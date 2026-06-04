/**
 * llama-server (Mellum2) lifecycle. The benchmark expects the model already served at :8080 per
 * ~/models/AGENTS.md; these helpers let the e2e harness verify readiness and, optionally, spawn it.
 * Knows nothing of harnesses/arms (ARCHITECTURE.md §2).
 */
import { spawn, type ChildProcess } from "node:child_process";

const DEFAULT_URL = "http://127.0.0.1:8080";

export async function isUp(url: string = DEFAULT_URL, timeoutMs = 2000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/v1/models`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Wait until the server answers /v1/models, or throw after `timeoutMs`. */
export async function waitUntilUp(url: string = DEFAULT_URL, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp(url, 2000)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Mellum2 server not reachable at ${url} within ${timeoutMs}ms`);
}

export interface ServerHandle {
  proc: ChildProcess;
  stop(): void;
}

/** Spawn llama-server with the verified Mellum2 flags. Caller must `stop()` it. */
export function startServer(opts: {
  bin: string; // path to llama-server
  modelPath: string;
  port?: number;
  ctxSize?: number;
}): ServerHandle {
  const proc = spawn(
    opts.bin,
    [
      "-m", opts.modelPath,
      "--host", "127.0.0.1",
      "--port", String(opts.port ?? 8080),
      "--ctx-size", String(opts.ctxSize ?? 32768),
      "--n-gpu-layers", "99",
      "--temp", "0.6", "--top-p", "0.95", "--top-k", "20",
      "--jinja"
    ],
    { stdio: "ignore" }
  );
  return {
    proc,
    stop: () => {
      proc.kill("SIGTERM");
    }
  };
}
