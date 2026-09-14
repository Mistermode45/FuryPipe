import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HOSTED_MCP_READ_ONLY_FIXTURE_TEXT } from './hosted-mcp-fixture-constants.js';

const INSPECTOR_PACKAGE = '@modelcontextprotocol/inspector';
const INSPECTOR_VERSION = '2.6.0';
const MODERN_PROTOCOL = '2026-07-28';
const LEGACY_PROTOCOL = '2025-11-25';
const SHA40 = /^[0-9a-f]{40}$/u;
const MAX_CHILD_OUTPUT_BYTES = 2 * 1024 * 1024;
const EXPECTED_TOOLS = Object.freeze([
  'index_text',
  'index_bytes',
  'fetch_text',
  'fetch_exact',
  'fetch_bytes',
  'fetch_bytes_base64',
  'fetch_range',
  'fetch_lines',
  'manifest',
  'delete_handle',
  'verify_handle',
].sort());

type CheckStatus = 'VERIFIED' | 'PARTIAL' | 'NOT_EXECUTED' | 'BLOCKED';

interface CheckEvidence {
  readonly status: CheckStatus;
  readonly details?: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

interface HostedMcpEvidence {
  readonly format: 'furypipe-hosted-mcp-conformance/v1';
  readonly generatedAt: number;
  readonly sourceCommit: string;
  readonly target: {
    readonly origin: string;
    readonly hostname: string;
    readonly protocol: 'https:' | 'http:';
    readonly port: number;
    readonly path: string;
  };
  readonly client: {
    readonly implementation: '@modelcontextprotocol/inspector';
    readonly version: string;
    readonly processBoundary: true;
    readonly runtimeHost: string;
    readonly boundary: string;
  };
  readonly checks: {
    readonly network: CheckEvidence;
    readonly sourceBinding: CheckEvidence;
    readonly modern: CheckEvidence;
    readonly modernTools: CheckEvidence;
    readonly readOnlyCall: CheckEvidence;
    readonly reconnect: CheckEvidence;
    readonly legacy: CheckEvidence;
    readonly legacyTools: CheckEvidence;
    readonly missingAuth: CheckEvidence;
    readonly invalidAuth: CheckEvidence;
    readonly slowBodyTimeout: CheckEvidence;
    readonly cancelReconnect: CheckEvidence;
  };
  readonly oauthAuthorizationServer: 'NOT_EXECUTED';
  readonly externalConformance: 'VERIFIED' | 'PARTIAL';
  readonly requestExecuted: boolean;
}

interface ChildResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sourceCommit(): string {
  const configured = process.env.FURYPIPE_SOURCE_COMMIT?.trim();
  const value = configured || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!SHA40.test(value)) throw new Error('source commit must be a lowercase 40-character SHA');
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (actual !== value) throw new Error('FURYPIPE_SOURCE_COMMIT does not match checkout HEAD');
  return value;
}

function safeTarget(raw: string): URL {
  const url = new URL(raw);
  if (url.username || url.password) throw new Error('hosted MCP URL must not embed credentials');
  if (url.hash || url.search) throw new Error('hosted MCP URL must not contain query or fragment');
  if (url.pathname !== '/mcp') throw new Error('hosted MCP URL must use the exact /mcp path');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('hosted MCP URL must use http(s)');
  if (url.protocol !== 'https:' && process.env.FURYPIPE_HOSTED_MCP_ALLOW_INSECURE_HTTP !== '1') {
    throw new Error('hosted MCP conformance requires HTTPS unless insecure HTTP is explicitly allowed for a PARTIAL run');
  }
  return url;
}

function isLoopbackHost(host: string): boolean {
  const value = host.toLowerCase().replace(/^\[|\]$/gu, '');
  return value === 'localhost' || value === '::1' || value.startsWith('127.');
}

function inspectorConfig(url: URL, token: string, protocolEra: 'modern' | 'legacy'): string {
  return JSON.stringify({
    mcpServers: {
      furypipe: {
        type: 'http',
        url: url.toString(),
        headers: {
          Authorization: `Bearer ${token}`,
        },
        protocolEra,
        connectionTimeout: 15_000,
        requestTimeout: 15_000,
      },
    },
  }, null, 2);
}

async function runChild(command: string, args: readonly string[], timeoutMs: number): Promise<ChildResult> {
  return await new Promise<ChildResult>((resolvePromise) => {
    const child = spawn(command, args, {
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let timedOut = false;
    const append = (current: string, chunk: Buffer): string => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_CHILD_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        return current;
      }
      return current + chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.once('error', () => {
      clearTimeout(timer);
      resolvePromise({ code: null, stdout, stderr, timedOut });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, timedOut });
    });
  });
}

