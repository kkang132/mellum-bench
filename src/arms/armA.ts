/** Arm A: Opus-4.7 advisor plans once, then the sequential Mellum2 harness pipeline executes.
 * Advisor cost is charged to the arm; worker cost is ~$0 (tokens metered via the proxy). */
import { addUsage, type Regime, type Task } from "../config.js";
import { readFixtures, renderCorpus } from "../tasks.js";
import { getHarness } from "../harnesses/index.js";
import { makePlan } from "./advisor.js";
import type { Arm, ArmContext, ArmResult } from "./types.js";

function stagePrompt(stage: string, plan: string, task: Task, prev: string): string {
  const head = `PLAN:\n${plan}\n\nTASK: ${task.prompt.trim()}`;
  switch (stage) {
    case "gather":
      return `${head}\n\nSTEP: Gather exactly the information the task needs. Be concise.`;
    case "summarize":
      return `${head}\n\nSTEP: Condense the gathered notes below for the task.\n\nNOTES:\n${prev}`;
    case "synthesize":
      return `${head}\n\nSTEP: Produce the FINAL answer in the exact format the task requests. Output only the answer.\n\nWORKING NOTES:\n${prev}`;
    default:
      return `${head}\n\nSTEP: ${stage}.\n\nCONTEXT:\n${prev}`;
  }
}

export const armA: Arm = {
  id: "A",
  async run(task: Task, regime: Regime, ctx: ArmContext): Promise<ArmResult> {
    const started = Date.now();
    const plan = await makePlan(task, { cwd: ctx.repoRoot, timeoutMs: ctx.timeoutMs });
    let usage = plan.usage; // only the advisor costs money; workers are local ($0)
    let ok = plan.ok;

    const corpus =
      regime.drive_mode === "constrained_text"
        ? renderCorpus(readFixtures(task, ctx.repoRoot))
        : "";

    let carry = "";
    const stages: { stage: string; harness: string; text: string }[] = [];
    for (const stage of regime.pipeline) {
      const h = getHarness(stage.harness);
      ctx.setMeterContext?.({ taskId: task.id, stage: stage.stage, harness: h.name });
      const res = await h.run({
        prompt: stagePrompt(stage.stage, plan.plan, task, carry),
        corpus,
        driveMode: regime.drive_mode,
        cwd: ctx.cwd,
        model: "mellum2",
        proxyUrl: ctx.proxyUrl,
        dummyKey: ctx.dummyKey,
        timeoutMs: ctx.timeoutMs
      });
      usage = addUsage(usage, res.usage);
      carry = res.text || carry;
      ok = ok && res.ok;
      stages.push({ stage: stage.stage, harness: h.name, text: res.text });
    }

    return {
      arm: "A",
      text: carry,
      usage,
      models: plan.models, // advisor (Opus 4.7) is the only frontier model in Arm A
      latencyMs: Date.now() - started,
      ok,
      detail: `advisor+${regime.pipeline.map((s) => s.harness).join("→")}`,
      artifacts: { plan: plan.plan, stages }
    };
  }
};
