#!/usr/bin/env tsx
/** FREE smoke test: meter proxy + one local Mellum2 call per harness (no Claude). Proves the
 * harness → proxy → llama-server path and that the proxy captures token usage. */
import { startMeter } from "../backend/meter.js";
import { isUp } from "../backend/server.js";
import { HARNESSES } from "../harnesses/index.js";

if (!(await isUp())) {
  console.error("Mellum2 not up at http://127.0.0.1:8080; start llama-server first.");
  process.exit(1);
}

const meter = await startMeter({ port: 8077, upstream: "http://127.0.0.1:8080" });
const dummyKey = process.env.MELLUM_DUMMY_KEY ?? "local-dummy";
const only = process.argv[2]; // optional: smoke just one harness

for (const [name, h] of Object.entries(HARNESSES)) {
  if (only && name !== only) continue;
  meter.setContext({ taskId: "smoke", stage: "smoke", harness: name });
  const res = await h.run({
    prompt: "Reply with exactly the two characters: ok",
    corpus: "",
    driveMode: "constrained_text",
    cwd: process.cwd(),
    model: "mellum2",
    proxyUrl: meter.url,
    dummyKey,
    timeoutMs: 120_000
  });
  console.log(`\n[${name}] ok=${res.ok} latency=${res.latencyMs}ms`);
  console.log(`  text: ${JSON.stringify((res.text || "").slice(0, 160))}`);
  if (res.error) console.log(`  error: ${res.error.slice(0, 200)}`);
}

const recs = meter.records();
console.log(`\nmeter captured ${recs.length} upstream request(s):`);
for (const r of recs) console.log(`  ${r.harness} ${r.path} prompt=${r.promptTokens} completion=${r.completionTokens} ${r.latencyMs}ms`);
await meter.stop();
