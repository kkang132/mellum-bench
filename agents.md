# Agent Execution Protocol

## 1. Preliminaries

Let $\mathcal{T}$ denote the set of tasks, each equipped with a depth indicator $d \in \{\text{shallow}, \text{medium}, \text{deep}\}$, a prompt $p$, a fixture set $F$, and a success specification $S$. Let $\mathcal{A} = \{A, B\}$ denote the two arms under comparison. The benchmark proceeds by Cartesian product: for each $(\tau, \alpha) \in \mathcal{T} \times \mathcal{A}$ we obtain an outcome $o(\tau, \alpha)$.

**Definition 1.1.** An *outcome* is a tuple $o = (\text{pass}, q, c, \ell, M)$ where:
- $\text{pass} \in \{0,1\}$ is the deterministic success indicator,
- $q \in [0,1] \cup \{\text{undefined}\}$ is the judge quality score,
- $c > 0$ is the cost in USD,
- $\ell > 0$ is the latency in milliseconds,
- $M$ is the multiset of model invocations with associated token counts.

The benchmark shall produce the set $\mathcal{O} = \{o(\tau, \alpha) : (\tau, \alpha) \in \mathcal{T} \times \mathcal{A}\}$.

## 2. The Execution Protocol

### 2.1 Setup Phase

Proposition 2.1. Before execution commences, the following invariants shall be established:

1. The Mellum2 model shall be available at `http://127.0.0.1:8080`.
2. The metering proxy shall be started on port 8077, forwarding to the upstream.
3. The results directory shall be emptied and recreated.
4. Each task fixture shall be validated to exist within the repository root.

*Proof.* The setup function in `runner.ts` checks (1) via `isUp()`, establishes (2) via `startMeter()`, enforces (3) via `rmSync` followed by `mkdirSync`, and ensures (4) via `readFixtures()`. ∎

### 2.2 Execution Phase

For each $\tau \in \mathcal{T}$ ordered by increasing depth, and for each $\alpha \in \mathcal{A}$:

1. Create the working directory $W_{\tau,\alpha} = \text{results}/\text{work}/\tau/\alpha$.
2. Construct the arm context $\Gamma = (W_{\tau,\alpha}, \text{repoRoot}, \text{proxyUrl}, \text{dummyKey}, \text{timeoutMs}, \text{setMeterContext})$.
3. Invoke $\alpha.\text{run}(\tau, \text{regime}, \Gamma)$ to obtain the result $r$.
4. Score $r$ deterministically: $d = \text{scoreDeterministic}(r.\text{text}, \tau.\text{success})$.
5. Score $r$ via judge: $j = \text{judgeAnswer}(\tau, r.\text{text}, \Gamma)$.
6. Persist $r$, $d$, $j$, and associated artifacts to $W_{\tau,\alpha}$.
7. Record the outcome $o = (d.\text{pass}, j.\text{quality}, r.\text{usage}.\text{costUsd}, r.\text{latencyMs}, r.\text{models})$.

**Theorem 2.2.** Upon completion of the execution phase, $\mathcal{O}$ contains exactly $|\mathcal{T}| \cdot |\mathcal{A}|$ outcomes.

*Proof.* The nested iteration visits each element of $\mathcal{T} \times \mathcal{A}$ exactly once. Each iteration produces one outcome by construction, and no outcome is discarded. ∎

### 2.3 Scoring Phase

Each outcome is scored by two independent lenses:

- **Deterministic lens:** Computes $\text{pass} \in \{0,1\}$ via pure logic on $r.\text{text}$ against $\tau.\text{success}$. This is reproducible and cost-free.
- **Judge lens:** Computes $q \in [0,1]$ by submitting $r.\text{text}$ to an Opus 4.8 judge with the task specification. This is non-deterministic and incurs cost.

The two lenses are orthogonal: the deterministic lens provides an anchor, while the judge lens estimates perceived quality.

### 2.4 Reporting Phase

Let $\text{aggregate}: \mathcal{P}(\mathcal{O}) \to \mathbb{R}^4$ map a set of outcomes to the tuple $(\text{success rate}, \text{mean quality}, \text{mean cost}, \text{mean latency})$ per arm. The report shall contain:

