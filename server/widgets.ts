import type { FastifyInstance, FastifyReply } from "fastify";
import type { DB } from "./db.js";
import type { Breakpoint, Repo, WidgetType } from "./repo/index.js";
import { RssError, type createRssService } from "./rss/service.js";
import type { RssItem } from "./rss/parse.js";

const BREAKPOINTS: Breakpoint[] = ["lg", "md", "sm"];
const TYPES: WidgetType[] = ["weather", "clock", "rss"];

export const MAX_FEEDS = 10;
export const MAX_FEED_URL = 2048;
export const MAX_CITY_NAME = 100;
export const MAX_MERGED_ITEMS = 30;

export type ConfigResult = { config: Record<string, unknown> } | { error: string };
const fail = (error: string): ConfigResult => ({ error });

function checkFeedUrl(v: unknown, n: number): string | null {
  const label = `Feed ${n}`;
  if (typeof v !== "string") return `${label}: the URL must be text.`;
  const url = v.trim();
  if (!url) return `${label}: the URL is empty.`;
  if (url.length > MAX_FEED_URL) return `${label}: the URL is longer than ${MAX_FEED_URL} characters.`;
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return null;
  } catch { /* fall through */ }
  return `${label}: that doesn't look like a web address. Feed URLs must start with http:// or https://`;
}

/** Validate and normalise a widget config for its type, explaining the first problem found. */
export function checkConfig(type: WidgetType, config: unknown): ConfigResult {
  if (config === undefined || config === null) config = {};
  if (typeof config !== "object" || Array.isArray(config)) return fail("Config must be an object.");
  const c = config as Record<string, unknown>;
  switch (type) {
    case "weather": {
      const out: Record<string, unknown> = { unit: "C" };
      if (c.unit !== undefined) {
        const unit = typeof c.unit === "string" ? c.unit.toUpperCase() : "";
        if (unit !== "C" && unit !== "F") return fail("Unit must be C or F.");
        out.unit = unit;
      }
      if (c.city !== undefined && c.city !== null) {
        const city = c.city as Record<string, unknown>;
        if (typeof city !== "object" || Array.isArray(city)) return fail("City must be an object with name, lat and lon.");
        const name = typeof city.name === "string" ? city.name.trim() : "";
        if (!name) return fail("City name is required.");
        if (name.length > MAX_CITY_NAME) return fail(`City name must be at most ${MAX_CITY_NAME} characters.`);
        const { lat, lon } = city;
        if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90)
          return fail("City latitude must be a number between -90 and 90.");
        if (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180)
          return fail("City longitude must be a number between -180 and 180.");
        out.city = { name, lat: Math.round(lat * 100) / 100 + 0, lon: Math.round(lon * 100) / 100 + 0 };
      }
      return { config: out };
    }
    case "clock": {
      if (c.hour12 === undefined || c.hour12 === null) return { config: {} };
      if (typeof c.hour12 !== "boolean") return fail("hour12 must be true or false.");
      return { config: { hour12: c.hour12 } };
    }
    case "rss": {
      let urls: unknown[];
      if (c.feedUrls !== undefined) {
        if (!Array.isArray(c.feedUrls)) return fail("feedUrls must be a list of URLs.");
        urls = c.feedUrls;
      } else if (c.feedUrl !== undefined && c.feedUrl !== "") {
        urls = [c.feedUrl]; // legacy single-feed shape
      } else {
        urls = [];
      }
      if (urls.length > MAX_FEEDS) return fail(`You can add at most ${MAX_FEEDS} feeds.`);
      const out: string[] = [];
      for (let i = 0; i < urls.length; i++) {
        const err = checkFeedUrl(urls[i], i + 1);
        if (err) return fail(err);
        const url = (urls[i] as string).trim();
        if (!out.includes(url)) out.push(url);
      }
      return { config: out.length ? { feedUrls: out } : {} }; // empty = not configured yet
    }
  }
}

/** Validate and normalise a widget config for its type; returns null when invalid. */
export function validateConfig(type: WidgetType, config: unknown): Record<string, unknown> | null {
  const r = checkConfig(type, config);
  return "config" in r ? r.config : null;
}

