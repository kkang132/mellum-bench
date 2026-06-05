# Agent Guide

## 0. Read This First

This file has two parts.

1. **Operational instructions** for agents of any ability. Follow these when editing the repo.
2. **Proof-based validation** for high-capability models only. If you are at or below the capability
   level of Opus 4.7 or GPT-5.5, do not spend reasoning budget re-proving the formal section. Use the
   operational instructions and the machine checks instead.

If a proof and a machine check disagree, trust the machine check and inspect the code.

## 1. Operational Instructions for Agents

### 1.1 Safe default workflow

1. Read `ARCHITECTURE.md` before changing benchmark logic.
2. Prefer small changes. This is an illustrative benchmark, not production infrastructure.
3. After code changes, run:

   ```bash
   npm run test:unit
   ```

4. Do not run paid commands unless the user explicitly asks:

   ```bash
   npm run bench
   npm run rejudge
   ```

5. Do not bypass secret scans, type checks, or security tests unless the user explicitly asks.
6. Do not introduce real API keys into worker harnesses. Workers should use dummy keys and the local
   proxy.
7. Do not introduce network access into task fixture loading. Tasks should read local fixture files.

### 1.2 Useful commands

```bash
npm run test:unit   # offline unit tests, coverage, security/supply-chain checks
npm run smoke       # local Mellum2 smoke test through the proxy
npm run profile     # local per-harness latency profile
npm run bench       # full benchmark; paid Claude calls
npm run rejudge     # judge persisted answers; paid Claude calls
```

### 1.3 Where to edit

- Task definitions: `config/tasks.yaml`
- Regime and harness pipeline: `config/regimes.yaml`
- Task loading and fixture rendering: `src/tasks.ts`
- Benchmark runner: `src/runner.ts`
- Arm A orchestration: `src/arms/armA.ts`
- Arm B orchestration: `src/arms/armB.ts`
- Claude invocation: `src/arms/claude.ts`
- Harness registry: `src/harnesses/index.ts`
- Harness implementations: `src/harnesses/*.ts`
- Metrics and crossover logic: `src/metrics.ts`

### 1.4 Common tasks

To add a task:

1. Add fixture files under the fixture corpus.
2. Add the task to `config/tasks.yaml`.
3. Choose a supported deterministic success spec.
4. Run `npm run test:unit`.

To add a harness:

1. Implement `src/harnesses/<name>.ts` using the `Harness` interface.
2. Register it in `src/harnesses/index.ts`.
3. Pin its version in `config/harness-manifest.toml`.
4. Update `scripts/setup.sh`.
5. Update `test/security/supply-chain.test.ts`.
6. Reference it from `config/regimes.yaml` if Arm A should use it.
7. Run `npm run test:unit`.

### 1.5 High-risk areas

- `src/arms/claude.ts` makes real Claude calls when used by advisor, Arm B, or judge paths.
- `npm run bench` and `npm run rejudge` are paid.
- `src/tasks.ts` is part of the determinism and local-corpus contract.
- `src/bin/profile.ts` kills local harness processes by name; keep subprocess invocation shell-free.

## 2. Proof-Based Validation Gate

This section is for formal cross-checking. If you are at or below Opus 4.7 or GPT-5.5 capability,
skip the proofs and run the machine checks. Stronger models may read the proofs, but each proof has
an executable check that should be preferred when there is doubt.

To run all lightweight machine checks in this document, use the commands printed below each proof.
The full project check remains:

```bash
npm run test:unit
```

## 3. Formal Protocol and Machine Checks

### 3.1 Preliminaries

Let `T` be the ordered list of tasks returned by `loadTaskList`. Each task has a depth in
`{shallow, medium, deep}`, a prompt, a fixture list, and a success specification. Let
`A = {Arm A, Arm B}` be the two arms declared in `runner.ts`.

**Definition 3.1.** An outcome is a record

```text
(taskId, depth, arm, regimeId, pass, quality, costUsd, latencyMs, models)
```

where `pass` is the deterministic success indicator, `quality` is the optional judge score,
`costUsd` is the arm cost, `latencyMs` is the arm latency, and `models` records model usage.

The runner is intended to produce one outcome for each ordered pair `(task, arm)` which completes
without an uncaught exception.

### 3.2 Setup Phase

**Proposition 3.2.** If execution reaches the first arm invocation, then the runner has established
the following facts:

1. Mellum2 is reachable at `http://127.0.0.1:8080`.
2. The results directory has been removed and recreated.
3. The metering proxy has been started on port 8077 and points at the Mellum2 upstream.

