# Results

A single run (n = 1). Cost figures are reproducible; quality figures are directional. Raw artefacts
(`results/report.json`, transcripts) are not committed. Regenerate with `npm run bench`.

## Configuration

- One fair run: 1 regime × {A, B} × 5 tasks. Workers receive context inline; no tool-use.
- Pinned models: advisor, Arm B, and Arm B subagents on `claude-opus-4-7`; judge on `claude-opus-4-8`.
- Mellum2: `Mellum2-12B-A2.5B-Thinking-Q5_K_M` on llama.cpp built from source, context 32768.

## Headline

Both arms solved all five tasks (5/5 deterministic pass). Judged quality was a near-tie. The separation
is cost and speed.

| | Arm A (advisor + Mellum2) | Arm B (Claude + subagents) |
|---|---|---|
| Deterministic pass | 5/5 | 5/5 |
| Mean judge quality (clean) | ≈ 0.99 | ≈ 0.94 |
| Total cost (5 tasks) | $0.94 | $2.03 |
| Cost per solved task | **$0.19** | $0.41 |
| Latency per task | 107 s | **25 s** |

Arm A matched frontier quality at about 46% of the cost per outcome, and ran about four times slower.

## Per-task judge quality (0–1)

| Task (depth) | Arm A | Arm B |
|---|---|---|
| t1 signatures (shallow) | 1.00 | 0.97 |
| t2 changelog (shallow) | 0.97 | 0.90 |
| t3 import-trace (medium) | 1.00 | 0.95 |
| t4 config-resolution (deep) | 1.00 | ⚠ judge parse-fail |
| t5 root-cause (deep) | ⚠ judge parse-fail | 0.95 |

⚠ marks a judge call that failed to emit structured output. Such cells are excluded from the means. They
are not real zeros.

## Latency, decomposed

Arm A ran about 4.3 times slower than Arm B as built (107 s against 25 s per task). The cause is the
pipeline's shape, not the model. A single local Mellum call beats Arm B on four of five tasks.

| task | Arm A (pipeline) | Arm B | single Mellum call | A/B |
|---|---|---|---|---|
| t1 | 92 s | 21 s | 5 s | 4.3× |
| t2 | 77 s | 20 s | 13 s | 3.8× |
| t3 | 151 s | 21 s | 5 s | 7.3× |
| t4 | 42 s | 27 s | 8 s | 1.5× |
| t5 | 172 s | 34 s | 62 s | 5.0× |
| **mean** | **107 s** | **25 s** | **18 s** | **4.3×** |

Where the time goes. Each stage is an agent loop, not one call. On t3 the pipeline issued 8 Mellum calls
(17,080 tokens); `pi` alone looped five times for 13.5 k tokens. These ran sequentially behind a Claude
advisor round-trip, to do what one call does in about 5 s. Four costs compound: agent-loop call
multiplication; Thinking-token volume per call; re-ingestion of the corpus and a 12–14 k-token harness
prompt at every stage; strict serial execution with the advisor.

Caveat. Call counts and token volumes are reliable. Exact per-stage seconds are not: the call log is
concurrency-contaminated for some tasks (t3's 263 s call-span exceeds its 151 s wall). Per-call overhead
(about 1 s) and per-harness walls were measured separately and are clean.

## Likely optimisation

The latency is the pipeline's shape, so the remedies are structural. In order of expected effect:

1. **Swap to the Instruct variant.** This is likely the single largest win. The runs above used
   `Mellum2-12B-A2.5B-Thinking`, and the decomposition shows reasoning-token volume is the dominant
   driver of both latency and Mellum token spend. Switching the workers to
   `Mellum2-12B-A2.5B-Instruct` (set `MELLUM_MODEL=mellum2-instruct`; already wired in the provider
   configs) drops the per-call Thinking tokens to near zero, which should sharply cut per-call wall
   time across every stage with little quality loss on these retrieval/summarisation tasks. Because it
   applies to all calls in the pipeline rather than reshaping it, it is the cheapest high-impact change
   and should be tried first.
2. **Adaptive depth.** A single local call already matches the pipeline's quality at about 5–13 s. The
   advisor should choose depth: one call for retrieval and summarisation, the three-stage pipeline only
   for work that genuinely decomposes. This alone brings Arm A to the single-call floor, below Arm B, on
   these tasks. It is the largest structural gain.
3. **Parallelise.** Where decomposition is warranted, run independent gather and summarise sub-tasks
   concurrently. Only the final synthesis must wait. This removes the strict serial chain.
4. **Bound generation.** Cap Thinking and output tokens per call. Reasoning-token volume is the dominant
   cost, and these tasks need little.
5. **Stop re-ingesting the corpus.** Give each stage the previous stage's distilled output, not the full
   corpus and the 12–14 k-token harness prompt again.
6. **Gate the advisor.** Omit the frontier planning round-trip on simple tasks.

## Caveats

- n = 1. Quality is directional.
- The judge fails to emit structured output in about 20% of calls (the two cells above).
- codex addresses `/v1/responses`, whose token counts the proxy does not parse; its throughput is unmeasured.
- Two earlier findings were measurement bugs, since fixed: Arm B's terse `result` capture, now the full
  transcript via stream-json; and judge JSON parse failure, now structured output via `--json-schema`.
