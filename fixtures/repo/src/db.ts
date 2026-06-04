import { verifyToken } from "./auth";

export interface Row {
  [column: string]: string | number | null;
}

/** Open a (fake) database connection after verifying the caller's token. */
export function connect(token: { sub: string; exp: string }): { connected: boolean } {
  verifyToken(token);
  return { connected: true };
}

/** Run a (fake) query, returning canned rows. */
export function query(sql: string): Row[] {
  if (!sql.trim()) return [];
  return [{ id: 1, sql }];
}
