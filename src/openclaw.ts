import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import JSON5 from 'json5';

export type OpenClawConfigStatus = 'valid' | 'missing' | 'invalid' | 'symlink' | 'unreadable';
export type OpenClawPathSource = 'environment' | 'config' | 'default';

export interface OpenClawPaths {
  readonly home: string;
  readonly stateDir: string;
  readonly configPath: string;
  readonly workspaceDir: string;
  readonly profile?: string;
  readonly sources: { readonly stateDir: OpenClawPathSource; readonly configPath: OpenClawPathSource; readonly workspaceDir: OpenClawPathSource };
}

export interface OpenClawWorkspaceSummary {
  readonly path: string;
  readonly exists: boolean;
  readonly regularDirectory: boolean;
  readonly files: Readonly<Record<string, 'present' | 'missing' | 'not_checked'>>;
}

export interface OpenClawConfigSummary {
  readonly status: OpenClawConfigStatus;
  readonly path: string;
  readonly regularFile: boolean;
  readonly agentEntryCount: number;
  readonly configuredWorkspace: string | undefined;
  readonly gatewayBind: string | undefined;
  readonly gatewayAuthMode: string | undefined;
  /** Paths only; values are never returned. */
  readonly secretBearingPaths: readonly string[];
}

export interface OpenClawDiscovery {
  readonly format: 'furypipe-openclaw-discovery/v1';
  readonly paths: OpenClawPaths;
  readonly config: OpenClawConfigSummary;
  readonly workspace: OpenClawWorkspaceSummary;
  readonly runtime: { readonly status: 'available' | 'unavailable'; readonly version?: string };
  readonly security: {
    readonly configContainsSecretBearingFields: boolean;
    readonly nonLoopbackWithoutAuth: boolean;
    readonly warnings: readonly string[];
  };
}

export interface OpenClawDiscoveryOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly home?: string;
  readonly checkRuntime?: boolean;
}

export type OpenClawProbeVerdict = 'healthy' | 'not_ready' | 'unreachable' | 'invalid_contract';

export interface OpenClawProbeEndpointResult {
  readonly endpoint: '/healthz' | '/startupz' | '/readyz';
  readonly verdict: OpenClawProbeVerdict;
  readonly httpStatus?: number;
  readonly durationMs: number;
}

export interface OpenClawGatewayProbe {
  readonly format: 'furypipe-openclaw-gateway-probe/v1';
  readonly origin: string;
  readonly liveness: OpenClawProbeEndpointResult;
  readonly startup: OpenClawProbeEndpointResult;
  readonly readiness: OpenClawProbeEndpointResult;
  readonly overall: 'healthy' | 'degraded' | 'unavailable';
  readonly modelCallExecuted: false;
}

