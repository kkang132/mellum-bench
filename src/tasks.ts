/**
 * Task loading + fixture reading. Tasks read ONLY from the local fixtures corpus (no network),
 * per the determinism contract in ARCHITECTURE.md §5.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadTasks, type Task } from "./config.js";

const DEPTH_ORDER: Record<Task["depth"], number> = { shallow: 0, medium: 1, deep: 2 };

/** Tasks sorted shallow → deep — the ordering used to locate the crossover. */
export function byDepth(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => DEPTH_ORDER[a.depth] - DEPTH_ORDER[b.depth]);
}

export function loadTaskList(tasksPath: string): Task[] {
  return byDepth(loadTasks(tasksPath));
}

/** Recursively collect readable text files under a file-or-directory path. */
function collectFiles(absPath: string): string[] {
  const st = statSync(absPath);
  if (st.isFile()) return [absPath];
  const out: string[] = [];
  for (const entry of readdirSync(absPath)) {
    out.push(...collectFiles(join(absPath, entry)));
  }
  return out;
}

export interface FixtureFile {
  path: string; // repo-relative
  content: string;
}

/**
 * Read all fixture files referenced by a task, repo-relative. Used to inject corpus content into
 * the prompt in `constrained_text` drive mode (so workers need no tool-calling).
 */
export function readFixtures(task: Task, repoRoot: string): FixtureFile[] {
  const files: FixtureFile[] = [];
  for (const ref of task.fixtures) {
    const abs = join(repoRoot, ref);
    for (const f of collectFiles(abs)) {
      files.push({ path: relative(repoRoot, f), content: readFileSync(f, "utf8") });
    }
  }
  // Stable order so prompts are reproducible.
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

/** Render fixture files as a labelled block for prompt injection. */
export function renderCorpus(files: FixtureFile[]): string {
  return files
    .map((f) => `===== FILE: ${f.path} =====\n${f.content.trimEnd()}\n`)
    .join("\n");
}
