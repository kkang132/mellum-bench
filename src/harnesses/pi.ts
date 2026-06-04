/** Pi (pi.dev) adapter. Cleanest custom-provider story: provider defined in ~/.pi/agent/models.json
 * (installed by setup.sh). `--no-tools` gives constrained_text mode; an allowlist gives agentic. */
import { zeroUsage, type RunResult } from "../config.js";
import { runCli, workerEnv } from "./run.js";
import { extractText } from "./extract.js";
import type { Harness, HarnessInput } from "./types.js";

export const pi: Harness = {
  name: "pi",
  async run(input: HarnessInput): Promise<RunResult> {
    const prompt =
      input.driveMode === "constrained_text"
        ? `${input.prompt}\n\n===== CORPUS =====\n${input.corpus}`
        : input.prompt;

    const args = [
      "--print",
      "--mode", "json",
      "--no-session",
      "--provider", "mellum",
      "--model", input.model
    ];
    if (input.driveMode === "constrained_text") args.push("--no-tools");
    else args.push("--tools", "read,bash,list");
    args.push(prompt);

    const r = await runCli("pi", args, {
      cwd: input.cwd,
      env: workerEnv(input.dummyKey),
      timeoutMs: input.timeoutMs
    });
    const ok = r.code === 0 && !r.timedOut;
    return {
      text: extractText(r.stdout),
      usage: zeroUsage(), // local model: $0; tokens come from the metering proxy
      latencyMs: r.latencyMs,
      ok,
      ...(ok ? {} : { error: r.timedOut ? "timeout" : r.stderr.slice(0, 500) })
    };
  }
};
