import { timingSafeEqual } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecoveryStore, type RecoveryStore } from '../src/core/recovery-store.js';
import {
  HOSTED_MCP_TIMEOUT_TEST_HANDLE,
  probeHostedMcpConformance,
} from '../src/hosted-mcp-conformance.js';
import { listenMcpHttpNode, type NodeMcpHttpServer } from '../src/mcp-http-node.js';

const roots: string[] = [];
const listeners: NodeMcpHttpServer[] = [];
const sourceCommit = 'a'.repeat(40);
const bearerToken = 'furypipe-hosted-test-token-0001';
const publicHostname = 'mcp.example.test';

afterEach(async () => {
  await Promise.all(listeners.splice(0).map((listener) => listener.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function verifier(expected: string): OAuthTokenVerifier {
  const expectedBytes = Buffer.from(expected);
  return {
    async verifyAccessToken(candidate): Promise<AuthInfo> {
      const received = Buffer.from(candidate);
      if (received.byteLength !== expectedBytes.byteLength || !timingSafeEqual(received, expectedBytes)) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'invalid token');
      }
      return {
        token: candidate,
        clientId: 'hosted-test-client',
        scopes: ['mcp'],
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      };
    },
  };
}

async function hostedFixture(servedCommit = sourceCommit): Promise<{ endpoint: string; fetchImpl: typeof fetch }> {
  const root = await mkdtemp(join(tmpdir(), 'furypipe-hosted-mcp-'));
  roots.push(root);
  const base = createRecoveryStore(root, { namespace: 'hosted-test' });
  const store: RecoveryStore = {
    ...base,
    async verify(handle) {
      if (handle === HOSTED_MCP_TIMEOUT_TEST_HANDLE) {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      return base.verify(handle);
    },
  };
  const listener = await listenMcpHttpNode(store, {
    host: '127.0.0.1',
    port: 0,
    sourceCommit: servedCommit,
    allowedHostnames: [publicHostname],
    allowedOriginHostnames: [publicHostname],
    bearerAuth: { verifier: verifier(bearerToken), requiredScopes: ['mcp'] },
    timeoutMs: 50,
  });
  listeners.push(listener);
  const address = listener.address() as AddressInfo;
  const localUrl = `http://127.0.0.1:${address.port}/mcp`;

  const fetchImpl: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('host', publicHostname);
    return fetch(localUrl, { ...init, headers });
  };
  return { endpoint: `https://${publicHostname}/mcp`, fetchImpl };
}

describe('hosted MCP conformance probe', () => {
  it('verifies modern/legacy protocol, source binding, auth negatives, read-only call, timeout and cancellation', async () => {
    const fixture = await hostedFixture();
    const report = await probeHostedMcpConformance({
      endpoint: fixture.endpoint,
      bearerToken,
      expectedSourceCommit: sourceCommit,
      fetchImpl: fixture.fetchImpl,
      cancellationDelayMs: 5,
      now: () => 123,
    });

    expect(report).toMatchObject({
      format: 'furypipe-hosted-mcp-conformance/v1',
      generatedAt: 123,
      sourceCommit,
      requestExecuted: true,
      status: 'VERIFIED',
      network: { remoteEndpoint: true, scheme: 'https', tls: 'VERIFIED', dns: 'VERIFIED' },
      sourceBinding: { verified: true },
      auth: {
        missingBearerRejected: true,
        invalidBearerRejected: true,
        validBearerAccepted: true,
        oauthAuthorizationServerTested: false,
      },
      protocol: {
        modernDiscover: true,
        toolsList: true,
        readOnlyToolCall: true,
        reconnectRoundTrip: true,
        legacyFallback: true,
      },
      resilience: { timeoutPath: true, cancellationPath: true },
      privacy: { bearerTokenRecorded: false, responseBodiesRecorded: false },
    });
    expect(JSON.stringify(report)).not.toContain(bearerToken);
  });

  it('blocks promotion when the hosted listener serves a different source commit', async () => {
    const fixture = await hostedFixture('b'.repeat(40));
    const report = await probeHostedMcpConformance({
      endpoint: fixture.endpoint,
      bearerToken,
      expectedSourceCommit: sourceCommit,
      fetchImpl: fixture.fetchImpl,
      cancellationDelayMs: 5,
    });
    expect(report.status).toBe('BLOCKED');
    expect(report.sourceBinding.verified).toBe(false);
  });

  it('rejects loopback endpoints and keeps insecure remote HTTP below VERIFIED', async () => {
    await expect(probeHostedMcpConformance({
      endpoint: 'https://127.0.0.1:47823/mcp',
      bearerToken,
      expectedSourceCommit: sourceCommit,
    })).rejects.toThrow('non-loopback');

    const fixture = await hostedFixture();
    const report = await probeHostedMcpConformance({
      endpoint: fixture.endpoint.replace('https:', 'http:'),
      bearerToken,
      expectedSourceCommit: sourceCommit,
      allowInsecureHttp: true,
      fetchImpl: fixture.fetchImpl,
      cancellationDelayMs: 5,
    });
    expect(report.status).toBe('PARTIAL');
    expect(report.network.tls).toBe('NOT_EXECUTED');
  });
});