**Proof.** The function `runBenchmark` first checks reachability with `isUp(UPSTREAM)`. It then
executes `rmSync(opts.resultsDir, { recursive: true, force: true })`, recreates the directory with
`mkdirSync`, and starts the proxy with `startMeter({ port: PROXY_PORT, upstream: UPSTREAM, ... })`.
Thus the three assertions follow directly from the program text. ∎

**Machine check.**

```bash
grep -n 'isUp(UPSTREAM)\|rmSync(opts.resultsDir\|mkdirSync(opts.resultsDir\|startMeter' src/runner.ts
```

**Remark 3.3.** Fixture validation is not a separate global setup step. It is performed when an arm
calls `readFixtures`. Since both arms read fixtures before constructing their corpus, malformed
fixture references fail before the corresponding model or harness call is made.

**Machine check.**

```bash
grep -n 'readFixtures' src/arms/armA.ts src/arms/armB.ts
grep -n 'realpathSync\|Path traversal attempt' src/tasks.ts
```

### 3.3 Execution Phase

For each task `t` in `T`, and for each arm `a` in `[armA, armB]`, `runBenchmark` performs the
following operations:

1. Create the working directory `results/work/<task>/<arm>`.
2. Construct an arm context containing the working directory, repository root, proxy URL, dummy key,
   timeout, and meter-context setter.
3. Invoke `a.run(t, regime, context)` to obtain an arm result.
4. Score the result text with `scoreDeterministic`.
5. Score the same result text with `judgeAnswer`.
6. Persist the answer, available artifacts, and score record.
7. Append a `TaskOutcome` to the `outcomes` array.

**Theorem 3.4.** If every arm invocation, deterministic scoring call, judge invocation, artifact
persistence step, and final report write returns normally, then the final report contains exactly
`|T| × 2` outcomes.

**Proof.** The nested loops in `runBenchmark` visit every element of `T × [armA, armB]` exactly
once. Under the stated hypothesis, execution reaches the single `outcomes.push(...)` statement in
each iteration. No statement removes an outcome. The final report is then constructed from this
array and written normally. Hence exactly two outcomes are appended for each task and the written
report contains them. ∎

**Machine check.**

```bash
grep -n 'const ARMS\|for (const task of tasks)\|for (const arm of ARMS)\|outcomes.push' src/runner.ts
grep -n 'const ARMS: Arm\[\] = \[armA, armB\]' src/runner.ts
```

**Corollary 3.5.** If an uncaught exception is thrown by an arm, by scoring, or by persistence, the
theorem need not hold; the function exits after the `finally` block stops the meter.

**Machine check.**

```bash
grep -n 'try {' -A60 src/runner.ts | grep -n 'finally\|meter.stop\|catch' || true
```

### 3.4 Scoring Phase

Each completed arm result is scored by two lenses:

- **Deterministic lens.** Computes `pass` from the result text and the task success specification.
  This path is pure and incurs no model cost.
- **Judge lens.** Computes `quality` by calling the judge through `judgeAnswer`. If the judge cannot
  produce a parsed score, the quality field may be absent.

The deterministic lens supplies the reproducible anchor. The judge lens supplies the headline
quality comparison when a parsed score is available.

**Machine check.**

```bash
grep -n 'scoreDeterministic\|judgeAnswer\|quality: judged.quality\|pass: det.pass' src/runner.ts
```

### 3.5 Reporting Phase

The report contains:

1. The raw outcomes.
2. One aggregate per `(regime, arm)` produced by `aggregate`.
3. A cost-efficiency verdict produced by `decideWinner(..., "success_per_dollar")`.
4. A quality verdict produced by `decideWinner(..., "quality_only")`.
5. Crossover points from `findCrossover`, walking tasks in shallow-to-deep order.

Observe that `decideWinner` uses `successPerDollar`, not `passRate / meanCost`. These quantities
coincide only up to a factor of the number of outcomes when the compared groups have equal size.

**Machine check.**

```bash
grep -n 'aggregate(outcomes)\|decideWinner\|findCrossover\|successPerDollar' src/runner.ts src/metrics.ts
```

### 3.6 Arm A

Arm A asks the advisor for a plan, then executes the configured Mellum2 harness pipeline.

In the checked-in `fair` regime, the pipeline is:

```text
gather     -> codex
summarize  -> opencode
synthesize -> pi
```

**Proposition 3.6.** Arm A executes the configured pipeline sequentially.

**Proof.** In `armA.ts`, the loop

```text
for (const stage of regime.pipeline) { ... await h.run(...) ... }
```

awaits each harness call before advancing to the next stage. The variable `carry` is updated after
each call and used when constructing the next stage prompt. Thus the pipeline is sequential and the
later stages can depend on the previous stage output. ∎

