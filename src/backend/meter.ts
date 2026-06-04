/**
 * Metering passthrough proxy. Sits between the harness workers and llama-server (:8080) and is the
 * single source of truth for Arm-A worker token/latency (ARCHITECTURE.md §3). Runs in-process with
 * the runner, which calls `setContext()` before invoking each pipeline stage so every upstream
 * request is attributed to (taskId, stage, harness).
 *
 * No external deps — Node http only. Streams responses through to the client while tee-ing the body
 * to a usage parser (handles both plain JSON and SSE `data:` chunks).
 */
import { createServer, request as httpRequest, type Server } from "node:http";
import { appendFileSync } from "node:fs";

export interface MeterRecord {
  ts: number;
  taskId: string;
  stage: string;
  harness: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  path: string;
}

export interface Meter {
  url: string;
  setContext(ctx: { taskId: string; stage: string; harness: string }): void;
  records(): readonly MeterRecord[];
  stop(): Promise<void>;
}

interface Usage {
  // chat/completions style
  prompt_tokens?: number;
  completion_tokens?: number;
  // responses-API style
  input_tokens?: number;
  output_tokens?: number;
}

/** Extract the last usage object found in a (possibly SSE) response body. */
function parseUsage(body: string): Usage | null {
  // SSE: scan `data: {…}` lines for the chunk carrying usage; else try whole body as JSON.
  const candidates: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^data:\s*(\{.*\})\s*$/.exec(line.trim());
    if (m) candidates.push(m[1]!);
  }
  if (candidates.length === 0) candidates.push(body);
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(candidates[i]!) as { usage?: Usage };
      if (obj.usage) return obj.usage;
    } catch {
      /* not JSON; keep scanning */
    }
  }
  return null;
}

export function startMeter(opts: {
  port?: number;
  upstream?: string; // e.g. http://127.0.0.1:8080
  logPath?: string;
}): Promise<Meter> {
  const port = opts.port ?? 8077;
  const upstreamUrl = new URL(opts.upstream ?? "http://127.0.0.1:8080");
  const log = opts.logPath;
  const recs: MeterRecord[] = [];
  let ctx = { taskId: "?", stage: "?", harness: "?" };

  const server: Server = createServer((clientReq, clientRes) => {
    const started = Date.now();
    const chunks: Buffer[] = [];
    clientReq.on("data", (c: Buffer) => chunks.push(c));
    clientReq.on("end", () => {
      const reqBody = Buffer.concat(chunks);
      const upstream = httpRequest(
        {
          hostname: upstreamUrl.hostname,
          port: upstreamUrl.port,
          path: clientReq.url,
          method: clientReq.method,
          headers: { ...clientReq.headers, host: upstreamUrl.host }
        },
        (upRes) => {
          clientRes.writeHead(upRes.statusCode ?? 502, upRes.headers);
          const respChunks: Buffer[] = [];
          upRes.on("data", (c: Buffer) => {
            respChunks.push(c);
            clientRes.write(c); // stream through
          });
          upRes.on("end", () => {
            clientRes.end();
            const usage = parseUsage(Buffer.concat(respChunks).toString("utf8"));
            recs.push({
              ts: started,
              taskId: ctx.taskId,
              stage: ctx.stage,
              harness: ctx.harness,
              promptTokens: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
              completionTokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0,
              latencyMs: Date.now() - started,
              path: clientReq.url ?? ""
            });
            if (log) appendFileSync(log, JSON.stringify(recs[recs.length - 1]) + "\n");
          });
        }
      );
      upstream.on("error", (e) => {
        clientRes.writeHead(502);
        clientRes.end(`meter upstream error: ${e.message}`);
      });
      upstream.end(reqBody);
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve({
        url: `http://127.0.0.1:${port}`,
        setContext: (c) => {
          ctx = c;
        },
        records: () => recs,
        stop: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          })
      });
    });
  });
}