/** Feed URLs for a stored rss config, reading the legacy `feedUrl` shape too. */
export function feedUrlsOf(config: unknown): string[] {
  const c = (config ?? {}) as { feedUrls?: unknown; feedUrl?: unknown };
  if (Array.isArray(c.feedUrls)) return c.feedUrls.filter((u): u is string => typeof u === "string" && !!u);
  return typeof c.feedUrl === "string" && c.feedUrl ? [c.feedUrl] : [];
}

export interface MergedItem extends RssItem { source: string }
export interface FeedError { feedUrl: string; error: string }

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

/** Fetch every feed, merge newest-first, cap the total; failed feeds are reported, not fatal. */
export async function mergeFeeds(
  urls: string[],
  getItems: (url: string) => Promise<RssItem[]>,
  limit = MAX_MERGED_ITEMS,
): Promise<{ items: MergedItem[]; errors: FeedError[]; statuses: number[] }> {
  const results = await Promise.allSettled(urls.map((u) => getItems(u)));
  const items: MergedItem[] = [];
  const errors: FeedError[] = [];
  const statuses: number[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      for (const it of r.value) items.push({ ...it, source: hostOf(urls[i]) });
    } else {
      const msg = r.reason instanceof RssError ? r.reason.message : "Could not load the feed.";
      errors.push({ feedUrl: urls[i], error: msg });
      if (r.reason instanceof RssError) statuses.push(r.reason.status);
    }
  });
  const time = (it: MergedItem) => { const t = it.date ? Date.parse(it.date) : NaN; return Number.isNaN(t) ? -Infinity : t; };
  items.sort((a, b) => time(b) - time(a));
  return { items: items.slice(0, limit), errors, statuses };
}

