import { XMLParser } from "fast-xml-parser";

export interface RssItem { title: string; link: string | null; date: string | null }

export const MAX_ITEMS = 10;
const MAX_TITLE = 300;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: false, // no entity expansion (avoids entity-bomb attacks); basic entities decoded below
  htmlEntities: false,
  trimValues: true,
});

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "";
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "#text" in v) return text((v as Record<string, unknown>)["#text"]);
  return "";
}

export function safeHttpUrl(s: string): string | null {
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function pickLink(item: Record<string, unknown>): string | null {
  const l = item.link;
  const links = arr(l as unknown);
  // Atom: prefer rel=alternate (or no rel); RSS: plain text.
  for (const x of links) {
    if (typeof x === "object" && x) {
      const o = x as Record<string, unknown>;
      const rel = o["@_rel"];
      if ((rel === undefined || rel === "alternate") && typeof o["@_href"] === "string") {
        const u = safeHttpUrl(decode(o["@_href"]));
        if (u) return u;
      }
    }
  }
  for (const x of links) {
    const t = text(x);
    if (t) { const u = safeHttpUrl(decode(t)); if (u) return u; }
  }
  const guid = item.guid;
  if (guid && typeof guid === "object" && (guid as Record<string, unknown>)["@_isPermaLink"] !== "false") return safeHttpUrl(decode(text(guid)));
  return null;
}

function pickDate(item: Record<string, unknown>): string | null {
  for (const k of ["pubDate", "published", "updated", "dc:date"]) {
    const t = text(item[k]);
    if (!t) continue;
    const d = new Date(decode(t));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/** Parse RSS 2.0 / RSS 1.0 (RDF) / Atom into sanitized items; throws on unparseable input. */
export function parseFeed(xml: string): RssItem[] {
  let doc: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { doc = parser.parse(xml); } catch { throw new Error("Not a valid feed"); }
  let raw: unknown[];
  if (doc.rss) raw = arr(doc.rss.channel).flatMap((c: Record<string, unknown>) => arr(c?.item as unknown[]));
  else if (doc["rdf:RDF"]) raw = arr(doc["rdf:RDF"].item);
  else if (doc.feed) raw = arr(doc.feed.entry);
  else throw new Error("Not a valid feed");
  const items: RssItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const item = r as Record<string, unknown>;
    const title = decode(text(item.title)).replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
    const link = pickLink(item);
    if (!title && !link) continue;
    items.push({ title: title || link!, link, date: pickDate(item) });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}
