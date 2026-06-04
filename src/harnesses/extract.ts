/** Best-effort extraction of an assistant's final text from a harness's stdout (JSON or plain). */
export function extractText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  // Try whole-output JSON first.
  const fromJson = tryJson(trimmed);
  if (fromJson !== null) return fromJson;

  // JSON-lines event streams (e.g. opencode --format json): collect assistant text parts.
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  const collected: string[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try {
      collected.push(...collectTextParts(JSON.parse(s)));
    } catch {
      /* skip non-JSON line */
    }
  }
  if (collected.length) return collected.join("").trim();

  // Last JSON object that yields a text field.
  for (let i = lines.length - 1; i >= 0; i--) {
    const v = tryJson(lines[i]!.trim());
    if (v !== null) return v;
  }
  return trimmed; // plain text fallback
}

/** Collect assistant `text` parts from an event object (opencode emits {part:{type:"text",text}}
 * and similar). Ignores reasoning/thinking fields. */
function collectTextParts(obj: unknown): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o["type"] === "text" && typeof o["text"] === "string") out.push(o["text"]);
    for (const key of ["part", "message", "content", "info"]) {
      if (o[key]) visit(o[key]);
    }
    if (Array.isArray(o["content"])) for (const c of o["content"]) visit(c);
  };
  visit(obj);
  return out;
}

function tryJson(s: string): string | null {
  if (!(s.startsWith("{") || s.startsWith("["))) return null;
  try {
    const obj = JSON.parse(s) as unknown;
    return pluckText(obj);
  } catch {
    return null;
  }
}

/** Pull assistant text from common CLI JSON shapes. */
function pluckText(obj: unknown): string | null {
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) {
    // messages array → last assistant content
    for (let i = obj.length - 1; i >= 0; i--) {
      const t = pluckText(obj[i]);
      if (t) return t;
    }
    return null;
  }
  if (obj && typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    for (const key of ["result", "text", "content", "message", "response", "output"]) {
      if (typeof o[key] === "string") return o[key] as string;
      if (o[key] && typeof o[key] === "object") {
        const nested = pluckText(o[key]);
        if (nested) return nested;
      }
    }
    if (Array.isArray(o["messages"])) return pluckText(o["messages"]);
  }
  return null;
}
