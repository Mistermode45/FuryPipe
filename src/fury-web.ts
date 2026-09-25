// FuryWeb — the web split into capabilities with different authority:
//   SEARCH   adapter-first (a configured local SearXNG, or nothing); no paid API
//   FETCH    one HTTP GET, never a browser
//   EXTRACT  pure parsing of fetched HTML (title, text, headings, links)
//   MAP      links of one page
//   CRAWL    bounded same-origin BFS that honours robots.txt
//   BROWSER / INTERACT  the governed browser runtime (permits, receipts)
// Every network hop is validated by the browser SSRF policy (public HTTP(S)
// on 80/443, no credentials, no private/loopback/metadata addresses), the
// connection is pinned to the validated address (no DNS rebinding) and each
// redirect is validated again. Responses are size-capped and type-checked.
import { createHash } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import type { LookupFunction } from 'node:net';

import { validateBrowserUrl } from './browser-runtime.js';
import { assertFuryLocalEndpoint } from './fury-local-fabric.js';
import type { FuryProofLedger, FuryReceipt } from './fury-proof.js';

export const FURY_WEB_CAPABILITIES = Object.freeze({
  SEARCH: { authority: 'NETWORK', browser: false, note: 'configured adapter only' },
  FETCH: { authority: 'NETWORK', browser: false, note: 'single GET, size-capped' },
  EXTRACT: { authority: 'NONE', browser: false, note: 'pure parsing' },
  MAP: { authority: 'NETWORK', browser: false, note: 'links of one page' },
  CRAWL: { authority: 'NETWORK', browser: false, note: 'same-origin, bounded, robots.txt' },
  BROWSER: { authority: 'NETWORK', browser: true, note: 'governed browser runtime' },
  INTERACT: { authority: 'EXTERNAL_ACTION', browser: true, note: 'permit + approval per action' },
} as const);

export class FuryWebError extends Error {
  override readonly name = 'FuryWebError';
  constructor(readonly code: 'blocked' | 'too-large' | 'unsupported-type' | 'too-many-redirects' | 'http-error' | 'timeout' | 'robots' | 'not-configured', message: string) {
    super(message);
  }
}

export interface FuryWebFetchOptions {
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
  /** DNS override (tests); addresses are still checked against the SSRF policy. */
  readonly resolveHostname?: (hostname: string) => Promise<readonly string[]>;
  /** Test hook: where to dial a validated address. Production dials the address itself. */
  readonly dial?: (address: string, port: number) => { readonly host: string; readonly port: number };
  readonly ledger?: FuryProofLedger;
}

export interface FuryWebDocument {
  readonly requestedUrl: string;
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly body: string;
  readonly redirects: readonly string[];
  readonly receipt?: FuryReceipt;
}

const ALLOWED_TYPES = /^(?:text\/[\w.+-]+|application\/(?:json|xml|xhtml\+xml|rss\+xml|atom\+xml|ld\+json))$/u;
const USER_AGENT = 'FuryPipe-Web/1 (fetch; no browser; no cookies)';

function getOnce(url: URL, address: string, options: FuryWebFetchOptions, maxBytes: number, timeoutMs: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const target = options.dial ? options.dial(address, port) : { host: address, port };
  // Pin the connection to the validated address; TLS still verifies the hostname.
  const lookup: LookupFunction = (_host, opts, cb) => {
    const family = target.host.includes(':') ? 6 : 4;
    if ((opts as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: target.host, family }]);
    else cb(null, target.host, family);
  };
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: url.protocol, hostname: url.hostname, port: target.port, path: `${url.pathname}${url.search}`, method: 'GET', lookup,
      headers: { host: url.host, 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1', 'accept-encoding': 'identity' },
      timeout: timeoutMs, agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const declared = Number(res.headers['content-length'] ?? '0');
      if (declared > maxBytes) {
        res.destroy();
        reject(new FuryWebError('too-large', `response declares ${declared} bytes (limit ${maxBytes})`));
        return;
      }
      res.on('data', (c: Buffer) => {
        total += c.byteLength;
        if (total > maxBytes) {
          res.destroy();
          reject(new FuryWebError('too-large', `response exceeds ${maxBytes} bytes`));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new FuryWebError('timeout', `no response within ${timeoutMs} ms`)));
    req.on('error', reject);
    req.end();
  });
}

