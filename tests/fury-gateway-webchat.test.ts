import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import {
  FURY_GATEWAY_WEBCHAT_CONFIG_PATH,
  FURY_GATEWAY_WEBCHAT_PATH,
  FURY_GATEWAY_WEBCHAT_SCRIPT_PATH,
  FURY_GATEWAY_WEBCHAT_STYLE_PATH,
  createFuryGatewayWebChatHandler,
} from '../src/gateway-webchat-node.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve())),
  ));
});

async function startWebChatServer(
  model: {
    readonly modelBridgeEnabled?: boolean;
    readonly modelProvider?: 'openai' | 'anthropic' | 'google';
    readonly model?: string;
    readonly toolBridgeEnabled?: boolean;
    readonly toolSourceCount?: number;
  } = {},
): Promise<{ readonly origin: string }> {
  let handler: ReturnType<typeof createFuryGatewayWebChatHandler> | undefined;
  const server = createServer((request, response) => {
    if (!handler) {
      response.statusCode = 503;
      response.end();
      return;
    }
    Promise.resolve(handler(request, response))
      .then((handled) => {
        if (!handled && !response.writableEnded) {
          response.statusCode = 404;
          response.end();
        }
      })
      .catch(() => {
        if (!response.writableEnded) {
          response.statusCode = 500;
          response.end();
        }
      });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  const origin = `http://127.0.0.1:${address.port}`;
  handler = createFuryGatewayWebChatHandler({ origin, ...model });
  return { origin };
}

describe('Fury Gateway local WebChat HTTP surface', () => {
  it('serves self-hosted HTML with restrictive no-store security headers', async () => {
    const { origin } = await startWebChatServer();
    const response = await fetch(origin + FURY_GATEWAY_WEBCHAT_PATH);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('permissions-policy')).toContain('microphone=()');

    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain(`connect-src 'self' ws://127.0.0.1:${new URL(origin).port}`);
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");

    expect(html).toContain('<h1>Local WebChat</h1>');
    expect(html).toContain(`src="${FURY_GATEWAY_WEBCHAT_SCRIPT_PATH}"`);
    expect(html).toContain(`href="${FURY_GATEWAY_WEBCHAT_STYLE_PATH}"`);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/u);
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('serves bounded same-origin JavaScript and CSS without third-party dependencies', async () => {
    const { origin } = await startWebChatServer();
    const jsResponse = await fetch(origin + FURY_GATEWAY_WEBCHAT_SCRIPT_PATH);
    const js = await jsResponse.text();
    const cssResponse = await fetch(origin + FURY_GATEWAY_WEBCHAT_STYLE_PATH);
    const css = await cssResponse.text();

    expect(jsResponse.status).toBe(200);
    expect(jsResponse.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(cssResponse.status).toBe(200);
    expect(cssResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(js.length).toBeGreaterThan(1000);
    expect(css.length).toBeGreaterThan(1000);
    expect(css).toContain('[hidden] { display: none !important; }');

    expect(js).toContain("'/gateway/local-bootstrap/v1'");
    expect(js).toContain("'/gateway/local-logout/v1'");
    expect(js).toContain("'conversation.message.submit'");
    expect(js).toContain("'conversation.model.execute'");
    expect(js).toContain("'provider-inference'");
    expect(js).toContain("'conversation.inspect'");
    expect(js).toContain("'tools.sources.inspect'");
    expect(js).toContain("'tools.propose'");
    expect(js).toContain("'tools.approve'");
    expect(js).toContain("'tools.execute'");
    expect(js).toContain("'process'");
    expect(js).toContain("'network'");
    expect(js).toContain("'Outcome unknown'");
    expect(js).toContain("'Tool failed'");
    expect(js).toContain("'Blocked'");
    expect(js).toContain('textContent');
    expect(js).not.toContain('innerHTML');
    expect(js).not.toMatch(/https?:\/\//u);
    expect(css).not.toMatch(/@import\s+url/u);
    expect(css).not.toMatch(/https?:\/\//u);
  });

  it('serves redacted model configuration without credentials or execution authority', async () => {
    const disabled = await startWebChatServer();
    const disabledResponse = await fetch(disabled.origin + FURY_GATEWAY_WEBCHAT_CONFIG_PATH);
    expect(await disabledResponse.json()).toEqual({
      format: 'furypipe-gateway-webchat-config/v1',
      modelBridge: { enabled: false },
      tools: { enabled: false },
      executionAuthority: false,
    });

    const enabled = await startWebChatServer({
      modelBridgeEnabled: true,
      modelProvider: 'openai',
      model: 'gpt-5.6-sol',
    });
    const enabledResponse = await fetch(enabled.origin + FURY_GATEWAY_WEBCHAT_CONFIG_PATH);
    const payload = await enabledResponse.json();
    expect(payload).toEqual({
      format: 'furypipe-gateway-webchat-config/v1',
      modelBridge: {
        enabled: true,
        providerId: 'openai',
        model: 'gpt-5.6-sol',
      },
      tools: { enabled: false },
      executionAuthority: false,
    });
    expect(JSON.stringify(payload)).not.toMatch(/api[_-]?key|credential|token/i);
  });

  it('serves only redacted tool availability metadata', async () => {
    const enabled = await startWebChatServer({
      toolBridgeEnabled: true,
      toolSourceCount: 2,
    });
    const response = await fetch(enabled.origin + FURY_GATEWAY_WEBCHAT_CONFIG_PATH);
    const payload = await response.json();

    expect(payload).toEqual({
      format: 'furypipe-gateway-webchat-config/v1',
      modelBridge: { enabled: false },
      tools: {
        enabled: true,
        sourceCount: 2,
      },
      executionAuthority: false,
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/credential|token|header|command|url|policy|fingerprint/i);
  });

  it('rejects contradictory or malformed tool metadata', () => {
    expect(() => createFuryGatewayWebChatHandler({
      origin: 'http://127.0.0.1:48722',
      toolSourceCount: 1,
    })).toThrow(/disabled tool bridge/u);

    for (const count of [0, 33, 1.5]) {
      expect(() => createFuryGatewayWebChatHandler({
        origin: 'http://127.0.0.1:48722',
        toolBridgeEnabled: true,
        toolSourceCount: count,
      })).toThrow(/source count/u);
    }
  });

  it('rejects contradictory or malformed model metadata', () => {
    expect(() => createFuryGatewayWebChatHandler({
      origin: 'http://127.0.0.1:48722',
      modelProvider: 'openai',
      model: 'gpt-5.6-sol',
    })).toThrow(/disabled model bridge/u);

    expect(() => createFuryGatewayWebChatHandler({
      origin: 'http://127.0.0.1:48722',
      modelBridgeEnabled: true,
      modelProvider: 'openai',
    })).toThrow(/model identifier/u);
  });

  it('supports HEAD and canonicalizes /gateway/webchat to the trailing-slash route', async () => {
    const { origin } = await startWebChatServer();

    const head = await fetch(origin + FURY_GATEWAY_WEBCHAT_PATH, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);

    const redirect = await fetch(origin + '/gateway/webchat', {
      redirect: 'manual',
    });
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get('location')).toBe(FURY_GATEWAY_WEBCHAT_PATH);
  });

  it('rejects query-bearing and non-GET asset requests', async () => {
    const { origin } = await startWebChatServer();

    const query = await fetch(origin + FURY_GATEWAY_WEBCHAT_PATH + '?code=must-not-be-here');
    expect(query.status).toBe(400);

    const post = await fetch(origin + FURY_GATEWAY_WEBCHAT_SCRIPT_PATH, {
      method: 'POST',
    });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('does not claim unrelated Gateway routes', async () => {
    const { origin } = await startWebChatServer();
    const response = await fetch(origin + '/gateway/local-bootstrap/v1');
    expect(response.status).toBe(404);
  });

  it('rejects non-loopback, HTTPS, credential-bearing and path-bearing configured origins', () => {
    for (const origin of [
      'http://0.0.0.0:48722',
      'http://192.168.1.4:48722',
      'https://127.0.0.1:48722',
      'http://user:pass@127.0.0.1:48722',
      'http://127.0.0.1:48722/path',
    ]) {
      expect(() => createFuryGatewayWebChatHandler({ origin })).toThrow(/loopback|origin/u);
    }
  });
});
