#!/usr/bin/env tsx
/** Free per-harness latency profiler. Runs each harness standalone on each task, strictly serialised,
 * and separates model-busy time (union of upstream Mellum2 request intervals, from the proxy) from
 * harness overhead (wall − model). Includes a raw direct-to-Mellum2 baseline (the floor). */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMeter, type MeterRecord } from "../backend/meter.js";
import { isUp } from "../backend/server.js";
import { loadTaskList, readFixtures, renderCorpus } from "../tasks.js";
import { HARNESSES } from "../harnesses/index.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const dummyKey = process.env.MELLUM_DUMMY_KEY ?? "local-dummy";
const timeoutMs = Number(process.env.PROFILE_TIMEOUT_MS ?? 200_000);

if (!(await isUp())) {
  console.error("Mellum2 not up at :8080");
  process.exit(1);
}

/** total duration covered by the union of [start, start+len] intervals (ms). */
function unionMs(recs: MeterRecord[]): number {
  const iv = recs.map((r) => [r.ts, r.ts + r.latencyMs] as [number, number]).sort((a, b) => a[0] - b[0]);
  let total = 0, curS = 0, curE = 0, open = false;
  for (const [s, e] of iv) {
    if (!open) { curS = s; curE = e; open = true; }
    else if (s <= curE) { curE = Math.max(curE, e); }
    else { total += curE - curS; curS = s; curE = e; }
  }
  if (open) total += curE - curS;
  return total;
}

function killStragglers(): void {
  try { execSync('pkill -f "opencode" 2>/dev/null; pkill -f "codex" 2>/dev/null', { stdio: "ignore" }); } catch { /* none */ }
}

const meter = await startMeter({ port: 8077, upstream: "http://127.0.0.1:8080" });
const tasks = loadTaskList(join(ROOT, "config/tasks.yaml"));

interface Row { task: string; runner: string; wallS: number; modelS: number; ovhS: number; calls: number; comp: number }
const rows: Row[] = [];

for (const task of tasks) {
  const corpus = renderCorpus(readFixtures(task, ROOT));
  const prompt = `${task.prompt.trim()}\n\n===== CORPUS =====\n${corpus}`;

  // raw baseline: one direct call through the proxy
  {
    const before = meter.records().length;
    meter.setContext({ taskId: task.id, stage: "raw", harness: "raw" });
    const t0 = Date.now();
    const res = await fetch("http://127.0.0.1:8077/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${dummyKey}` },
      body: JSON.stringify({ model: "mellum2", messages: [{ role: "user", content: prompt }], max_tokens: 4096, temperature: 0.6 })
    });
    await res.text();
    const wall = Date.now() - t0;
    const recs = meter.records().slice(before);
    rows.push({ task: task.id, runner: "raw", wallS: wall / 1000, modelS: unionMs(recs) / 1000, ovhS: (wall - unionMs(recs)) / 1000, calls: recs.length, comp: recs.reduce((a, r) => a + r.completionTokens, 0) });
  }

  for (const [name, h] of Object.entries(HARNESSES)) {
    killStragglers();
    const before = meter.records().length;
    meter.setContext({ taskId: task.id, stage: "solo", harness: name });
    const t0 = Date.now();
    const res = await h.run({ prompt: task.prompt.trim(), corpus, driveMode: "constrained_text", cwd: ROOT, model: "mellum2", proxyUrl: meter.url, dummyKey, timeoutMs });
    const wall = Date.now() - t0;
    const recs = meter.records().slice(before);
    const m = unionMs(recs);
    rows.push({ task: task.id, runner: name, wallS: wall / 1000, modelS: m / 1000, ovhS: (wall - m) / 1000, calls: recs.length, comp: recs.reduce((a, r) => a + r.completionTokens, 0) });
    console.log(`${task.id} / ${name}: wall=${(wall / 1000).toFixed(1)}s model=${(m / 1000).toFixed(1)}s ovh=${((wall - m) / 1000).toFixed(1)}s calls=${recs.length} ok=${res.ok}`);
  }
}
killStragglers();
await meter.stop();

// per-runner averages
const runners = ["raw", "codex", "opencode", "pi"];
console.log("\n=== per-runner averages (mean over 5 tasks) ===");
console.log("runner     wall(s)  model(s)  harness-ovh(s)  calls  compTok  model%");
for (const r of runners) {
  const rs = rows.filter((x) => x.runner === r);
  const avg = (f: (x: Row) => number) => rs.reduce((a, x) => a + f(x), 0) / rs.length;
  const wall = avg((x) => x.wallS), model = avg((x) => x.modelS), ovh = avg((x) => x.ovhS);
  console.log(`${r.padEnd(10)} ${wall.toFixed(1).padStart(6)}  ${model.toFixed(1).padStart(7)}  ${ovh.toFixed(1).padStart(13)}  ${avg((x) => x.calls).toFixed(1).padStart(5)}  ${avg((x) => x.comp).toFixed(0).padStart(7)}  ${((model / wall) * 100).toFixed(0).padStart(5)}%`);
}
writeFileSync(join(ROOT, "results", "profile.json"), JSON.stringify(rows, null, 2));