/** FETCH: a single SSRF-safe GET; no browser, no cookies, no credentials. */
export async function furyWebFetch(value: string, options: FuryWebFetchOptions = {}): Promise<FuryWebDocument> {
  const maxBytes = Math.min(options.maxBytes ?? 2 * 1024 * 1024, 16 * 1024 * 1024);
  const timeoutMs = Math.min(options.timeoutMs ?? 15_000, 60_000);
  const maxRedirects = Math.min(options.maxRedirects ?? 5, 10);
  const redirects: string[] = [];
  // A #fragment never reaches the server; drop it rather than refusing the page.
  let current = typeof value === 'string' ? value.replace(/#.*$/su, '') : value;
  for (;;) {
    let checked: Awaited<ReturnType<typeof validateBrowserUrl>>;
    try {
      checked = await validateBrowserUrl(current, options.resolveHostname ? { resolveHostname: options.resolveHostname } : {});
    } catch (error) {
      throw new FuryWebError('blocked', `${(error as Error).message}: ${current.slice(0, 200)}`);
    }
    const url = new URL(checked.url);
    const res = await getOnce(url, checked.addresses[0]!, options, maxBytes, timeoutMs);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (redirects.length >= maxRedirects) throw new FuryWebError('too-many-redirects', `more than ${maxRedirects} redirects`);
      current = new URL(res.headers.location, url).toString();
      redirects.push(current);
      continue;
    }
    if (res.status >= 400) throw new FuryWebError('http-error', `HTTP ${res.status} from ${url.origin}`);
    const contentType = String(res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!ALLOWED_TYPES.test(contentType)) throw new FuryWebError('unsupported-type', `content type ${contentType || 'unknown'} is not fetched as text`);
    const charset = /charset=([\w-]+)/iu.exec(String(res.headers['content-type'] ?? ''))?.[1]?.toLowerCase();
    let body: string;
    try {
      body = new TextDecoder(charset ?? 'utf-8').decode(res.body);
    } catch {
      body = res.body.toString('utf8');
    }
    const sha256 = createHash('sha256').update(res.body).digest('hex');
    const receipt = options.ledger?.issue({ kind: 'TOOL_RECEIPT', subject: `web:fetch:${url.toString().slice(0, 500)}`, outcome: 'pass', producer: 'host:fury-web', evidenceDigest: sha256 });
    return Object.freeze({ requestedUrl: value, url: url.toString(), status: res.status, contentType, bytes: res.body.byteLength, sha256, body, redirects: Object.freeze(redirects), ...(receipt ? { receipt } : {}) });
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/giu, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export interface FuryWebExtract {
  readonly title: string;
  readonly description: string;
  readonly canonical?: string;
  readonly headings: readonly string[];
  readonly text: string;
  readonly links: readonly { readonly url: string; readonly text: string }[];
}

/** EXTRACT: readable text and structure from HTML. Pure: no network, no script execution. */
export function furyWebExtract(html: string, baseUrl: string): FuryWebExtract {
  const base = new URL(baseUrl);
  const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu').exec(tag)?.slice(2).find((v) => v !== undefined);
  const cleaned = html.replace(/<!--[\s\S]*?-->/gu, ' ').replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1\s*>/giu, ' ');
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/iu.exec(cleaned)?.[1]?.replace(/\s+/gu, ' ').trim() ?? '');
  let description = '';
  let canonical: string | undefined;
  for (const tag of cleaned.match(/<(meta|link)\b[^>]*>/giu) ?? []) {
    if (/^<meta/iu.test(tag) && /name\s*=\s*["']?description/iu.test(tag)) description = decode(attr(tag, 'content') ?? '');
    if (/^<link/iu.test(tag) && /rel\s*=\s*["']?canonical/iu.test(tag)) {
      try { canonical = new URL(attr(tag, 'href') ?? '', base).toString(); } catch { /* ignore */ }
    }
  }
  const headings = [...cleaned.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/giu)].map((m) => decode(m[2]!.replace(/<[^>]+>/gu, '').replace(/\s+/gu, ' ').trim())).filter(Boolean).slice(0, 100);
  const links: { url: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const m of cleaned.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const href = attr(m[1]!, 'href');
    if (!href || /^(?:javascript|mailto|tel|data):/iu.test(href)) continue;
    let url: URL;
    try { url = new URL(decode(href), base); } catch { continue; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    url.hash = '';
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ url: key, text: decode(m[2]!.replace(/<[^>]+>/gu, '').replace(/\s+/gu, ' ').trim()).slice(0, 200) });
    if (links.length >= 1_000) break;
  }
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/iu.exec(cleaned)?.[1] ?? /<article\b[^>]*>([\s\S]*?)<\/article>/iu.exec(cleaned)?.[1] ?? /<body\b[^>]*>([\s\S]*?)<\/body>/iu.exec(cleaned)?.[1] ?? cleaned;
  const text = decode(main.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1\s*>/giu, ' ').replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/giu, '\n').replace(/<[^>]+>/gu, ' '))
    .split('\n').map((l) => l.replace(/[ \t\r\f\v]+/gu, ' ').trim()).filter(Boolean).join('\n').slice(0, 200_000);
  return Object.freeze({ title, description, ...(canonical ? { canonical } : {}), headings: Object.freeze(headings), text, links: Object.freeze(links) });
}

/** MAP: the http(s) links of one page, same-origin first. */
export async function furyWebMap(url: string, options: FuryWebFetchOptions = {}) {
  const doc = await furyWebFetch(url, options);
  const page = furyWebExtract(doc.body, doc.url);
  const origin = new URL(doc.url).origin;
  return Object.freeze({ url: doc.url, sameOrigin: page.links.filter((l) => new URL(l.url).origin === origin), external: page.links.filter((l) => new URL(l.url).origin !== origin) });
}

