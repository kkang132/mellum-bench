/** Shared headless-Claude invoker (advisor, Arm B, judge). Runs the `claude` CLI in print mode and
 * parses authoritative `total_cost_usd`, token usage, and the per-model `modelUsage` map (so we record
 * which models ran, subagents included). Uses the FULL process env (real auth). REAL COST.
 *
 * Launcher is configurable for wrapped/proxied auth setups:
 *   CLAUDE_CMD          binary to invoke (default "claude")
 *   CLAUDE_PREFIX_ARGS  space-separated args inserted before the print flags (default none)
 * e.g. a wrapper that runs claude via `<tool> run claude-code -- <flags>` sets
 *   CLAUDE_CMD=<tool> CLAUDE_PREFIX_ARGS="run claude-code --". Keep such values in an uncommitted .env. */
import { spawn } from "node:child_process";
import { type Usage, type ModelUsageMap, zeroUsage } from "../config.js";

const CLAUDE_CMD = process.env.CLAUDE_CMD ?? "claude";
const CLAUDE_PREFIX_ARGS = (process.env.CLAUDE_PREFIX_ARGS ?? "").split(" ").filter(Boolean);

export interface ClaudeResult {
  text: string;
  usage: Usage;
  models: ModelUsageMap; // which models actually ran + their tokens/cost
  structured?: unknown; // result.structured_output when --json-schema is used
  latencyMs: number;
  ok: boolean;
  error?: string;
}

export interface ClaudeOpts {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  model?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  maxTurns?: number;
  agents?: string; // JSON for --agents (custom subagents, incl. their pinned model)
  streamJson?: boolean; // capture the full transcript (Arm B) instead of just `result`
  jsonSchema?: string; // force structured output (lands in result.structured_output)
}

interface RawModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUSD?: number;
}
interface ResultJson {
  type?: string;
  result?: string;
  structured_output?: unknown;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, RawModelUsage>;
}

function toModelMap(mu: Record<string, RawModelUsage> | undefined): ModelUsageMap {
  const out: ModelUsageMap = {};
  for (const [id, u] of Object.entries(mu ?? {})) {
    out[id] = { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0, costUsd: u.costUSD ?? 0 };
  }
  return out;
}

function usageFrom(j: ResultJson): Usage {
  return {
    inputTokens: j.usage?.input_tokens ?? 0,
    outputTokens: j.usage?.output_tokens ?? 0,
    cacheReadTokens: j.usage?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: j.usage?.cache_creation_input_tokens ?? 0,
    costUsd: j.total_cost_usd ?? 0
  };
}

/** Parse a single-object json response (strip any leading proxy/routing noise). */
function parseSingleJson(stdout: string): ClaudeResult | null {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(stdout.slice(start, end + 1)) as ResultJson;
    return {
      text: j.result ?? "",
      usage: usageFrom(j),
      models: toModelMap(j.modelUsage),
      ...(j.structured_output !== undefined ? { structured: j.structured_output } : {}),
      latencyMs: 0,
      ok: j.is_error !== true
    };
  } catch {
    return null;
  }
}

/** Parse a stream-json transcript: concatenate assistant text, take usage/cost/models from `result`. */
function parseStreamJson(stdout: string): ClaudeResult | null {
  const texts: string[] = [];
  let result: ResultJson | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    let ev: { type?: string; message?: { content?: { type?: string; text?: string }[] } } & ResultJson;
    try {
      ev = JSON.parse(s);
    } catch {
      continue;
    }
    if (ev.type === "assistant" && ev.message?.content) {
      for (const block of ev.message.content) if (block.type === "text" && block.text) texts.push(block.text);
    }
    if (ev.type === "result") result = ev;
  }
  if (!result) return texts.length ? { text: texts.join("\n"), usage: zeroUsage(), models: {}, latencyMs: 0, ok: true } : null;
  return {
    text: texts.join("\n") || (result.result ?? ""),
    usage: usageFrom(result),
    models: toModelMap(result.modelUsage),
    latencyMs: 0,
    ok: result.is_error !== true
  };
}

export function runClaude(opts: ClaudeOpts): Promise<ClaudeResult> {
  const fmt = opts.streamJson ? ["--output-format", "stream-json", "--verbose"] : ["--output-format", "json"];
  const passthrough = ["-p", opts.prompt, ...fmt];
  if (opts.jsonSchema) passthrough.push("--json-schema", opts.jsonSchema);
  if (opts.model) passthrough.push("--model", opts.model);
  if (opts.systemPrompt) passthrough.push("--append-system-prompt", opts.systemPrompt);
  if (opts.maxTurns !== undefined) passthrough.push("--max-turns", String(opts.maxTurns));
  if (opts.allowedTools) passthrough.push("--allowedTools", opts.allowedTools.join(","));
  if (opts.agents) passthrough.push("--agents", opts.agents);
  const args = [...CLAUDE_PREFIX_ARGS, ...passthrough];

  return new Promise((resolve) => {
    const started = Date.now();
    const proc = spawn(CLAUDE_CMD, args, { cwd: opts.cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, opts.timeoutMs);
    proc.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    proc.stdin.end();
    proc.on("close", () => {
      clearTimeout(timer);
      const latencyMs = Date.now() - started;
      const parsed = opts.streamJson ? parseStreamJson(stdout) : parseSingleJson(stdout);
      if (!parsed) {
        resolve({ text: "", usage: zeroUsage(), models: {}, latencyMs, ok: false, error: timedOut ? "timeout" : stderr.slice(0, 500) || "no json" });
        return;
      }
      resolve({ ...parsed, latencyMs });
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ text: "", usage: zeroUsage(), models: {}, latencyMs: Date.now() - started, ok: false, error: String(e) });
    });
  });
}
