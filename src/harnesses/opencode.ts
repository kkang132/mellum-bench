/** opencode adapter. Provider defined in config/providers/opencode.json (passed via OPENCODE_CONFIG).
 * `opencode run -m <provider>/<model> -p <prompt>` is non-interactive. */
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { zeroUsage, type RunResult } from "../config.js";
import { runCli, workerEnv } from "./run.js";
import { extractText } from "./extract.js";
import type { Harness, HarnessInput } from "./types.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OPENCODE_CONFIG = join(REPO_ROOT, "config/providers/opencode.json");

export const opencode: Harness = {
  name: "opencode",
  async run(input: HarnessInput): Promise<RunResult> {
    const prompt =
      input.driveMode === "constrained_text"
        ? `${input.prompt}\n\nUse only the corpus below; do not call tools.\n\n===== CORPUS =====\n${input.corpus}`
        : input.prompt;

    // opencode `run` takes the message positionally; --format json emits raw events.
    const args = ["run", "-m", `mellum/${input.model}`, "--format", "json", prompt];

    const r = await runCli("opencode", args, {
      cwd: input.cwd,
      env: workerEnv(input.dummyKey, { OPENCODE_CONFIG }),
      timeoutMs: input.timeoutMs
    });
    const ok = r.code === 0 && !r.timedOut;
    return {
      text: extractText(r.stdout),
      usage: zeroUsage(),
      latencyMs: r.latencyMs,
      ok,
      ...(ok ? {} : { error: r.timedOut ? "timeout" : r.stderr.slice(0, 500) })
    };
  }
};
