import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DB } from "./db.js";
import { createSqliteRepo, type User } from "./repo/index.js";
import {
  MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, createAccount, hashPassword, isValidEmail, normalizeEmail, verifyPassword,
} from "./auth/accounts.js";
import { SESSION_COOKIE, createSession, hashToken, lookupSession } from "./auth/sessions.js";
import { createRateLimiter } from "./auth/rateLimit.js";
import { createRssService, type RssServiceOptions } from "./rss/service.js";
import { registerGeocodeRoutes, type GeocodeOptions } from "./geocode.js";
import { registerWidgetRoutes } from "./widgets.js";
import { createGoogleClient, newChecks, type GoogleChecks, type GoogleClient } from "./auth/google.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const OAUTH_COOKIE = "g_oauth";
const OAUTH_TTL_MS = 10 * 60 * 1000;
/** Paths reachable without a session (besides /auth/*). */
const { version } = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")
) as { version: string };

const PUBLIC_PATHS = new Set(["/login", "/login.html", "/login.js", "/login.css", "/healthz"]);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://api.open-meteo.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export interface AppOptions {
  /** Public URL of the app (defaults to BASE_URL). */
  baseUrl?: string;
  /** Google client; defaults to a real one when GOOGLE_CLIENT_ID/SECRET are set. */
  google?: GoogleClient | null;
  loginRateLimit?: { max: number; windowMs: number };
  signupRateLimit?: { max: number; windowMs: number };
  trustProxy?: boolean;
  /** Overrides for the RSS fetcher (tests). */
  rss?: RssServiceOptions;
  /** Overrides for the city search proxy (tests). */
  geocode?: GeocodeOptions;
}

declare module "fastify" {
  interface FastifyRequest { user?: User }
}

