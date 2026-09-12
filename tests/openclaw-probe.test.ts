import { describe, expect, it, vi } from 'vitest';
import { probeOpenClawGateway } from '../src/openclaw.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OpenClaw Gateway health probe', () => {
  it('validates the documented health/startup/readiness JSON contracts without credentials or model calls', async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, auth: headers.get('authorization') });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true, status: 'live' });
      if (url.endsWith('/startupz')) return jsonResponse({ ok: true, status: 'started' });
      if (url.endsWith('/readyz')) return jsonResponse({ ready: true, failing: [] });
      throw new Error('unexpected endpoint');
    }) as typeof fetch;

    let now = 0;
    const result = await probeOpenClawGateway({
      baseUrl: 'http://127.0.0.1:18789',
      fetchImpl,
      now: () => (now += 3),
    });

    expect(result).toMatchObject({
      format: 'furypipe-openclaw-gateway-probe/v1',
      origin: 'http://127.0.0.1:18789',
      liveness: { endpoint: '/healthz', verdict: 'healthy', httpStatus: 200 },
      startup: { endpoint: '/startupz', verdict: 'healthy', httpStatus: 200 },
      readiness: { endpoint: '/readyz', verdict: 'healthy', httpStatus: 200 },
      overall: 'healthy',
      modelCallExecuted: false,
    });
    expect(calls.map((call) => new URL(call.url).pathname).sort()).toEqual(['/healthz', '/readyz', '/startupz']);
    expect(calls.every((call) => call.auth === null)).toBe(true);
    expect(calls.some((call) => call.url.includes('/v1/'))).toBe(false);
  });

  it('distinguishes liveness from startup/readiness degradation', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === '/healthz') return jsonResponse({ ok: true, status: 'live' });
      if (path === '/startupz') return jsonResponse({ ok: false, status: 'starting' }, 503);
      return jsonResponse({ ready: false, failing: ['telegram'] }, 503);
    }) as typeof fetch;

    const result = await probeOpenClawGateway({
      baseUrl: 'http://localhost:18789',
      fetchImpl,
      now: () => 1,
    });

    expect(result.liveness.verdict).toBe('healthy');
    expect(result.startup).toMatchObject({ verdict: 'not_ready', httpStatus: 503 });
    expect(result.readiness).toMatchObject({ verdict: 'not_ready', httpStatus: 503 });
    expect(result.overall).toBe('degraded');
    expect(JSON.stringify(result)).not.toContain('telegram');
  });

  it('rejects catch-all HTML/incorrect JSON even when the HTTP status is 200', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === '/healthz') return new Response('<html>Control UI</html>', { status: 200 });
      if (path === '/startupz') return jsonResponse({ ok: true, status: 'wrong-route' });
      return jsonResponse({ ok: true, status: 'ready' });
    }) as typeof fetch;

    const result = await probeOpenClawGateway({
      baseUrl: 'http://[::1]:18789',
      fetchImpl,
      now: () => 1,
    });

    expect(result.liveness.verdict).toBe('invalid_contract');
    expect(result.startup.verdict).toBe('invalid_contract');
    expect(result.readiness.verdict).toBe('invalid_contract');
    expect(result.overall).toBe('unavailable');
  });

  it('reports unreachable endpoints without throwing or leaking error details', async () => {
    const fetchImpl = (async () => {
      throw new Error('connect ECONNREFUSED token=secret-value');
    }) as typeof fetch;

    const result = await probeOpenClawGateway({
      baseUrl: 'http://127.0.0.1:18789',
      fetchImpl,
      now: () => 1,
    });

    expect(result.liveness.verdict).toBe('unreachable');
    expect(result.startup.verdict).toBe('unreachable');
    expect(result.readiness.verdict).toBe('unreachable');
    expect(result.overall).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('secret-value');
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
  });

  it('denies remote origins by default and embedded credentials/path/query inputs always', async () => {
    await expect(probeOpenClawGateway({
      baseUrl: 'https://openclaw.example.invalid:18789',
      fetchImpl: (async () => jsonResponse({ ok: true })) as typeof fetch,
    })).rejects.toThrow(/allowRemote=true/);

    await expect(probeOpenClawGateway({
      baseUrl: 'http://user:pass@127.0.0.1:18789',
    })).rejects.toThrow(/must not embed credentials/);

    await expect(probeOpenClawGateway({
      baseUrl: 'http://127.0.0.1:18789/control?token=x',
    })).rejects.toThrow(/origin without path/);
  });

  it('allows an explicitly trusted remote origin without changing probe semantics', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === '/healthz') return jsonResponse({ ok: true, status: 'live' });
      if (path === '/startupz') return jsonResponse({ ok: true, status: 'started' });
      return jsonResponse({ ready: true, failing: [] });
    }) as typeof fetch;

    const result = await probeOpenClawGateway({
      baseUrl: 'https://openclaw.internal.example:18789',
      allowRemote: true,
      fetchImpl,
      now: () => 1,
    });
    expect(result.overall).toBe('healthy');
    expect(result.origin).toBe('https://openclaw.internal.example:18789');
  });

  it('validates timeout bounds before issuing network work', async () => {
    await expect(probeOpenClawGateway({
      baseUrl: 'http://127.0.0.1:18789',
      timeoutMs: 99,
    })).rejects.toThrow(/between 100 and 30000/);
  });
});
