import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { openDb } from "./db.js";

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
});