export function buildApp(db: DB, opts: AppOptions = {}) {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    trustProxy: opts.trustProxy ?? process.env.TRUST_PROXY === "1",
  });
  const repo = createSqliteRepo(db);
  app.decorate("repo", repo);
  app.register(fastifyCookie);

  const baseUrl = (opts.baseUrl ?? process.env.BASE_URL)?.replace(/\/+$/, "");
  // Allow non-Secure cookies only for http:// base URLs (local dev) or when nothing is configured outside production.
  const secureCookies = baseUrl ? baseUrl.startsWith("https:") : process.env.NODE_ENV === "production";
  const cookieOpts = { httpOnly: true, secure: secureCookies, sameSite: "lax" as const, path: "/" };

  let google = opts.google;
  if (google === undefined) {
    const id = process.env.GOOGLE_CLIENT_ID;
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    google = id && secret && baseUrl ? createGoogleClient(id, secret, `${baseUrl}/auth/google/callback`) : null;
  }

  const loginLimit = createRateLimiter(opts.loginRateLimit?.max ?? 10, opts.loginRateLimit?.windowMs ?? 15 * 60_000);
  const signupLimit = createRateLimiter(opts.signupRateLimit?.max ?? 5, opts.signupRateLimit?.windowMs ?? 60 * 60_000);

  const oauthPending = new Map<string, { checks: GoogleChecks; expires: number }>();
  const cleanup = setInterval(() => {
    const now = Date.now();
    repo.sessions.deleteExpired(new Date(now).toISOString());
    for (const [k, v] of oauthPending) if (v.expires <= now) oauthPending.delete(k);
  }, 60 * 60_000);
  cleanup.unref();
  app.addHook("onClose", async () => clearInterval(cleanup));

  const startSession = (reply: FastifyReply, userId: number) => {
    const { token, expires } = createSession(repo, userId);
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOpts, expires });
  };

  // Security headers.
  app.addHook("onSend", async (_req, reply) => {
    reply.header("Content-Security-Policy", CSP);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
  });

  // CSRF: Origin check on every mutating request.
  app.addHook("onRequest", async (req, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    const expected = baseUrl ? new URL(baseUrl).origin : `${req.protocol}://${req.headers.host}`;
    let origin = req.headers.origin;
    if (!origin && req.headers.referer) {
      try { origin = new URL(req.headers.referer).origin; } catch { /* invalid */ }
    }
    if (origin !== expected) return reply.code(403).send({ error: "Cross-origin request rejected" });
  });

  // Route guard.
  app.addHook("onRequest", async (req, reply) => {
    const pathname = req.url.split("?")[0];
    req.user = lookupSession(repo, req.cookies[SESSION_COOKIE]);
    if (pathname.startsWith("/auth/") || pathname === "/healthz") return;
    if (PUBLIC_PATHS.has(pathname)) {
      if (req.user && (pathname === "/login" || pathname === "/login.html")) return reply.redirect("/");
      return;
    }
    if (req.user) return;
    if (pathname === "/api" || pathname.startsWith("/api/")) return reply.code(401).send({ error: "Not authenticated" });
    return reply.redirect("/login");
  });

  app.get("/api/version", async () => ({ version }));

  app.get("/healthz", async () => {
    db.prepare("SELECT 1").get();
    return { status: "ok" };
  });

  app.get("/login", (_req, reply) => reply.sendFile("login.html"));

  type Creds = { email?: unknown; password?: unknown };
  const parseCreds = (body: unknown) => {
    const b = (body ?? {}) as Creds;
    if (typeof b.email !== "string" || typeof b.password !== "string") return null;
    return { email: normalizeEmail(b.email), password: b.password };
  };

  app.post("/auth/signup", async (req, reply) => {
    if (!signupLimit.hit(req.ip)) return reply.code(429).send({ error: "Too many sign-up attempts. Try again later." });
    const c = parseCreds(req.body);
    if (!c || !isValidEmail(c.email)) return reply.code(400).send({ error: "Enter a valid email address." });
    if (c.password.length < MIN_PASSWORD_LENGTH)
      return reply.code(400).send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    if (c.password.length > MAX_PASSWORD_LENGTH) return reply.code(400).send({ error: "Password is too long." });
    if (repo.users.getByEmail(c.email))
      return reply.code(409).send({ error: "An account with this email already exists. Try signing in." });
    const hash = await hashPassword(c.password);
    let user: User;
    try {
      user = createAccount(db, repo, c.email, hash);
    } catch (e) {
      if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE")
        return reply.code(409).send({ error: "An account with this email already exists. Try signing in." });
      throw e;
    }
    startSession(reply, user.id);
    return reply.code(201).send({ ok: true });
  });

  app.post("/auth/login", async (req, reply) => {
    const c = parseCreds(req.body);
    if (!c) return reply.code(400).send({ error: "Enter your email and password." });
    if (!loginLimit.hit(`ip:${req.ip}`) || !loginLimit.hit(`email:${c.email}`))
      return reply.code(429).send({ error: "Too many sign-in attempts. Try again later." });
    const user = repo.users.getByEmail(c.email);
    if (!(await verifyPassword(user, c.password)) || !user)
      return reply.code(401).send({ error: "Invalid email or password." });
    startSession(reply, user.id);
    return { ok: true };
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) repo.sessions.delete(hashToken(token));
    reply.clearCookie(SESSION_COOKIE, cookieOpts);
    return { ok: true };
  });

  const loginError = (reply: FastifyReply, code: string) => reply.redirect(`/login?error=${code}`);

  app.get("/auth/google", async (_req: FastifyRequest, reply) => {
    if (!google) return loginError(reply, "google_unavailable");
    const checks = newChecks();
    const id = crypto.randomBytes(16).toString("base64url");
    oauthPending.set(id, { checks, expires: Date.now() + OAUTH_TTL_MS });
    reply.setCookie(OAUTH_COOKIE, id, { ...cookieOpts, maxAge: OAUTH_TTL_MS / 1000 });
    return reply.redirect(await google.authorizationUrl(checks));
  });

  app.get("/auth/google/callback", async (req, reply) => {
    if (!google) return loginError(reply, "google_unavailable");
    const id = req.cookies[OAUTH_COOKIE];
    const pending = id ? oauthPending.get(id) : undefined;
    if (id) oauthPending.delete(id);
    reply.clearCookie(OAUTH_COOKIE, cookieOpts);
    if (!pending || pending.expires <= Date.now()) return loginError(reply, "google_failed");

    let profile;
    try {
      const callbackUrl = `${baseUrl ?? `${req.protocol}://${req.headers.host}`}${req.url}`;
      profile = await google.exchange(callbackUrl, pending.checks);
    } catch (e) {
      req.log.warn({ err: e }, "google sign-in failed");
      return loginError(reply, "google_failed");
    }

    const existing = repo.identities.find("google", profile.sub);
    if (existing) {
      startSession(reply, existing.user_id);
      return reply.redirect("/");
    }
    // Only trust the email if Google says it is verified.
    if (profile.email_verified !== true || !profile.email) return loginError(reply, "google_unverified");
    const email = normalizeEmail(profile.email);
    // Never auto-link to an existing account by email alone.
    if (repo.users.getByEmail(email)) return loginError(reply, "account_exists");
    let user: User;
    try {
      user = createAccount(db, repo, email, null, { provider: "google", subject: profile.sub });
    } catch (e) {
      if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return loginError(reply, "account_exists");
      throw e;
    }
    startSession(reply, user.id);
    return reply.redirect("/");
  });

  registerGeocodeRoutes(app, opts.geocode);
  registerWidgetRoutes(app, db, repo, createRssService(repo, opts.rss));

  app.register(fastifyStatic, { root: publicDir });
  return app;
}