/** Minimal robots.txt reader for the `*` and FuryPipe groups (Disallow/Allow prefixes). */
export function furyRobotsAllows(robots: string, pathname: string): boolean {
  let applies = false;
  let inGroupHeader = false;
  const rules: { allow: boolean; prefix: string }[] = [];
  for (const raw of robots.split(/\r?\n/u)) {
    const line = raw.replace(/#.*$/u, '').trim();
    const m = /^([\w-]+)\s*:\s*(.*)$/u.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!inGroupHeader) applies = false;
      inGroupHeader = true;
      if (value === '*' || /furypipe/iu.test(value)) applies = true;
      continue;
    }
    inGroupHeader = false;
    if (applies && (key === 'disallow' || key === 'allow') && value) rules.push({ allow: key === 'allow', prefix: value });
  }
  const match = rules.filter((r) => pathname.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length || Number(b.allow) - Number(a.allow))[0];
  return match ? match.allow : true;
}

/** CRAWL: bounded same-origin breadth-first crawl honouring robots.txt. */
export async function furyWebCrawl(start: string, options: FuryWebFetchOptions & { readonly maxPages?: number; readonly maxDepth?: number } = {}) {
  const maxPages = Math.min(options.maxPages ?? 20, 200);
  const maxDepth = Math.min(options.maxDepth ?? 2, 5);
  const origin = new URL(start).origin;
  let robots = '';
  try {
    robots = (await furyWebFetch(`${origin}/robots.txt`, { ...options, maxBytes: 256 * 1024 })).body;
  } catch {
    robots = '';
  }
  const pages: { url: string; depth: number; title: string; text: string; sha256: string }[] = [];
  const skipped: { url: string; reason: string }[] = [];
  const queue: { url: string; depth: number }[] = [{ url: new URL(start).toString(), depth: 0 }];
  const seen = new Set([queue[0]!.url]);
  while (queue.length && pages.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (!furyRobotsAllows(robots, new URL(url).pathname)) { skipped.push({ url, reason: 'robots.txt' }); continue; }
    let doc: FuryWebDocument;
    try {
      doc = await furyWebFetch(url, options);
    } catch (error) {
      skipped.push({ url, reason: (error as Error).message.slice(0, 200) });
      continue;
    }
    if (new URL(doc.url).origin !== origin) { skipped.push({ url, reason: 'redirected off-origin' }); continue; }
    const page = /html|xml/u.test(doc.contentType) ? furyWebExtract(doc.body, doc.url) : { title: '', text: doc.body, links: [] };
    pages.push({ url: doc.url, depth, title: page.title, text: page.text.slice(0, 20_000), sha256: doc.sha256 });
    if (depth >= maxDepth) continue;
    for (const link of page.links) {
      if (new URL(link.url).origin !== origin || seen.has(link.url)) continue;
      seen.add(link.url);
      queue.push({ url: link.url, depth: depth + 1 });
    }
  }
  return Object.freeze({ origin, pages: Object.freeze(pages), skipped: Object.freeze(skipped), truncated: queue.length > 0 });
}

export interface FuryWebSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly engine: string;
}

export interface FuryWebSearchAdapter {
  readonly id: string;
  search(query: string, limit: number): Promise<readonly FuryWebSearchResult[]>;
}

/** SEARCH adapter for a self-hosted SearXNG on this machine (JSON API, loopback only). */
export function createFurySearxngAdapter(baseUrl: string): FuryWebSearchAdapter {
  const base = assertFuryLocalEndpoint(baseUrl);
  return Object.freeze({
    id: `searxng:${base.origin}`,
    async search(query: string, limit: number) {
      const url = new URL('search', base.href.endsWith('/') ? base.href : `${base.href}/`);
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'json');
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } });
      if (res.status !== 200) throw new FuryWebError('http-error', `SearXNG answered HTTP ${res.status}`);
      const body = await res.json() as { results?: { title?: unknown; url?: unknown; content?: unknown; engine?: unknown }[] };
      return (body.results ?? []).filter((r) => typeof r.url === 'string' && /^https?:/u.test(r.url)).slice(0, limit).map((r) => Object.freeze({ title: String(r.title ?? ''), url: String(r.url), snippet: String(r.content ?? '').slice(0, 500), engine: String(r.engine ?? 'searxng') }));
    },
  });
}

/** SEARCH: runs only through a configured adapter; there is no built-in paid provider. */
export async function furyWebSearch(query: string, adapter: FuryWebSearchAdapter | undefined, limit = 10) {
  if (!adapter) throw new FuryWebError('not-configured', 'no search adapter configured (set a local SearXNG endpoint); FuryPipe does not call paid search APIs');
  if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new FuryWebError('blocked', 'query must be 1..500 characters');
  return Object.freeze({ adapter: adapter.id, results: await adapter.search(query.trim(), Math.max(1, Math.min(limit, 50))) });
}
