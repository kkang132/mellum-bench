/** Arm contract. An Arm executes one task under one regime and returns a normalised result. */
import type { ModelUsageMap, Regime, Task, Usage } from "../config.js";

export interface ArmContext {
  /** Sandbox working dir for this task (fixtures copied in for agentic mode). */
  cwd: string;
  repoRoot: string;
  proxyUrl: string;
  dummyKey: string;
  timeoutMs: number;
  /** Called before each Arm-A worker stage so the meter attributes tokens correctly. */
  setMeterContext?: (ctx: { taskId: string; stage: string; harness: string }) => void;
}

export interface ArmArtifacts {
  plan?: string; // advisor plan (Arm A)
  stages?: { stage: string; harness: string; text: string }[]; // Arm A worker outputs
  transcript?: string; // Arm B full transcript
}

export interface ArmResult {
  arm: "A" | "B";
  text: string; // final answer to be scored
  usage: Usage; // cost charged to this arm (advisor for A; all claude calls for B)
  models: ModelUsageMap; // which models ran (advisor for A; Arm B + subagents for B)
  latencyMs: number;
  ok: boolean;
  detail?: string;
  artifacts?: ArmArtifacts;
}

export interface Arm {
  readonly id: "A" | "B";
  run(task: Task, regime: Regime, ctx: ArmContext): Promise<ArmResult>;
}
