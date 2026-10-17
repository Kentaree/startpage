import crypto from "node:crypto";
import type { Repo, User } from "../repo/index.js";

export const SESSION_COOKIE = "sid";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export function createSession(repo: Repo, userId: number, now = Date.now()): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(now + SESSION_TTL_MS);
  repo.sessions.create(hashToken(token), userId, expires.toISOString());
  return { token, expires };
}

export function lookupSession(repo: Repo, token: string | undefined, now = Date.now()): User | undefined {
  if (!token) return undefined;
  const h = hashToken(token);
  const s = repo.sessions.get(h);
  if (!s) return undefined;
  if (Date.parse(s.expires_at) <= now) {
    repo.sessions.delete(h);
    return undefined;
  }
  return repo.users.getById(s.user_id);
}
