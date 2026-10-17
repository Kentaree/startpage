import type { FastifyInstance } from "fastify";
import { createRateLimiter } from "./auth/rateLimit.js";

const UPSTREAM = "https://geocoding-api.open-meteo.com/v1/search";
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 6;

export interface GeocodeOptions {
  /** Fetch implementation (tests mock this). */
  fetch?: typeof fetch;
  timeoutMs?: number;
  rateLimit?: { max: number; windowMs: number };
}

export interface GeocodeMatch { name: string; admin1?: string; country?: string; lat: number; lon: number }

const optStr = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export function trimResults(body: unknown): GeocodeMatch[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: GeocodeMatch[] = [];
  for (const r of results) {
    if (out.length >= MAX_RESULTS) break;
    const o = (r ?? {}) as Record<string, unknown>;
    if (typeof o.name !== "string" || !o.name || typeof o.latitude !== "number" || typeof o.longitude !== "number") continue;
    const m: GeocodeMatch = { name: o.name, lat: o.latitude, lon: o.longitude };
    const admin1 = optStr(o.admin1);
    const country = optStr(o.country);
    if (admin1) m.admin1 = admin1;
    if (country) m.country = country;
    out.push(m);
  }
  return out;
}

export function registerGeocodeRoutes(app: FastifyInstance, opts: GeocodeOptions = {}) {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const limit = createRateLimiter(opts.rateLimit?.max ?? 30, opts.rateLimit?.windowMs ?? 60_000);

  // Sign-in is enforced by the global /api route guard.
  app.get("/api/geocode", async (req, reply) => {
    const raw = (req.query as { q?: unknown }).q;
    const q = typeof raw === "string" ? raw.trim() : "";
    if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH)
      return reply.code(400).send({ error: `Enter between ${MIN_QUERY_LENGTH} and ${MAX_QUERY_LENGTH} characters to search for a city.` });
    if (!limit.hit(`user:${req.user?.id ?? req.ip}`))
      return reply.code(429).send({ error: "Too many searches. Try again in a minute." });

    const url = `${UPSTREAM}?${new URLSearchParams({ name: q, count: String(MAX_RESULTS), language: "en", format: "json" })}`;
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      return { results: trimResults(await res.json()) };
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === "TimeoutError" || name === "AbortError")
        return reply.code(504).send({ error: "City search timed out. Please try again." });
      req.log.warn({ err: e }, "geocode upstream failed");
      return reply.code(502).send({ error: "City search is unavailable right now. Please try again later." });
    }
  });
}
