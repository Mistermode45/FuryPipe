import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import { createRecoveryStore } from '../dist/core/recovery-store.js';
import { listenMcpHttpNode } from '../dist/mcp-http-node.js';

const SHA40 = /^[0-9a-f]{40}$/u;
const HOSTNAME = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(\`\${name} is required\`);
  return value;
}
function boundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/u.test(raw)) throw new Error(\`\${name} must be an integer\`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(\`\${name} must be between \${minimum} and \${maximum}\`);
  return value;
}
function exactSourceCommit() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().toLowerCase();
  if (!SHA40.test(commit)) throw new Error('git rev-parse HEAD did not return a lowercase 40-character SHA');
  const expected = process.env.FURYPIPE_SOURCE_COMMIT;
  if (expected !== undefined && expected !== commit) throw new Error(\`FURYPIPE_SOURCE_COMMIT mismatch: checkout is \${commit}\`);
  return commit;
}
function hostnames() {
  const publicHostname = required('FURYPIPE_HOSTED_MCP_PUBLIC_HOSTNAME').trim().toLowerCase();
  if (!HOSTNAME.test(publicHostname) || publicHostname === 'localhost' || publicHostname.endsWith('.local')) {
    throw new Error('FURYPIPE_HOSTED_MCP_PUBLIC_HOSTNAME must be a public-style DNS hostname');
  }
  const configured = (process.env.FURYPIPE_HOSTED_MCP_ALLOWED_HOSTNAMES ?? publicHostname).split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (configured.length === 0 || configured.length > 16 || configured.some((v) => !HOSTNAME.test(v))) throw new Error('FURYPIPE_HOSTED_MCP_ALLOWED_HOSTNAMES is invalid');
  return { publicHostname, allowedHostnames: [...new Set(configured)] };
}
function conformanceStore(base, sourceCommit, slowDelayMs) {
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'put') return async (bytes, metadata) => target.put(bytes, { ...(metadata ?? {}), furypipe_source_commit: sourceCommit });
      if (property === 'manifest') return async (handle) => {
        const manifest = await target.manifest(handle);
        if (manifest?.metadata?.furypipe_conformance_case === 'slow') await delay(slowDelayMs);
        return manifest;
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
async function main() {
  if (process.env.FURYPIPE_ALLOW_HOSTED_MCP_CONFORMANCE_TARGET !== '1') throw new Error('set FURYPIPE_ALLOW_HOSTED_MCP_CONFORMANCE_TARGET=1 to start the isolated conformance target');
  const token = required('FURYPIPE_HOSTED_MCP_BEARER_TOKEN');
  if (token.length < 32 || token.length > 4096) throw new Error('FURYPIPE_HOSTED_MCP_BEARER_TOKEN must contain between 32 and 4096 characters');
  const recoveryRoot = resolve(required('FURYPIPE_HOSTED_MCP_RECOVERY_ROOT'));
  const bindHost = process.env.FURYPIPE_HOSTED_MCP_BIND_HOST ?? '0.0.0.0';
  const port = boundedInteger('FURYPIPE_HOSTED_MCP_PORT', 47823, 1, 65535);
  const timeoutMs = boundedInteger('FURYPIPE_HOSTED_MCP_SERVER_TIMEOUT_MS', 500, 50, 30000);
  const slowDelayMs = boundedInteger('FURYPIPE_HOSTED_MCP_SLOW_DELAY_MS', 1500, timeoutMs + 50, 60000);
  const { publicHostname, allowedHostnames } = hostnames();
  const sourceCommit = exactSourceCommit();
  const store = conformanceStore(createRecoveryStore(recoveryRoot, { namespace: 'hosted-mcp-conformance' }), sourceCommit, slowDelayMs);
  const verifier = {
    async verifyAccessToken(candidate) {
      if (candidate !== token) throw new OAuthError(OAuthErrorCode.InvalidToken, 'invalid hosted conformance token');
      return { token: candidate, clientId: 'furypipe-hosted-conformance-client', scopes: ['mcp'], expiresAt: Math.floor(Date.now() / 1000) + 300 };
    },
  };
  const listener = await listenMcpHttpNode(store, {
    host: bindHost, port, path: '/mcp', allowedHostnames,
    bearerAuth: { verifier, requiredScopes: ['mcp'] },
    timeoutMs,
  });
  process.stdout.write(\`\${JSON.stringify({
    format: 'furypipe-hosted-mcp-conformance-target/v1',
    sourceCommit, bindHost, port, publicHostname, allowedHostnames, path: '/mcp',
    timeoutMs, slowDelayMs,
    auth: 'ephemeral-static-bearer-for-conformance-only',
    oauthAuthorizationServerClaim: false,
    tlsExpectedAtReverseProxy: true,
  }, null, 2)}\n\`);
  let closing = false;
  const close = async (signal) => {
    if (closing) return;
    closing = true;
    process.stdout.write(\`Hosted MCP conformance target shutting down (\${signal})\n\`);
    await listener.close();
    process.exitCode = 0;
  };
  process.once('SIGINT', () => void close('SIGINT'));
  process.once('SIGTERM', () => void close('SIGTERM'));
}
main().catch((error) => {
  console.error(\`Hosted MCP conformance target failed: \${error instanceof Error ? error.message : String(error)}\`);
  process.exitCode = 1;
});