export interface OpenClawGatewayProbeOptions {
  /** HTTP(S) origin of the Gateway. No path, query, fragment or embedded credentials. */
  readonly baseUrl: string;
  /** Remote hosts are denied by default; explicitly enable only for a trusted private/TLS ingress. */
  readonly allowRemote?: boolean;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

const SECRET_KEY = /(?:token|password|secret|apikey|api_key|privatekey|private_key|credential|accesskey|access_key)/i;
const WORKSPACE_FILES = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md', 'HEARTBEAT.md', 'MEMORY.md'] as const;
const MAX_OPENCLAW_CONFIG_BYTES = 1_048_576;
const MAX_OPENCLAW_HEALTH_RESPONSE_BYTES = 64 * 1024;

function readBoundedUtf8File(filePath: string, maxBytes: number): string {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(maxBytes + 1);
  let bytesRead = 0;
  try {
    while (bytesRead < buffer.length) {
      const count = fs.readSync(fd, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (count === 0) break;
      bytesRead += count;
    }
  } finally {
    fs.closeSync(fd);
  }
  if (bytesRead > maxBytes) throw new RangeError('OpenClaw config exceeds the 1 MiB inspection bound');
  return buffer.subarray(0, bytesRead).toString('utf8');
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function expandHome(value: string, home: string): string {
  if (value === '~') return home;
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) return path.join(home, value.slice(2));
  return value;
}

function resolvePath(value: string, base: string, home: string): string {
  const expanded = expandHome(value, home);
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(base, expanded));
}

function defaultStateDir(home: string, profile: string | undefined): string {
  return profile && profile !== 'default' ? path.join(home, `.openclaw-${profile}`) : path.join(home, '.openclaw');
}

/** Resolve OpenClaw's documented path environment without touching the filesystem. */
export function resolveOpenClawPaths(options: Pick<OpenClawDiscoveryOptions, 'env' | 'home'> = {}): OpenClawPaths {
  const env = options.env ?? process.env;
  const home = path.resolve(clean(env.OPENCLAW_HOME) ?? options.home ?? os.homedir());
  const profile = clean(env.OPENCLAW_PROFILE);
  const stateEnv = clean(env.OPENCLAW_STATE_DIR);
  const stateDir = resolvePath(stateEnv ?? defaultStateDir(home, profile), home, home);
  const configEnv = clean(env.OPENCLAW_CONFIG_PATH);
  const configPath = resolvePath(configEnv ?? path.join(stateDir, 'openclaw.json'), stateDir, home);
  const workspaceEnv = clean(env.OPENCLAW_WORKSPACE_DIR);
  const workspaceDir = workspaceEnv === undefined ? path.join(stateDir, 'workspace') : resolvePath(workspaceEnv, stateDir, home);
  return {
    home, stateDir, configPath, workspaceDir,
    ...(profile === undefined ? {} : { profile }),
    sources: {
      stateDir: stateEnv === undefined ? 'default' : 'environment',
      configPath: configEnv === undefined ? 'default' : 'environment',
      workspaceDir: workspaceEnv === undefined ? 'default' : 'environment',
    },
  };
}

function secretPaths(value: unknown, current = '$'): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((entry, index) => secretPaths(entry, `${current}[${index}]`));
  const result: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${current}.${key}`;
    if (SECRET_KEY.test(key)) result.push(childPath);
    else result.push(...secretPaths(child, childPath));
  }
  return result;
}

function objectAt(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, unknown> : undefined;
}

function stringAt(value: unknown, keys: readonly string[]): string | undefined {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.trim() ? current.trim() : undefined;
}

function emptyConfigSummary(status: OpenClawConfigStatus, configPath: string, regularFile: boolean): OpenClawConfigSummary {
  return {
    status, path: configPath, regularFile, agentEntryCount: 0,
    configuredWorkspace: undefined, gatewayBind: undefined, gatewayAuthMode: undefined, secretBearingPaths: [],
  };
}

function readConfig(paths: OpenClawPaths): OpenClawConfigSummary {
  let stat: fs.Stats;
  try {
    const link = fs.lstatSync(paths.configPath);
    if (link.isSymbolicLink()) return emptyConfigSummary('symlink', paths.configPath, false);
    stat = fs.statSync(paths.configPath);
  } catch (error) {
    return emptyConfigSummary((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable', paths.configPath, false);
  }
  if (!stat.isFile()) return emptyConfigSummary('unreadable', paths.configPath, false);
  try {
    const parsed = JSON5.parse(readBoundedUtf8File(paths.configPath, MAX_OPENCLAW_CONFIG_BYTES)) as unknown;
    const entries = objectAt(parsed, ['agents', 'entries']);
    return {
      status: 'valid', path: paths.configPath, regularFile: true,
      agentEntryCount: entries ? Object.keys(entries).length : 0,
      configuredWorkspace: stringAt(parsed, ['agents', 'defaults', 'workspace']),
      gatewayBind: stringAt(parsed, ['gateway', 'bind']),
      gatewayAuthMode: stringAt(parsed, ['gateway', 'auth', 'mode']),
      secretBearingPaths: secretPaths(parsed),
    };
  } catch {
    return emptyConfigSummary('invalid', paths.configPath, true);
  }
}

function workspaceSummary(workspacePath: string): OpenClawWorkspaceSummary {
  let directory = false;
  try { directory = fs.statSync(workspacePath).isDirectory(); } catch { /* absent is a normal fixture/state */ }
  const files = Object.fromEntries(WORKSPACE_FILES.map((file) => {
    if (!directory) return [file, 'not_checked'];
    try { return [file, fs.statSync(path.join(workspacePath, file)).isFile() ? 'present' : 'missing']; } catch { return [file, 'missing']; }
  })) as Record<string, 'present' | 'missing' | 'not_checked'>;
  return { path: workspacePath, exists: directory, regularDirectory: directory, files };
}

function runtimeCheck(): OpenClawDiscovery['runtime'] {
  try {
    const output = process.platform === 'win32'
      ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'openclaw --version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      : execFileSync('openclaw', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const version = output.trim().split(/\r?\n/, 1)[0];
    return version ? { status: 'available', version } : { status: 'available' };
  } catch { return { status: 'unavailable' }; }
}

function normalizeProbeOrigin(baseUrl: string, allowRemote: boolean): URL {
  if (typeof baseUrl !== 'string' || baseUrl.length < 1 || baseUrl.length > 2048 || baseUrl.includes('\0')) {
    throw new Error('OpenClaw probe baseUrl must be a bounded non-empty URL');
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('OpenClaw probe baseUrl is invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OpenClaw probe baseUrl must use http or https');
  }
  if (url.username || url.password) {
    throw new Error('OpenClaw probe baseUrl must not embed credentials');
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('OpenClaw probe baseUrl must be an origin without path, query or fragment');
  }
  const host = url.hostname.toLowerCase();
  const normalizedHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const loopback = normalizedHost === 'localhost' || normalizedHost === '127.0.0.1' || normalizedHost === '::1';
  if (!loopback && !allowRemote) {
    throw new Error('remote OpenClaw probe requires allowRemote=true');
  }
  url.pathname = '/';
  return url;
}

function boundedProbeTimeout(value: number | undefined): number {
  const timeout = value ?? 5_000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 30_000) {
    throw new RangeError('OpenClaw probe timeoutMs must be between 100 and 30000');
  }
  return timeout;
}

function validProbeClock(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('OpenClaw probe clock must be non-negative and finite');
  return value;
}

function objectPayload(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json'
    || (mediaType?.startsWith('application/') === true && mediaType.endsWith('+json'));
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('OpenClaw health response has no body');
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_OPENCLAW_HEALTH_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new RangeError('OpenClaw health response exceeds the 64 KiB limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

function probeContractVerdict(
  endpoint: OpenClawProbeEndpointResult['endpoint'],
  payload: unknown,
): 'healthy' | 'not_ready' | 'invalid_contract' {
  const object = objectPayload(payload);
  if (!object) return 'invalid_contract';

  if (endpoint === '/healthz') {
    if (typeof object.ok !== 'boolean' || typeof object.status !== 'string') return 'invalid_contract';
    return object.ok === true && object.status === 'live' ? 'healthy' : 'not_ready';
  }

  if (endpoint === '/startupz') {
    if (typeof object.ok !== 'boolean' || !['started', 'starting', 'draining'].includes(String(object.status))) {
      return 'invalid_contract';
    }
    return object.ok === true && object.status === 'started' ? 'healthy' : 'not_ready';
  }

  if (typeof object.ready !== 'boolean') return 'invalid_contract';
  return object.ready ? 'healthy' : 'not_ready';
}

async function probeOpenClawEndpoint(
  origin: URL,
  endpoint: OpenClawProbeEndpointResult['endpoint'],
  fetchImpl: typeof fetch,
  timeoutMs: number,
  now: () => number,
): Promise<OpenClawProbeEndpointResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = validProbeClock(now());
  try {
    const target = new URL(endpoint, origin);
    const response = await fetchImpl(target, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!isJsonContentType(response.headers.get('content-type'))) {
      return {
        endpoint,
        verdict: 'invalid_contract',
        httpStatus: response.status,
        durationMs: Math.max(0, Math.round(validProbeClock(now()) - start)),
      };
    }
    let payload: unknown;
    try {
      payload = await readBoundedJson(response);
    } catch {
      return {
        endpoint,
        verdict: 'invalid_contract',
        httpStatus: response.status,
        durationMs: Math.max(0, Math.round(validProbeClock(now()) - start)),
      };
    }
    const contractVerdict = probeContractVerdict(endpoint, payload);
    const verdict = response.ok || contractVerdict === 'invalid_contract'
      ? contractVerdict
      : 'not_ready';
    return {
      endpoint,
      verdict,
      httpStatus: response.status,
      durationMs: Math.max(0, Math.round(validProbeClock(now()) - start)),
    };
  } catch {
    return {
      endpoint,
      verdict: 'unreachable',
      durationMs: Math.max(0, Math.round(validProbeClock(now()) - start)),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe only OpenClaw's documented HTTP health surfaces.
 * No Gateway credential, session, agent turn, tool call or model call is created.
 */
export async function probeOpenClawGateway(options: OpenClawGatewayProbeOptions): Promise<OpenClawGatewayProbe> {
  if (!options || typeof options !== 'object') throw new Error('OpenClaw probe options are required');
  const origin = normalizeProbeOrigin(options.baseUrl, options.allowRemote === true);
  const timeoutMs = boundedProbeTimeout(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  if (typeof fetchImpl !== 'function') throw new Error('OpenClaw probe fetch implementation is unavailable');
  const now = options.now ?? (() => performance.now());

  const [liveness, startup, readiness] = await Promise.all([
    probeOpenClawEndpoint(origin, '/healthz', fetchImpl, timeoutMs, now),
    probeOpenClawEndpoint(origin, '/startupz', fetchImpl, timeoutMs, now),
    probeOpenClawEndpoint(origin, '/readyz', fetchImpl, timeoutMs, now),
  ]);

  const overall = liveness.verdict !== 'healthy'
    ? 'unavailable'
    : startup.verdict === 'healthy' && readiness.verdict === 'healthy'
      ? 'healthy'
      : 'degraded';

  return Object.freeze({
    format: 'furypipe-openclaw-gateway-probe/v1',
    origin: origin.origin,
    liveness: Object.freeze(liveness),
    startup: Object.freeze(startup),
    readiness: Object.freeze(readiness),
    overall,
    modelCallExecuted: false,
  });
}

/** Read-only OpenClaw adapter. It returns metadata and never returns config values. */
export function discoverOpenClaw(options: OpenClawDiscoveryOptions = {}): OpenClawDiscovery {
  const paths = resolveOpenClawPaths(options);
  const config = readConfig(paths);
  const configWorkspace = config.configuredWorkspace === undefined ? undefined : resolvePath(config.configuredWorkspace, paths.stateDir, paths.home);
  const workspaceFromEnvironment = paths.sources.workspaceDir === 'environment';
  const workspaceDir = workspaceFromEnvironment ? paths.workspaceDir : configWorkspace ?? paths.workspaceDir;
  const resolvedPaths: OpenClawPaths = {
    ...paths,
    workspaceDir,
    sources: {
      ...paths.sources,
      workspaceDir: workspaceFromEnvironment ? 'environment' : configWorkspace === undefined ? 'default' : 'config',
    },
  };
  const workspace = workspaceSummary(workspaceDir);
  const nonLoopback = config.gatewayBind !== undefined && !['loopback', 'localhost', '127.0.0.1', '::1'].includes(config.gatewayBind.toLowerCase());
  const nonLoopbackWithoutAuth = nonLoopback && config.gatewayAuthMode === undefined;
  const warnings = [
    ...(config.status === 'symlink' ? ['config path is a symlink; OpenClaw requires a regular file'] : []),
    ...(config.status === 'invalid' ? ['config is not valid JSON5 or exceeds the 1 MiB inspection bound'] : []),
    ...(config.secretBearingPaths.length > 0 ? ['config contains secret-bearing fields; values were not read into the report'] : []),
    ...(nonLoopbackWithoutAuth ? ['non-loopback gateway bind has no declared local auth mode'] : []),
  ];
  return {
    format: 'furypipe-openclaw-discovery/v1',
    paths: resolvedPaths,
    config,
    workspace,
    runtime: options.checkRuntime === false ? { status: 'unavailable' } : runtimeCheck(),
    security: { configContainsSecretBearingFields: config.secretBearingPaths.length > 0, nonLoopbackWithoutAuth, warnings },
  };
}