function parseInspectorJson(result: ChildResult, label: string): Record<string, unknown> {
  if (result.timedOut || result.code !== 0) {
    throw new Error(`${label} failed (exit=${String(result.code)}, stdoutSha256=${hashText(result.stdout)}, stderrSha256=${hashText(result.stderr)})`);
  }
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} returned non-JSON output (stdoutSha256=${hashText(result.stdout)})`);
  }
}

function resultObject(value: Record<string, unknown>): Record<string, unknown> {
  const nested = value.result;
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : value;
}

async function runInspector(
  configPath: string,
  method: string,
  extraArgs: readonly string[] = [],
): Promise<Record<string, unknown>> {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = await runChild(npx, [
    '--yes',
    `${INSPECTOR_PACKAGE}@${INSPECTOR_VERSION}`,
    '--cli',
    '--config',
    configPath,
    '--server',
    'furypipe',
    '--method',
    method,
    '--stored-auth-only',
    '--format',
    'json',
    ...extraArgs,
  ], 60_000);
  return parseInspectorJson(result, `Inspector ${method}`);
}

function protocolVersion(value: Record<string, unknown>): string | undefined {
  const result = resultObject(value);
  return typeof result.protocolVersion === 'string' ? result.protocolVersion : undefined;
}

function toolNames(value: Record<string, unknown>): string[] {
  const result = resultObject(value);
  if (!Array.isArray(result.tools)) return [];
  return result.tools
    .flatMap((tool) => tool && typeof tool === 'object' && typeof (tool as Record<string, unknown>).name === 'string'
      ? [(tool as Record<string, unknown>).name as string]
      : [])
    .sort();
}

function exactToolSet(names: readonly string[]): boolean {
  return names.length === EXPECTED_TOOLS.length
    && names.every((name, index) => name === EXPECTED_TOOLS[index]);
}

function fixtureHandle(): string {
  const digest = createHash('sha256').update(HOSTED_MCP_READ_ONLY_FIXTURE_TEXT, 'utf8').digest('hex');
  return `furypipe-recovery/v1/sha256/${digest}`;
}

function modernHeaders(token?: string): Record<string, string> {
  return {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'mcp-protocol-version': MODERN_PROTOCOL,
    'mcp-method': 'tools/list',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function modernBody(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL,
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  });
}

async function rawModern(url: URL, token?: string): Promise<Response> {
  return await fetch(url, {
    method: 'POST',
    headers: modernHeaders(token),
    body: modernBody(),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
}

async function partialBodyRequest(
  url: URL,
  token: string,
  mode: 'wait-for-response' | 'abort',
  timeoutMs: number,
): Promise<{ status?: number; aborted: boolean }> {
  const requestImpl = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let outerTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = (value: { status?: number; aborted: boolean }) => {
      if (settled) return;
      settled = true;
      if (outerTimer !== undefined) clearTimeout(outerTimer);
      resolvePromise(value);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (outerTimer !== undefined) clearTimeout(outerTimer);
      rejectPromise(error);
    };
    const req = requestImpl(url, {
      method: 'POST',
      headers: {
        ...modernHeaders(token),
        'transfer-encoding': 'chunked',
      },
    }, (res) => {
      const status = res.statusCode;
      res.resume();
      res.once('end', () => {
        req.destroy();
        settle({ status, aborted: false });
      });
    });
    req.once('error', (error) => {
      if (mode === 'abort') {
        settle({ aborted: true });
        return;
      }
      fail(new Error(`partial body request failed: ${error instanceof Error ? error.name : 'network error'}`));
    });
    req.write('{"jsonrpc":"2.0","id":9,"method":"tools/list","params":{"_meta":{');
    if (mode === 'abort') {
      setTimeout(() => {
        req.destroy(new Error('intentional hosted MCP conformance abort'));
        settle({ aborted: true });
      }, 100);
    }
    outerTimer = setTimeout(() => {
      req.destroy();
      fail(new Error('partial body request exceeded outer conformance timeout'));
    }, timeoutMs);
  });
}

async function writeEvidence(outputDir: string, evidence: HostedMcpEvidence): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const json = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidencePath = join(outputDir, 'hosted-mcp-conformance.json');
  await writeFile(evidencePath, json, { encoding: 'utf8', mode: 0o600 });
  await writeFile(
    `${evidencePath}.sha256`,
    `${hashText(json)}  hosted-mcp-conformance.json\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

