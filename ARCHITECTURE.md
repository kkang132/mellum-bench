# Architecture

Normative. Every rule marked **MUST** binds any agent, human or otherwise, that edits this repository;
a violation fails review. The document is the single source of intent, so that the code need not be
re-read to recover it.

## 1. Definitions

- **Arm A.** A token-frugal advisor (Claude Opus 4.7) emits one plan per task; three open harnesses
  (`codex`, `opencode`, `pi`), each driving a local **Mellum2** model, execute it. Marginal worker cost
  is ≈ 0.
- **Arm B.** Headless Claude (Opus 4.7) performs the whole task, spawning its own subagents.
- **Run.** A single fair pass: 1 regime × {A, B} × 5 tasks. Workers receive context inline; no tool-use,
  which would penalise a small model. Each task is scored by two lenses (§4).
- **Lenses.** (i) a deterministic substance check (free, reproducible — the anchor); (ii) an Opus 4.8
  judge (the headline quality metric). Separation is read along the shallow→deep task ordering.

## 2. Layering — **MUST**

Dependencies flow one way:

```
config + fixtures (data)        scoring (pure)
        │                             │
        ▼                             ▼
backend ──▶ harnesses ──▶ arms ──▶ runner ──▶ metrics
```

- `backend` MUST NOT import `harnesses`, `arms`, or `runner`; `harnesses` MUST NOT import `arms`;
  `scoring` MUST NOT import `backend`, `harnesses`, or `arms`.
- `scoring` MUST be pure: no network, no filesystem, no clock. Input ↦ score.
- `config` and `fixtures` are data; they carry no behaviour.

## 3. Component contracts — **MUST**

- A harness adapter (`src/harnesses/*.ts`) MUST implement `Harness` (`types.ts`) and return a normalised
  `RunResult`. It knows its `DriveMode` and nothing of arms or regimes.
- The advisor (`src/arms/advisor.ts`) is the sole frontier component permitted within Arm A and MUST be
  planning-only: it emits a plan, executes no tools, and is token-capped. Its usage is charged to Arm A.
- All Arm A *worker* traffic MUST traverse the metering proxy (`src/backend/meter.ts`), never `:8080`
  directly; the proxy is the single source of worker token and latency truth.

## 4. Scoring — **MUST**

Both lenses run on every task. The deterministic checker is the gate; the judge is quality only. Neither
may be removed — the anchor exists precisely to expose judge misbehaviour and same-family bias. Answers
are wrapped in `<answer>…</answer>`; scorers strip reasoning and grade that region alone, so the Thinking
variant's verbosity does not penalise a correct answer.

## 5. Models — **MUST**

Advisor, Arm B, and Arm B's subagents on `claude-opus-4-7`; judge on `claude-opus-4-8`. No call runs
unpinned. Every `claude` invocation's `modelUsage` MUST be persisted per outcome.

## 6. Determinism — **MUST**

Tasks read only from `fixtures/`; no live network in inputs or scoring. Deterministic scores are stable
across runs. Model nondeterminism is confined to arm execution and the judge, never the gate.

## 7. Cost — **MUST**

Local Mellum2 is priced at 0 in `config/pricing.yaml`. Claude cost is taken from `total_cost_usd`
(authoritative); cache-creation and cache-read tokens are preserved. Arm A cost = advisor + Σ worker
(≈ 0); Arm B cost = Σ Claude. Cost-efficiency is computed in `src/metrics.ts`, never hard-coded.

## 8. Security — **MUST** (enforced by `test/security/*`)

- Harnesses run with a dummy key (`MELLUM_DUMMY_KEY`) and a sandboxed working directory. No real secret
  enters a harness environment. (`pi` has no sandbox of its own; this confinement is mandatory.)
- Every dependency is exact-versioned and integrity-hashed in `package-lock.json`. No range, `latest`,
  or floating ref, in dependencies or scripts.
- Installed harness versions equal the pins in `config/harness-manifest.toml`.
- No script pipes a download into a shell. All URLs are `https` (localhost endpoints excepted).
- `osv-scanner` and `npm audit` report no High or Critical advisory.

## 9. Auditability — **MUST**

For each task and arm, persist under `results/work/<task>/<arm>/`: the advisor plan, each worker stage,
the final answer, Arm B's full transcript, and the model-usage map.

## 10. Extension — the sole sanctioned procedure

- **A harness.** Implement `Harness` in `src/harnesses/<name>.ts`; register it in `index.ts`; pin its
  version in `config/harness-manifest.toml`; add its install line to `scripts/setup.sh`; add it to the
  security manifest test. No other module imports an adapter directly.
- **A task.** Add a spec to `config/tasks.yaml` and fixtures to `fixtures/`; add a checker case to
  `src/scoring/deterministic.ts`. Tasks remain within summarisation and context-gathering.
- **Behaviour** is passed via typed config; component code MUST NOT branch on regime or task identifiers.
