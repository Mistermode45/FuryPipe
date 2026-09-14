import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  createProductionMcpHandler,
  getProductionMcpRuntimeEvidence,
  type ProductionMcpHttpHandler,
} from '../src/mcp-modern.js';

const roots: string[] = [];
const handlers: ProductionMcpHttpHandler[] = [];

const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
};

afterEach(async () => {
  await Promise.all(handlers.splice(0).map((handler) => handler.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function handler(options: Parameters<typeof createProductionMcpHandler>[1] = {
  allowedHostnames: ['localhost'],
  allowUnauthenticatedLoopback: true,
}) {
  const root = await mkdtemp(join(tmpdir(), 'furypipe-mcp-http-'));
  roots.push(root);
  const value = createProductionMcpHandler(createRecoveryStore(root), options);
  handlers.push(value);
  return value;
}

function modernRequest(
  method: string,
  params: Record<string, unknown>,
  init: { host?: string; origin?: string; contentType?: string; accept?: string; body?: string } = {},
): Request {
  const body = init.body ?? JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method,
    params: { ...params, _meta: modernMeta },
  });
  const headers: Record<string, string> = {
    host: init.host ?? 'localhost',
    accept: init.accept ?? 'application/json, text/event-stream',
    'content-type': init.contentType ?? 'application/json',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': method,
  };
  if (method === 'tools/call' && typeof params.name === 'string') headers['mcp-name'] = params.name;
  if (init.origin !== undefined) headers.origin = init.origin;
  return new Request('https://localhost/mcp', { method: 'POST', headers, body });
}

async function json(response: Response): Promise<Record<string, any>> {
  return JSON.parse(await response.text()) as Record<string, any>;
}

describe('production MCP HTTP boundary', () => {
  it('requires an explicit auth posture and rejects unauthenticated non-loopback hosts', () => {
    expect(() => createProductionMcpHandler(createRecoveryStore('unused'), {
      allowedHostnames: ['mcp.example.test'],
    })).toThrow('bearerAuth is required');
    expect(() => createProductionMcpHandler(createRecoveryStore('unused'), {
      allowedHostnames: ['mcp.example.test'],
      allowUnauthenticatedLoopback: true,
    })).toThrow('loopback hostnames');
    expect(() => createProductionMcpHandler(createRecoveryStore('unused'), {
      allowedHostnames: ['localhost'],
      allowedOriginHostnames: ['app.example.test'],
      allowUnauthenticatedLoopback: true,
    })).toThrow('loopback hostnames');
  });

  it('serves a modern request and adds restrictive transport headers', async () => {
    const mcp = await handler();
    expect(getProductionMcpRuntimeEvidence(mcp)).toEqual({
      format: 'furypipe-mcp-http-runtime-evidence/v1',
      requests: 0,
      dispatchedRequests: 0,
      bearerAuthConfigured: false,
      bearerAuthSuccesses: 0,
      oauthMetadataConfigured: false,
      oauthMetadataResponses: 0,
    });
    expect(getProductionMcpRuntimeEvidence({ ...mcp })).toBeUndefined();

    const response = await mcp.fetch(modernRequest('tools/list', {}, { origin: 'https://localhost' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://localhost');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await json(response)).result.tools).toHaveLength(11);
    expect(getProductionMcpRuntimeEvidence(mcp)).toMatchObject({
      requests: 1,
      dispatchedRequests: 1,
      bearerAuthConfigured: false,
      bearerAuthSuccesses: 0,
    });
  });

  it('blocks DNS rebinding, foreign origins, unsupported methods, and invalid media', async () => {
    const mcp = await handler();
    expect((await mcp.fetch(modernRequest('tools/list', {}, { host: 'attacker.test' }))).status).toBe(403);
    expect((await mcp.fetch(modernRequest('tools/list', {}, { origin: 'https://attacker.test' }))).status).toBe(403);
    expect((await mcp.fetch(new Request('https://localhost/mcp', {
      method: 'GET',
      headers: { host: 'localhost', accept: 'application/json' },
    }))).status).toBe(405);
    expect((await mcp.fetch(modernRequest('tools/list', {}, { contentType: 'text/plain; a=application/json' }))).status).toBe(415);
    expect((await mcp.fetch(modernRequest('tools/list', {}, { accept: 'text/plain' }))).status).toBe(406);
  });

  it('bounds the body before dispatch and validates JSON-RPC routing headers', async () => {
    const mcp = await handler({
      allowedHostnames: ['localhost'],
      allowUnauthenticatedLoopback: true,
      maxRequestBytes: 1024,
    });
    const oversized = modernRequest('tools/list', {}, { body: 'x'.repeat(1025) });
    expect((await mcp.fetch(oversized)).status).toBe(413);

    const missingVersion = modernRequest('tools/list', {});
    missingVersion.headers.delete('mcp-protocol-version');
    const missingVersionResponse = await mcp.fetch(missingVersion);
    expect(missingVersionResponse.status).toBe(400);
    expect((await json(missingVersionResponse)).error).toMatchObject({ code: -32020 });

    const mismatch = modernRequest('tools/list', {});
    mismatch.headers.set('mcp-method', 'tools/call');
    const mismatchBody = await json(await mcp.fetch(mismatch));
    expect(mismatchBody.error).toMatchObject({ code: -32020 });

    const missingMethod = modernRequest('tools/list', {});
    missingMethod.headers.delete('mcp-method');
    const missingMethodResponse = await mcp.fetch(missingMethod);
    expect(missingMethodResponse.status).toBe(400);
    expect((await json(missingMethodResponse)).error).toMatchObject({ code: -32020 });

    const nameMismatch = modernRequest('tools/call', { name: 'index_text', arguments: { text: 'x' } });
    nameMismatch.headers.set('mcp-name', 'fetch_text');
    const nameMismatchResponse = await mcp.fetch(nameMismatch);
    expect(nameMismatchResponse.status).toBe(400);
    expect((await json(nameMismatchResponse)).error).toMatchObject({ code: -32020 });

    const missingName = modernRequest('tools/call', { name: 'index_text', arguments: { text: 'x' } });
    missingName.headers.delete('mcp-name');
    const missingNameResponse = await mcp.fetch(missingName);
    expect(missingNameResponse.status).toBe(400);
    expect((await json(missingNameResponse)).error).toMatchObject({ code: -32020 });

    const malformed = new Request('https://localhost/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
      },
      body: '{not-json',
    });
    expect((await mcp.fetch(malformed)).status).toBe(400);

    const cancelled = new AbortController();
    cancelled.abort();
    const cancelledRequest = new Request('https://localhost/mcp', {
      method: 'POST',
      signal: cancelled.signal,
      headers: { host: 'localhost', accept: 'application/json', 'content-type': 'application/json' },
      body: '{}',
    });
    expect((await mcp.fetch(cancelledRequest)).status).toBe(499);
  });

  it('stops reading a chunked body as soon as the byte limit is crossed', async () => {
    const mcp = await handler({
      allowedHostnames: ['localhost'],
      allowUnauthenticatedLoopback: true,
      maxRequestBytes: 1024,
    });
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new Uint8Array(1025));
          return;
        }
        throw new Error('body was read past the configured limit');
      },
    });
    const response = await mcp.fetch(new Request('https://localhost/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }));
    expect(response.status).toBe(413);
    expect(pulls).toBe(1);
  });

  it('enforces the configured timeout while the request body is still streaming', async () => {
    const mcp = await handler({
      allowedHostnames: ['localhost'],
      allowUnauthenticatedLoopback: true,
      timeoutMs: 25,
    });
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
    });
    const response = await mcp.fetch(new Request('https://localhost/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
      },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }));
    expect(response.status).toBe(504);
    expect((await json(response)).error).toMatchObject({ code: -32603, message: 'MCP request timed out' });
  });

  it('includes Bearer verification in the same request deadline budget', async () => {
    const verifier: OAuthTokenVerifier = {
      async verifyAccessToken(): Promise<AuthInfo> {
        return new Promise<AuthInfo>(() => undefined);
      },
    };
    const mcp = await handler({
      allowedHostnames: ['localhost'],
      bearerAuth: { verifier, requiredScopes: ['mcp'] },
      timeoutMs: 25,
    });
    const request = modernRequest('tools/list', {});
    request.headers.set('authorization', 'Bearer opaque-test-token');
    const response = await mcp.fetch(request);
    expect(response.status).toBe(504);
    expect((await json(response)).error).toMatchObject({ code: -32603, message: 'MCP request timed out' });
    expect(getProductionMcpRuntimeEvidence(mcp)).toMatchObject({
      requests: 1,
      dispatchedRequests: 0,
      bearerAuthConfigured: true,
      bearerAuthSuccesses: 0,
    });
  });

  it('keeps the 2025 stateless fallback available through the secured boundary', async () => {
    const mcp = await handler();
    const response = await mcp.fetch(new Request('https://localhost/mcp', {
      method: 'POST',
      headers: { host: 'localhost', accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toContain('"protocolVersion":"2025-11-25"');
  });

  it('uses the official Bearer middleware and does not expose token material', async () => {
    const verifier: OAuthTokenVerifier = {
      async verifyAccessToken(token): Promise<AuthInfo> {
        if (token !== 'valid-test-token') throw new OAuthError(OAuthErrorCode.InvalidToken, 'invalid token');
        return {
          token,
          clientId: 'test-client',
          scopes: ['mcp'],
          expiresAt: Math.floor(Date.now() / 1000) + 60,
        };
      },
    };
    const mcp = await handler({
      allowedHostnames: ['localhost'],
      bearerAuth: { verifier, requiredScopes: ['mcp'], resourceMetadataUrl: 'https://localhost/.well-known/oauth-protected-resource/mcp' },
    });

    const missing = await mcp.fetch(modernRequest('tools/list', {}));
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toContain('Bearer');

    const invalidRequest = modernRequest('tools/list', {});
    invalidRequest.headers.set('authorization', 'Bearer invalid-test-token');
    const invalid = await mcp.fetch(invalidRequest);
    expect(invalid.status).toBe(401);
    expect(await invalid.text()).not.toContain('invalid-test-token');

    const validRequest = modernRequest('tools/list', {});
    validRequest.headers.set('authorization', 'Bearer valid-test-token');
    expect((await mcp.fetch(validRequest)).status).toBe(200);

    const runtimeEvidence = getProductionMcpRuntimeEvidence(mcp);
    expect(runtimeEvidence).toMatchObject({
      requests: 3,
      dispatchedRequests: 1,
      bearerAuthConfigured: true,
      bearerAuthSuccesses: 1,
      oauthMetadataConfigured: false,
      oauthMetadataResponses: 0,
    });
    expect(JSON.stringify(runtimeEvidence)).not.toContain('valid-test-token');
    expect(JSON.stringify(runtimeEvidence)).not.toContain('test-client');
  });

  it('makes resource-audience enforcement an explicit host verifier contract', async () => {
    const expectedResource = 'https://localhost/mcp';
    const tokenAudiences = new Map<string, string>([
      ['token-for-furypipe', expectedResource],
      ['token-for-other-resource', 'https://other.example.test/mcp'],
    ]);
    const verifier: OAuthTokenVerifier = {
      async verifyAccessToken(token): Promise<AuthInfo> {
        if (tokenAudiences.get(token) !== expectedResource) {
          throw new OAuthError(OAuthErrorCode.InvalidToken, 'token audience does not match FuryPipe MCP');
        }
        return {
          token,
          clientId: 'audience-test-client',
          scopes: ['mcp'],
          expiresAt: Math.floor(Date.now() / 1000) + 60,
        };
      },
    };
    const mcp = await handler({
      allowedHostnames: ['localhost'],
      bearerAuth: {
        verifier,
        requiredScopes: ['mcp'],
        resourceMetadataUrl: 'https://localhost/.well-known/oauth-protected-resource/mcp',
      },
    });

    const wrongAudience = modernRequest('tools/list', {});
    wrongAudience.headers.set('authorization', 'Bearer token-for-other-resource');
    expect((await mcp.fetch(wrongAudience)).status).toBe(401);

    const correctAudience = modernRequest('tools/list', {});
    correctAudience.headers.set('authorization', 'Bearer token-for-furypipe');
    expect((await mcp.fetch(correctAudience)).status).toBe(200);
  });

  it('serves OAuth discovery only when configured and keeps the endpoint stateless', async () => {
    const mcp = await handler({
      allowedHostnames: ['localhost'],
      bearerAuth: {
        verifier: {
          async verifyAccessToken(): Promise<AuthInfo> {
            throw new OAuthError(OAuthErrorCode.InvalidToken, 'not used');
          },
        },
      },
      oauthMetadata: {
        oauthMetadata: {
          issuer: 'https://auth.example.test',
          authorization_endpoint: 'https://auth.example.test/authorize',
          token_endpoint: 'https://auth.example.test/token',
          response_types_supported: ['code'],
        },
        resourceServerUrl: new URL('https://localhost/mcp'),
        scopesSupported: ['mcp'],
        resourceName: 'FuryPipe recovery',
      },
    });
    const response = await mcp.fetch(new Request('https://localhost/.well-known/oauth-protected-resource/mcp', {
      headers: { host: 'localhost' },
    }));
    expect(response.status).toBe(200);
    expect((await json(response)).resource).toBe('https://localhost/mcp');
    expect(getProductionMcpRuntimeEvidence(mcp)).toMatchObject({
      requests: 1,
      dispatchedRequests: 0,
      bearerAuthConfigured: true,
      bearerAuthSuccesses: 0,
      oauthMetadataConfigured: true,
      oauthMetadataResponses: 1,
    });
  });
});