/** Existing ids in stored order, then any widgets missing from the order. */
export function healOrder(stored: unknown, validIds: number[]): number[] {
  const valid = new Set(validIds);
  const seen = new Set<number>();
  const out: number[] = [];
  if (Array.isArray(stored)) {
    for (const id of stored) {
      if (typeof id === "number" && valid.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
    }
  }
  for (const id of validIds) if (!seen.has(id)) out.push(id);
  return out;
}

/** True when `order` is exactly a permutation of `validIds` (no unknown, missing or duplicate ids). */
export function isPermutation(order: unknown, validIds: number[]): order is number[] {
  if (!Array.isArray(order) || order.length !== validIds.length) return false;
  const valid = new Set(validIds);
  const seen = new Set<number>();
  for (const id of order) {
    if (typeof id !== "number" || !valid.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function parseJson(s: string, fallback: unknown) {
  try { return JSON.parse(s); } catch { return fallback; }
}

export function registerWidgetRoutes(app: FastifyInstance, db: DB, repo: Repo, rss: ReturnType<typeof createRssService>) {
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "Widget not found" });
  const parseId = (raw: string) => (/^\d{1,15}$/.test(raw) ? Number(raw) : null);

  app.get("/api/state", async (req) => {
    const userId = req.user!.id;
    const widgets = repo.widgets.listForUser(userId);
    const ids = widgets.map((w) => w.id);
    const stored = new Map(repo.layouts.listForUser(userId).map((l) => [l.breakpoint, l.widget_order_json]));
    const layouts = Object.fromEntries(
      BREAKPOINTS.map((bp) => [bp, healOrder(parseJson(stored.get(bp) ?? "[]", []), ids)]),
    );
    return {
      widgets: widgets.map((w) => ({ id: w.id, type: w.type, config: parseJson(w.config_json, {}), enabled: w.enabled !== 0 })),
      layouts,
    };
  });

  app.put("/api/layouts/:breakpoint", async (req, reply) => {
    const userId = req.user!.id;
    const bp = (req.params as { breakpoint: string }).breakpoint as Breakpoint;
    if (!BREAKPOINTS.includes(bp)) return reply.code(404).send({ error: "Unknown breakpoint" });
    const saved = db.transaction(() => {
      const ids = repo.widgets.listForUser(userId).map((w) => w.id);
      if (!isPermutation(req.body, ids)) return null;
      repo.layouts.set(userId, bp, req.body);
      return req.body;
    })();
    if (!saved) return reply.code(400).send({ error: "Order must list each of your widgets exactly once" });
    return { breakpoint: bp, order: saved };
  });

  app.post("/api/widgets", async (req, reply) => {
    const userId = req.user!.id;
    const body = (req.body ?? {}) as { type?: unknown; config?: unknown };
    if (typeof body.type !== "string" || !TYPES.includes(body.type as WidgetType))
      return reply.code(400).send({ error: "Unknown widget type" });
    const type = body.type as WidgetType;
    const checked = checkConfig(type, body.config);
    if (!("config" in checked)) return reply.code(400).send({ error: checked.error });
    const config = checked.config;
    const widget = db.transaction(() => {
      const w = repo.widgets.create(userId, type, config);
      const ids = repo.widgets.listForUser(userId).map((x) => x.id);
      for (const bp of BREAKPOINTS) {
        const cur = healOrder(parseJson(repo.layouts.get(userId, bp)?.widget_order_json ?? "[]", []), ids.filter((i) => i !== w.id));
        repo.layouts.set(userId, bp, [...cur, w.id]);
      }
      return w;
    })();
    return reply.code(201).send({ id: widget.id, type: widget.type, config, enabled: widget.enabled !== 0 });
  });

  app.patch("/api/widgets/:id", async (req, reply) => {
    const userId = req.user!.id;
    const id = parseId((req.params as { id: string }).id);
    const widget = id === null ? undefined : repo.widgets.get(id);
    if (!widget || widget.user_id !== userId) return notFound(reply);
    const body = (req.body ?? {}) as { config?: unknown; enabled?: unknown };
    const hasConfig = body.config !== undefined;
    const hasEnabled = body.enabled !== undefined;
    if (!hasConfig && !hasEnabled) return reply.code(400).send({ error: "Provide config and/or enabled" });
    if (hasEnabled && typeof body.enabled !== "boolean") return reply.code(400).send({ error: "enabled must be a boolean" });
    let config: Record<string, unknown> | null = null;
    if (hasConfig) {
      const checked = checkConfig(widget.type, body.config);
      if (!("config" in checked)) return reply.code(400).send({ error: checked.error });
      config = checked.config;
    }
    db.transaction(() => {
      if (config) repo.widgets.updateConfig(widget.id, userId, config);
      if (hasEnabled) repo.widgets.setEnabled(widget.id, userId, body.enabled as boolean);
    })();
    const fresh = repo.widgets.get(widget.id)!;
    return { id: fresh.id, type: fresh.type, config: parseJson(fresh.config_json, {}), enabled: fresh.enabled !== 0 };
  });

  app.delete("/api/widgets/:id", async (req, reply) => {
    const userId = req.user!.id;
    const id = parseId((req.params as { id: string }).id);
    if (id === null) return notFound(reply);
    const removed = db.transaction(() => {
      if (!repo.widgets.delete(id, userId)) return false;
      for (const bp of BREAKPOINTS) {
        const cur = parseJson(repo.layouts.get(userId, bp)?.widget_order_json ?? "[]", []);
        if (Array.isArray(cur)) repo.layouts.set(userId, bp, cur.filter((x) => x !== id));
      }
      return true;
    })();
    return removed ? { ok: true } : notFound(reply);
  });

  app.get("/api/rss", async (req, reply) => {
    const raw = (req.query as { widgetId?: unknown }).widgetId;
    const id = typeof raw === "string" ? parseId(raw) : null;
    const widget = id === null ? undefined : repo.widgets.get(id);
    if (!widget || widget.user_id !== req.user!.id || widget.type !== "rss") return notFound(reply);
    const urls = feedUrlsOf(parseJson(widget.config_json, {}));
    if (!urls.length) return reply.code(400).send({ error: "No feed URL set" });
    const { items, errors, statuses } = await mergeFeeds(urls, (u) => rss.getItems(u));
    if (!items.length && errors.length === urls.length) {
      // Every feed failed: keep the single-feed behaviour of surfacing an error status.
      return reply.code(urls.length === 1 && statuses.length ? statuses[0] : 502).send({ error: errors.length === 1 ? errors[0].error : "Could not load any of the feeds.", errors });
    }
    return { items, errors };
  });
}
