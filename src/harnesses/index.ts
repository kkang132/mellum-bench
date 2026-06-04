/** Harness registry. The runner discovers harnesses here; nothing else imports adapters directly
 * (ARCHITECTURE.md §6). Add a harness by registering it in this map. */
import type { Harness } from "./types.js";
import { codex } from "./codex.js";
import { opencode } from "./opencode.js";
import { pi } from "./pi.js";

export const HARNESSES: Record<string, Harness> = { codex, opencode, pi };

export function getHarness(name: string): Harness {
  const h = HARNESSES[name];
  if (!h) throw new Error(`unknown harness: ${name} (have: ${Object.keys(HARNESSES).join(", ")})`);
  return h;
}

export type { Harness, HarnessInput } from "./types.js";
