import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db.js";
import { createSqliteRepo, type Repo } from "./index.js";

let repo: Repo;
beforeEach(() => { repo = createSqliteRepo(openDb(":memory:")); });

describe("users & identities", () => {
  it("creates and looks up users; email unique", () => {
    const u = repo.users.create("a@x.com");
    expect(u.password_hash).toBeNull();
    expect(repo.users.getByEmail("a@x.com")?.id).toBe(u.id);
    expect(() => repo.users.create("a@x.com")).toThrow();
    repo.users.setPasswordHash(u.id, "h");
    expect(repo.users.getById(u.id)?.password_hash).toBe("h");
  });
  it("links identities uniquely", () => {
    const u = repo.users.create("a@x.com");
    repo.identities.link(u.id, "google", "123");
    expect(repo.identities.find("google", "123")?.user_id).toBe(u.id);
    expect(() => repo.identities.link(u.id, "google", "123")).toThrow();
    expect(repo.identities.listForUser(u.id)).toHaveLength(1);
  });
});

describe("sessions", () => {
  it("create/get/delete/expire", () => {
    const u = repo.users.create("a@x.com");
    repo.sessions.create("h1", u.id, "2020-01-01T00:00:00Z");
    repo.sessions.create("h2", u.id, "2099-01-01T00:00:00Z");
    expect(repo.sessions.get("h1")?.user_id).toBe(u.id);
    expect(repo.sessions.deleteExpired("2025-01-01T00:00:00Z")).toBe(1);
    expect(repo.sessions.get("h1")).toBeUndefined();
    repo.sessions.delete("h2");
    expect(repo.sessions.get("h2")).toBeUndefined();
    repo.sessions.create("h3", u.id, "2099-01-01T00:00:00Z");
    repo.sessions.deleteForUser(u.id);
    expect(repo.sessions.get("h3")).toBeUndefined();
  });
});

describe("widgets", () => {
  it("crud scoped to owner, validates type", () => {
    const u = repo.users.create("a@x.com");
    const o = repo.users.create("b@x.com");
    const w = repo.widgets.create(u.id, "rss", { url: "http://f" });
    expect(JSON.parse(w.config_json)).toEqual({ url: "http://f" });
    expect(repo.widgets.listForUser(u.id)).toHaveLength(1);
    expect(repo.widgets.updateConfig(w.id, o.id, {})).toBe(false);
    expect(repo.widgets.updateConfig(w.id, u.id, { url: "g" })).toBe(true);
    expect(JSON.parse(repo.widgets.get(w.id)!.config_json)).toEqual({ url: "g" });
    expect(repo.widgets.delete(w.id, o.id)).toBe(false);
    expect(repo.widgets.delete(w.id, u.id)).toBe(true);
    expect(() => repo.widgets.create(u.id, "bogus" as any, {})).toThrow();
  });
});

describe("layouts", () => {
  it("upserts per breakpoint, rejects bad breakpoint", () => {
    const u = repo.users.create("a@x.com");
    repo.layouts.set(u.id, "lg", [1, 2]);
    repo.layouts.set(u.id, "lg", [2, 1]);
    repo.layouts.set(u.id, "sm", [1]);
    expect(JSON.parse(repo.layouts.get(u.id, "lg")!.widget_order_json)).toEqual([2, 1]);
    expect(repo.layouts.listForUser(u.id)).toHaveLength(2);
    expect(() => repo.layouts.set(u.id, "xl" as any, [])).toThrow();
  });
});

describe("rss cache", () => {
  it("put/get/overwrite/delete", () => {
    repo.rssCache.put("http://f", "t1", "e1", [{ a: 1 }]);
    repo.rssCache.put("http://f", "t2", null, [{ a: 2 }]);
    const e = repo.rssCache.get("http://f")!;
    expect(e.fetched_at).toBe("t2");
    expect(e.etag).toBeNull();
    expect(JSON.parse(e.items_json)).toEqual([{ a: 2 }]);
    repo.rssCache.delete("http://f");
    expect(repo.rssCache.get("http://f")).toBeUndefined();
  });
});
