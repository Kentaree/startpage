import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export class BlockedUrlError extends Error {}
export class FetchError extends Error {}

export const MAX_REDIRECTS = 3;
export const MAX_BYTES = 1024 * 1024;
export const TIMEOUT_MS = 5000;

type Cidr4 = [string, number];
const BLOCKED_V4: Cidr4[] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
// [prefix as hex groups, prefix length in bits]
const BLOCKED_V6: [string, number][] = [
  ["::", 96], // unspecified, loopback, deprecated IPv4-compatible
  ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
];

const v4ToInt = (ip: string) => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);

function v6ToBytes(ip: string): number[] | null {
  let s = ip.split("%")[0].toLowerCase();
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    if (!net.isIPv4(m[2])) return null;
    const n = v4ToInt(m[2]);
    s = `${m[1]}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    out.push(n >> 8, n & 0xff);
  }
  return out;
}

function inV4(ip: string, [base, bits]: Cidr4) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((v4ToInt(ip) & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
}

function inV6(bytes: number[], [prefix, bits]: [string, number]) {
  const p = v6ToBytes(prefix)!;
  for (let i = 0; i < bits; i += 8) {
    const keep = Math.min(8, bits - i);
    const mask = (0xff << (8 - keep)) & 0xff;
    if ((bytes[i / 8] & mask) !== (p[i / 8] & mask)) return false;
  }
  return true;
}

/** True when the address is not a public unicast address (or is not a valid IP at all). */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return BLOCKED_V4.some((c) => inV4(ip, c));
  if (!net.isIPv6(ip)) return true;
  const b = v6ToBytes(ip);
  if (!b) return true;
  // IPv4-mapped (::ffff:a.b.c.d): judge by the embedded IPv4 address.
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) {
    return isBlockedIp(b.slice(12).join("."));
  }
  return BLOCKED_V6.some((c) => inV6(b, c));
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
}
/** Performs one HTTP request, connecting to `address` (already vetted) rather than resolving the host again. */
export type Transport = (url: URL, address: string, headers: Record<string, string>, signal: AbortSignal) => Promise<TransportResponse>;
export type Resolver = (hostname: string) => Promise<string[]>;

export const defaultResolver: Resolver = async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address);

export const defaultTransport: Transport = (url, address, headers, signal) =>
  new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        headers,
        signal,
        agent: false,
        // Pin the connection to the vetted IP; TLS SNI / cert checks still use the hostname.
        lookup: (_h, _o, cb) => (_o as { all?: boolean })?.all
          ? (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family: net.isIPv6(address) ? 6 : 4 }])
          : cb(null, address, net.isIPv6(address) ? 6 : 4),
      },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res, destroy: () => res.destroy() }),
    );
    req.on("error", reject);
    req.end();
  });

export interface SafeFetchOptions {
  resolver?: Resolver;
  transport?: Transport;
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}
export interface SafeFetchResult { status: number; body: string; etag: string | null; notModified: boolean }

async function vet(url: URL, resolver: Resolver): Promise<string> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError("Only http(s) URLs are allowed");
  if (url.username || url.password) throw new BlockedUrlError("URLs with credentials are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addrs: string[];
  if (net.isIP(host)) addrs = [host];
  else {
    try { addrs = await resolver(host); } catch { throw new FetchError("Could not resolve host"); }
  }
  if (addrs.length === 0) throw new FetchError("Could not resolve host");
  // Refuse if any record is non-public, so a mixed answer cannot be used to rebind.
  if (addrs.some(isBlockedIp)) throw new BlockedUrlError("That address is not allowed");
  return addrs[0];
}

/** GET a URL with SSRF protection: every hop (including redirects) is resolved, vetted and pinned. */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const resolver = opts.resolver ?? defaultResolver;
  const transport = opts.transport ?? defaultTransport;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    let url: URL;
    try { url = new URL(rawUrl); } catch { throw new BlockedUrlError("Invalid URL"); }
    for (let hop = 0; ; hop++) {
      const address = await vet(url, resolver);
      const headers = { "user-agent": "startpage-rss/1.0", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1", "accept-encoding": "identity", ...opts.headers };
      let res: TransportResponse;
      try { res = await transport(url, address, headers, ctrl.signal); } catch { throw new FetchError("Request failed"); }
      const status = res.status;
      if (status >= 300 && status < 400 && status !== 304) {
        res.destroy();
        const loc = res.headers.location;
        const target = Array.isArray(loc) ? loc[0] : loc;
        if (!target) throw new FetchError("Redirect without location");
        if (hop >= maxRedirects) throw new FetchError("Too many redirects");
        try { url = new URL(target, url); } catch { throw new BlockedUrlError("Invalid redirect"); }
        // Conditional headers only make sense for the original URL.
        opts = { ...opts, headers: undefined };
        continue;
      }
      const etagH = res.headers.etag;
      const etag = (Array.isArray(etagH) ? etagH[0] : etagH) ?? null;
      if (status === 304) { res.destroy(); return { status, body: "", etag, notModified: true }; }
      if (status < 200 || status >= 300) { res.destroy(); throw new FetchError(`Feed server returned ${status}`); }
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        for await (const c of res.body) {
          total += c.byteLength;
          if (total > maxBytes) { res.destroy(); throw new FetchError("Feed is too large"); }
          chunks.push(Buffer.from(c));
        }
      } catch (e) {
        if (e instanceof FetchError) throw e;
        throw new FetchError("Request failed");
      }
      return { status, body: Buffer.concat(chunks).toString("utf8"), etag, notModified: false };
    }
  } finally {
    clearTimeout(timer);
  }
}
