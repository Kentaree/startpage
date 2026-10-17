import { describe, expect, it, vi } from "vitest";
import { buildApp, type AppOptions } from "./app.js";
import { openDb } from "./db.js";
import type { GoogleClient, GoogleProfile } from "./auth/google.js";
import { SESSION_COOKIE, hashToken } from "./auth/sessions.js";

const ORIGIN = "http://localhost:3000";
const PW = "correct-horse-battery";

function setup(opts: AppOptions = {}, profile?: GoogleProfile) {
  const db = openDb(":memory:");
  const google: GoogleClient = {
    authorizationUrl: async (c) => `https://accounts.example/auth?state=${c.state}&nonce=${c.nonce}`,
    exchange: vi.fn(async (_url, _checks) => {
      if (!profile) throw new Error("bad exchange");
      return profile;
    }),
  };
  const app = buildApp(db, { baseUrl: ORIGIN, google, ...opts });
  const post = (url: string, payload: unknown, cookie?: string, origin: string | null = ORIGIN) =>
    app.inject({ method: "POST", url, payload: payload as object, headers: { ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) } });
  const cookieOf = (r: { cookies: { name: string; value: string }[] }, name = SESSION_COOKIE) =>
    r.cookies.find((c) => c.name === name)?.value;
  return { app, db, google, post, cookieOf };
}

describe("route guard", () => {
  it("redirects anonymous pages to /login and 401s /api", async () => {
    const { app } = setup();
    for (const url of ["/", "/about.html", "/app.js", "/nope"]) {
      const r = await app.inject(url);
      expect(r.statusCode, url).toBe(302);
      expect(r.headers.location).toBe("/login");
      expect(r.body).not.toContain("weather");
    }
    for (const url of ["/api/widgets", "/api/anything"]) {
      const r = await app.inject(url);
      expect(r.statusCode, url).toBe(401);
    }
    expect((await app.inject({ method: "POST", url: "/api/widgets", headers: { origin: ORIGIN } })).statusCode).toBe(401);
  });

  it("serves pages to a signed-in user", async () => {
    const { app, post, cookieOf } = setup();
    const r = await post("/auth/signup", { email: "a@example.com", password: PW });
    const cookie = `${SESSION_COOKIE}=${cookieOf(r)}`;
    expect((await app.inject({ url: "/", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/about.html", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/login", headers: { cookie } })).statusCode).toBe(302);
  });
});

describe("email/password", () => {
  it("signs up with a normalized email, seeds widgets and layouts, and sets a safe cookie", async () => {
    const { db, post } = setup();
    const r = await post("/auth/signup", { email: "  Mixed@Example.COM ", password: PW });
    expect(r.statusCode).toBe(201);
    const c = r.cookies[0];
    expect(c).toMatchObject({ name: SESSION_COOKIE, httpOnly: true, sameSite: "Lax" });
    expect(c.secure).toBeFalsy(); // http base URL
    const user = db.prepare("SELECT * FROM users").get() as { id: number; email: string; password_hash: string };
    expect(user.email).toBe("mixed@example.com");
    expect(user.password_hash).toMatch(/^\$argon2id\$/);
    // token is stored hashed only
    const s = db.prepare("SELECT id_hash FROM sessions").get() as { id_hash: string };
    expect(s.id_hash).toBe(hashToken(c.value));

    const widgets = db.prepare("SELECT id, type, config_json FROM widgets WHERE user_id = ? ORDER BY id").all(user.id) as
      { id: number; type: string; config_json: string }[];
    expect(widgets.map((w) => w.type)).toEqual(["weather", "clock"]);
    const layouts = db.prepare("SELECT breakpoint, widget_order_json FROM layouts WHERE user_id = ?").all(user.id) as
      { breakpoint: string; widget_order_json: string }[];
    expect(layouts.map((l) => l.breakpoint).sort()).toEqual(["lg", "md", "sm"]);
    for (const l of layouts) expect(JSON.parse(l.widget_order_json)).toEqual([widgets[0].id, widgets[1].id]);
  });

  it("uses Secure cookies for an https base URL", async () => {
    const { post } = setup({ baseUrl: "https://start.example.com" });
    const r = await post("/auth/signup", { email: "a@example.com", password: PW }, undefined, "https://start.example.com");
    expect(r.cookies[0].secure).toBe(true);
  });

  it("validates input and rejects duplicates", async () => {
    const { post } = setup();
    expect((await post("/auth/signup", { email: "nope", password: PW })).statusCode).toBe(400);
    expect((await post("/auth/signup", { email: "a@example.com", password: "short" })).statusCode).toBe(400);
    expect((await post("/auth/signup", { email: "a@example.com", password: PW })).statusCode).toBe(201);
    expect((await post("/auth/signup", { email: "A@example.com", password: PW })).statusCode).toBe(409);
  });

  it("logs in; rejects wrong password and unknown email identically", async () => {
    const { post, cookieOf } = setup();
    await post("/auth/signup", { email: "a@example.com", password: PW });
    const ok = await post("/auth/login", { email: "A@Example.com", password: PW });
    expect(ok.statusCode).toBe(200);
    expect(cookieOf(ok)).toBeTruthy();
    const bad = await post("/auth/login", { email: "a@example.com", password: "wrong-password!" });
    const none = await post("/auth/login", { email: "x@example.com", password: PW });
    expect(bad.statusCode).toBe(401);
    expect(none.statusCode).toBe(401);
    expect(bad.json()).toEqual(none.json());
    expect(cookieOf(bad)).toBeUndefined();
  });

  it("rate limits login and signup", async () => {
    const { post } = setup({ loginRateLimit: { max: 3, windowMs: 60_000 }, signupRateLimit: { max: 2, windowMs: 60_000 } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await post("/auth/login", { email: "a@example.com", password: "x" })).statusCode);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    const s: number[] = [];
    for (let i = 0; i < 3; i++) s.push((await post("/auth/signup", { email: `u${i}@example.com`, password: PW })).statusCode);
    expect(s).toEqual([201, 201, 429]);
  });
});

