/** The Arm A advisor: a token-frugal Opus-4.7 planner. Planning-only (ARCHITECTURE.md §3) — it emits
 * a short numbered plan and never executes tools. Its usage is charged to Arm A. */
import { type Task, type Usage, type ModelUsageMap } from "../config.js";
import { runClaude } from "./claude.js";

export const ADVISOR_MODEL = "claude-opus-4-7";

// Terse, plan-only system prompt. "medium reasoning" is requested but the claude CLI exposes no
// per-call effort flag, so frugality is enforced here + via --max-turns 1 (documented in README).
const SYSTEM = [
  "You are a planning ADVISOR for cheaper worker agents.",
  "Output ONLY a numbered plan of at most 5 short imperative steps the workers will execute.",
  "Each step <= 15 words. No preamble, no explanation, no solution, no code. Plan only."
].join(" ");

export interface PlanResult {
  plan: string;
  usage: Usage;
  models: ModelUsageMap;
  latencyMs: number;
  ok: boolean;
}

export async function makePlan(
  task: Task,
  opts: { cwd: string; timeoutMs: number; model?: string }
): Promise<PlanResult> {
  const prompt = [
    `TASK: ${task.prompt.trim()}`,
    `Available fixture paths: ${task.fixtures.join(", ")}`,
    "Write the execution plan."
  ].join("\n");

  const r = await runClaude({
    prompt,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    model: opts.model ?? ADVISOR_MODEL,
    systemPrompt: SYSTEM,
    maxTurns: 1
  });
  return { plan: r.text, usage: r.usage, models: r.models, latencyMs: r.latencyMs, ok: r.ok };
}
