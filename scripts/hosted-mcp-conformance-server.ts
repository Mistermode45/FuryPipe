import { timingSafeEqual } from 'node:crypto';
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { createRecoveryStore, type RecoveryStore } from '../src/core/recovery-store.js';
import { listenMcpHttpNode } from '../src/mcp-http-node.js';
import { HOSTED_MCP_TIMEOUT_TEST_HANDLE } from '../src/hosted-mcp-conformance.js';

const SHA40 = /^[0-9a-f]{40}$/u;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

if (process.env.FURYPIPE_ALLOW_HOSTED_MCP_CONFORMANCE_SERVER !== '1') {
  throw new Error('set FURYPIPE_ALLOW_HOSTED_MCP_CONFORMANCE_SERVER=1 to start the conformance-only hosted server');
}

const sourceCommit = required('FURYPIPE_SOURCE_COMMIT');
if (!SHA40.test(sourceCommit)) throw new Error('FURYPIPE_SOURCE_COMMIT must be a lowercase 40-character commit SHA');

const token = required('FURYPIPE_HOSTED_MCP_BEARER_TOKEN');
if (token.length < 16 || token.length > 4096 || token.includes('\0')) {
  throw new Error('FURYPIPE_HOSTED_MCP_BEARER_TOKEN must be a bounded secret');
}
const expectedToken = Buffer.from(token, 'utf8');

const allowedHostnames = required('FURYPIPE_HOSTED_MCP_ALLOWED_HOSTNAMES')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
if (allowedHostnames.length < 1 || allowedHostnames.length > 32) {
  throw new Error('FURYPIPE_HOSTED_MCP_ALLOWED_HOSTNAMES must contain 1 to 32 hostnames');
}

const host = process.env.FURYPIPE_HOSTED_MCP_BIND_HOST?.trim() || '0.0.0.0';
const port = integer('FURYPIPE_HOSTED_MCP_PORT', 47823, 1, 65_535);
const timeoutMs = integer('FURYPIPE_HOSTED_MCP_TIMEOUT_MS', 100, 50, 5_000);
const delayedMs = Math.max(timeoutMs + 100, integer('FURYPIPE_HOSTED_MCP_DELAY_MS', 350, 150, 10_000));
const root = process.env.FURYPIPE_RECOVERY_ROOT?.trim() || `${process.cwd()}/.furypipe/hosted-mcp-conformance`;
const namespace = process.env.FURYPIPE_TENANT?.trim() || 'hosted-conformance';

const baseStore = createRecoveryStore(root, { namespace });
const store: RecoveryStore = {
  ...baseStore,
  async verify(handle) {
    if (handle === HOSTED_MCP_TIMEOUT_TEST_HANDLE) {
      await new Promise((resolve) => setTimeout(resolve, delayedMs));
    }
    return baseStore.verify(handle);
  },
};

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(candidate): Promise<AuthInfo> {
    const received = Buffer.from(candidate, 'utf8');
    if (received.byteLength !== expectedToken.byteLength || !timingSafeEqual(received, expectedToken)) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, 'invalid hosted conformance token');
    }
    return {
      token: candidate,
      clientId: 'furypipe-hosted-conformance-client',
      scopes: ['mcp'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
  },
};

const listener = await listenMcpHttpNode(store, {
  host,
  port,
  path: '/mcp',
  sourceCommit,
  allowedHostnames,
  allowedOriginHostnames: allowedHostnames,
  bearerAuth: {
    verifier,
    requiredScopes: ['mcp'],
  },
  timeoutMs,
});

const address = listener.address();
const display = typeof address === 'object' && address !== null
  ? `${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}`
  : `${host}:${port}`;

console.log(`[furypipe-hosted-mcp-conformance] listening on ${display}/mcp`);
console.log('[furypipe-hosted-mcp-conformance] static Bearer auth is validation-only and does not prove OAuth Authorization Server conformance');
console.log(`[furypipe-hosted-mcp-conformance] source commit ${sourceCommit}`);

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log(`[furypipe-hosted-mcp-conformance] ${signal} — shutting down`);
  await listener.close();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
