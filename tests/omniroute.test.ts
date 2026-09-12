import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOmniRouteProxyConfig,
  inspectOmniRouteAdapter,
  normalizeOmniRouteBaseUrl,
} from '../src/core/omniroute.js';
import { createProxy } from '../src/core/proxy.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OmniRoute adapter', () => {
  it('normalizes root and /v1 URLs without hard-coding a port', () => {
    expect(normalizeOmniRouteBaseUrl('http://127.0.0.1:20128')).toBe('http://127.0.0.1:20128');
    expect(normalizeOmniRouteBaseUrl('http://localhost:3456/v1/')).toBe('http://localhost:3456');
    expect(normalizeOmniRouteBaseUrl('https://gateway.example.test/v1')).toBe('https://gateway.example.test');
  });

  it('allows plaintext HTTP only for loopback instances', () => {
    expect(() => normalizeOmniRouteBaseUrl('http://omniroute.example.test:20128/v1'))
      .toThrow(/require HTTPS/);
    expect(() => normalizeOmniRouteBaseUrl('ftp://127.0.0.1:20128'))
      .toThrow(/HTTP or HTTPS/);
    expect(() => normalizeOmniRouteBaseUrl('https://user:pass@example.test/v1'))
      .toThrow(/must not contain credentials/);
    expect(() => normalizeOmniRouteBaseUrl('https://example.test/custom'))
      .toThrow(/root or \/v1/);
  });

  it('builds one gateway config for Anthropic, OpenAI and Gemini protocol surfaces', () => {
    const config = createOmniRouteProxyConfig({
      baseUrl: 'https://omni.example.test/v1',
      apiKey: 'om_test_key',
      headers: { 'x-session-id': 'furypipe-test' },
    });

    expect(config).toMatchObject({
      upstream: 'https://omni.example.test',
      openAIUpstream: 'https://omni.example.test',
      googleUpstream: 'https://omni.example.test',
      gatewayHeaders: {
        authorization: 'Bearer om_test_key',
        'x-session-id': 'furypipe-test',
      },
      gatewayCredentialIsolation: true,
    });
  });

  it('does not expose API keys through adapter inspection', () => {
    const inspection = inspectOmniRouteAdapter({
      baseUrl: 'https://omni.example.test/v1',
      apiKey: 'TOP-SECRET-OMNIROUTE-KEY',
    });

    expect(inspection).toMatchObject({
      format: 'furypipe-omniroute-adapter/v1',
      baseUrl: 'https://omni.example.test',
      authentication: 'configured',
      protocols: ['anthropic', 'openai', 'google'],
    });
    expect(JSON.stringify(inspection)).not.toContain('TOP-SECRET');
    expect(JSON.stringify(inspection)).not.toContain('authorization');
  });

  it('refuses secret-bearing generic headers so auth has one explicit source', () => {
    expect(() => createOmniRouteProxyConfig({
      baseUrl: 'https://omni.example.test',
      headers: { Authorization: 'Bearer hidden' },
    })).toThrow(/must not be supplied through generic headers/);
  });

  it('overrides an inbound OpenAI credential with the configured OmniRoute key', async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const request = input instanceof Request
        ? input
        : new Request(String(input), {
            ...init,
            ...(init?.body ? { duplex: 'half' as const } : {}),
          });
      calls.push({
        url: request.url,
        authorization: request.headers.get('authorization'),
      });
      return new Response(JSON.stringify({
        id: 'chatcmpl-test',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const handler = createProxy({
      ...createOmniRouteProxyConfig({
        baseUrl: 'https://omni.example.test/v1',
        apiKey: 'om_gateway_key',
      }),
      transform: { compress: false },
    });

    const response = await handler(new Request('http://127.0.0.1:47821/v1/chat/completions?api_key=client-query-secret&trace=1', {
      method: 'POST',
      headers: {
        authorization: 'Bearer sk-client-must-not-leak',
        'x-api-key': 'sk-ant-client-must-not-leak',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.6-sol',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: 'https://omni.example.test/v1/chat/completions?trace=1',
      authorization: 'Bearer om_gateway_key',
    });
    expect(JSON.stringify(calls)).not.toContain('sk-client-must-not-leak');
    expect(JSON.stringify(calls)).not.toContain('client-query-secret');
    expect(JSON.stringify(calls)).not.toContain('sk-ant-client-must-not-leak');
  });
});