1. The raw outcomes $\mathcal{O}$.
2. The aggregates $\text{aggregate}(\{o(\tau, A) : \tau \in \mathcal{T}\})$ and $\text{aggregate}(\{o(\tau, B) : \tau \in \mathcal{T}\})$.
3. The cost-efficiency verdict: the arm with greater $\text{success rate} / \text{mean cost}$.
4. The quality verdict: the arm with greater $\text{mean quality}$.
5. The crossover points: the shallowest task at which $B$ overtakes $A$ on each metric.

## 3. Arm Architectures

### 3.1 Arm A (Hybrid)

Arm A employs a frontier advisor (Claude Opus 4.7) to generate a decomposition plan, then executes the plan using local Mellum2 workers through three harnesses: codex, opencode, and pi.

**Protocol.**
1. Advisor generates plan $\Pi = \langle \sigma_1, \sigma_2, \sigma_3 \rangle$ where each $\sigma_i$ has a stage indicator $s_i \in \{\text{gather}, \text{refine}, \text{synthesize}\}$ and a harness assignment $h_i \in \{\text{codex}, \text{opencode}, \text{pi}\}$.
2. For each $\sigma_i$ sequentially:
   a. Invoke $h_i.\text{run}(\text{prompt}, \text{corpus}, \text{constrained\_text}, \Gamma)$.
   b. Accumulate the output $y_i$.
3. Return the concatenation $y = y_1 \circ y_2 \circ y_3$.

**Remark 3.1.** The sequential execution is a deliberate design choice to preserve state between stages. The overhead is approximately $3 \times$ the single-call latency, which is the primary cost of this architecture.

### 3.2 Arm B (Frontier-only)

Arm B delegates the entire task to Claude Opus 4.7 with subagent capabilities.

**Protocol.**
1. Invoke Claude CLI with the task prompt and corpus, requesting subagent decomposition.
2. Claude autonomously spawns and coordinates subagents.
3. Return the final answer $y$.

**Remark 3.2.** Arm B pays frontier rates for all computation but requires no orchestration code. The latency is dominated by Claude's internal parallelism.

## 4. Error Handling and Resource Management

**Proposition 4.1.** The metering proxy shall be stopped regardless of execution success or failure.

*Proof.* The proxy lifecycle is wrapped in a `try...finally` block in `runner.ts`. The `finally` clause executes `meter.stop()` unconditionally. ∎

**Proposition 4.2.** If any arm invocation times out or throws, the error shall be caught, logged, and the outcome marked as failed.

*Proof.* Each arm implements timeout handling via `AbortController`. The outer loop does not terminate on individual failures; it records the partial outcome and continues. ∎

## 5. Extension Points

### 5.1 Adding a Harness

To add a new harness $h$:

1. Implement the `Harness` interface in `src/harnesses/$h$.ts`.
2. Register $h$ in `src/harnesses/index.ts`.
3. Pin the version in `config/harness-manifest.toml`.
4. Add the installation command to `scripts/setup.sh`.
5. Add a version check to `test/security/supply-chain.test.ts`.

**Theorem 5.1.** A harness satisfying the interface shall be usable by Arm A without modification to the orchestration logic.

*Proof.* Arm A accesses harnesses through the polymorphic `Harness` interface. The concrete type is erased at runtime; only the interface methods are called. ∎

### 5.2 Adding a Task

To add a new task $\tau$:

1. Create fixture files under `fixtures/repo/`.
2. Add $\tau$ to `config/tasks.yaml` with the required fields.
3. Define the success specification $S$ (one of: `set_subset`, `contains_word`, `contains_all`, `custom_regex`).
4. Ensure the depth indicator reflects the intended complexity.

**Remark 5.1.** The task depth ordering is used for crossover detection. Misclassification may obscure the crossover point but does not affect individual task scoring.

## 6. Cost and Latency Accounting

All model invocations are proxied through the metering proxy, which records:

- Timestamp $t$
- Latency $\ell$
- Prompt tokens $p$
- Completion tokens $c$
- Model identifier $m$

The proxy aggregates these records per context (task, arm, stage). The total cost is computed as:
$$
C = \sum_{i} (p_i \cdot \text{price}_{\text{prompt}}(m_i) + c_i \cdot \text{price}_{\text{completion}}(m_i))
$$

**Observation 6.1.** Arm A's cost is dominated by the single advisor call; the worker calls use dummy keys and are therefore free at the margin. Arm B's cost scales with the number of subagent invocations.

---

*This document specifies the deterministic execution protocol. Any deviation constitutes a protocol violation and shall invalidate the benchmark results.*