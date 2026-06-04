import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadTaskList, readFixtures, renderCorpus, byDepth } from "../src/tasks.js";
import type { Task } from "../src/config.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

describe("task loading & ordering", () => {
  const tasks = loadTaskList(join(ROOT, "config/tasks.yaml"));

  it("returns tasks ordered shallow → deep", () => {
    const depths = tasks.map((t) => t.depth);
    const rank = { shallow: 0, medium: 1, deep: 2 } as const;
    for (let i = 1; i < depths.length; i++) {
      expect(rank[depths[i]!]).toBeGreaterThanOrEqual(rank[depths[i - 1]!]);
    }
  });

  it("byDepth does not mutate its input", () => {
    const arr: Task[] = [...tasks].reverse();
    const snapshot = arr.map((t) => t.id);
    byDepth(arr);
    expect(arr.map((t) => t.id)).toEqual(snapshot);
  });

  it("reads fixture files referenced by a task", () => {
    const t1 = tasks.find((t) => t.id === "t1-signatures")!;
    const files = readFixtures(t1, ROOT);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("fixtures/repo/src/auth.ts");
    expect(files.find((f) => f.path.endsWith("auth.ts"))!.content).toContain("verifyToken");
  });

  it("renders a labeled corpus block for prompt injection", () => {
    const t2 = tasks.find((t) => t.id === "t2-changelog")!;
    const rendered = renderCorpus(readFixtures(t2, ROOT));
    expect(rendered).toContain("===== FILE: fixtures/repo/CHANGELOG.md =====");
    expect(rendered).toContain("rate limit");
  });
});
