import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { openDb } from "./db.js";

describe("server", () => {
  const app = buildApp(openDb(":memory:"));
  it("healthz", async () => {
    const r = await app.inject("/healthz");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ status: "ok" });
  });
  it("serves public/index.html and weather.js", async () => {
    expect((await app.inject("/")).statusCode).toBe(200);
    expect((await app.inject("/weather.js")).statusCode).toBe(200);
    expect((await app.inject("/about.html")).statusCode).toBe(200);
  });
});
