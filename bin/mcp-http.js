#!/usr/bin/env node
import { createRecoveryStore } from '../dist/core/recovery-store.js';
import { listenMcpHttpNode } from '../dist/mcp-http-node.js';

function positiveInteger(name, fallback, maximum) {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be an integer from 0 to ${maximum}`);
  }
  return value;
}

const host = process.env.FURYPIPE_MCP_HTTP_HOST?.trim() || '127.0.0.1';
const port = positiveInteger('FURYPIPE_MCP_HTTP_PORT', 47822, 65_535);
const root = process.env.FURYPIPE_RECOVERY_ROOT?.trim() || `${process.cwd()}/.furypipe/recovery`;
const namespace = process.env.FURYPIPE_TENANT?.trim() || 'default';
if (process.env.FURYPIPE_MCP_HTTP_ALLOW_UNAUTH_LOOPBACK !== '1') {
  throw new Error('set FURYPIPE_MCP_HTTP_ALLOW_UNAUTH_LOOPBACK=1 for the explicit local mode');
}

const listener = await listenMcpHttpNode(createRecoveryStore(root, { namespace }), {
  host,
  port,
  allowedHostnames: ['127.0.0.1', 'localhost', '[::1]'],
  allowUnauthenticatedLoopback: true,
});
const address = listener.address();
const display = typeof address === 'object' && address !== null
  ? `http://${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}/mcp`
  : `http://${host}:${port}/mcp`;
console.log(`[furypipe-mcp-http] listening on ${display}`);

let stopping = false;
const shutdown = async (signal) => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log(`[furypipe-mcp-http] ${signal} — shutting down`);
  await listener.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
