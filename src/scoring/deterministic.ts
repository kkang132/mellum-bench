/**
 * Deterministic scorers; PURE (no I/O, no clock, no model). Input: model output text + a task's
 * SuccessSpec → a pass/fail Score. These are the CI gate (ARCHITECTURE.md §4-§5).
 */
import type { SuccessSpec } from "../config.js";

export interface Score {
  pass: boolean;
  detail: string;
}

// Common prose/markdown tokens to ignore when extracting identifier-like names.
const STOP = new Set([
  "the", "are", "here", "and", "or", "is", "a", "an", "of", "in", "to", "for", "with", "list",
  "exported", "function", "functions", "class", "classes", "name", "names", "file", "files",
  "identifier", "identifiers", "output", "following", "below", "these", "their", "each", "from",
  "import", "imports", "module", "symbol", "symbols", "line", "lines", "per", "nothing", "else"
]);

const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/**
 * Extract the substantive answer from raw model output: strip reasoning blocks, then return the
 * last <answer>…</answer> region if present (else the cleaned text). Pure. Lets the Thinking variant
 * reason freely without failing substance checks (v2).
 */
export function normalizeAnswer(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, " ").replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, " ");
  const answers = [...t.matchAll(/<answer>([\s\S]*?)<\/answer>/gi)];
  if (answers.length > 0) return answers[answers.length - 1]![1]!.trim();
  // No closing tag: drop a bracketed "[Start thinking] … [End thinking]" segment if delimited.
  t = t.replace(/\[start thinking\][\s\S]*?\[(?:end|stop) thinking\]/gi, " ");
  return t.trim();
}

function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Whole-word, case-insensitive presence of `needle` in `haystack`. */
function containsWord(haystack: string, needle: string): boolean {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_$])${esc}([^A-Za-z0-9_$]|$)`, "i").test(haystack);
}

function scoreSetEquals(text: string, golden: string[]): Score {
  // Identifier tokens in the output, minus stopwords/markdown noise.
  const tokens = (text.match(IDENT) ?? []).filter((t) => !STOP.has(t.toLowerCase()));
  const found = new Set(tokens);
  const want = new Set(golden);
  const missing = golden.filter((g) => !found.has(g));
  const extra = [...found].filter((f) => !want.has(f));
  const pass = missing.length === 0 && extra.length === 0;
  return {
    pass,
    detail: pass
      ? `all ${golden.length} identifiers matched exactly`
      : `missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`
  };
}

function scoreSetSubset(text: string, golden: string[]): Score {
  // All golden identifiers must appear; extra tokens are tolerated (Thinking model may add prose).
  const found = new Set(text.match(IDENT) ?? []);
  const missing = golden.filter((g) => !found.has(g));
  return {
    pass: missing.length === 0,
    detail: missing.length === 0 ? `all ${golden.length} identifiers present` : `missing=[${missing.join(", ")}]`
  };
}

function scoreKeywordsAll(text: string, required: string[], maxLines?: number): Score {
  const lines = nonEmptyLines(text);
  const overLimit = maxLines !== undefined && lines.length > maxLines;
  const missing = required.filter((kw) => !text.toLowerCase().includes(kw.toLowerCase()));
  const pass = missing.length === 0 && !overLimit;
  const parts: string[] = [];
  if (missing.length) parts.push(`missing=[${missing.join(", ")}]`);
  if (overLimit) parts.push(`too many lines: ${lines.length} > ${maxLines}`);
  return { pass, detail: pass ? `all ${required.length} keywords present` : parts.join("; ") };
}

function scorePairsAll(text: string, required: { file: string; symbol: string }[]): Score {
  const lines = nonEmptyLines(text);
  const failed = required.filter(
    (p) => !lines.some((l) => l.includes(p.file) && containsWord(l, p.symbol))
  );
  const pass = failed.length === 0;
  return {
    pass,
    detail: pass
      ? `all ${required.length} file→symbol pairs present`
      : `unmatched=[${failed.map((p) => `${p.file}:${p.symbol}`).join(", ")}]`
  };
}

function scoreValueAndSource(text: string, value: string, sourceKeyword: string): Score {
  const hasValue = containsWord(text, value);
  const hasSource = text.toLowerCase().includes(sourceKeyword.toLowerCase());
  const pass = hasValue && hasSource;
  const miss: string[] = [];
  if (!hasValue) miss.push(`value "${value}"`);
  if (!hasSource) miss.push(`source "${sourceKeyword}"`);
  return { pass, detail: pass ? `value + source cited` : `missing ${miss.join(" and ")}` };
}

/** Score model output against a task's success spec. Normalises (strips reasoning, extracts the
 * <answer> region) first, then applies the substance check. Pure and total. */
export function scoreDeterministic(text: string, spec: SuccessSpec): Score {
  const ans = normalizeAnswer(text);
  switch (spec.type) {
    case "set_equals":
      return scoreSetEquals(ans, spec.golden);
    case "set_subset":
      return scoreSetSubset(ans, spec.golden);
    case "keywords_all":
      return scoreKeywordsAll(ans, spec.required, spec.max_lines);
    case "pairs_all":
      return scorePairsAll(ans, spec.required);
    case "value_and_source":
      return scoreValueAndSource(ans, spec.value, spec.source_keyword);
  }
}
