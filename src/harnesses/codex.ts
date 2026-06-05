/** Codex adapter. Custom OpenAI-compatible provider supplied via `-c` config overrides at call time
 * (see config/providers/codex.toml). `codex exec` is non-interactive. */
import { zeroUsage, type RunResult } from "../config.js";
import { runCli, workerEnv } from "./run.js";
import { extractText } from "./extract.js";
import type { Harness, HarnessInput } from "./types.js";

export const codex: Harness = {
  name: "codex",
  async run(input: HarnessInput): Promise<RunResult> {
    const prompt =
      input.driveMode === "constrained_text"
        ? `${input.prompt}\n\nDo not use any tools. Use only the corpus below.\n\n===== CORPUS =====\n${input.corpus}`
        : input.prompt;

    const sandbox = input.driveMode === "agentic" ? "workspace-write" : "read-only";
    const args = [
      "exec",
      "-c", "model_provider=mellum",
      "-c", `model=${input.model}`,
      "-c", `model_providers.mellum.name="Mellum2"`,
      "-c", `model_providers.mellum.base_url="${input.proxyUrl}/v1"`,
      "-c", `model_providers.mellum.wire_api="responses"`,
      "-c", `model_providers.mellum.env_key="MELLUM_DUMMY_KEY"`,
      "-c", `approval_policy="never"`,
      "-c", `sandbox_mode="${sandbox}"`,
      "--skip-git-repo-check",
      prompt
    ];

    const r = await runCli("codex", args, {
      cwd: input.cwd,
      env: workerEnv(input.dummyKey),
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
