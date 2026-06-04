/** Harness adapter contract. A harness is a Mellum2 worker; it knows its DriveMode but nothing
 * about arms/regimes (ARCHITECTURE.md §3). */
import type { DriveMode, RunResult } from "../config.js";

export interface HarnessInput {
  /** Full instruction for the worker (may already include the advisor's plan). */
  prompt: string;
  /** Pre-read corpus content, injected in `constrained_text` mode (no tool-calling needed). */
  corpus: string;
  driveMode: DriveMode;
  /** Sandbox working directory the harness is confined to (dummy key only). */
  cwd: string;
  model: string; // "mellum2"
  proxyUrl: string; // OpenAI-compatible base served by the metering proxy
  dummyKey: string;
  timeoutMs: number;
}

export interface Harness {
  readonly name: string;
  run(input: HarnessInput): Promise<RunResult>;
}

export type { RunResult };