export async function runHostedMcpConformance(): Promise<HostedMcpEvidence> {
  if (process.env.FURYPIPE_ALLOW_HOSTED_MCP_CONFORMANCE !== '1') {
    throw new Error('set FURYPIPE_ALLOW_HOSTED_MCP_CONFORMANCE=1 to execute external hosted MCP validation');
  }
  const token = requiredEnv('FURYPIPE_HOSTED_MCP_BEARER_TOKEN');
  if (token.length < 16 || token.length > 4096) {
    throw new Error('FURYPIPE_HOSTED_MCP_BEARER_TOKEN must contain 16..4096 characters');
  }
  const source = sourceCommit();
  const targetUrl = safeTarget(requiredEnv('FURYPIPE_HOSTED_MCP_URL'));
  const boundary = process.env.FURYPIPE_HOSTED_MCP_CLIENT_BOUNDARY?.trim() || 'unknown';
  const serverTimeoutMs = Number(process.env.FURYPIPE_HOSTED_MCP_SERVER_TIMEOUT_MS?.trim() || '1500');
  if (!Number.isSafeInteger(serverTimeoutMs) || serverTimeoutMs < 100 || serverTimeoutMs > 30_000) {
    throw new Error('FURYPIPE_HOSTED_MCP_SERVER_TIMEOUT_MS must be an integer from 100 to 30000');
  }

  const temporary = await mkdtemp(join(tmpdir(), 'furypipe-hosted-mcp-'));
  const modernConfigPath = join(temporary, 'modern.json');
  const legacyConfigPath = join(temporary, 'legacy.json');
  await writeFile(modernConfigPath, inspectorConfig(targetUrl, token, 'modern'), { mode: 0o600 });
  await writeFile(legacyConfigPath, inspectorConfig(targetUrl, token, 'legacy'), { mode: 0o600 });

  let requested = false;
  try {
    const dns = isIP(targetUrl.hostname)
      ? []
      : await lookup(targetUrl.hostname, { all: true });
    const remoteBoundary = !isLoopbackHost(targetUrl.hostname);
    const tlsVerified = targetUrl.protocol === 'https:';

    requested = true;
    const sourceResponse = await rawModern(targetUrl, token);
    const wireSource = sourceResponse.headers.get('x-furypipe-source-commit');
    const sourceBindingOk = sourceResponse.status === 200 && wireSource === source;
    await sourceResponse.body?.cancel();

    const missingAuthResponse = await rawModern(targetUrl);
    const missingAuthOk = missingAuthResponse.status === 401;
    await missingAuthResponse.body?.cancel();

    const invalidToken = token === 'furypipe-invalid-hosted-token'
      ? 'furypipe-invalid-hosted-token-2'
      : 'furypipe-invalid-hosted-token';
    const invalidAuthResponse = await rawModern(targetUrl, invalidToken);
    const invalidAuthOk = invalidAuthResponse.status === 401;
    await invalidAuthResponse.body?.cancel();

    const modernInitialize = await runInspector(modernConfigPath, 'initialize');
    const modernVersion = protocolVersion(modernInitialize);
    const modernOk = modernVersion === MODERN_PROTOCOL;

    const modernList = await runInspector(modernConfigPath, 'tools/list', ['--strict']);
    const modernNames = toolNames(modernList);
    const modernToolsOk = exactToolSet(modernNames);

    const readOnly = await runInspector(modernConfigPath, 'tools/call', [
      '--tool-name',
      'verify_handle',
      '--tool-args-json',
      JSON.stringify({ handle: fixtureHandle() }),
    ]);
    const readOnlyResult = resultObject(readOnly);
    const readOnlyCallOk = Array.isArray(readOnlyResult.content)
      && readOnlyResult.content.length > 0
      && readOnlyResult.isError !== true;

    const reconnectInitialize = await runInspector(modernConfigPath, 'initialize');
    const reconnectOk = protocolVersion(reconnectInitialize) === MODERN_PROTOCOL;

    const legacyInitialize = await runInspector(legacyConfigPath, 'initialize');
    const legacyVersion = protocolVersion(legacyInitialize);
    const legacyOk = legacyVersion === LEGACY_PROTOCOL;

    const legacyList = await runInspector(legacyConfigPath, 'tools/list', ['--strict']);
    const legacyNames = toolNames(legacyList);
    const legacyToolsOk = exactToolSet(legacyNames);

    const slowBody = await partialBodyRequest(
      targetUrl,
      token,
      'wait-for-response',
      serverTimeoutMs + 10_000,
    );
    const slowBodyOk = slowBody.status === 504;

    const cancelled = await partialBodyRequest(targetUrl, token, 'abort', 5_000);
    const postCancelReconnect = await runInspector(modernConfigPath, 'initialize');
    const cancelReconnectOk = cancelled.aborted
      && protocolVersion(postCancelReconnect) === MODERN_PROTOCOL;

    const networkVerified = remoteBoundary
      && tlsVerified
      && boundary === 'github-hosted-runner'
      && (isIP(targetUrl.hostname) !== 0 || dns.length > 0);

    const checks = {
      network: {
        status: networkVerified ? 'VERIFIED' : 'PARTIAL',
        details: {
          remoteBoundary,
          tlsVerified,
          dnsResolutionCount: dns.length,
          targetUsesIpLiteral: isIP(targetUrl.hostname) !== 0,
          githubHostedRunner: boundary === 'github-hosted-runner',
        },
      },
      sourceBinding: {
        status: sourceBindingOk ? 'VERIFIED' : 'PARTIAL',
        details: {
          httpStatus: sourceResponse.status,
          wireSourceMatchesCheckout: sourceBindingOk,
        },
      },
      modern: {
        status: modernOk ? 'VERIFIED' : 'PARTIAL',
        details: { protocolVersion: modernVersion ?? 'unknown' },
      },
      modernTools: {
        status: modernToolsOk ? 'VERIFIED' : 'PARTIAL',
        details: { toolCount: modernNames.length, exactExpectedSet: modernToolsOk },
      },
      readOnlyCall: {
        status: readOnlyCallOk ? 'VERIFIED' : 'PARTIAL',
        details: { tool: 'verify_handle', mutationRequested: false },
      },
      reconnect: {
        status: reconnectOk ? 'VERIFIED' : 'PARTIAL',
        details: { freshInspectorProcess: true, protocolVersion: protocolVersion(reconnectInitialize) ?? 'unknown' },
      },
      legacy: {
        status: legacyOk ? 'VERIFIED' : 'PARTIAL',
        details: { protocolVersion: legacyVersion ?? 'unknown' },
      },
      legacyTools: {
        status: legacyToolsOk ? 'VERIFIED' : 'PARTIAL',
        details: { toolCount: legacyNames.length, exactExpectedSet: legacyToolsOk },
      },
      missingAuth: {
        status: missingAuthOk ? 'VERIFIED' : 'PARTIAL',
        details: { httpStatus: missingAuthResponse.status },
      },
      invalidAuth: {
        status: invalidAuthOk ? 'VERIFIED' : 'PARTIAL',
        details: { httpStatus: invalidAuthResponse.status },
      },
      slowBodyTimeout: {
        status: slowBodyOk ? 'VERIFIED' : 'PARTIAL',
        details: { httpStatus: slowBody.status ?? 0, configuredServerTimeoutMs: serverTimeoutMs },
      },
      cancelReconnect: {
        status: cancelReconnectOk ? 'VERIFIED' : 'PARTIAL',
        details: {
          clientAbortIssued: cancelled.aborted,
          reconnectAfterAbort: protocolVersion(postCancelReconnect) === MODERN_PROTOCOL,
        },
      },
    } satisfies HostedMcpEvidence['checks'];

    const externalConformance = Object.values(checks).every((check) => check.status === 'VERIFIED')
      ? 'VERIFIED'
      : 'PARTIAL';

    return {
      format: 'furypipe-hosted-mcp-conformance/v1',
      generatedAt: Date.now(),
      sourceCommit: source,
      target: {
        origin: targetUrl.origin,
        hostname: targetUrl.hostname,
        protocol: targetUrl.protocol as 'https:' | 'http:',
        port: Number(targetUrl.port || (targetUrl.protocol === 'https:' ? '443' : '80')),
        path: targetUrl.pathname,
      },
      client: {
        implementation: INSPECTOR_PACKAGE,
        version: INSPECTOR_VERSION,
        processBoundary: true,
        runtimeHost: hostname(),
        boundary,
      },
      checks,
      oauthAuthorizationServer: 'NOT_EXECUTED',
      externalConformance,
      requestExecuted: requested,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const outputDir = resolve(process.env.FURYPIPE_HOSTED_MCP_OUTPUT_DIR?.trim()
    || 'artifacts/hosted-mcp-conformance');
  if (process.env.FURYPIPE_ALLOW_HOSTED_MCP_CONFORMANCE !== '1') {
    const blocked = {
      format: 'furypipe-hosted-mcp-conformance/v1',
      status: 'BLOCKED_EXTERNAL_ENV',
      requestExecuted: false,
      reason: 'Explicit opt-in, target URL and bearer credential are required.',
    };
    process.stdout.write(`${JSON.stringify(blocked, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    const evidence = await runHostedMcpConformance();
    await writeEvidence(outputDir, evidence);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (evidence.externalConformance !== 'VERIFIED') process.exitCode = 1;
  } catch {
    process.stderr.write('Hosted MCP conformance failed; credentials and remote response bodies were not recorded.\n');
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  await main();
}
