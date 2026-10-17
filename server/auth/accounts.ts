import argon2 from "argon2";
import type { DB } from "../db.js";
import type { Repo, User } from "../repo/index.js";

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 256;

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const isValidEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });

// Verified against when the account doesn't exist, to keep timing similar.
let dummy: Promise<string> | undefined;
export async function verifyPassword(user: User | undefined, pw: string): Promise<boolean> {
  if (!user?.password_hash) {
    await argon2.verify(await (dummy ??= hashPassword("dummy-password")), pw).catch(() => false);
    return false;
  }
  return argon2.verify(user.password_hash, pw).catch(() => false);
}

/**
 * Create a user (+ optional Google identity) with the default weather and clock
 * widgets and the lg/md/sm layouts, all in one transaction.
 */
export function createAccount(
  db: DB,
  repo: Repo,
  email: string,
  passwordHash: string | null,
  identity?: { provider: string; subject: string },
): User {
  return db.transaction(() => {
    const user = repo.users.create(email, passwordHash);
    if (identity) repo.identities.link(user.id, identity.provider, identity.subject);
    const weather = repo.widgets.create(user.id, "weather", { unit: "c" });
    const clock = repo.widgets.create(user.id, "clock", {});
    for (const bp of ["lg", "md", "sm"] as const) repo.layouts.set(user.id, bp, [weather.id, clock.id]);
    return user;
  })();
}
