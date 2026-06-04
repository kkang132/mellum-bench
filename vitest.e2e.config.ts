import { defineConfig } from "vitest/config";

// E2E suite ONLY. Makes real calls: Mellum2 (local, free) + Claude (advisor + Arm B, REAL COST).
// Requires: Mellum2 llama-server + metering proxy running, harnesses installed, claude CLI authed.
export default defineConfig({
  test: {
    include: ["test/**/*.e2e.test.ts"],
    environment: "node",
    // Full pipelines over 5 tasks × 2 regimes × 2 arms — allow generous time.
    testTimeout: 1_800_000,
    hookTimeout: 120_000,
    // Real model calls must not run in parallel (shared local server + cost control).
    fileParallelism: false,
    sequence: { concurrent: false }
  }
});
