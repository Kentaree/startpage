import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate, openDb } from "./db.js";

describe("migrations", () => {
  it("creates all tables on a fresh DB and is idempotent", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), "sub", "t.db");
    const db = openDb(file);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    for (const t of ["users", "identities", "sessions", "widgets", "layouts", "rss_cache", "schema_migrations"])
      expect(tables).toContain(t);
    const count = (db.prepare("SELECT COUNT(*) c FROM schema_migrations").get() as any).c;
    expect(count).toBeGreaterThan(0);
    db.close();

    const again = openDb(file); // restart
    expect((again.prepare("SELECT COUNT(*) c FROM schema_migrations").get() as any).c).toBe(count);
    expect(migrate(again)).toEqual([]);
    again.close();
  });

  it("rolls back a failing migration", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migdir-"));
    fs.writeFileSync(path.join(dir, "001_bad.sql"), "CREATE TABLE a (x); SELECT * FROM nope;");
    const db = new Database(":memory:");
    expect(() => migrate(db, dir)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='a'").get()).toBeUndefined();
  });
});
