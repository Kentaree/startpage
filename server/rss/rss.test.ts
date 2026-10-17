import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { openDb } from "../db.js";
import { SESSION_COOKIE } from "../auth/sessions.js";
import { BlockedUrlError, FetchError, isBlockedIp, safeFetch, type Transport, type TransportResponse } from "./ssrf.js";
import { parseFeed } from "./parse.js";

const resp = (status: number, body = "", headers: Record<string, string> = {}): TransportResponse => ({
  status, headers, destroy() {},
  body: (async function* () { yield Buffer.from(body); })(),
});

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1", "127.255.255.254", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.1",
    "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1", "64:ff9b::7f00:1", "2002:7f00:1::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "0:0:0:0:0:0:0:1", "not-an-ip",
  ])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each([
    "8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111", "2a00:1450:4009::200e", "::ffff:8.8.8.8",
  ])("allows %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe("safeFetch", () => {
  const publicResolver = async () => ["93.184.216.34"];
  it("rejects non-http schemes, credentials and private literals", async () => {
    const t: Transport = async () => { throw new Error("must not connect"); };
    for (const u of ["file:///etc/passwd", "ftp://example.com/", "http://localhost/", "http://127.0.0.1/", "http://[::1]/",
      "http://0x7f.1/", "http://2130706433/", "http://169.254.169.254/latest", "http://u:p@example.com/"]) {
      await expect(safeFetch(u, { transport: t, resolver: async (h) => (h === "localhost" ? ["127.0.0.1"] : ["93.184.216.34"]) })).rejects.toBeInstanceOf(BlockedUrlError);
    }
  });
  it("rejects hostnames resolving to private addresses, including mixed answers", async () => {
    const t: Transport = async () => { throw new Error("must not connect"); };
    await expect(safeFetch("http://evil.test/", { transport: t, resolver: async () => ["10.0.0.5"] })).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(safeFetch("http://evil.test/", { transport: t, resolver: async () => ["93.184.216.34", "127.0.0.1"] })).rejects.toBeInstanceOf(BlockedUrlError);
  });
  it("connects to the vetted address", async () => {
    const seen: string[] = [];
    const t: Transport = async (_u, addr) => { seen.push(addr); return resp(200, "ok", { etag: '"x"' }); };
    const r = await safeFetch("https://example.com/f", { transport: t, resolver: publicResolver });
    expect(seen).toEqual(["93.184.216.34"]);
    expect(r).toMatchObject({ body: "ok", etag: '"x"' });
  });
  it("re-checks every redirect hop", async () => {
    const t: Transport = async (u) => {
      if (u.hostname === "example.com") return resp(302, "", { location: "http://internal.test/admin" });
      throw new Error("must not connect");
    };
    const resolver = async (h: string) => (h === "internal.test" ? ["192.168.0.10"] : ["93.184.216.34"]);
    await expect(safeFetch("http://example.com/", { transport: t, resolver })).rejects.toBeInstanceOf(BlockedUrlError);
    const t2: Transport = async () => resp(301, "", { location: "http://127.0.0.1:8080/" });
    await expect(safeFetch("http://example.com/", { transport: t2, resolver })).rejects.toBeInstanceOf(BlockedUrlError);
    const t3: Transport = async () => resp(301, "", { location: "file:///etc/passwd" });
    await expect(safeFetch("http://example.com/", { transport: t3, resolver })).rejects.toBeInstanceOf(BlockedUrlError);
  });
  it("follows relative redirects up to the limit", async () => {
    let n = 0;
    const t: Transport = async (u) => (u.pathname === "/end" ? resp(200, "done") : resp(302, "", { location: n++ < 2 ? "/a" : "/end" }));
    expect((await safeFetch("http://example.com/", { transport: t, resolver: publicResolver })).body).toBe("done");
    const loop: Transport = async () => resp(302, "", { location: "/again" });
    await expect(safeFetch("http://example.com/", { transport: loop, resolver: publicResolver })).rejects.toBeInstanceOf(FetchError);
  });
  it("enforces the size limit and surfaces HTTP errors", async () => {
    await expect(safeFetch("http://example.com/", { transport: async () => resp(200, "x".repeat(100)), resolver: publicResolver, maxBytes: 50 })).rejects.toThrow(/too large/);
    await expect(safeFetch("http://example.com/", { transport: async () => resp(500), resolver: publicResolver })).rejects.toBeInstanceOf(FetchError);
  });
  it("times out", async () => {
    const hang: Transport = (_u, _a, _h, signal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
    await expect(safeFetch("http://example.com/", { transport: hang, resolver: publicResolver, timeoutMs: 20 })).rejects.toBeInstanceOf(FetchError);
  });
});

