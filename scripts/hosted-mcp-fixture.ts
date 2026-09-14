import { timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { createRecoveryStore } from '../src/core/recovery-store.js';
import { listenMcpHttpNode } from '../src/mcp-http-node.js';
import { HOSTED_MCP_READ_ONLY_FIXTURE_TEXT } from './hosted-mcp-fixture-constants.js';

const SHA40 = /^[0-9a-f]{40}$/u;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function exactTokenMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.byteLength === expectedBytes.byteLength
    && timingSafeEqual(actualBytes, expectedBytes);
}

function checkoutSha(): string {
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!SHA40.test(actual)) throw new Error('git HEAD must be a lowercase 40-character SHA');
  const configured = process.env.FURYPIPE_SOURCE_COMMIT?.trim();
  if (configured !== undefined && configured !== '') {
    if (!SHA40.test(configured)) throw new Error('FURYPIPE_SOURCE_COMMIT must be a lowercase 40-character SHA');
    if (configured !== actual) throw new Error('FURYPIPE_SOURCE_COMMIT does not match checkout HEAD');
  }
  return actual;
}

if (process.env.FURYPIPE_ALLOW_HOSTED_MCP_FIXTURE !== '1') {
  throw new Error('set FURYPIPE_ALLOW_HOSTED_MCP_FIXTURE=1 to start the hosted MCP conformance fixture');
}

const token = requiredEnv('FURYPIPE_HOSTED_MCP_BEARER_TOKEN');
if (token.length < 16 || token.length > 4096) {
  throw new Error('FURYPIPE_HOSTED_MCP_BEARER_TOKEN must contain 16..4096 characters');
}
const allowedHostnames = requiredEnv('FURYPIPE_HOSTED_MCP_ALLOWED_HOSTNAMES')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
if (allowedHostnames.length === 0 || allowedHostnames.length > 16) {
  throw new Error('FURYPIPE_HOSTED_MCP_ALLOWED_HOSTNAMES must contain 1..16 hostnames');
}

const sourceCommit = checkoutSha();
const host = process.env.FURYPIPE_HOSTED_MCP_HOST?.trim() || '127.0.0.1';
const port = boundedInteger('FURYPIPE_HOSTED_MCP_PORT', 47822, 1, 65_535);
const timeoutMs = boundedInteger('FURYPIPE_HOSTED_MCP_TIMEOUT_MS', 1500, 100, 30_000);
const root = process.env.FURYPIPE_RECOVERY_ROOT?.trim()
  || `${process.cwd()}/.furypipe/hosted-mcp-conformance`;
const namespace = process.env.FURYPIPE_TENANT?.trim() || 'hosted-conformance';

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(candidate: string): Promise<AuthInfo> {
    if (!exactTokenMatch(candidate, token)) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, 'invalid token');
    }
    return {
      token: candidate,
      clientId: 'furypipe-hosted-mcp-conformance',
      scopes: ['mcp'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
  },
};

const store = createRecoveryStore(root, { namespace });
const readOnlyFixture = await store.put(
  new TextEncoder().encode(HOSTED_MCP_READ_ONLY_FIXTURE_TEXT),
  { purpose: 'hosted-mcp-conformance', immutableFixture: true },
);
const readOnlyFixtureHandle = `furypipe-recovery/v1/sha256/${readOnlyFixture.digest}`;

const listener = await listenMcpHttpNode(store, {
  host,
  port,
  allowedHostnames,
  bearerAuth: {
    verifier,
    requiredScopes: ['mcp'],
  },
  timeoutMs,
  sourceCommit,
});

const address = listener.address();
process.stdout.write(`${JSON.stringify({
  format: 'furypipe-hosted-mcp-fixture/v1',
  status: 'LISTENING',
  sourceCommit,
  listener: typeof address === 'object' && address !== null
    ? { address: address.address, port: address.port, path: '/mcp' }
    : { address: host, port, path: '/mcp' },
  allowedHostnames,
  timeoutMs,
  readOnlyFixture: {
    tool: 'verify_handle',
    handle: readOnlyFixtureHandle,
  },
  auth: {
    mode: 'static-conformance-bearer',
    oauthAuthorizationServer: false,
  },
  tls: {
    terminatedByFixture: false,
    expectation: 'terminate HTTPS at the trusted reverse proxy before external validation',
  },
})}\n`);

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`${JSON.stringify({
    format: 'furypipe-hosted-mcp-fixture/v1',
    status: 'STOPPING',
    sourceCommit,
    signal,
  })}\n`);
  await listener.close();
};

process.once('SIGINT', () => void shutdown('SIGINT').finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown('SIGTERM').finally(() => process.exit(0)));