describe("sessions and CSRF", () => {
  it("logout invalidates the session", async () => {
    const { app, db, post, cookieOf } = setup();
    const cookie = `${SESSION_COOKIE}=${cookieOf(await post("/auth/signup", { email: "a@example.com", password: PW }))}`;
    expect((await app.inject({ url: "/", headers: { cookie } })).statusCode).toBe(200);
    expect((await post("/auth/logout", {}, cookie)).statusCode).toBe(200);
    expect(db.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    const r = await app.inject({ url: "/", headers: { cookie } });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe("/login");
  });

  it("rejects expired sessions", async () => {
    const { app, db, post, cookieOf } = setup();
    const token = cookieOf(await post("/auth/signup", { email: "a@example.com", password: PW }));
    db.prepare("UPDATE sessions SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    const r = await app.inject({ url: "/", headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(r.statusCode).toBe(302);
    expect(db.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  it("rejects mutating requests with a missing or foreign Origin", async () => {
    const { post, db } = setup();
    const body = { email: "a@example.com", password: PW };
    expect((await post("/auth/signup", body, undefined, "https://evil.example")).statusCode).toBe(403);
    expect((await post("/auth/signup", body, undefined, null)).statusCode).toBe(403);
    expect(db.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 0 });
  });
});

describe("google", () => {
  const profile = { sub: "g-123", email: "G@Example.com", email_verified: true };

  async function startFlow(ctx: ReturnType<typeof setup>) {
    const start = await ctx.app.inject("/auth/google");
    expect(start.statusCode).toBe(302);
    expect(start.headers.location).toContain("https://accounts.example/auth");
    const cookie = `g_oauth=${ctx.cookieOf(start, "g_oauth")}`;
    return ctx.app.inject({ url: "/auth/google/callback?code=c&state=s", headers: { cookie } });
  }

  it("creates a seeded account and session on first Google sign-in, then reuses it", async () => {
    const ctx = setup({}, profile);
    const r = await startFlow(ctx);
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe("/");
    const cookie = `${SESSION_COOKIE}=${ctx.cookieOf(r)}`;
    expect((await ctx.app.inject({ url: "/", headers: { cookie } })).statusCode).toBe(200);
    const user = ctx.db.prepare("SELECT * FROM users").get() as { id: number; email: string; password_hash: string | null };
    expect(user.email).toBe("g@example.com");
    expect(user.password_hash).toBeNull();
    expect(ctx.db.prepare("SELECT provider, provider_subject FROM identities").all())
      .toEqual([{ provider: "google", provider_subject: "g-123" }]);
    expect(ctx.db.prepare("SELECT count(*) AS n FROM widgets").get()).toEqual({ n: 2 });
    expect(ctx.db.prepare("SELECT count(*) AS n FROM layouts").get()).toEqual({ n: 3 });

    expect((await startFlow(ctx)).headers.location).toBe("/");
    expect(ctx.db.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 1 });
  });

  it("never auto-links to an existing password account with the same email", async () => {
    const ctx = setup({}, profile);
    await ctx.post("/auth/signup", { email: "g@example.com", password: PW });
    const r = await startFlow(ctx);
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe("/login?error=account_exists");
    expect(ctx.cookieOf(r)).toBeUndefined();
    expect(ctx.db.prepare("SELECT count(*) AS n FROM identities").get()).toEqual({ n: 0 });
  });

  it("does not trust an unverified email", async () => {
    const ctx = setup({}, { ...profile, email_verified: false });
    const r = await startFlow(ctx);
    expect(r.headers.location).toBe("/login?error=google_unverified");
    expect(ctx.db.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 0 });
  });

  it("rejects callbacks without our pending state cookie and failed exchanges", async () => {
    const ctx = setup({}, profile);
    const r = await ctx.app.inject("/auth/google/callback?code=c&state=s");
    expect(r.headers.location).toBe("/login?error=google_failed");
    expect(ctx.google.exchange).not.toHaveBeenCalled();

    const failing = setup({}, undefined);
    expect((await startFlow(failing)).headers.location).toBe("/login?error=google_failed");
  });

  it("reports Google as unavailable when not configured", async () => {
    const ctx = setup({ google: null });
    expect((await ctx.app.inject("/auth/google")).headers.location).toBe("/login?error=google_unavailable");
  });
});
