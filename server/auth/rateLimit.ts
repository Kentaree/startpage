/** Small in-memory fixed-window limiter (the app runs as a single instance). */
export function createRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return {
    /** Returns true if the request is allowed. */
    hit(key: string, now = Date.now()): boolean {
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
      const e = hits.get(key);
      if (!e || e.reset <= now) {
        hits.set(key, { count: 1, reset: now + windowMs });
        return true;
      }
      return ++e.count <= max;
    },
  };
}
