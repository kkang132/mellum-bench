/** Arm B: Claude (pinned Opus 4.7) does the whole task headlessly, spawning its own subagents
 * (also pinned Opus 4.7 via --agents). All tokens charged to the arm. Transcript captured via
 * stream-json so scoring/judging see the full work, not a terse `result`. REAL COST. */
import type { Regime, Task } from "../config.js";
import { readFixtures, renderCorpus } from "../tasks.js";
import { runClaude } from "./claude.js";
import type { Arm, ArmContext, ArmResult } from "./types.js";

export const ARM_B_MODEL = "claude-opus-4-7";

// Subagents pinned to the same model so Arm B can't silently drop to a cheaper tier.
const AGENTS = JSON.stringify({
  worker: {
    description: "Gathers/summarizes from the provided corpus for a delegated subtask.",
    prompt: "You are a worker subagent. Complete the delegated subtask precisely from the provided context and report the result.",
    model: ARM_B_MODEL
  }
});

export const armB: Arm = {
  id: "B",
  async run(task: Task, _regime: Regime, ctx: ArmContext): Promise<ArmResult> {
    const started = Date.now();
    const corpus = renderCorpus(readFixtures(task, ctx.repoRoot));
    const prompt = [
      task.prompt.trim(),
      "",
      "Decompose into subtasks and spawn subagents (Task tool, subagent_type \"worker\") to process the corpus, then synthesize the final answer in the requested <answer>…</answer> format.",
      "",
      "===== CORPUS =====",
      corpus
    ].join("\n");

    const r = await runClaude({
      prompt,
      cwd: ctx.cwd,
      timeoutMs: ctx.timeoutMs,
      model: ARM_B_MODEL,
      allowedTools: ["Task"],
      agents: AGENTS,
      maxTurns: 30,
      streamJson: true
    });

    return {
      arm: "B",
      text: r.text,
      usage: r.usage,
      models: r.models,
      latencyMs: Date.now() - started,
      ok: r.ok,
      artifacts: { transcript: r.text },
      ...(r.error ? { detail: r.error } : {})
    };
  }
};
