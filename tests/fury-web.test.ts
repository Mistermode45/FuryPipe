import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFuryProofLedger } from '../src/fury-proof.js';
import { FURY_WEB_CAPABILITIES, FuryWebError, createFurySearxngAdapter, furyRobotsAllows, furyWebCrawl, furyWebExtract, furyWebFetch, furyWebMap, furyWebSearch } from '../src/fury-web.js';

const PUBLIC_IP = '93.184.216.34';
let server: Server;
let port = 0;
const hits: string[] = [];

const PAGES: Record<string, [number, Record<string, string>, string]> = {
  '/': [200, { 'content-type': 'text/html; charset=utf-8' }, '<html><head><title>Docs &amp; Guides</title><meta name="description" content="Home"><link rel="canonical" href="/"></head><body><nav><a href="/nav-only">nav</a></nav><main><h1>Welcome</h1><p>Hello <b>world</b>.</p><script>alert(1)</script><a href="/a">A</a> <a href="/private/x">P</a> <a href="https://other.test/z">ext</a> <a href="javascript:void 0">js</a></main></body></html>'],
  '/a': [200, { 'content-type': 'text/html' }, '<title>A</title><body><h2>Page A</h2><a href="/b">B</a></body>'],
  '/b': [200, { 'content-type': 'text/html' }, '<title>B</title><body>deep</body>'],
  '/private/x': [200, { 'content-type': 'text/html' }, '<title>secret</title>'],
  '/robots.txt': [200, { 'content-type': 'text/plain' }, 'User-agent: *\nDisallow: /private\n'],
  '/redirect': [302, { location: '/a' }, ''],
  '/to-loopback': [302, { location: 'http://127.0.0.1/admin' }, ''],
  '/loop': [302, { location: '/loop' }, ''],
  '/big': [200, { 'content-type': 'text/plain' }, 'x'.repeat(5_000)],
  '/image': [200, { 'content-type': 'image/png' }, 'png'],
  '/404': [404, { 'content-type': 'text/plain' }, 'no'],
};

