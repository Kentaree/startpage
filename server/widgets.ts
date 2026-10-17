import type { FastifyInstance, FastifyReply } from "fastify";
import type { DB } from "./db.js";
import type { Breakpoint, Repo, WidgetType } from "./repo/index.js";
import { RssError, type createRssService } from "./rss/service.js";

const BREAKPOINTS: Breakpoint[] = ["lg", "md", "sm"];
const TYPES: WidgetType[] = ["weather", "clock", "rss"];

/** Validate and normalise a widget config for its type; returns null when invalid. */
export function validateConfig(type: WidgetType, config: unknown): Record<string, unknown> | null {
  if (config === undefined || config === null) config = {};
  if (typeof config !== "object" || Array.isArray(config)) return null;
  const c = config as Record<string, unknown>;
  switch (type) {
    case "weather": {
      if (c.unit === undefined) return { unit: "C" };
      if (typeof c.unit !== "string") return null;
      const unit = c.unit.toUpperCase();
      return unit === "C" || unit === "F" ? { unit } : null;
    }
    case "clock":
      return {};
    case "rss": {
      if (c.feedUrl === undefined || c.feedUrl === "") return {}; // not configured yet
      if (typeof c.feedUrl !== "string" || c.feedUrl.length > 2048) return null;
      try {
        const u = new URL(c.feedUrl);
        return u.protocol === "http:" || u.protocol === "https:" ? { feedUrl: c.feedUrl } : null;
      } catch {
        return null;
      }
    }
  }
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
      widgets: widgets.map((w) => ({ id: w.id, type: w.type, config: parseJson(w.config_json, {}) })),
      layouts,
    };
  });

  app.post("/api/widgets", async (req, reply) => {
    const userId = req.user!.id;
    const body = (req.body ?? {}) as { type?: unknown; config?: unknown };
    if (typeof body.type !== "string" || !TYPES.includes(body.type as WidgetType))
      return reply.code(400).send({ error: "Unknown widget type" });
    const type = body.type as WidgetType;
    const config = validateConfig(type, body.config);
    if (!config) return reply.code(400).send({ error: "Invalid widget config" });
    const widget = db.transaction(() => {
      const w = repo.widgets.create(userId, type, config);
      const ids = repo.widgets.listForUser(userId).map((x) => x.id);
      for (const bp of BREAKPOINTS) {
        const cur = healOrder(parseJson(repo.layouts.get(userId, bp)?.widget_order_json ?? "[]", []), ids.filter((i) => i !== w.id));
        repo.layouts.set(userId, bp, [...cur, w.id]);
      }
      return w;
    })();
    return reply.code(201).send({ id: widget.id, type: widget.type, config });
  });

  app.patch("/api/widgets/:id", async (req, reply) => {
    const userId = req.user!.id;
    const id = parseId((req.params as { id: string }).id);
    const widget = id === null ? undefined : repo.widgets.get(id);
    if (!widget || widget.user_id !== userId) return notFound(reply);
    const body = (req.body ?? {}) as { config?: unknown };
    const config = validateConfig(widget.type, body.config);
    if (!config) return reply.code(400).send({ error: "Invalid widget config" });
    repo.widgets.updateConfig(widget.id, userId, config);
    return { id: widget.id, type: widget.type, config };
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
    const feedUrl = (parseJson(widget.config_json, {}) as { feedUrl?: unknown }).feedUrl;
    if (typeof feedUrl !== "string" || !feedUrl) return reply.code(400).send({ error: "No feed URL set" });
    try {
      return { items: await rss.getItems(feedUrl) };
    } catch (e) {
      if (e instanceof RssError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });
}
