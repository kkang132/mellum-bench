#!/usr/bin/env tsx
/** Re-score PERSISTED answers with the fixed judge — no arm re-run (cheap). Reads each
 * results/work/<task>/<arm>/answer.txt, re-judges, rewrites scores.json, and recomputes report.json
 * (quality, aggregates, verdicts, crossover). Deterministic pass + cost are taken from the prior run. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTaskList } from "../tasks.js";
import { judgeAnswer } from "../scoring/judge.js";
import { aggregate, decideWinner, findCrossover, type TaskOutcome } from "../metrics.js";
import type { BenchReport } from "../runner.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RESULTS = join(ROOT, "results");
const timeoutMs = Number(process.env.BENCH_TIMEOUT_MS ?? 240_000);

const report = JSON.parse(readFileSync(join(RESULTS, "report.json"), "utf8")) as BenchReport;
const tasks = loadTaskList(join(ROOT, "config/tasks.yaml"));
const byId = new Map(tasks.map((t) => [t.id, t]));

for (const o of report.outcomes as TaskOutcome[]) {
  const work = join(RESULTS, "work", o.taskId, o.arm);
  const answerPath = join(work, "answer.txt");
  if (!existsSync(answerPath)) {
    console.log(`skip ${o.taskId}/${o.arm}: no persisted answer`);
    continue;
  }
  const task = byId.get(o.taskId)!;
  const answer = readFileSync(answerPath, "utf8");
  const j = await judgeAnswer(task, answer, { cwd: work, timeoutMs });
  o.quality = j.quality;

  // rewrite scores.json with the corrected judge output + raw for audit
  const scoresPath = join(work, "scores.json");
  const prev = existsSync(scoresPath) ? JSON.parse(readFileSync(scoresPath, "utf8")) : {};
  writeFileSync(
    scoresPath,
    JSON.stringify({ ...prev, quality: j.quality, rationale: j.rationale, judgeRaw: j.raw, judgeModels: j.models }, null, 2)
  );
  console.log(`${o.taskId}/${o.arm}: quality=${j.quality.toFixed(2)}  «${j.rationale.slice(0, 70)}»`);
}

// recompute aggregates + verdicts + crossover from updated qualities
const aggregates = aggregate(report.outcomes as TaskOutcome[]);
const regimeId = (report.outcomes[0] as TaskOutcome).regimeId;
const depthOrder = tasks.map((t) => t.id);
report.aggregates = aggregates;
report.verdictCost = decideWinner(regimeId, aggregates, "success_per_dollar");
report.verdictQuality = decideWinner(regimeId, aggregates, "quality_only");
report.crossover = {
  pass: findCrossover(report.outcomes as TaskOutcome[], depthOrder, "pass"),
  quality: findCrossover(report.outcomes as TaskOutcome[], depthOrder, "quality")
};
writeFileSync(join(RESULTS, "report.json"), JSON.stringify(report, null, 2));
console.log("\nupdated verdicts:", JSON.stringify({ cost: report.verdictCost, quality: report.verdictQuality, crossover: report.crossover }, null, 2));
