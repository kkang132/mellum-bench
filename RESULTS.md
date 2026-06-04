# Results

A single run (n = 1). The cost figures are reproducible; the quality figures are directional. Raw
artifacts (`results/report.json`, transcripts) are not committed; regenerate with `npm run bench`.

## Configuration

- One fair run: 1 regime × {A, B} × 5 tasks; workers given context inline (no tool-use).
- Models, pinned: advisor, Arm B, and Arm B subagents `claude-opus-4-7`; judge `claude-opus-4-8`.
- Mellum2: `Mellum2-12B-A2.5B-Thinking-Q5_K_M` on llama.cpp (built from source), ctx 32768.

## Headline

Both arms solved all five tasks (5/5 deterministic pass). Judged quality was a near-tie at the top.
The separation is cost and speed.

| | Arm A (advisor + Mellum2) | Arm B (Claude + subagents) |
|---|---|---|
| Deterministic pass | 5/5 | 5/5 |
| Mean judge quality (clean) | ≈ 0.99 | ≈ 0.94 |
| Total cost (5 tasks) | $0.94 | $2.03 |
| Cost per solved task | **$0.19** | $0.41 |
| Latency per task | 107 s | **25 s** |

The hybrid matched frontier quality at ≈ 46% of the cost per outcome, but ≈ 4× slower.

## Per-task judge quality (0–1)

| Task (depth) | Arm A | Arm B |
|---|---|---|
| t1 signatures (shallow) | 1.00 | 0.97 |
| t2 changelog (shallow) | 0.97 | 0.90 |
| t3 import-trace (medium) | 1.00 | 0.95 |
| t4 config-resolution (deep) | 1.00 | ⚠ judge parse-fail |
| t5 root-cause (deep) | ⚠ judge parse-fail | 0.95 |

⚠ marks a judge that failed to emit structured output; excluded from the means above (not a real 0).

## Latency, decomposed

Arm A is ~4.3× slower than Arm B as built (107 s vs 25 s/task), but this is the pipeline's *shape*, not the
model: a single local Mellum call beats Arm B on four of five tasks.

| task | Arm A (pipeline) | Arm B | single Mellum call | A/B |
|---|---|---|---|---|
| t1 | 92 s | 21 s | 5 s | 4.3× |
| t2 | 77 s | 20 s | 13 s | 3.8× |
| t3 | 151 s | 21 s | 5 s | 7.3× |
| t4 | 42 s | 27 s | 8 s | 1.5× |
| t5 | 172 s | 34 s | 62 s | 5.0× |
| **mean** | **107 s** | **25 s** | **18 s** | **4.3×** |

**Where Arm A's time goes.** Each "stage" is an agent loop, not one call. On t3 the pipeline issued 8 Mellum
calls (17,080 tokens) — `pi` alone looped 5× for 13.5 k tokens — run sequentially behind a Claude advisor
round-trip, versus ~5 s for one raw call. The cost is (1) agent-loop call multiplication, (2) Thinking-token
volume per call, (3) each stage re-ingesting the corpus + a 12–14 k-token harness prompt + the prior output,
(4) strict serial execution + advisor.

**Caveat.** Call counts and token volumes are reliable; exact per-stage *seconds* are not — the run's call
log is concurrency-contaminated for some tasks (t3's 263 s call-span exceeds its 151 s wall). Per-call
overhead (~1 s) and per-harness walls were measured separately and are clean.

## Likely optimisation

The latency is the pipeline's shape, so the fixes are structural, in order of expected impact:
1. **Adaptive depth.** A single local call already matches the pipeline's quality here at ~5–13 s. Let the
   advisor choose depth — one call for retrieval/summarisation, the three-stage pipeline only for genuinely
   decomposable work — rather than always running three stages. Alone, this brings Arm A to the single-call
   floor (below Arm B) on these tasks; the largest win.
2. **Parallelise.** Where decomposition is warranted, fan out independent gather/summarise sub-tasks
   concurrently; only the final synthesis must wait. Replaces the strict serial chain.
3. **Bound generation.** Cap per-call Thinking/output tokens — reasoning-token volume is the dominant cost
   and these tasks need little.
4. **Stop re-ingesting the corpus.** Pass each stage the prior stage's distilled output, not the full corpus
   + 12–14 k-token harness prompt again.
5. **Gate the advisor.** Skip the frontier planning round-trip on simple tasks.

## Caveats

- n = 1. Quality is directional.
- The judge fails to emit structured output in ≈ 20% of calls (two cells above).
- codex addresses `/v1/responses`; the proxy does not parse its token counts, so its throughput is unmeasured.
- Two earlier "findings" were measurement bugs, since fixed: Arm B's terse `result` capture (now full
  transcript via stream-json) and judge JSON parse failure (now `--json-schema` → `structured_output`).
