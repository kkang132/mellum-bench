/**
 * Typed configuration loading + shared types. Pure parsing/validation (file reads only).
 * No knowledge of harnesses/arms; this is data the rest of the system consumes.
 */
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// ---------- Tasks ----------
export const SuccessSpec = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_equals"), golden: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("set_subset"), golden: z.array(z.string()).min(1) }),
  z.object({
    type: z.literal("keywords_all"),
    required: z.array(z.string()).min(1),
    max_lines: z.number().int().positive().optional()
  }),
  z.object({
    type: z.literal("pairs_all"),
    required: z.array(z.object({ file: z.string(), symbol: z.string() })).min(1)
  }),
  z.object({ type: z.literal("value_and_source"), value: z.string(), source_keyword: z.string() })
]);
export type SuccessSpec = z.infer<typeof SuccessSpec>;

export const Task = z.object({
  id: z.string(),
  kind: z.enum(["context", "summarization"]),
  depth: z.enum(["shallow", "medium", "deep"]),
  prompt: z.string(),
  fixtures: z.array(z.string()),
  success: SuccessSpec
});
export type Task = z.infer<typeof Task>;

const TasksFile = z.object({ tasks: z.array(Task).min(1) });

// ---------- Regimes ----------
export const DriveMode = z.enum(["constrained_text", "agentic"]);
export type DriveMode = z.infer<typeof DriveMode>;
export const ScoringMode = z.enum(["deterministic", "judge"]);
export type ScoringMode = z.infer<typeof ScoringMode>;
export const CostTreatment = z.enum(["success_per_dollar", "quality_only"]);
export type CostTreatment = z.infer<typeof CostTreatment>;

export const Regime = z.object({
  id: z.string(),
  description: z.string(),
  drive_mode: DriveMode,
  // v2: a single fair run is scored by BOTH lenses (deterministic + judge); these per-regime knobs
  // are retained as optional metadata but no longer select a single winner.
  scoring: ScoringMode.optional(),
  cost_treatment: CostTreatment.optional(),
  pipeline: z.array(z.object({ stage: z.string(), harness: z.string() })).min(1)
});
export type Regime = z.infer<typeof Regime>;

const RegimesFile = z.object({ regimes: z.array(Regime).min(1) });

// ---------- Pricing ----------
export const ModelPrice = z.object({
  input_per_mtok: z.number(),
  output_per_mtok: z.number(),
  cache_write_per_mtok: z.number(),
  cache_read_per_mtok: z.number()
});
export type ModelPrice = z.infer<typeof ModelPrice>;
const PricingFile = z.object({ models: z.record(z.string(), ModelPrice) });
export type Pricing = z.infer<typeof PricingFile>;

// ---------- Loaders ----------
function loadYaml<T>(path: string, schema: z.ZodType<T>): T {
  return schema.parse(parseYaml(readFileSync(path, "utf8")));
}

export function loadTasks(path: string): Task[] {
  return loadYaml(path, TasksFile).tasks;
}
export function loadRegimes(path: string): Regime[] {
  return loadYaml(path, RegimesFile).regimes;
}
export function loadPricing(path: string): Pricing {
  return loadYaml(path, PricingFile);
}

// ---------- Shared runtime types ----------
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export const zeroUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0
});

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    costUsd: a.costUsd + b.costUsd
  };
}

export interface RunResult {
  text: string;
  usage: Usage;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

/** Per-model usage breakdown captured from `claude -p` (includes subagents). Keyed by model id. */
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}
export type ModelUsageMap = Record<string, ModelUsage>;
