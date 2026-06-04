/** Orchestrates the single fair run (1 regime × {A,B} × 5 tasks) and scores each task by BOTH lenses:
 * the deterministic substance anchor and the Opus-4.8 judge (headline). Persists every plan, worker
 * output, final answer, Arm B transcript, and model-usage map for full auditability. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTaskList } from "./tasks.js";
import { loadRegimes, type Task } from "./config.js";
import { isUp } from "./backend/server.js";
import { startMeter } from "./backend/meter.js";
import { armA } from "./arms/armA.js";
import { armB } from "./arms/armB.js";
import type { Arm, ArmContext } from "./arms/types.js";
import { scoreDeterministic } from "./scoring/deterministic.js";
import { judgeAnswer } from "./scoring/judge.js";
import {
  aggregate,
  decideWinner,
  findCrossover,
  type ArmAggregate,
  type TaskOutcome,
  type WinnerVerdict
} from "./metrics.js";

const PROXY_PORT = 8077;
const UPSTREAM = "http://127.0.0.1:8080";

export interface RunnerOptions {
  repoRoot: string;
  tasksPath: string;
  regimesPath: string;
  resultsDir: string;
  dummyKey: string;
  timeoutMs: number;
}

export interface BenchReport {
  outcomes: TaskOutcome[];
  aggregates: ArmAggregate[];
  /** Two verdicts: cost-efficiency (deterministic success-per-$) and headline quality (judge). */
  verdictCost: WinnerVerdict;
  verdictQuality: WinnerVerdict;
  crossover: { pass: string | null; quality: string | null };
}

const ARMS: Arm[] = [armA, armB];

export async function runBenchmark(opts: RunnerOptions): Promise<BenchReport> {
  const tasks = loadTaskList(opts.tasksPath);
  const regime = loadRegimes(opts.regimesPath)[0]!; // v2: a single fair run

  if (!(await isUp(UPSTREAM))) {
    throw new Error(`Mellum2 not reachable at ${UPSTREAM}. Start llama-server first (see ~/models/AGENTS.md).`);
  }

  rmSync(opts.resultsDir, { recursive: true, force: true });
  mkdirSync(opts.resultsDir, { recursive: true });
  const meter = await startMeter({ port: PROXY_PORT, upstream: UPSTREAM, logPath: join(opts.resultsDir, "meter.jsonl") });

  const outcomes: TaskOutcome[] = [];
  try {
    for (const task of tasks) {
      for (const arm of ARMS) {
        const work = join(opts.resultsDir, "work", task.id, arm.id);
        mkdirSync(work, { recursive: true });
        const ctx: ArmContext = {
          cwd: work,
          repoRoot: opts.repoRoot,
          proxyUrl: meter.url,
          dummyKey: opts.dummyKey,
          timeoutMs: opts.timeoutMs,
          setMeterContext: (c) => meter.setContext(c)
        };

        const res = await arm.run(task, regime, ctx);
        const det = scoreDeterministic(res.text, task.success);
        const judged = await judgeAnswer(task, res.text, { cwd: work, timeoutMs: opts.timeoutMs });

        // Persist everything for auditability.
        writeFileSync(join(work, "answer.txt"), res.text);
        if (res.artifacts?.plan) writeFileSync(join(work, "plan.txt"), res.artifacts.plan);
        if (res.artifacts?.transcript) writeFileSync(join(work, "transcript.txt"), res.artifacts.transcript);
        for (const s of res.artifacts?.stages ?? []) writeFileSync(join(work, `stage-${s.stage}-${s.harness}.txt`), s.text);
        writeFileSync(
          join(work, "scores.json"),
          JSON.stringify(
            { pass: det.pass, detail: det.detail, quality: judged.quality, rationale: judged.rationale, judgeRaw: judged.raw, armModels: res.models, judgeModels: judged.models, costUsd: res.usage.costUsd },
            null,
            2
          )
        );

        outcomes.push({
          taskId: task.id,
          depth: task.depth,
          arm: arm.id,
          regimeId: regime.id,
          pass: det.pass,
          quality: judged.quality,
          costUsd: res.usage.costUsd,
          latencyMs: res.latencyMs,
          models: res.models
        });
      }
    }
  } finally {
    await meter.stop();
  }

  const aggregates = aggregate(outcomes);
  const depthOrder = tasks.map((t: Task) => t.id);
  const report: BenchReport = {
    outcomes,
    aggregates,
    verdictCost: decideWinner(regime.id, aggregates, "success_per_dollar"),
    verdictQuality: decideWinner(regime.id, aggregates, "quality_only"),
    crossover: {
      pass: findCrossover(outcomes, depthOrder, "pass"),
      quality: findCrossover(outcomes, depthOrder, "quality")
    }
  };
  writeFileSync(join(opts.resultsDir, "report.json"), JSON.stringify(report, null, 2));
  return report;
}
