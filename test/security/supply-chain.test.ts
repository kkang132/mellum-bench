import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

describe("dependencies are exact-pinned (no floating ranges)", () => {
  const pkg = JSON.parse(read("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [name, spec] of Object.entries(all)) {
    it(`${name}@${spec} is an exact version`, () => {
      expect(spec, `${name} must be exact, not a range/latest`).toMatch(EXACT_SEMVER);
    });
  }
});

describe("package-lock.json has integrity hashes and https sources", () => {
  it("exists (run `npm ci` / `npm install` first)", () => {
    expect(existsSync(join(ROOT, "package-lock.json")), "package-lock.json missing").toBe(true);
  });

  it("every registry package has https resolved + integrity", () => {
    const lock = JSON.parse(read("package-lock.json")) as {
      packages: Record<string, { resolved?: string; integrity?: string; link?: boolean }>;
    };
    const offenders: string[] = [];
    for (const [key, entry] of Object.entries(lock.packages)) {
      if (key === "" || entry.link) continue; // root / local link
      if (!entry.resolved) continue; // local/workspace entry
      if (!entry.resolved.startsWith("https://")) offenders.push(`${key}: non-https resolved`);
      if (!entry.integrity) offenders.push(`${key}: missing integrity`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("scripts do not pipe network downloads into a shell", () => {
  const scripts = ["scripts/setup.sh"];
  for (const s of scripts) {
    it(`${s} has no curl|wget pipe-to-shell and only https external URLs`, () => {
      const body = read(s);
      expect(body, "pipe-to-shell detected").not.toMatch(/(curl|wget)[^\n]*\|\s*(sudo\s+)?(sh|bash)/);
      // any non-localhost http:// is forbidden (localhost endpoints are allowed runtime config)
      const badUrls = [...body.matchAll(/http:\/\/(?!127\.0\.0\.1|localhost)[^\s"')]+/g)].map((m) => m[0]);
      expect(badUrls, badUrls.join(", ")).toEqual([]);
    });
  }
});

describe("installed harness versions match the pinned manifest", () => {
  const manifest = read("config/harness-manifest.toml");
  const pin = (section: string): string => {
    const m = new RegExp(`\\[${section}\\][^\\[]*version\\s*=\\s*"([^"]+)"`).exec(manifest);
    if (!m) throw new Error(`no version pin for [${section}]`);
    return m[1]!;
  };
  const installedVersion = (bin: string): string | null => {
    try {
      // Some CLIs (pi) print --version to stderr, so merge both streams.
      const out = execFileSync(bin, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const err = ""; // execFileSync returns stdout; fall through to combined exec on miss
      const hit = /(\d+\.\d+\.\d+)/.exec(out + err)?.[1];
      if (hit) return hit;
    } catch {
      /* fall through to combined-stream attempt */
    }
    try {
      const combined = execFileSync("sh", ["-c", `${bin} --version 2>&1`], { encoding: "utf8" });
      return /(\d+\.\d+\.\d+)/.exec(combined)?.[1] ?? null;
    } catch {
      return null;
    }
  };
  for (const [section, bin] of [
    ["codex", "codex"],
    ["opencode", "opencode"],
    ["pi", "pi"]
  ] as const) {
    it(`${bin} == pin ${section}`, () => {
      const installed = installedVersion(bin);
      expect(installed, `${bin} not installed; run scripts/setup.sh`).not.toBeNull();
      expect(installed).toBe(pin(section));
    });
  }
});

describe("secrets are git-ignored", () => {
  it(".gitignore excludes .env files", () => {
    expect(read(".gitignore")).toMatch(/^\.env$/m);
  });
});
