import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { openDb } from "./db.js";
import { SESSION_COOKIE } from "./auth/sessions.js";
import type { GeocodeOptions } from "./geocode.js";

const ORIGIN = "http://localhost:3000";

async function setup(geocode: GeocodeOptions) {
  const app = buildApp(openDb(":memory:"), { baseUrl: ORIGIN, google: null, geocode });
  const r = await app.inject({ method: "POST", url: "/auth/signup", payload: { email: "a@example.com", password: "correct-horse-battery" }, headers: { origin: ORIGIN } });
  const cookie = `${SESSION_COOKIE}=${r.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  const get = (q: string, c: string | null = cookie) =>
    app.inject({ method: "GET", url: `/api/geocode?q=${encodeURIComponent(q)}`, headers: c ? { cookie: c } : {} });
  return { get };
}

const ok = (body: unknown) => vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify(body), { status: 200 }));

describe("GET /api/geocode", () => {
  it("returns trimmed matches", async () => {
    const f = ok({
      results: [
        { id: 1, name: "Porto", admin1: "Porto", country: "Portugal", latitude: 41.15, longitude: -8.61, timezone: "x", population: 1 },
        { name: "Nowhere", latitude: 1, longitude: 2 },
        { name: "Bad" },
      ],
    });
    const { get } = await setup({ fetch: f as unknown as typeof fetch });
    const res = await get("  Port ");
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual([
      { name: "Porto", admin1: "Porto", country: "Portugal", lat: 41.15, lon: -8.61 },
      { name: "Nowhere", lat: 1, lon: 2 },
    ]);
    expect(String(f.mock.calls[0][0])).toContain("name=Port&");
  });

  it("caps the number of results and handles no matches", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `C${i}`, latitude: i, longitude: i }));
    const { get } = await setup({ fetch: ok({ results: many }) as unknown as typeof fetch });
    expect((await get("city")).json().results).toHaveLength(6);
    const none = await setup({ fetch: ok({}) as unknown as typeof fetch });
    expect((await none.get("zzzz")).json()).toEqual({ results: [] });
  });

  it("rejects bad queries with 400", async () => {
    const f = ok({});
    const { get } = await setup({ fetch: f as unknown as typeof fetch });
    expect((await get("a")).statusCode).toBe(400);
    expect((await get(" a ")).statusCode).toBe(400);
    expect((await get("x".repeat(101))).statusCode).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("requires sign-in", async () => {
    const f = ok({});
    const { get } = await setup({ fetch: f as unknown as typeof fetch });
    expect((await get("Porto", null)).statusCode).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 502 when upstream fails", async () => {
    const bad = await setup({ fetch: (async () => new Response("no", { status: 500 })) as typeof fetch });
    const r = await bad.get("Porto");
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toMatch(/unavailable/);
    const thrown = await setup({ fetch: (async () => { throw new TypeError("network"); }) as typeof fetch });
    expect((await thrown.get("Porto")).statusCode).toBe(502);
  });

  it("returns 504 when upstream times out", async () => {
    const slow = ((_u: string, init: RequestInit) =>
      new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))) as unknown as typeof fetch;
    const { get } = await setup({ fetch: slow, timeoutMs: 20 });
    const r = await get("Porto");
    expect(r.statusCode).toBe(504);
    expect(r.json().error).toMatch(/timed out/);
  });

  it("rate limits", async () => {
    const { get } = await setup({ fetch: ok({ results: [] }) as unknown as typeof fetch, rateLimit: { max: 2, windowMs: 60_000 } });
    expect((await get("Porto")).statusCode).toBe(200);
    expect((await get("Porto")).statusCode).toBe(200);
    expect((await get("Porto")).statusCode).toBe(429);
  });
});
