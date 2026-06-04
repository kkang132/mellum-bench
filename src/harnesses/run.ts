/** Shared subprocess helper for harness adapters. */
import { spawn } from "node:child_process";

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
  latencyMs: number;
  timedOut: boolean;
}

export function runCli(
  bin: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; input?: string }
): Promise<CliResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const proc = spawn(bin, args, { cwd: opts.cwd, env: opts.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, opts.timeoutMs);

    proc.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    // Always close stdin so CLIs that read it (pi, others) see EOF and don't block.
    if (opts.input !== undefined) proc.stdin.write(opts.input);
    proc.stdin.end();
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, latencyMs: Date.now() - started, timedOut });
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(e), code: -1, latencyMs: Date.now() - started, timedOut });
    });
  });
}

/** Minimal env for a sandboxed worker: PATH + HOME + the dummy key only (no real secrets). */
export function workerEnv(dummyKey: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    MELLUM_DUMMY_KEY: dummyKey,
    OPENAI_API_KEY: dummyKey, // harnesses default to this var for OpenAI-compatible providers
    ...extra
  };
}
