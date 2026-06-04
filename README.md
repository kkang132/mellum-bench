# mellum-bench

A benchmark of two architectures for summarisation and context-gathering: **Arm A**, a frontier
*advisor* (Claude Opus 4.7) that plans once and delegates execution to local **Mellum2** workers
behind three open harnesses (`codex`, `opencode`, `pi`); and **Arm B**, Claude (Opus 4.7) performing
the whole task with its own subagents. The same five tasks are scored by two lenses — a deterministic
substance check and an Opus 4.8 judge.

The contract that governs the code is [`ARCHITECTURE.md`](./ARCHITECTURE.md); read it before editing.

## 1. The question

Not which arm is superior, but *where the two cross*: for which task depth does frontier-planning with
cheap local execution cease to suffice? Arm A's workers are local, hence ≈ $0 at the margin; its only
paid component is the advisor. Arm B pays frontier rates throughout. Cost and quality are therefore the
two axes, and the crossover along the shallow→deep task ordering is the object of interest.

## 2. Prerequisites

- Node ≥ 24, npm.
- Mellum2 served on llama.cpp at `http://127.0.0.1:8080` (§3).
- `claude` CLI, authenticated; used by the advisor and by Arm B. **These calls are paid.** Invoked
  directly by default; for wrapped/proxied auth set `CLAUDE_CMD` / `CLAUDE_PREFIX_ARGS` (see `.env.example`).
- Harness CLIs at pinned versions (installed by `npm run setup`): `codex`, `opencode`, `pi`.
- `osv-scanner` (Homebrew), for the security gate.

## 3. Serving Mellum2 on llama.cpp

The GGUF carries the architecture tag `mellum`. Support for it (`LLM_ARCH_MELLUM`) entered llama.cpp at
build **b9482**; the Homebrew bottle and Ollama lag behind and reject the model with
`unknown model architecture: 'mellum'`. Build from source.

```bash
# 1. llama.cpp pinned to a verified commit (contains src/models/mellum.cpp). Metal on Apple Silicon;
#    CUDA on NVIDIA. The pin gives a reproducible build; bump it deliberately, not implicitly.
git clone https://github.com/ggml-org/llama.cpp.git && cd llama.cpp && git checkout 65ef50a
cmake -B build -DGGML_METAL=ON -DLLAMA_CURL=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j --target llama-server

# 2. The high-bit quantisation (avoid Q4_0: perplexity doubles, tokens repeat). Pin the HF revision
#    and verify the file hash — a community re-upload cannot silently change under you.
hf download CodeFault/Mellum2-12B-A2.5B-Thinking-GGUF --include "*Q5_K_M*" --local-dir ./mellum2-q5km
echo "931c9059dac9ebceaf7e728209a44e61813fa389f5c3622ca1ca13e4633b51e7  ./mellum2-q5km/Mellum2-12B-A2.5B-Thinking-Q5_K_M.gguf" | shasum -a 256 -c

# 3. Serve. ctx-size ≥ 32768: the agent harnesses send large system prompts.
./build/bin/llama-server -m ./mellum2-q5km/Mellum2-12B-A2.5B-Thinking-Q5_K_M.gguf \
  --host 127.0.0.1 --port 8080 --ctx-size 32768 --n-gpu-layers 99 \
  --temp 0.6 --top-p 0.95 --top-k 20 --jinja
```

Mellum2-12B-A2.5B-Thinking is a mixture of experts (12 B total, ≈ 2.5 B active; 64 experts, 8 per token),
mixed sliding-window (`n_swa = 1024`) and full attention, trained context 131 072, YaRN rope. It emits
reasoning before its answer; downstream parsing must strip it.

## 4. Checkout and setup

```bash
git clone https://github.com/kkang132/mellum-bench.git && cd mellum-bench
npm ci --ignore-scripts   # exact, integrity-checked install; --ignore-scripts neutralises postinstall attacks (this tree needs no install scripts)
npm run setup             # pinned harnesses (codex, opencode, pi) + osv-scanner + Pi provider config
```

Git hooks are enabled by `npm run setup` (via `core.hooksPath .githooks`): **pre-commit** secret-scans
staged files (secretlint), **pre-push** type-checks (`tsc --noEmit`). Override in emergencies with
`SKIP_SECRETLINT=1` / `SKIP_TYPECHECK=1`.

Order of preliminaries: (i) Node ≥ 24; (ii) **build llama.cpp from source and serve the Mellum2 Q5_K_M
GGUF** — §3 gives the exact `git clone` / `cmake` / `hf download` / `llama-server` commands (Ollama and
the Homebrew bottle will *not* work; they reject arch `mellum`); (iii) authenticate the `claude` CLI;
(iv) the two commands above. Harnesses reach Mellum2 through a metering proxy with a dummy key only;
no real secret enters a worker.

## 5. Running

```bash
npm run test:unit   # offline: unit tests + security/supply-chain gate + ≥ 80% coverage. Free.
npm run smoke       # one local Mellum2 call per harness through the proxy. Free.
npm run bench       # the full benchmark. Paid: advisor + Arm B call Claude.
npm run profile     # per-harness latency decomposition (model vs harness). Free, local.
npm run rejudge     # re-score persisted answers with the judge only. Paid, but cheap.
```

`bench` writes `results/report.json` and persists, under `results/work/<task>/<arm>/`, the advisor plan,
each worker stage, the final answer, Arm B's transcript, and the per-model usage map.

## 6. Output

One table over both arms, scored by both lenses, plus two verdicts (cost-efficiency; judge quality) and,
for each lens, the crossover task — the first point, shallow→deep, at which Arm B overtakes Arm A.

## 7. Observed (single run; illustrative, not definitive)

Both arms solved all five tasks; judged quality was a near-tie at the top (Arm A ≈ 0.99, Arm B ≈ 0.94 on
cleanly judged tasks). The separation lay in cost and speed:

| | Arm A (advisor + Mellum2) | Arm B (Claude + subagents) |
|---|---|---|
| Cost per solved task | ≈ $0.19 | ≈ $0.41 |
| Latency per task | ≈ 107 s | ≈ 25 s |

The hybrid matched frontier quality at roughly half the cost per outcome, but some four times slower. The
latency is dominated by model generation (the Thinking variant emits thousands of tokens per call) and by
`opencode` spawning a background server whose concurrent calls saturate a single GPU; per-call harness
overhead is ≈ 1 s, hence negligible. n = 1; treat as directional. Full table, per-task quality, and the
latency decomposition are in [`RESULTS.md`](./RESULTS.md).

## 8. Known limitations

- The Opus 4.8 judge occasionally fails to emit structured output (~20% of calls); affected scores are
  recorded as parse failures, not zeros, and excluded from means.
- codex addresses `/v1/responses`, whose token counts the proxy does not parse; its throughput is unmeasured.
- `opencode`'s background server bleeds calls across pipeline stages, which inflates Arm A latency and
  confounds strict per-stage attribution.
- Results are a single run. The cost figures are reproducible; the quality figures are directional.
