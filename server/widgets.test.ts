import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { openDb } from "./db.js";
import { SESSION_COOKIE } from "./auth/sessions.js";
import { healOrder, validateConfig } from "./widgets.js";

const ORIGIN = "http://localhost:3000";
const PW = "correct-horse-battery";

async function setup() {
  const db = openDb(":memory:");
  const app = buildApp(db, { baseUrl: ORIGIN, google: null });
  const signup = async (email: string) => {
    const r = await app.inject({ method: "POST", url: "/auth/signup", payload: { email, password: PW }, headers: { origin: ORIGIN } });
    return `${SESSION_COOKIE}=${r.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  };
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, cookie: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { origin: ORIGIN, cookie } });
  return { app, db, signup, call, a: await signup("a@example.com"), b: await signup("b@example.com") };
}

describe("validateConfig / healOrder", () => {
  it("validates per type", () => {
    expect(validateConfig("weather", { unit: "f" })).toEqual({ unit: "F" });
    expect(validateConfig("weather", { unit: "K" })).toBeNull();
    expect(validateConfig("clock", { x: 1 })).toEqual({});
    expect(validateConfig("rss", { feedUrl: "https://e.com/feed" })).toEqual({ feedUrl: "https://e.com/feed" });
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
