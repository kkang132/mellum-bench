#!/usr/bin/env tsx
/** Benchmark entrypoint. REAL COST: invokes the Opus-4.7 advisor (Arm A) and Claude (Arm B). */
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runBenchmark, type BenchReport } from "../runner.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function renderTable(report: BenchReport): string {
  const rows = report.aggregates
    .sort((a, b) => a.arm.localeCompare(b.arm))
    .map((a) => {
      const q = a.meanQuality === null ? "—" : a.meanQuality.toFixed(2);
      const sd = a.successPerDollar === Infinity ? "∞" : a.successPerDollar.toFixed(1);
      const qd = a.qualityPerDollar === Infinity ? "∞" : a.qualityPerDollar.toFixed(1);
      return `| ${a.arm} | ${(a.passRate * 100).toFixed(0)}% | ${q} | $${a.totalCostUsd.toFixed(4)} | ${Math.round(a.meanLatencyMs)}ms | ${sd} | ${qd} |`;
    });
  const header =
    "| arm | pass | judge qual | cost | latency | succ/$ | qual/$ |\n" +
    "|---|---|---|---|---|---|---|";
  const v = (w: typeof report.verdictCost) =>
    `**Arm ${w.winner}** by ${w.metric} (A=${w.values.A.toFixed(2)}, B=${w.values.B.toFixed(2)})`;
  const verdicts = [
    `- Cost-efficiency lens (deterministic): ${v(report.verdictCost)} · crossover: ${report.crossover.pass ?? "none"}`,
    `- Quality lens (Opus-4.8 judge, headline): ${v(report.verdictQuality)} · crossover: ${report.crossover.quality ?? "none"}`
  ].join("\n");
  return `${header}\n${rows.join("\n")}\n\n${verdicts}`;
}

async function main(): Promise<void> {
  const report = await runBenchmark({
    repoRoot: REPO_ROOT,
    tasksPath: join(REPO_ROOT, "config/tasks.yaml"),
    regimesPath: join(REPO_ROOT, "config/regimes.yaml"),
    resultsDir: join(REPO_ROOT, "results"),
    dummyKey: process.env.MELLUM_DUMMY_KEY ?? "local-dummy",
    timeoutMs: Number(process.env.BENCH_TIMEOUT_MS ?? 300_000)
  });
  console.log("\n" + renderTable(report) + "\n");
  console.log(`Full results: ${join(REPO_ROOT, "results/report.json")}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
