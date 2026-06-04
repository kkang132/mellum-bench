import { describe, it, expect } from "vitest";
import { aggregate, decideWinner, findCrossover, type TaskOutcome } from "../src/metrics.js";

function outcome(p: Partial<TaskOutcome> & Pick<TaskOutcome, "taskId" | "arm" | "regimeId">): TaskOutcome {
  return {
    depth: "shallow",
    pass: false,
    costUsd: 0,
    latencyMs: 0,
    ...p
  };
}

describe("aggregate", () => {
  it("groups by regime+arm and computes pass-rate, cost, success-per-$", () => {
    const outcomes: TaskOutcome[] = [
      outcome({ taskId: "t1", arm: "A", regimeId: "r", pass: true, costUsd: 0 }),
      outcome({ taskId: "t2", arm: "A", regimeId: "r", pass: true, costUsd: 0 }),
      outcome({ taskId: "t1", arm: "B", regimeId: "r", pass: true, costUsd: 1 }),
      outcome({ taskId: "t2", arm: "B", regimeId: "r", pass: false, costUsd: 1 })
    ];
    const aggs = aggregate(outcomes);
    const a = aggs.find((x) => x.arm === "A")!;
    const b = aggs.find((x) => x.arm === "B")!;
    expect(a.passRate).toBe(1);
    expect(b.passRate).toBe(0.5);
    // A is free → astronomically high success-per-$ vs B's 1 success / $2.
    expect(a.successPerDollar).toBeGreaterThan(b.successPerDollar);
    expect(b.successPerDollar).toBeCloseTo(1 / 2, 5);
    expect(a.meanQuality).toBeNull();
  });

  it("computes mean quality when present", () => {
    const aggs = aggregate([
      outcome({ taskId: "t1", arm: "A", regimeId: "r", quality: 0.4 }),
      outcome({ taskId: "t2", arm: "A", regimeId: "r", quality: 0.6 })
    ]);
    expect(aggs[0]!.meanQuality).toBeCloseTo(0.5, 5);
  });
});

describe("decideWinner", () => {
  it("success_per_dollar favors the cheap arm that ties on passes", () => {
    const aggs = aggregate([
      outcome({ taskId: "t1", arm: "A", regimeId: "r", pass: true, costUsd: 0 }),
      outcome({ taskId: "t1", arm: "B", regimeId: "r", pass: true, costUsd: 5 })
    ]);
    expect(decideWinner("r", aggs, "success_per_dollar").winner).toBe("A");
  });
  it("quality_only favors the higher-quality arm regardless of cost", () => {
    const aggs = aggregate([
      outcome({ taskId: "t1", arm: "A", regimeId: "r", quality: 0.5, costUsd: 0 }),
      outcome({ taskId: "t1", arm: "B", regimeId: "r", quality: 0.9, costUsd: 5 })
    ]);
    const v = decideWinner("r", aggs, "quality_only");
    expect(v.winner).toBe("B");
    expect(v.metric).toBe("quality");
  });
  it("quality_only falls back to pass-rate when no judge scores", () => {
    const aggs = aggregate([
      outcome({ taskId: "t1", arm: "A", regimeId: "r", pass: false }),
      outcome({ taskId: "t1", arm: "B", regimeId: "r", pass: true })
    ]);
    const v = decideWinner("r", aggs, "quality_only");
    expect(v.metric).toBe("pass_rate");
    expect(v.winner).toBe("B");
  });
  it("throws if an arm aggregate is missing", () => {
    const aggs = aggregate([outcome({ taskId: "t1", arm: "A", regimeId: "r" })]);
    expect(() => decideWinner("r", aggs, "success_per_dollar")).toThrow();
  });
});

describe("findCrossover", () => {
  const order = ["t1", "t2", "t3"];
  it("finds the first deep task where B passes and A fails", () => {
    const outcomes = [
      outcome({ taskId: "t1", arm: "A", regimeId: "r", pass: true }),
      outcome({ taskId: "t1", arm: "B", regimeId: "r", pass: true }),
      outcome({ taskId: "t2", arm: "A", regimeId: "r", pass: false }),
      outcome({ taskId: "t2", arm: "B", regimeId: "r", pass: true })
    ];
    expect(findCrossover(outcomes, order)).toBe("t2");
  });
  it("uses quality when judged", () => {
    const outcomes = [
      outcome({ taskId: "t1", arm: "A", regimeId: "r", quality: 0.8 }),
      outcome({ taskId: "t1", arm: "B", regimeId: "r", quality: 0.7 }),
      outcome({ taskId: "t2", arm: "A", regimeId: "r", quality: 0.5 }),
      outcome({ taskId: "t2", arm: "B", regimeId: "r", quality: 0.9 })
    ];
    expect(findCrossover(outcomes, order)).toBe("t2");
  });
  it("pass lens ignores quality and uses deterministic pass", () => {
    const outcomes = [
      // A higher quality but B passes where A fails → pass lens picks t2, quality lens would not
      outcome({ taskId: "t1", arm: "A", regimeId: "r", pass: true, quality: 0.9 }),
      outcome({ taskId: "t1", arm: "B", regimeId: "r", pass: true, quality: 0.1 }),
      outcome({ taskId: "t2", arm: "A", regimeId: "r", pass: false, quality: 0.9 }),
      outcome({ taskId: "t2", arm: "B", regimeId: "r", pass: true, quality: 0.1 })
    ];
    expect(findCrossover(outcomes, order, "pass")).toBe("t2");
    expect(findCrossover(outcomes, order, "quality")).toBeNull();
  });
  it("returns null when A never loses", () => {
    const outcomes = [
      outcome({ taskId: "t1", arm: "A", regimeId: "r", pass: true }),
      outcome({ taskId: "t1", arm: "B", regimeId: "r", pass: false })
    ];
    expect(findCrossover(outcomes, order)).toBeNull();
  });
});
