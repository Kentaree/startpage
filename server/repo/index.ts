import type { DB } from "../db.js";
import type {
  Breakpoint, Identity, Layout, RssCacheEntry, Session, User, Widget, WidgetType,
} from "./types.js";

export * from "./types.js";

/**
 * All SQL lives here. Callers depend on this interface only, so another
 * database can be swapped in by providing a different implementation.
 */
export interface Repo {
  users: {
    create(email: string, passwordHash?: string | null): User;
    getById(id: number): User | undefined;
    getByEmail(email: string): User | undefined;
    setPasswordHash(id: number, hash: string | null): void;
  };
  identities: {
    link(userId: number, provider: string, subject: string): Identity;
    find(provider: string, subject: string): Identity | undefined;
    listForUser(userId: number): Identity[];
  };
  sessions: {
    create(idHash: string, userId: number, expiresAt: string): Session;
    get(idHash: string): Session | undefined;
    delete(idHash: string): void;
    deleteForUser(userId: number): void;
    deleteExpired(nowIso: string): number;
  };
  widgets: {
    create(userId: number, type: WidgetType, config: unknown): Widget;
    get(id: number): Widget | undefined;
    listForUser(userId: number): Widget[];
    updateConfig(id: number, userId: number, config: unknown): boolean;
    setEnabled(id: number, userId: number, enabled: boolean): boolean;
    delete(id: number, userId: number): boolean;
  };
  layouts: {
    get(userId: number, breakpoint: Breakpoint): Layout | undefined;
    listForUser(userId: number): Layout[];
    set(userId: number, breakpoint: Breakpoint, order: number[]): Layout;
  };
  rssCache: {
    get(feedUrl: string): RssCacheEntry | undefined;
    put(feedUrl: string, fetchedAt: string, etag: string | null, items: unknown): void;
    delete(feedUrl: string): void;
  };
}

export function createSqliteRepo(db: DB): Repo {
  return {
    users: {
      create: (email, passwordHash = null) =>
        db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING *").get(email, passwordHash) as User,
      getById: (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined,
      getByEmail: (email) => db.prepare("SELECT * FROM users WHERE email = ?").get(email) as User | undefined,
      setPasswordHash: (id, hash) => { db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id); },
    },
    identities: {
      link: (userId, provider, subject) =>
        db.prepare("INSERT INTO identities (user_id, provider, provider_subject) VALUES (?, ?, ?) RETURNING *")
          .get(userId, provider, subject) as Identity,
      find: (provider, subject) =>
        db.prepare("SELECT * FROM identities WHERE provider = ? AND provider_subject = ?")
          .get(provider, subject) as Identity | undefined,
      listForUser: (userId) => db.prepare("SELECT * FROM identities WHERE user_id = ? ORDER BY id").all(userId) as Identity[],
    },
    sessions: {
      create: (idHash, userId, expiresAt) =>
        db.prepare("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?) RETURNING *")
          .get(idHash, userId, expiresAt) as Session,
      get: (idHash) => db.prepare("SELECT * FROM sessions WHERE id_hash = ?").get(idHash) as Session | undefined,
      delete: (idHash) => { db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash); },
      deleteForUser: (userId) => { db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId); },
      deleteExpired: (nowIso) => db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso).changes,
    },
    widgets: {
      create: (userId, type, config) =>
        db.prepare("INSERT INTO widgets (user_id, type, config_json) VALUES (?, ?, ?) RETURNING *")
          .get(userId, type, JSON.stringify(config ?? {})) as Widget,
      get: (id) => db.prepare("SELECT * FROM widgets WHERE id = ?").get(id) as Widget | undefined,
      listForUser: (userId) => db.prepare("SELECT * FROM widgets WHERE user_id = ? ORDER BY id").all(userId) as Widget[],
      updateConfig: (id, userId, config) =>
        db.prepare("UPDATE widgets SET config_json = ? WHERE id = ? AND user_id = ?")
          .run(JSON.stringify(config ?? {}), id, userId).changes > 0,
      setEnabled: (id, userId, enabled) =>
        db.prepare("UPDATE widgets SET enabled = ? WHERE id = ? AND user_id = ?").run(enabled ? 1 : 0, id, userId).changes > 0,
      delete: (id, userId) => db.prepare("DELETE FROM widgets WHERE id = ? AND user_id = ?").run(id, userId).changes > 0,
    },
    layouts: {
      get: (userId, bp) =>
        db.prepare("SELECT * FROM layouts WHERE user_id = ? AND breakpoint = ?").get(userId, bp) as Layout | undefined,
      listForUser: (userId) => db.prepare("SELECT * FROM layouts WHERE user_id = ?").all(userId) as Layout[],
      set: (userId, bp, order) =>
        db.prepare(
          `INSERT INTO layouts (user_id, breakpoint, widget_order_json) VALUES (?, ?, ?)
           ON CONFLICT (user_id, breakpoint) DO UPDATE SET widget_order_json = excluded.widget_order_json
           RETURNING *`,
        ).get(userId, bp, JSON.stringify(order)) as Layout,
    },
    rssCache: {
      get: (url) => db.prepare("SELECT * FROM rss_cache WHERE feed_url = ?").get(url) as RssCacheEntry | undefined,
      put: (url, fetchedAt, etag, items) => {
        db.prepare(
          `INSERT INTO rss_cache (feed_url, fetched_at, etag, items_json) VALUES (?, ?, ?, ?)
           ON CONFLICT (feed_url) DO UPDATE SET fetched_at = excluded.fetched_at, etag = excluded.etag, items_json = excluded.items_json`,
        ).run(url, fetchedAt, etag, JSON.stringify(items ?? []));
      },
      delete: (url) => { db.prepare("DELETE FROM rss_cache WHERE feed_url = ?").run(url); },
    },
  };
}