beforeEach(async () => {
  hits.length = 0;
  server = createServer((req, res) => {
    hits.push(`${req.headers.host} ${req.url}`);
    const page = PAGES[req.url ?? ''] ?? PAGES['/404']!;
    res.writeHead(page[0], page[1]).end(page[2]);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
});

// Hostnames resolve to a public address (passes SSRF policy); the test dialer
// then routes that validated address to the local fixture server.
const net = () => ({
  resolveHostname: async (h: string) => (h === 'evil.test' ? ['10.0.0.7'] : [PUBLIC_IP]),
  dial: (address: string) => {
    expect(address).toBe(PUBLIC_IP);
    return { host: '127.0.0.1', port };
  },
});

describe('FuryWeb FETCH', () => {
  it('fetches text without a browser, keeps the Host header and issues a receipt', async () => {
    const ledger = createFuryProofLedger();
    const doc = await furyWebFetch('http://docs.test/', { ...net(), ledger });
    expect(doc).toMatchObject({ status: 200, contentType: 'text/html', url: 'http://docs.test/' });
    expect(hits).toEqual(['docs.test /']);
    expect(doc.receipt && ledger.verify(doc.receipt)).toBe(true);
    expect(doc.receipt?.evidenceDigest).toBe(doc.sha256);
    expect(FURY_WEB_CAPABILITIES.FETCH.browser).toBe(false);
  });

  it('revalidates redirects and blocks SSRF targets, loops, big and binary bodies', async () => {
    expect((await furyWebFetch('http://docs.test/redirect', net())).redirects).toEqual(['http://docs.test/a']);
    await expect(furyWebFetch('http://docs.test/to-loopback', net())).rejects.toMatchObject({ code: 'blocked' });
    await expect(furyWebFetch('http://evil.test/', net())).rejects.toMatchObject({ code: 'blocked' });
    await expect(furyWebFetch('http://127.0.0.1/', net())).rejects.toMatchObject({ code: 'blocked' });
    await expect(furyWebFetch('http://169.254.169.254/latest/meta-data', net())).rejects.toMatchObject({ code: 'blocked' });
    await expect(furyWebFetch('http://user:pw@docs.test/', net())).rejects.toMatchObject({ code: 'blocked' });
    await expect(furyWebFetch('file:///etc/passwd', net())).rejects.toMatchObject({ code: 'blocked' });
    await expect(furyWebFetch('http://docs.test:8080/', net())).rejects.toMatchObject({ code: 'blocked' });
    await expect(furyWebFetch('http://docs.test/loop', net())).rejects.toMatchObject({ code: 'too-many-redirects' });
    await expect(furyWebFetch('http://docs.test/big', { ...net(), maxBytes: 1_000 })).rejects.toMatchObject({ code: 'too-large' });
    await expect(furyWebFetch('http://docs.test/image', net())).rejects.toMatchObject({ code: 'unsupported-type' });
    await expect(furyWebFetch('http://docs.test/404', net())).rejects.toMatchObject({ code: 'http-error' });
    expect(hits.some((h) => h.includes('admin'))).toBe(false);
  });
});

describe('FuryWeb EXTRACT / MAP / CRAWL / SEARCH', () => {
  it('extracts readable text without scripts or navigation', () => {
    const page = furyWebExtract(PAGES['/']![2], 'http://docs.test/');
    expect(page).toMatchObject({ title: 'Docs & Guides', description: 'Home', canonical: 'http://docs.test/', headings: ['Welcome'] });
    expect(page.text).toContain('Hello world .');
    expect(page.text).not.toContain('alert');
    expect(page.links.map((l) => l.url)).toEqual(['http://docs.test/nav-only', 'http://docs.test/a', 'http://docs.test/private/x', 'https://other.test/z']);
  });

  it('maps one page and crawls same-origin within bounds, honouring robots.txt', async () => {
    const map = await furyWebMap('http://docs.test/', net());
    expect(map.external.map((l) => l.url)).toEqual(['https://other.test/z']);
    const crawl = await furyWebCrawl('http://docs.test/', { ...net(), maxDepth: 2, maxPages: 10 });
    expect(crawl.pages.map((p) => p.url)).toEqual(['http://docs.test/', 'http://docs.test/a', 'http://docs.test/b']);
    expect(crawl.skipped).toContainEqual({ url: 'http://docs.test/nav-only', reason: 'HTTP 404 from http://docs.test' });
    expect(crawl.skipped).toContainEqual({ url: 'http://docs.test/private/x', reason: 'robots.txt' });
    expect(hits).not.toContain('docs.test /private/x');
    const shallow = await furyWebCrawl('http://docs.test/', { ...net(), maxPages: 1 });
    expect(shallow).toMatchObject({ truncated: true });
    expect(furyRobotsAllows('User-agent: *\nDisallow: /\nAllow: /public', '/public/x')).toBe(true);
    expect(furyRobotsAllows('User-agent: other\nDisallow: /\n', '/x')).toBe(true);
  });

  it('searches only through a configured adapter; SearXNG stays on loopback', async () => {
    await expect(furyWebSearch('x', undefined)).rejects.toMatchObject({ code: 'not-configured' });
    const fake = { id: 'fake', search: async () => [{ title: 't', url: 'https://r.test', snippet: 's', engine: 'e' }] };
    expect(await furyWebSearch('hello', fake)).toEqual({ adapter: 'fake', results: [{ title: 't', url: 'https://r.test', snippet: 's', engine: 'e' }] });
    expect(() => createFurySearxngAdapter('https://search.example.com')).toThrow();
    expect(createFurySearxngAdapter('http://127.0.0.1:8888').id).toBe('searxng:http://127.0.0.1:8888');
    expect(new FuryWebError('blocked', 'x').code).toBe('blocked');
  });
});

describe('FuryWeb SSRF regressions', () => {
  const resolveTo = (addresses: string[]) => ({ resolveHostname: async () => addresses, dial: () => ({ host: '127.0.0.1', port }) });
  it.each([
    ['loopback v4', 'http://127.0.0.1/'], ['short loopback', 'http://127.1/'], ['decimal loopback', 'http://2130706433/'], ['hex loopback', 'http://0x7f000001/'],
    ['RFC1918 10/8', 'http://10.1.2.3/'], ['RFC1918 172.16/12', 'http://172.20.0.1/'], ['RFC1918 192.168/16', 'http://192.168.1.1/'],
    ['CGNAT', 'http://100.64.0.1/'], ['link-local metadata', 'http://169.254.169.254/latest/meta-data'], ['zero network', 'http://0.0.0.0/'],
    ['IPv6 loopback literal', 'http://[::1]/'], ['IPv4-mapped IPv6 literal', 'http://[::ffff:127.0.0.1]/'], ['localhost name', 'http://localhost/'],
    ['metadata name', 'http://metadata.google.internal/'], ['credentials trick', 'http://docs.test@127.0.0.1/'], ['non-http scheme', 'gopher://docs.test/'],
  ])('blocks %s', async (_name, url) => {
    await expect(furyWebFetch(url, net())).rejects.toMatchObject({ code: 'blocked' });
  });

  it.each([
    ['one private answer among public ones', ['93.184.216.34', '10.0.0.5']],
    ['IPv4-mapped IPv6 answer', ['::ffff:10.0.0.5']],
    ['NAT64 answer embedding loopback', ['64:ff9b::7f00:1']],
    ['IPv4-compatible answer embedding loopback', ['::7f00:1']],
    ['6to4 answer embedding RFC1918', ['2002:0a00:0001::1']],
    ['unique-local answer', ['fd00::1']],
    ['link-local v6 answer', ['fe80::1']],
  ])('blocks DNS answers: %s', async (_name, addresses) => {
    await expect(furyWebFetch('http://rebind.test/', resolveTo(addresses))).rejects.toMatchObject({ code: 'blocked' });
    expect(hits).toEqual([]);
  });

  it('ignores a #fragment instead of refusing the page', async () => {
    const doc = await furyWebFetch('http://docs.test/a#section', net());
    expect(doc.url).toBe('http://docs.test/a');
  });
});
