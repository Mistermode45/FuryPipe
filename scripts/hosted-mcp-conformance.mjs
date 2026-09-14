import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const MODERN = '2026-07-28';
const LEGACY = '2025-11-25';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SHA40 = /^[0-9a-f]{40}$/u;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
function envInt(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/u.test(raw)) throw new Error(name + ' must be an integer');
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(name + ' is out of bounds');
  return n;
}
export function isForbiddenHostedMcpHostname(hostname) {
  const value = hostname.trim().toLowerCase().replace(/^\[|\]$/gu, '');
  if (!value || value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local')) return true;
  if (isIP(value) === 4) {
    const p = value.split('.').map(Number);
    return p[0] === 127 || (p[0] === 169 && p[1] === 254);
  }
  if (isIP(value) === 6) return value === '::1' || value.startsWith('fe80:');
  return false;
}
export function isForbiddenResolvedAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const p = address.split('.').map(Number);
    return p[0] === 0
      || p[0] === 10
      || p[0] === 127
      || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
      || (p[0] === 169 && p[1] === 254)
      || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
      || (p[0] === 192 && p[1] === 168)
      || (p[0] === 198 && (p[1] === 18 || p[1] === 19))
      || p[0] >= 224;
  }
  if (family === 6) {
    const value = address.toLowerCase();
    return value === '::' || value === '::1'
      || value.startsWith('fc') || value.startsWith('fd')
      || /^fe[89ab]/u.test(value)
      || value.startsWith('ff');
  }
  return true;
}
export function parseHostedMcpTarget(raw, options = {}) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('FURYPIPE_HOSTED_MCP_URL must be an absolute URL'); }
  if (url.username || url.password) throw new Error('credentials in the MCP URL are forbidden');
  if (url.search || url.hash) throw new Error('query strings and fragments are forbidden on the MCP endpoint');
  const allowHttp = options.allowInsecureHttp === true;
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) throw new Error('hosted MCP conformance requires HTTPS');
  if (isForbiddenHostedMcpHostname(url.hostname)) throw new Error('hosted MCP conformance refuses loopback, link-local, localhost and mDNS targets');
  return url;
}
function modernMeta() {
  return {
    'io.modelcontextprotocol/protocolVersion': MODERN,
    'io.modelcontextprotocol/clientInfo': { name: 'furypipe-hosted-conformance', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}
export function modernRpcBody(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params: { ...params, _meta: modernMeta() } };
}
export function parseRpcPayloadText(text, contentType = '') {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('MCP response body is empty');
  if (contentType.toLowerCase().includes('application/json')) return JSON.parse(trimmed);
  try { return JSON.parse(trimmed); } catch {}
  for (const line of text.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trimStart();
    if (!data || data === '[DONE]') continue;
    try { return JSON.parse(data); } catch {}
  }
  throw new Error('MCP response was neither JSON nor a parseable SSE JSON frame');
}
async function decodeResponse(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('MCP response exceeds 2 MiB');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let payload;
  if (text) {
    try { payload = parseRpcPayloadText(text, response.headers.get('content-type') || ''); } catch {}
  }
  return { status: response.status, payload, wwwAuthenticate: response.headers.get('www-authenticate') };
}
function headers(method, token, toolName) {
  const value = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'mcp-protocol-version': MODERN,
    'mcp-method': method,
    'user-agent': 'furypipe-hosted-conformance/1',
  };
  if (toolName) value['mcp-name'] = toolName;
  if (token) value.authorization = 'Bearer ' + token;
  return value;
}
async function rpc(url, options) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 15000;
  const timer = setTimeout(() => controller.abort(new DOMException('request timeout', 'TimeoutError')), timeoutMs);
  try {
    const modern = options.modern !== false;
    const body = modern
      ? modernRpcBody(options.id, options.method, options.params || {})
      : { jsonrpc: '2.0', id: options.id, method: options.method, params: options.params || {} };
    const requestHeaders = modern
      ? headers(options.method, options.token, options.method === 'tools/call' ? options.params?.name : undefined)
      : {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'user-agent': 'furypipe-hosted-conformance/1',
          ...(options.token ? { authorization: 'Bearer ' + options.token } : {}),
        };
    const response = await fetch(url, {
      method: 'POST', headers: requestHeaders, body: JSON.stringify(body),
      signal: controller.signal, redirect: 'error',
    });
    return await decodeResponse(response);
  } finally {
    clearTimeout(timer);
  }
}
function toolText(payload) {
  const items = payload?.result?.content;
  if (!Array.isArray(items)) throw new Error('tools/call result has no content array');
  const item = items.find((entry) => entry?.type === 'text' && typeof entry.text === 'string');
  if (!item) throw new Error('tools/call result has no text item');
  return item.text;
}
function handleFrom(payload) {
  const value = JSON.parse(toolText(payload));
  if (typeof value?.handle !== 'string' || !value.handle || value.handle.length > 160) throw new Error('index_text returned an invalid handle');
  return value.handle;
}
async function authProbe(url, token) {
  const missing = await rpc(url, { id: 'auth-missing', method: 'server/discover' });
  const invalid = await rpc(url, { id: 'auth-invalid', method: 'server/discover', token: 'invalid-' + randomBytes(24).toString('hex') });
  const challenge = ((missing.wwwAuthenticate || '') + ' ' + (invalid.wwwAuthenticate || '')).toLowerCase();
  return {
    missingRejected: missing.status === 401,
    invalidRejected: invalid.status === 401,
    bearerChallengeObserved: challenge.includes('bearer'),
    validTokenConfigured: Boolean(token),
  };
}
async function modernCycle(url, token, createFixture = true) {
  const discover = await rpc(url, { id: 'discover', method: 'server/discover', token });
  if (discover.status !== 200 || discover.payload?.error) throw new Error('server/discover failed');
  if (!Array.isArray(discover.payload?.result?.supportedVersions) || !discover.payload.result.supportedVersions.includes(MODERN)) {
    throw new Error('server/discover did not advertise MCP ' + MODERN);
  }
  const listed = await rpc(url, { id: 'tools-list', method: 'tools/list', params: {}, token });
  if (listed.status !== 200 || listed.payload?.error || !Array.isArray(listed.payload?.result?.tools)) throw new Error('tools/list failed');
  const names = new Set(listed.payload.result.tools.map((tool) => tool?.name));
  for (const name of ['index_text', 'fetch_text', 'manifest', 'delete_handle']) {
    if (!names.has(name)) throw new Error('required MCP tool missing: ' + name);
  }
  const base = { discoverVerified: true, toolsListVerified: true, protocolVersion: MODERN, toolCount: names.size };
  if (!createFixture) return base;

  const challenge = 'furypipe-hosted-' + randomBytes(24).toString('hex');
  const indexed = await rpc(url, {
    id: 'index-source', method: 'tools/call', token,
    params: { name: 'index_text', arguments: { text: challenge, metadata: { furypipe_conformance_case: 'source' } } },
  });
  if (indexed.status !== 200 || indexed.payload?.error) throw new Error('index_text failed');
  const handle = handleFrom(indexed.payload);
  const fetched = await rpc(url, {
    id: 'fetch-source', method: 'tools/call', token,
    params: { name: 'fetch_text', arguments: { handle } },
  });
  if (fetched.status !== 200 || fetched.payload?.error || toolText(fetched.payload) !== challenge) throw new Error('read-only fetch verification failed');
  const manifest = await rpc(url, {
    id: 'manifest-source', method: 'tools/call', token,
    params: { name: 'manifest', arguments: { handle } },
  });
  if (manifest.status !== 200 || manifest.payload?.error) throw new Error('manifest failed');
  const manifestValue = JSON.parse(toolText(manifest.payload));
  const serverSourceCommit = manifestValue?.metadata?.furypipe_source_commit;
  if (typeof serverSourceCommit !== 'string' || !SHA40.test(serverSourceCommit)) throw new Error('server source binding missing');
  return { ...base, readOnlyFetchVerified: true, sourceBoundManifestVerified: true, serverSourceCommit, sourceHandle: handle };
}
async function legacyProbe(url, token) {
  const response = await rpc(url, {
    id: 'legacy-initialize', method: 'initialize', modern: false, token,
    params: {
      protocolVersion: LEGACY, capabilities: {},
      clientInfo: { name: 'furypipe-hosted-conformance-legacy', version: '1.0.0' },
    },
  });
  return {
    verified: response.status === 200 && !response.payload?.error && response.payload?.result?.protocolVersion === LEGACY,
    status: response.status,
    negotiatedProtocolVersion: response.payload?.result?.protocolVersion,
  };
}
async function createSlowFixture(url, token) {
  const response = await rpc(url, {
    id: 'index-slow', method: 'tools/call', token,
    params: {
      name: 'index_text',
      arguments: { text: 'furypipe-slow-' + randomBytes(24).toString('hex'), metadata: { furypipe_conformance_case: 'slow' } },
    },
  });
  if (response.status !== 200 || response.payload?.error) throw new Error('slow fixture creation failed');
  return handleFrom(response.payload);
}
async function timeoutProbe(url, token, handle) {
  const response = await rpc(url, {
    id: 'timeout', method: 'tools/call', token,
    params: { name: 'manifest', arguments: { handle } },
    timeoutMs: envInt('FURYPIPE_HOSTED_MCP_TIMEOUT_PROBE_CLIENT_MS', 5000, 100, 30000),
  });
  return {
    verified: response.status === 504 && response.payload?.error?.code === -32603 && response.payload?.error?.message === 'MCP request timed out',
    httpStatus: response.status,
    rpcCode: response.payload?.error?.code,
  };
}
async function cancellationProbe(url, token, handle) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('intentional cancellation', 'AbortError')),
    envInt('FURYPIPE_HOSTED_MCP_CANCEL_AFTER_MS', 100, 10, 5000));
  let clientAbortObserved = false;
  try {
    await fetch(url, {
      method: 'POST',
      headers: headers('tools/call', token, 'manifest'),
      body: JSON.stringify(modernRpcBody('cancel', 'tools/call', { name: 'manifest', arguments: { handle } })),
      signal: controller.signal,
      redirect: 'error',
    });
  } catch (error) {
    clientAbortObserved = controller.signal.aborted || error?.name === 'AbortError';
    if (!clientAbortObserved) throw error;
  } finally {
    clearTimeout(timer);
  }
  const recovery = await rpc(url, { id: 'after-cancel', method: 'tools/list', params: {}, token });
  return {
    clientAbortObserved,
    serviceRecovered: recovery.status === 200 && !recovery.payload?.error && Array.isArray(recovery.payload?.result?.tools),
  };
}
async function deleteHandle(url, token, handle, id) {
  if (!handle) return false;
  try {
    const response = await rpc(url, {
      id, method: 'tools/call', token,
      params: { name: 'delete_handle', arguments: { handle } },
    });
    return response.status === 200 && !response.payload?.error;
  } catch { return false; }
}
async function dnsProbe(url) {
  if (isIP(url.hostname)) {
    if (isForbiddenResolvedAddress(url.hostname)) throw new Error('hosted MCP target address is not public-routable');
    return { applicable: false, resolved: true, answerCount: 1, publicRoutable: true };
  }
  const answers = await lookup(url.hostname, { all: true, verbatim: true });
  if (!answers.length) throw new Error('DNS returned no answers');
  if (answers.some((answer) => isForbiddenResolvedAddress(answer.address))) {
    throw new Error('hosted MCP DNS resolved to a private, loopback, link-local, CGNAT, benchmark, multicast or reserved address');
  }
  return {
    applicable: true,
    resolved: true,
    publicRoutable: true,
    answerCount: answers.length,
    families: [...new Set(answers.map((v) => v.family))].sort(),
  };
}
async function tlsProbe(url) {
  if (url.protocol !== 'https:') return { applicable: false, authorized: false };
  const port = url.port ? Number(url.port) : 443;
  return await new Promise((resolvePromise, rejectPromise) => {
    const socket = tls.connect({
      host: url.hostname, port, servername: isIP(url.hostname) ? undefined : url.hostname,
      rejectUnauthorized: true, minVersion: 'TLSv1.2',
    });
    const timer = setTimeout(() => socket.destroy(new Error('TLS probe timed out')), 10000);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const cert = socket.getPeerCertificate();
      const cipher = socket.getCipher();
      const result = {
        applicable: true, authorized: socket.authorized,
        protocol: socket.getProtocol() || undefined,
        alpnProtocol: socket.alpnProtocol || undefined,
        cipher: cipher?.name,
        peerFingerprint256: typeof cert?.fingerprint256 === 'string' ? cert.fingerprint256 : undefined,
      };
      socket.end();
      resolvePromise(result);
    });
    socket.once('error', (error) => { clearTimeout(timer); rejectPromise(error); });
  });
}
async function reconnectChild() {
  const path = fileURLToPath(import.meta.url);
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [path, '--reconnect-child'], {
      env: { ...process.env, FURYPIPE_HOSTED_MCP_RECONNECT_CHILD: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 65536) child.kill('SIGKILL'); });
    child.stderr.on('data', (chunk) => { stderr += chunk; if (stderr.length > 65536) child.kill('SIGKILL'); });
    child.once('error', rejectPromise);
    child.once('exit', (code) => {
      if (code !== 0) return rejectPromise(new Error('reconnect child failed: ' + stderr.slice(0, 1024)));
      try { resolvePromise(JSON.parse(stdout)); } catch { rejectPromise(new Error('reconnect child returned invalid JSON')); }
    });
  });
}
export function evaluateHostedMcpEvidence(evidence) {
  const required = [
    evidence?.sourceBinding?.matchesClientSource === true,
    evidence?.network?.dns?.resolved === true,
    evidence?.network?.tls?.applicable === true,
    evidence?.network?.tls?.authorized === true,
    evidence?.auth?.missingRejected === true,
    evidence?.auth?.invalidRejected === true,
    evidence?.auth?.bearerChallengeObserved === true,
    evidence?.auth?.validTokenAccepted === true,
    evidence?.protocol?.modern?.discoverVerified === true,
    evidence?.protocol?.modern?.toolsListVerified === true,
    evidence?.protocol?.modern?.readOnlyFetchVerified === true,
    evidence?.protocol?.legacy?.verified === true,
    evidence?.reconnect?.verified === true,
    evidence?.resilience?.timeout?.verified === true,
    evidence?.resilience?.cancellation?.clientAbortObserved === true,
    evidence?.resilience?.cancellation?.serviceRecovered === true,
    evidence?.execution?.githubHostedBoundary === true,
  ];
  return required.every(Boolean) ? 'VERIFIED' : 'PARTIAL';
}
async function reconnectChildMain() {
  const raw = process.env.FURYPIPE_HOSTED_MCP_URL;
  const token = process.env.FURYPIPE_HOSTED_MCP_BEARER_TOKEN;
  if (!raw || !token) throw new Error('reconnect child requires URL and token');
  const url = parseHostedMcpTarget(raw, { allowInsecureHttp: process.env.FURYPIPE_HOSTED_MCP_ALLOW_INSECURE_HTTP === '1' });
  const cycle = await modernCycle(url, token, false);
  process.stdout.write(JSON.stringify({ ok: true, ...cycle }));
}
async function main() {
  if (process.argv.includes('--reconnect-child') || process.env.FURYPIPE_HOSTED_MCP_RECONNECT_CHILD === '1') {
    await reconnectChildMain();
    return;
  }
  const raw = process.env.FURYPIPE_HOSTED_MCP_URL;
  const token = process.env.FURYPIPE_HOSTED_MCP_BEARER_TOKEN;
  const sourceCommit = process.env.FURYPIPE_SOURCE_COMMIT;
  if (!raw || !token) throw new Error('FURYPIPE_HOSTED_MCP_URL and FURYPIPE_HOSTED_MCP_BEARER_TOKEN are required');
  if (!sourceCommit || !SHA40.test(sourceCommit)) throw new Error('FURYPIPE_SOURCE_COMMIT must be the exact lowercase candidate SHA');
  const url = parseHostedMcpTarget(raw, { allowInsecureHttp: process.env.FURYPIPE_HOSTED_MCP_ALLOW_INSECURE_HTTP === '1' });
  const outputDir = resolve(process.env.FURYPIPE_HOSTED_MCP_OUTPUT_DIR || 'artifacts/hosted-mcp-conformance');
  const outputPath = resolve(outputDir, 'hosted-mcp-conformance.json');
  let sourceHandle;
  let slowHandle;
  let cleanup = { sourceHandleDeleted: false, slowHandleDeleted: false };
  try {
    const dns = await dnsProbe(url);
    const tlsResult = await tlsProbe(url);
    const auth = await authProbe(url, token);
    const modern = await modernCycle(url, token, true);
    sourceHandle = modern.sourceHandle;
    if (modern.serverSourceCommit !== sourceCommit) throw new Error('hosted target source commit mismatch');
    slowHandle = await createSlowFixture(url, token);
    const timeout = await timeoutProbe(url, token, slowHandle);
    const cancellation = await cancellationProbe(url, token, slowHandle);
    const legacy = await legacyProbe(url, token);
    const reconnect = await reconnectChild();

    const evidence = {
      format: 'furypipe-hosted-mcp-conformance/v1',
      generatedAt: Date.now(),
      sourceCommit,
      execution: {
        githubActions: process.env.GITHUB_ACTIONS === 'true',
        githubHostedBoundary: process.env.GITHUB_ACTIONS === 'true'
          && process.env.GITHUB_REPOSITORY === 'Mistermode45/FuryPipe'
          && Boolean(process.env.RUNNER_OS),
        runId: process.env.GITHUB_RUN_ID || undefined,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT || undefined,
      },
      target: {
        scheme: url.protocol.slice(0, -1),
        hostSha256: sha256(url.hostname.toLowerCase()),
        port: Number(url.port || 443),
        path: url.pathname,
      },
      network: { dns, tls: tlsResult },
      sourceBinding: {
        clientSourceCommit: sourceCommit,
        serverSourceCommit: modern.serverSourceCommit,
        matchesClientSource: modern.serverSourceCommit === sourceCommit,
        mechanism: 'server-injected Recovery manifest metadata from git-derived target source',
      },
      auth: { ...auth, validTokenAccepted: modern.discoverVerified === true, tokenMaterialRecorded: false },
      protocol: {
        modern: {
          version: MODERN,
          discoverVerified: modern.discoverVerified,
          toolsListVerified: modern.toolsListVerified,
          readOnlyFetchVerified: modern.readOnlyFetchVerified,
          sourceBoundManifestVerified: modern.sourceBoundManifestVerified,
          toolCount: modern.toolCount,
        },
        legacy: { version: LEGACY, ...legacy },
      },
      reconnect: {
        verified: reconnect?.ok === true && reconnect?.protocolVersion === MODERN
          && reconnect?.discoverVerified === true && reconnect?.toolsListVerified === true,
        separateClientProcess: true,
      },
      resilience: { timeout, cancellation },
      cleanup,
      nonClaims: [
        'Does not verify a real OAuth Authorization Server, token issuance, JWKS, provider billing or production deployment.',
        'Client cancellation proves external abort plus subsequent service recovery, not synchronous cancellation of arbitrary internal work.',
      ],
    };
    evidence.status = evaluateHostedMcpEvidence(evidence);
    cleanup = {
      sourceHandleDeleted: await deleteHandle(url, token, sourceHandle, 'cleanup-source'),
      slowHandleDeleted: await deleteHandle(url, token, slowHandle, 'cleanup-slow'),
    };
    evidence.cleanup = cleanup;
    await mkdir(dirname(outputPath), { recursive: true });
    const serialized = JSON.stringify(evidence, null, 2) + '\n';
    await writeFile(outputPath, serialized, { mode: 0o600 });
    await writeFile(outputPath + '.sha256', sha256(serialized) + '  hosted-mcp-conformance.json\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify({
      format: evidence.format, status: evidence.status, sourceCommit,
      modern: MODERN, legacy: legacy.verified, reconnect: evidence.reconnect.verified,
      timeout: timeout.verified,
      cancellation: cancellation.clientAbortObserved && cancellation.serviceRecovered,
      outputPath,
    }, null, 2) + '\n');
    if (evidence.status !== 'VERIFIED') process.exitCode = 2;
  } finally {
    if (sourceHandle && !cleanup.sourceHandleDeleted) cleanup.sourceHandleDeleted = await deleteHandle(url, token, sourceHandle, 'cleanup-source-finally');
    if (slowHandle && !cleanup.slowHandleDeleted) cleanup.slowHandleDeleted = await deleteHandle(url, token, slowHandle, 'cleanup-slow-finally');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error('Hosted MCP conformance failed: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
