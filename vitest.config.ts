import { defineConfig } from "vitest/config";

// Default (offline) suite: unit tests + the security/supply-chain gate.
// E2E tests (which make real model calls) live in *.e2e.test.ts and are run
// separately via vitest.e2e.config.ts so the default run stays free & deterministic.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.e2e.test.ts", "node_modules/**", "dist/**"],
    environment: "node",
    // osv-scanner / npm audit can take a little while.
    testTimeout: 120_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Coverage is gated on PURE-LOGIC modules only. Subprocess orchestration
      // (backend/harnesses/arms) is exercised by the e2e suite, not counted here.
      include: [
        "src/scoring/deterministic.ts",
        "src/tasks.ts",
        "src/metrics.ts",
        "src/config.ts"
      ],
      // judge.ts is the non-deterministic LLM judge (paid, e2e-only); not part of the pure gate.
      exclude: ["src/scoring/judge.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75
      }
    }
  }
});
