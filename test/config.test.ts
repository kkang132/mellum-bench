import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  loadTasks,
  loadRegimes,
  loadPricing,
  addUsage,
  zeroUsage
} from "../src/config.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

describe("config loaders (real files)", () => {
  it("loads and validates the 5 tasks", () => {
    const tasks = loadTasks(join(ROOT, "config/tasks.yaml"));
    expect(tasks).toHaveLength(5);
    expect(new Set(tasks.map((t) => t.success.type))).toEqual(
      new Set(["set_subset", "keywords_all", "pairs_all", "value_and_source"])
    );
  });
  it("loads the single fair run (constrained_text)", () => {
    const regimes = loadRegimes(join(ROOT, "config/regimes.yaml"));
    expect(regimes).toHaveLength(1);
    expect(regimes[0]!.id).toBe("fair");
    expect(regimes[0]!.drive_mode).toBe("constrained_text");
  });
  it("prices Mellum2 at zero and Claude non-zero", () => {
    const p = loadPricing(join(ROOT, "config/pricing.yaml"));
    expect(p.models["mellum2-local"]!.input_per_mtok).toBe(0);
    expect(p.models["claude-opus-4-7"]!.output_per_mtok).toBeGreaterThan(0);
  });
});

describe("config validation rejects bad data", () => {
  it("throws on an unknown success type", () => {
    const dir = mkdtempSync(join(tmpdir(), "mb-"));
    const bad = join(dir, "tasks.yaml");
    writeFileSync(
      bad,
      "tasks:\n  - id: x\n    kind: context\n    depth: shallow\n    prompt: hi\n    fixtures: []\n    success:\n      type: nope\n"
    );
    expect(() => loadTasks(bad)).toThrow();
  });
});

describe("usage helpers", () => {
  it("adds usage component-wise from zero", () => {
    const u = addUsage(zeroUsage(), {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheCreationTokens: 3,
      costUsd: 0.5
    });
    expect(u.inputTokens).toBe(10);
    expect(u.costUsd).toBeCloseTo(0.5, 5);
  });
});
