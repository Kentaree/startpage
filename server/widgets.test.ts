import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { openDb } from "./db.js";
import { SESSION_COOKIE } from "./auth/sessions.js";
import { RssError } from "./rss/service.js";
import { checkConfig, feedUrlsOf, healOrder, isPermutation, mergeFeeds, validateConfig } from "./widgets.js";

const ORIGIN = "http://localhost:3000";
const PW = "correct-horse-battery";

async function setup() {
  const db = openDb(":memory:");
  const app = buildApp(db, { baseUrl: ORIGIN, google: null });
  const signup = async (email: string) => {
    const r = await app.inject({ method: "POST", url: "/auth/signup", payload: { email, password: PW }, headers: { origin: ORIGIN } });
    return `${SESSION_COOKIE}=${r.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  };
  const call = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, cookie: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { origin: ORIGIN, cookie } });
  return { app, db, signup, call, a: await signup("a@example.com"), b: await signup("b@example.com") };
}

describe("validateConfig / healOrder", () => {
  it("validates per type", () => {
    expect(validateConfig("weather", { unit: "f" })).toEqual({ unit: "F" });
    expect(validateConfig("weather", { unit: "K" })).toBeNull();
    expect(validateConfig("clock", { x: 1 })).toEqual({});
    expect(validateConfig("rss", { feedUrl: "https://e.com/feed" })).toEqual({ feedUrls: ["https://e.com/feed"] });
    expect(validateConfig("rss", { feedUrl: "javascript:alert(1)" })).toBeNull();
    expect(validateConfig("rss", {})).toEqual({});
    expect(validateConfig("rss", { feedUrl: 5 })).toBeNull();
    expect(validateConfig("clock", [])).toBeNull();
  });
  it("heals orders", () => {
    expect(healOrder([3, 99, 1, 1], [1, 2, 3])).toEqual([3, 1, 2]);
    expect(healOrder("junk", [1, 2])).toEqual([1, 2]);
  });
});

describe("widgets API", () => {
  it("returns default state and supports add / patch / delete", async () => {
    const { call, a } = await setup();
    const s = (await call("GET", "/api/state", a)).json();
    expect(s.widgets.map((w: { type: string }) => w.type)).toEqual(["weather", "clock"]);
    const created = (await call("POST", "/api/widgets", a, { type: "weather", config: { unit: "F" } })).json();
    expect(created.config).toEqual({ unit: "F" });
    let st = (await call("GET", "/api/state", a)).json();
    for (const bp of ["lg", "md", "sm"]) expect(st.layouts[bp].at(-1)).toBe(created.id);
    expect((await call("PATCH", `/api/widgets/${created.id}`, a, { config: { unit: "C" } })).statusCode).toBe(200);
    expect((await call("PATCH", `/api/widgets/${created.id}`, a, { config: { unit: "x" } })).statusCode).toBe(400);
    expect((await call("POST", "/api/widgets", a, { type: "nope" })).statusCode).toBe(400);
    expect((await call("DELETE", `/api/widgets/${created.id}`, a)).statusCode).toBe(200);
    st = (await call("GET", "/api/state", a)).json();
    expect(st.widgets).toHaveLength(2);
    for (const bp of ["lg", "md", "sm"]) expect(st.layouts[bp]).not.toContain(created.id);
  });

  it("self-heals layouts on read", async () => {
    const { call, a, db } = await setup();
    db.prepare("UPDATE layouts SET widget_order_json = '[999]'").run();
    const st = (await call("GET", "/api/state", a)).json();
    expect(st.layouts.lg).toEqual(st.widgets.map((w: { id: number }) => w.id));
  });

  it("isolates users", async () => {
    const { call, a, b } = await setup();
    const stateA = (await call("GET", "/api/state", a)).json();
    const stateB = (await call("GET", "/api/state", b)).json();
    const idsA = stateA.widgets.map((w: { id: number }) => w.id);
    const idsB = stateB.widgets.map((w: { id: number }) => w.id);
    expect(idsA.filter((i: number) => idsB.includes(i))).toEqual([]);
    for (const bp of ["lg", "md", "sm"]) expect(stateB.layouts[bp].filter((i: number) => idsA.includes(i))).toEqual([]);
    const target = idsA[0];
    expect((await call("PATCH", `/api/widgets/${target}`, b, { config: { unit: "F" } })).statusCode).toBe(404);
    expect((await call("DELETE", `/api/widgets/${target}`, b)).statusCode).toBe(404);
    const after = (await call("GET", "/api/state", a)).json();
    expect(after.widgets.find((w: { id: number }) => w.id === target).config).toEqual({ unit: "c" });
    expect(after.layouts.lg).toContain(target);
  });

  it("requires authentication", async () => {
    const { app } = await setup();
    expect((await app.inject("/api/state")).statusCode).toBe(401);
  });
});

describe("layouts API", () => {
  it("checks permutations", () => {
    expect(isPermutation([2, 1], [1, 2])).toBe(true);
    expect(isPermutation([1], [1, 2])).toBe(false);
    expect(isPermutation([1, 1], [1, 2])).toBe(false);
    expect(isPermutation([1, 3], [1, 2])).toBe(false);
    expect(isPermutation(["1", "2"], [1, 2])).toBe(false);
    expect(isPermutation({}, [1, 2])).toBe(false);
  });

  it("saves one breakpoint only and persists it", async () => {
    const { call, a } = await setup();
    const before = (await call("GET", "/api/state", a)).json();
    const rev = [...before.layouts.md].reverse();
    expect((await call("PUT", "/api/layouts/md", a, rev as unknown as object)).statusCode).toBe(200);
    const after = (await call("GET", "/api/state", a)).json();
    expect(after.layouts.md).toEqual(rev);
    expect(after.layouts.lg).toEqual(before.layouts.lg);
    expect(after.layouts.sm).toEqual(before.layouts.sm);
  });

  it("rejects invalid bodies and breakpoints", async () => {
    const { call, a } = await setup();
    const [x, y] = (await call("GET", "/api/state", a)).json().layouts.lg as number[];
    for (const body of [[x], [x, x], [x, y, 9999], [], { order: [x, y] }, ["a", "b"]]) {
      expect((await call("PUT", "/api/layouts/lg", a, body as unknown as object)).statusCode).toBe(400);
    }
    expect((await call("PUT", "/api/layouts/xl", a, [x, y] as unknown as object)).statusCode).toBe(404);
  });

  it("does not let users use or change others' layouts", async () => {
    const { call, a, b } = await setup();
    const aIds = (await call("GET", "/api/state", a)).json().layouts.lg as number[];
    const bBefore = (await call("GET", "/api/state", b)).json();
    expect((await call("PUT", "/api/layouts/lg", b, [...aIds].reverse() as unknown as object)).statusCode).toBe(400);
    const bOrder = [...bBefore.layouts.lg].reverse();
    expect((await call("PUT", "/api/layouts/lg", b, bOrder as unknown as object)).statusCode).toBe(200);
    expect((await call("GET", "/api/state", a)).json().layouts.lg).toEqual(aIds);
  });
});

describe("richer widget configs", () => {
  it("validates weather city", () => {
    expect(validateConfig("weather", { unit: "F", city: { name: " Lisbon ", lat: 38.7223, lon: -9.1393, junk: 1 } }))
      .toEqual({ unit: "F", city: { name: "Lisbon", lat: 38.72, lon: -9.14 } });
    expect(validateConfig("weather", {})).toEqual({ unit: "C" });
    expect(validateConfig("weather", { city: { name: "X", lat: 91, lon: 0 } })).toBeNull();
    expect(validateConfig("weather", { city: { name: "X", lat: 0, lon: -181 } })).toBeNull();
    expect(validateConfig("weather", { city: { name: "", lat: 0, lon: 0 } })).toBeNull();
    expect(validateConfig("weather", { city: { name: "x".repeat(101), lat: 0, lon: 0 } })).toBeNull();
    expect(validateConfig("weather", { city: { name: "X", lat: "1", lon: 0 } })).toBeNull();
  });
  it("validates clock hour12", () => {
    expect(validateConfig("clock", { hour12: false, x: 1 })).toEqual({ hour12: false });
    expect(validateConfig("clock", { hour12: "yes" })).toBeNull();
  });
  it("reads legacy feedUrl and writes feedUrls", () => {
    expect(validateConfig("rss", { feedUrl: "https://a.com/f" })).toEqual({ feedUrls: ["https://a.com/f"] });
    expect(validateConfig("rss", { feedUrls: ["https://a.com/f", "http://b.com/g", "https://a.com/f"] }))
      .toEqual({ feedUrls: ["https://a.com/f", "http://b.com/g"] });
    expect(feedUrlsOf({ feedUrl: "https://a.com/f" })).toEqual(["https://a.com/f"]);
    expect(feedUrlsOf({ feedUrls: ["https://x.com"] })).toEqual(["https://x.com"]);
    expect(feedUrlsOf({})).toEqual([]);
  });
  it("rejects bad feed URLs with a clear message", () => {
    const r = checkConfig("rss", { feedUrls: ["https://ok.com/f", "example.com/feed"] });
    expect(r).toEqual({ error: expect.stringContaining("Feed 2") });
    expect((r as { error: string }).error).toContain("http:// or https://");
    expect(validateConfig("rss", { feedUrls: ["ftp://x.com/f"] })).toBeNull();
    expect(validateConfig("rss", { feedUrls: ["https://a.com/" + "x".repeat(2048)] })).toBeNull();
    expect(validateConfig("rss", { feedUrls: Array.from({ length: 11 }, (_, i) => `https://a.com/${i}`) })).toBeNull();
    expect(validateConfig("rss", { feedUrls: "https://a.com" })).toBeNull();
  });
  it("merges feeds newest-first and tolerates partial failure", async () => {
    const feeds: Record<string, { title: string; link: null; date: string | null }[]> = {
      "https://a.com/f": [{ title: "A1", link: null, date: "2026-10-17T10:00:00Z" }, { title: "A2", link: null, date: null }],
      "https://c.com/f": [{ title: "C1", link: null, date: "2026-10-17T12:00:00Z" }],
    };
    const getItems = async (u: string) => {
      if (u === "https://b.com/f") throw new RssError("Could not load the feed.", 502);
      return feeds[u];
    };
    const r = await mergeFeeds(["https://a.com/f", "https://b.com/f", "https://c.com/f"], getItems);
    expect(r.items.map((i) => i.title)).toEqual(["C1", "A1", "A2"]);
    expect(r.items[0].source).toBe("c.com");
    expect(r.errors).toEqual([{ feedUrl: "https://b.com/f", error: "Could not load the feed." }]);
    expect((await mergeFeeds(["https://a.com/f", "https://c.com/f"], getItems, 2)).items).toHaveLength(2);
  });
});
