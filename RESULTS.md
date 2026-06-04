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

Per-call harness overhead is ≈ 1 s — negligible. Wall-clock is dominated by model generation: the
Thinking variant emits 1000–5000 tokens per call. Arm A's inflation beyond that is `opencode`, which
spawns a background server whose concurrent calls saturate a single GPU, dropping effective throughput
from ≈ 144 tok/s (single stream) to ≈ 20–35 tok/s (contended). Mellum2 itself is fast; the harness layer
is the cost.

## Caveats

- n = 1. Quality is directional.
- The judge fails to emit structured output in ≈ 20% of calls (two cells above).
- codex addresses `/v1/responses`; the proxy does not parse its token counts, so its throughput is unmeasured.
- Two earlier "findings" were measurement bugs, since fixed: Arm B's terse `result` capture (now full
  transcript via stream-json) and judge JSON parse failure (now `--json-schema` → `structured_output`).
