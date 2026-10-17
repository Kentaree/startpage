import type { Repo } from "../repo/index.js";
import { BlockedUrlError, safeFetch, type SafeFetchOptions } from "./ssrf.js";
import { parseFeed, type RssItem } from "./parse.js";

export const TTL_MS = 12 * 60_000;

export class RssError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export interface RssServiceOptions {
  fetchOptions?: SafeFetchOptions;
  now?: () => number;
  ttlMs?: number;
}

export function createRssService(repo: Repo, opts: RssServiceOptions = {}) {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? TTL_MS;
  const inflight = new Map<string, Promise<RssItem[]>>();

  async function refresh(url: string): Promise<RssItem[]> {
    const cached = repo.rssCache.get(url);
    const stale = cached ? (JSON.parse(cached.items_json) as RssItem[]) : null;
    try {
      const res = await safeFetch(url, {
        ...opts.fetchOptions,
        headers: cached?.etag ? { "if-none-match": cached.etag } : undefined,
      });
      if (res.notModified && cached && stale) {
        repo.rssCache.put(url, new Date(now()).toISOString(), cached.etag, stale);
        return stale;
      }
      const items = parseFeed(res.body);
      repo.rssCache.put(url, new Date(now()).toISOString(), res.etag, items);
      return items;
    } catch (e) {
      if (e instanceof BlockedUrlError) throw new RssError("That feed URL is not allowed.", 400);
      if (stale) return stale;
      throw new RssError("Could not load the feed.", 502);
    }
  }

  return {
    async getItems(url: string): Promise<RssItem[]> {
      const cached = repo.rssCache.get(url);
      if (cached && now() - Date.parse(cached.fetched_at) < ttl) return JSON.parse(cached.items_json);
      let p = inflight.get(url);
      if (!p) {
        p = refresh(url).finally(() => inflight.delete(url));
        inflight.set(url, p);
      }
      return p;
    },
  };
}