describe("parseFeed", () => {
  it("parses RSS, keeps markup as text and drops unsafe links", () => {
    const items = parseFeed(`<?xml version="1.0"?><rss><channel>
      <item><title><![CDATA[<script>alert(1)</script> Hi &amp; bye]]></title><link>javascript:alert(1)</link><pubDate>Wed, 02 Oct 2002 13:00:00 GMT</pubDate></item>
      <item><title>A &lt;b&gt;x&lt;/b&gt;</title><link>https://e.com/a</link></item></channel></rss>`);
    expect(items[0].title).toBe("<script>alert(1)</script> Hi & bye");
    expect(items[0].link).toBeNull();
    expect(items[0].date).toBe("2002-10-02T13:00:00.000Z");
    expect(items[1]).toMatchObject({ title: "A <b>x</b>", link: "https://e.com/a" });
  });
  it("parses Atom and caps the count", () => {
    const entries = Array.from({ length: 15 }, (_, i) => `<entry><title>T${i}</title><link rel="alternate" href="https://e.com/${i}"/><updated>2024-01-01T00:00:00Z</updated></entry>`).join("");
    const items = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`);
    expect(items).toHaveLength(10);
    expect(items[3]).toEqual({ title: "T3", link: "https://e.com/3", date: "2024-01-01T00:00:00.000Z" });
  });
  it("does not expand entities and rejects non-feeds", () => {
    const xml = `<!DOCTYPE r [<!ENTITY a "AAAA"><!ENTITY b "&a;&a;">]><rss><channel><item><title>&b;</title></item></channel></rss>`;
    expect(parseFeed(xml)[0].title).toBe("&b;");
    expect(() => parseFeed("<html></html>")).toThrow();
    expect(() => parseFeed("nope")).toThrow();
  });
});

const ORIGIN = "http://localhost:3000";
const FEED = `<rss><channel><item><title>Hello</title><link>https://e.com/1</link></item></channel></rss>`;

async function setup(transport: Transport, now = { t: 1_000_000 }) {
  const db = openDb(":memory:");
  const app = buildApp(db, { baseUrl: ORIGIN, google: null, rss: { now: () => now.t, fetchOptions: { transport, resolver: async (h) => (h === "local.test" || h === "localhost" ? ["127.0.0.1"] : ["93.184.216.34"]) } } });
  const signup = async (email: string) => {
    const r = await app.inject({ method: "POST", url: "/auth/signup", payload: { email, password: "correct-horse-battery" }, headers: { origin: ORIGIN } });
    return `${SESSION_COOKIE}=${r.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  };
  const call = (method: "GET" | "POST" | "PATCH", url: string, cookie: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { origin: ORIGIN, cookie } });
  const a = await signup("a@example.com");
  const b = await signup("b@example.com");
  const mk = async (cookie: string, feedUrl?: string) =>
    (await call("POST", "/api/widgets", cookie, { type: "rss", config: feedUrl ? { feedUrl } : {} })).json().id as number;
  return { call, a, b, mk, now };
}

describe("GET /api/rss", () => {
  it("returns items and serves repeat requests from cache within the TTL", async () => {
    let calls = 0;
    const { call, a, mk, now } = await setup(async () => { calls++; return resp(200, FEED, { etag: '"v1"' }); });
    const id = await mk(a, "https://example.com/feed");
    const r = await call("GET", `/api/rss?widgetId=${id}`, a);
    expect(r.json()).toEqual({ items: [{ title: "Hello", link: "https://e.com/1", date: null, source: "example.com" }], errors: [] });
    await call("GET", `/api/rss?widgetId=${id}`, a);
    expect(calls).toBe(1);
    now.t += 20 * 60_000;
    await call("GET", `/api/rss?widgetId=${id}`, a);
    expect(calls).toBe(2);
  });
  it("revalidates with If-None-Match and honours 304", async () => {
    const sent: (string | undefined)[] = [];
    const { call, a, mk, now } = await setup(async (_u, _a, h) => {
      sent.push(h["if-none-match"]);
      return h["if-none-match"] ? resp(304) : resp(200, FEED, { etag: '"v1"' });
    });
    const id = await mk(a, "https://example.com/feed");
    await call("GET", `/api/rss?widgetId=${id}`, a);
    now.t += 20 * 60_000;
    const r = await call("GET", `/api/rss?widgetId=${id}`, a);
    expect(sent).toEqual([undefined, '"v1"']);
    expect(r.json().items).toHaveLength(1);
  });
  it("serves stale on failure, errors clearly without cache", async () => {
    let fail = false;
    const { call, a, mk, now } = await setup(async () => { if (fail) throw new Error("down"); return resp(200, FEED); });
    const id = await mk(a, "https://example.com/feed");
    const bad = await mk(a, "https://example.com/other");
    await call("GET", `/api/rss?widgetId=${id}`, a);
    fail = true;
    now.t += 20 * 60_000;
    expect((await call("GET", `/api/rss?widgetId=${id}`, a)).json().items).toHaveLength(1);
    const e = await call("GET", `/api/rss?widgetId=${bad}`, a);
    expect(e.statusCode).toBe(502);
    expect(e.json().error).toMatch(/Could not load/);
  });
  it("rejects local/private targets and redirects to them", async () => {
    const { call, a, mk } = await setup(async (u) => (u.hostname === "redir.test" ? resp(302, "", { location: "http://127.0.0.1/" }) : resp(200, FEED)));
    for (const url of ["http://localhost/feed", "http://127.0.0.1/feed", "http://local.test/feed", "http://redir.test/feed", "http://[::1]/f", "http://10.0.0.1/f"]) {
      const id = await mk(a, url);
      expect((await call("GET", `/api/rss?widgetId=${id}`, a)).statusCode).toBe(400);
    }
  });
  it("only serves the owner and only rss widgets", async () => {
    const { call, a, b, mk } = await setup(async () => resp(200, FEED));
    const id = await mk(a, "https://example.com/feed");
    expect((await call("GET", `/api/rss?widgetId=${id}`, b)).statusCode).toBe(404);
    expect((await call("GET", `/api/rss?widgetId=${id}`, a)).statusCode).toBe(200);
    expect((await call("GET", `/api/rss?widgetId=abc`, a)).statusCode).toBe(404);
    expect((await call("GET", `/api/rss?widgetId=${await mk(a)}`, a)).statusCode).toBe(400);
  });
  it("persists the feed URL via PATCH and requires auth", async () => {
    const { call, a, mk } = await setup(async () => resp(200, FEED));
    const id = await mk(a);
    expect((await call("PATCH", `/api/widgets/${id}`, a, { config: { feedUrl: "https://example.com/f" } })).json().config).toEqual({ feedUrls: ["https://example.com/f"] });
    expect((await call("GET", "/api/state", a)).json().widgets.find((w: { id: number }) => w.id === id).config.feedUrls).toEqual(["https://example.com/f"]);
    expect((await call("GET", `/api/rss?widgetId=${id}`, "")).statusCode).toBe(401);
  });
});
