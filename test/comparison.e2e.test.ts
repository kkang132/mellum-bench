/**
 * E2E comparison — REAL COST (advisor + Arm B + judge call Claude). Tagged via filename (*.e2e.test.ts)
 * and run only by `npm run test:e2e`. Requires Mellum2 + harnesses + claude CLI.
 *
 * Asserts the runner produces a well-formed report (every regime × arm × task cell, costs recorded,
 * winners + crossover computed). The DIRECTIONAL hypothesis — A wins a-favorable on success-per-$,
 * B wins b-favorable on quality — is model-dependent and surfaced in the printed table, not hard-asserted.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runBenchmark, type BenchReport } from "../src/runner.js";
import { isUp } from "../src/backend/server.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

describe("A vs B benchmark (e2e, real cost)", () => {
  let report: BenchReport;

  beforeAll(async () => {
    if (!(await isUp())) throw new Error("Mellum2 not up at :8080 — start llama-server first.");
    report = await runBenchmark({
      repoRoot: ROOT,
      tasksPath: join(ROOT, "config/tasks.yaml"),
      regimesPath: join(ROOT, "config/regimes.yaml"),
      resultsDir: join(ROOT, "results"),
      dummyKey: process.env.MELLUM_DUMMY_KEY ?? "local-dummy",
      timeoutMs: Number(process.env.BENCH_TIMEOUT_MS ?? 300_000)
    });
  });

  it("produces an outcome for every arm × task (2 × 5 = 10) in the single fair run", () => {
    expect(report.outcomes).toHaveLength(10);
  });

  it("records both verdicts (cost + quality) and both crossovers", () => {
    expect(report.verdictCost.metric).toBe("success_per_dollar");
    expect(report.verdictQuality.metric).toBe("quality");
    expect(report.crossover).toHaveProperty("pass");
    expect(report.crossover).toHaveProperty("quality");
  });

  it("every outcome records which models ran", () => {
    for (const o of report.outcomes) expect(o.models && Object.keys(o.models).length).toBeGreaterThan(0);
  });

  it("charges Arm B real cost and Arm A only the advisor (workers ~$0)", () => {
    const aCost = report.aggregates.filter((a) => a.arm === "A").reduce((s, a) => s + a.totalCostUsd, 0);
    const bCost = report.aggregates.filter((a) => a.arm === "B").reduce((s, a) => s + a.totalCostUsd, 0);
    expect(bCost).toBeGreaterThan(0);
    // Arm A spend is advisor-only and should be well below Arm B's all-frontier spend.
    expect(aCost).toBeLessThan(bCost);
  });

  it("prints the comparison (both lenses)", () => {
    for (const w of [report.verdictCost, report.verdictQuality]) {
      // eslint-disable-next-line no-console
      console.log(`winner=Arm ${w.winner} by ${w.metric} (A=${w.values.A.toFixed(2)}, B=${w.values.B.toFixed(2)})`);
    }
    expect(report.aggregates.length).toBeGreaterThan(0);
  });
});
