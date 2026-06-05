import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const INSTRUCT = "mellum2-instruct";

describe("instruct variant is wired in the provider configs", () => {
  it("opencode registers the instruct model", () => {
    const cfg = JSON.parse(
      readFileSync(join(ROOT, "config/providers/opencode.json"), "utf8")
    );
    expect(Object.keys(cfg.provider.mellum.models)).toContain(INSTRUCT);
  });

  it("pi registers the instruct model", () => {
    const cfg = JSON.parse(
      readFileSync(join(ROOT, "config/providers/pi.models.json"), "utf8")
    );
    const ids = cfg.providers.mellum.models.map((m: { id: string }) => m.id);
    expect(ids).toContain(INSTRUCT);
  });

  it("codex provider references the instruct label", () => {
    const toml = readFileSync(join(ROOT, "config/providers/codex.toml"), "utf8");
    expect(toml).toContain(INSTRUCT);
  });
});

describe("MELLUM_MODEL selects the instruct worker model", () => {
  it("WORKER_MODEL honors MELLUM_MODEL=mellum2-instruct", async () => {
    const prev = process.env.MELLUM_MODEL;
    process.env.MELLUM_MODEL = INSTRUCT;
    try {
      vi.resetModules();
      const fresh = await import("../src/config.js");
      expect(fresh.WORKER_MODEL).toBe(INSTRUCT);
    } finally {
      if (prev === undefined) delete process.env.MELLUM_MODEL;
      else process.env.MELLUM_MODEL = prev;
      vi.resetModules();
    }
  });
});

describe("a harness runs with the instruct model from config", () => {
  it("codex forwards model=mellum2-instruct and reports ok", async () => {
    vi.resetModules();
    let capturedArgs: string[] = [];
    vi.doMock("../src/harnesses/run.js", async () => {
      const actual = await vi.importActual<typeof import("../src/harnesses/run.js")>(
        "../src/harnesses/run.js"
      );
      return {
        ...actual,
        runCli: vi.fn(async (_bin: string, args: string[]) => {
          capturedArgs = args;
          return { stdout: "done", stderr: "", code: 0, latencyMs: 1, timedOut: false };
        })
      };
    });

    const { codex } = await import("../src/harnesses/codex.js");
    const res = await codex.run({
      prompt: "summarize",
      corpus: "corpus",
      driveMode: "constrained_text",
      cwd: ROOT,
      model: INSTRUCT,
      proxyUrl: "http://127.0.0.1:8077",
      dummyKey: "dummy",
      timeoutMs: 1000
    });

    expect(res.ok).toBe(true);
    expect(capturedArgs).toContain(`model=${INSTRUCT}`);

    vi.doUnmock("../src/harnesses/run.js");
    vi.resetModules();
  });
});
