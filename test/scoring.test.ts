import { describe, it, expect } from "vitest";
import { scoreDeterministic, normalizeAnswer } from "../src/scoring/deterministic.js";

describe("normalizeAnswer", () => {
  it("extracts the <answer> region", () => {
    expect(normalizeAnswer("blah\n<answer>the result</answer>\ntrailing")).toBe("the result");
  });
  it("strips <think> reasoning when no answer tags", () => {
    expect(normalizeAnswer("<think>lots of reasoning</think> final")).toBe("final");
  });
  it("uses the last <answer> if several", () => {
    expect(normalizeAnswer("<answer>draft</answer> ... <answer>final</answer>")).toBe("final");
  });
});

describe("scoreDeterministic scores only the answer region", () => {
  it("passes when keywords are inside <answer> even with noisy thinking around it", () => {
    const out = "<think>1.0.0 mentioned only in reasoning</think>\n<answer>1.0.0 initial release; 2.0.0 breaking; 1.1.0 rate limit</answer>";
    const r = scoreDeterministic(out, {
      type: "keywords_all",
      required: ["1.0.0", "1.1.0", "2.0.0", "initial release", "rate limit", "breaking"]
    });
    expect(r.pass).toBe(true);
  });
  it("fails when a required keyword is ONLY in the stripped reasoning, not the answer", () => {
    const out = "<think>the fix is in auth.ts</think>\n<answer>something unrelated</answer>";
    const r = scoreDeterministic(out, { type: "keywords_all", required: ["auth.ts"] });
    expect(r.pass).toBe(false);
  });
});

describe("scoreDeterministic / set_subset", () => {
  const golden = ["hashPassword", "verifyToken", "AuthError"];
  it("passes when all golden present, extras tolerated", () => {
    const r = scoreDeterministic("<answer>hashPassword\nverifyToken\nAuthError\nsomethingExtra</answer>", {
      type: "set_subset",
      golden
    });
    expect(r.pass).toBe(true);
  });
  it("fails when a golden identifier is missing", () => {
    const r = scoreDeterministic("hashPassword verifyToken", { type: "set_subset", golden });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("AuthError");
  });
});

describe("scoreDeterministic / set_equals", () => {
  const golden = ["hashPassword", "verifyToken", "AuthError"];
  it("passes on an exact one-per-line list", () => {
    const r = scoreDeterministic("hashPassword\nverifyToken\nAuthError", { type: "set_equals", golden });
    expect(r.pass).toBe(true);
  });
  it("ignores prose/markdown noise words", () => {
    const r = scoreDeterministic(
      "Here are the exported functions:\n- hashPassword\n- verifyToken\n- AuthError",
      { type: "set_equals", golden }
    );
    expect(r.pass).toBe(true);
  });
  it("fails when an identifier is missing", () => {
    const r = scoreDeterministic("hashPassword\nverifyToken", { type: "set_equals", golden });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("AuthError");
  });
  it("fails on a hallucinated extra identifier", () => {
    const r = scoreDeterministic("hashPassword\nverifyToken\nAuthError\nbogusExtra", {
      type: "set_equals",
      golden
    });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("bogusExtra");
  });
});

describe("scoreDeterministic / keywords_all", () => {
  it("passes when all keywords present within line limit", () => {
    const r = scoreDeterministic("v1.0.0 initial release\nv2.0.0 breaking change", {
      type: "keywords_all",
      required: ["1.0.0", "initial release", "breaking"],
      max_lines: 8
    });
    expect(r.pass).toBe(true);
  });
  it("fails when a keyword is missing", () => {
    const r = scoreDeterministic("1.0.0 only", {
      type: "keywords_all",
      required: ["1.0.0", "breaking"]
    });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("breaking");
  });
  it("fails when over the line limit", () => {
    const r = scoreDeterministic("a\nb\nc", {
      type: "keywords_all",
      required: ["a"],
      max_lines: 2
    });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("too many lines");
  });
});

describe("scoreDeterministic / pairs_all", () => {
  const required = [
    { file: "users.ts", symbol: "hashPassword" },
    { file: "db.ts", symbol: "verifyToken" }
  ];
  it("passes when each file→symbol pair is on a line", () => {
    const r = scoreDeterministic("users.ts: hashPassword\ndb.ts: verifyToken", {
      type: "pairs_all",
      required
    });
    expect(r.pass).toBe(true);
  });
  it("fails when a pair is split across lines", () => {
    const r = scoreDeterministic("users.ts\nhashPassword\ndb.ts: verifyToken", {
      type: "pairs_all",
      required
    });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("users.ts:hashPassword");
  });
});

describe("scoreDeterministic / value_and_source", () => {
  const spec = { type: "value_and_source", value: "debug", source_keyword: "env" } as const;
  it("passes when value and source are cited", () => {
    expect(scoreDeterministic("Effective log_level is debug, set in env.md", spec).pass).toBe(true);
  });
  it("fails when the value is wrong/absent", () => {
    const r = scoreDeterministic("log_level is warn per override.md", spec);
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("debug");
  });
  it("fails when the source is not cited", () => {
    const r = scoreDeterministic("the value is debug", spec);
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("env");
  });
});