**Machine check.**

```bash
grep -n 'for (const stage of regime.pipeline)\|await h.run\|carry =' src/arms/armA.ts
cat config/regimes.yaml
```

### 3.7 Arm B

Arm B constructs a single prompt containing the task and rendered corpus, then invokes `runClaude`
with:

```text
model: claude-opus-4-7
allowedTools: ["Task"]
agents: AGENTS
streamJson: true
```

The custom `worker` subagent is pinned to the same model. The transcript text returned by
`runClaude` is persisted as the Arm B transcript.

**Machine check.**

```bash
grep -n 'ARM_B_MODEL\|allowedTools\|agents: AGENTS\|streamJson\|transcript' src/arms/armB.ts
```

### 3.8 Error Handling and Resource Management

**Proposition 3.7.** Once the metering proxy has been started, `runBenchmark` attempts to stop it
whether the benchmark loop succeeds or fails.

**Proof.** The benchmark loop is enclosed in a `try ... finally` statement, and the `finally` block
contains `await meter.stop()`. JavaScript executes the `finally` block after normal completion and
after an exception. ∎

**Machine check.**

```bash
grep -n 'try {' -A65 src/runner.ts | grep -n 'finally\|meter.stop'
```

**Proposition 3.8.** Errors inside the Claude subprocess boundary are converted into `ClaudeResult`
records rather than thrown by `runClaude`.

**Proof.** The `close` handler resolves with `{ ok: false, error: ... }` when parsing fails or a
timeout occurs. The `error` handler also resolves with `{ ok: false, error: String(e) }`. Neither
handler rejects the promise. ∎

**Machine check.**

```bash
grep -n 'proc.on("close"\|proc.on("error"\|resolve({ text: "", usage: zeroUsage(), models: {}, latencyMs' src/arms/claude.ts
```

**Remark 3.9.** This proposition is deliberately local to `runClaude`. The outer runner does not
catch arbitrary arm or persistence exceptions and does not synthesize failed outcomes for such
exceptions.

### 3.9 Extension Points

To add a harness `h`:

1. Implement the `Harness` interface in `src/harnesses/<h>.ts`.
2. Register `h` in `src/harnesses/index.ts`.
3. Pin the version in `config/harness-manifest.toml`.
4. Add the installation command to `scripts/setup.sh`.
5. Add a version check to `test/security/supply-chain.test.ts`.
6. Reference the harness name from a regime pipeline entry if Arm A should use it.

**Theorem 3.10.** A registered harness satisfying the `Harness` interface can be used by Arm A
without changing `armA.ts`.

**Proof.** Arm A obtains harnesses only through `getHarness(stage.harness)`. It then calls the
interface method `run` on the returned value. Therefore a new registered harness with the required
name and interface is selected by configuration, not by a change to the orchestration logic. ∎

**Machine check.**

```bash
grep -n 'interface Harness\|run(input' src/harnesses/types.ts
grep -n 'HARNESSES\|getHarness' src/harnesses/index.ts src/arms/armA.ts
```

To add a task `t`:

1. Create fixture files under the fixture corpus.
2. Add `t` to `config/tasks.yaml` with the required fields.
3. Define a success specification supported by `scoreDeterministic`.
4. Choose the depth intentionally, since depth order is used for crossover detection.

**Remark 3.11.** Misclassifying task depth does not change the score for an individual task, but it
can change the reported crossover point.

**Machine check.**

```bash
grep -n 'DEPTH_ORDER\|byDepth\|loadTaskList' src/tasks.ts
grep -n 'findCrossover' src/runner.ts src/metrics.ts
```

### 3.10 Cost and Latency Accounting

The metering proxy records request metadata for local worker calls. Claude invocations report their
own cost and model usage through the parsed CLI JSON. The final arm cost is the `costUsd` field in
the arm result. For Arm A this is the advisor cost plus any metered worker usage added by
`addUsage`; for Arm B it is the cost parsed from Claude.

In schematic form, the aggregate cost is:

```text
totalCostUsd = sum(outcome.costUsd for outcome in selected outcomes)
```

The cost-efficiency comparison is:

```text
successPerDollar = passCount / max(totalCostUsd, 1e-9)
```

**Machine check.**

```bash
grep -n 'addUsage\|costUsd\|totalCostUsd\|successPerDollar' src/arms/armA.ts src/arms/armB.ts src/arms/claude.ts src/metrics.ts
```

## 4. Closing Convention

This document describes the current execution protocol. Where a claim is conditional, its hypothesis
is part of the claim; removing the hypothesis generally makes the assertion false.
