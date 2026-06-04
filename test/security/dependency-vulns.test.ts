import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function hasBin(bin: string): boolean {
  try {
    execFileSync(bin, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("dependency vulnerability gate", () => {
  it("osv-scanner reports no vulnerabilities for package-lock.json", () => {
    expect(hasBin("osv-scanner"), "osv-scanner missing — run scripts/setup.sh (brew install osv-scanner)").toBe(true);

    let raw = "";
    try {
      // exit 0 = clean. Non-zero = vulns found (or error) — output captured for inspection.
      raw = execSync(`osv-scanner --lockfile=package-lock.json --format=json`, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      // clean run: assert no results
      const parsed = JSON.parse(raw || "{}") as { results?: unknown[] };
      expect(parsed.results ?? []).toEqual([]);
    } catch (e) {
      const err = e as { stdout?: string };
      const parsed = JSON.parse(err.stdout || "{}") as {
        results?: { packages?: { vulnerabilities?: unknown[] }[] }[];
      };
      const vulns =
        parsed.results?.flatMap((r) => r.packages ?? []).flatMap((p) => p.vulnerabilities ?? []) ?? [];
      expect(vulns, `osv-scanner found ${vulns.length} vulnerabilities`).toEqual([]);
    }
  });

  it("npm audit reports no high/critical advisories", () => {
    let raw = "";
    try {
      raw = execSync(`npm audit --audit-level=high --json`, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
    } catch (e) {
      // npm audit exits non-zero when advisories are found; the JSON is still on stdout.
      raw = (e as { stdout?: string }).stdout ?? "";
    }
    const audit = JSON.parse(raw || "{}") as {
      metadata?: { vulnerabilities?: Record<string, number> };
    };
    const v = audit.metadata?.vulnerabilities ?? {};
    const highOrCritical = (v.high ?? 0) + (v.critical ?? 0);
    expect(highOrCritical, `npm audit: ${highOrCritical} high/critical`).toBe(0);
  });

  it("npm audit signatures finds no invalid registry signatures", () => {
    let raw = "";
    let failed = false;
    try {
      raw = execSync("npm audit signatures", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      failed = true;
      raw = (e as { stdout?: string; stderr?: string }).stdout ?? (e as { stderr?: string }).stderr ?? "";
    }
    // A tampered/forged package yields "invalid" signatures — that must fail. Missing signatures
    // (older packages) are tolerated; the command exits 0 when all present signatures verify.
    expect(/invalid/i.test(raw), `npm audit signatures reported invalid signatures:\n${raw}`).toBe(false);
    expect(failed, `npm audit signatures exited non-zero:\n${raw}`).toBe(false);
  });
});
