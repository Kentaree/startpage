import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import fs from "node:fs";
import { openDb } from "./db.js";
import { SESSION_COOKIE } from "./auth/sessions.js";

describe("server", () => {
  const app = buildApp(openDb(":memory:"));
  it("healthz is public", async () => {
    const r = await app.inject("/healthz");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ status: "ok" });
  });
  it("serves the sign-in page and its assets publicly, with a CSP", async () => {
    const r = await app.inject("/login");
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Sign in with Google");
    expect(r.headers["content-security-policy"]).toContain("default-src 'self'");
    expect((await app.inject("/login.js")).statusCode).toBe(200);
  });
  it("/api/version requires sign-in and returns the package version", async () => {
    expect((await app.inject("/api/version")).statusCode).toBe(401);
    const origin = "http://localhost:3000";
    const a = buildApp(openDb(":memory:"), { baseUrl: origin, google: null });
    const su = await a.inject({ method: "POST", url: "/auth/signup", payload: { email: "v@example.com", password: "correct-horse-battery" }, headers: { origin } });
    const cookie = `${SESSION_COOKIE}=${su.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
    const r = await a.inject({ url: "/api/version", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(r.json()).toEqual({ version: pkg.version });
  });
});
