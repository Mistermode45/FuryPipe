import dns from 'node:dns/promises';
import net from 'node:net';
import { boundedText, hasExplicitOptIn, isPresent, presence, sourceCommit, writeEvidence } from './external-validation-common.mjs';

const MAX_BODY_BYTES = 1_048_576;
const endpointValue = boundedText(process.env.FURYPIPE_REMOTE_MCP_ENDPOINT, 2_048);
const allowedHostname = boundedText(process.env.FURYPIPE_REMOTE_MCP_ALLOWED_HOSTNAME, 253)?.toLowerCase();
const baseEvidence = {
  format: 'furypipe-remote-mcp-live-validation/v1',
  sourceCommit: sourceCommit(),
  requestExecuted: false,
  externalMutation: false,
  credentialPresence: presence(['FURYPIPE_REMOTE_MCP_AUTH']),
  scope: 'read-only MCP initialize and tools/list; tools/call is deliberately not executed',
};

function privateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0);
  }
  const normalized = address.toLowerCase().split('%')[0];
  return normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
    || normalized.startsWith('ff')
    || normalized.includes('::ffff:10.')
    || normalized.includes('::ffff:127.');
}

function endpointUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('endpoint URL is invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('remote MCP endpoint must be HTTPS without credentials, query or fragment');
  }
  return url;
}

async function responseJson(response, allowEmpty = false) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new Error('remote MCP response exceeded the bounded limit');
  const text = new TextDecoder().decode(bytes).trim();
  const line = text.startsWith('data:') ? text.split(/\r?\n/u).find((item) => item.startsWith('data:'))?.slice(5).trim() : text;
  if (!line && allowEmpty) return {};
  if (!line) throw new Error('remote MCP response was empty');
  return JSON.parse(line);
}

async function rpc(url, body, headers = {}, notification = false) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(isPresent('FURYPIPE_REMOTE_MCP_AUTH') ? { authorization: process.env.FURYPIPE_REMOTE_MCP_AUTH.trim() } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('remote MCP HTTP status was not successful');
  if (notification && (response.status === 202 || response.status === 204)) {
    return { body: {}, sessionId: response.headers.get('mcp-session-id') };
  }
  return { body: await responseJson(response, notification), sessionId: response.headers.get('mcp-session-id') };
}

if (!hasExplicitOptIn('FURYPIPE_MCP_REMOTE_AUTHORIZED')) {
  await writeEvidence('mcp-remote.json', {
    ...baseEvidence,
    status: 'AUTHORIZATION_REQUIRED',
    reason: 'Set FURYPIPE_LIVE_VALIDATION=1 and FURYPIPE_MCP_REMOTE_AUTHORIZED=YES to authorize external MCP requests.',
  });
} else if (!endpointValue || !allowedHostname) {
  await writeEvidence('mcp-remote.json', {
    ...baseEvidence,
    status: 'BLOCKED_EXTERNAL_ENV',
    reason: 'FURYPIPE_REMOTE_MCP_ENDPOINT and exact FURYPIPE_REMOTE_MCP_ALLOWED_HOSTNAME are required.',
  });
  process.exitCode = 2;
} else {
  try {
    const endpoint = endpointUrl(endpointValue);
    if (endpoint.hostname.toLowerCase() !== allowedHostname) throw new Error('endpoint hostname does not match the exact allowlist');
    const addresses = (await dns.lookup(endpoint.hostname, { all: true })).map((entry) => entry.address);
    if (addresses.length === 0 || addresses.some(privateAddress)) throw new Error('endpoint resolved to a private or reserved address');
    const initialized = await rpc(endpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'furypipe-0.16.0-rc-validation', version: '0.16.0' },
      },
    });
    const sessionHeaders = initialized.sessionId ? { 'mcp-session-id': initialized.sessionId } : {};
    const initializedResult = initialized.body?.result;
    if (!initializedResult || typeof initializedResult !== 'object') throw new Error('initialize response omitted result');
    await rpc(endpoint, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, sessionHeaders, true);
    const listed = await rpc(endpoint, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, sessionHeaders);
    const tools = Array.isArray(listed.body?.result?.tools) ? listed.body.result.tools : undefined;
    if (!tools) throw new Error('tools/list response omitted tools');
    await writeEvidence('mcp-remote.json', {
      ...baseEvidence,
      status: 'PARTIAL',
      requestExecuted: true,
      resolvedAddressCount: addresses.length,
      initialize: 'VERIFIED',
      toolsList: 'VERIFIED',
      toolCount: tools.length,
      toolNames: tools.map((tool) => typeof tool?.name === 'string' ? tool.name : 'invalid').slice(0, 128),
      toolCallExecuted: false,
      limitation: 'This read-only probe does not prove third-party tool semantics, authorization, mutation safety, streaming, reconnect or production availability.',
    });
  } catch {
    await writeEvidence('mcp-remote.json', {
      ...baseEvidence,
      status: 'BLOCKED_EXTERNAL_ENV',
      requestExecuted: true,
      reason: 'Remote MCP validation failed; authorization values, request bodies and response bodies were not recorded.',
    });
    process.exitCode = 1;
  }
}
