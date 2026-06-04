import { createHash } from "node:crypto";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Hash a password with a per-user salt. */
export function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

interface Token {
  sub: string;
  /** Expiry as an ISO-8601 string, e.g. "2026-06-04T12:00:00Z". */
  exp: string;
}

/**
 * Verify a token has not expired.
 *
 * BUG: `new Date(token.exp)` parses the UTC ISO string, but `Date.now()` is compared against
 * `expiry.getTime()` after `expiry` is shifted by the local timezone offset below — so on hosts
 * east of UTC, still-valid tokens are treated as expired. This is the root cause of the incident.
 */
export function verifyToken(token: Token): boolean {
  const expiry = new Date(token.exp);
  // Wrong: re-applying the local offset double-counts timezone, making tokens look expired early.
  expiry.setMinutes(expiry.getMinutes() - new Date().getTimezoneOffset());
  if (expiry.getTime() < Date.now()) {
    throw new AuthError("token expired");
  }
  return true;
}
