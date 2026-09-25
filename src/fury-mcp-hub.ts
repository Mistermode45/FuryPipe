// FuryMcpHub — one view of every MCP server the installed harnesses know about.
//
// Read-only discovery of the MCP config files used by Claude Code, Cursor,
// VS Code, OpenCode, Codex and FuryPipe itself. Secrets never leave the
// config: env and header values are reduced to their names, URL credentials
// and query strings are stripped and secret-looking arguments are redacted.
// The hub adds operator state per source (enabled, trusted, default policy)
// and per tool (ALLOW / ASK / DENY / READ_ONLY), and an on-demand health
// probe through MCP Direct. Probes never send configured env values or
// headers (no credential use) and reach remote hosts only when asked to.
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { deriveMcpDirectEndpointFingerprint, probeMcpDirectInventory, type McpDirectInventoryProbeEvidence, type McpDirectRuntimeConfig } from './mcp-direct-client-node.js';

export const FURY_MCP_POLICIES = Object.freeze(['ALLOW', 'ASK', 'DENY', 'READ_ONLY'] as const);
export type FuryMcpPolicy = typeof FURY_MCP_POLICIES[number];

export class FuryMcpHubError extends Error {
  override readonly name = 'FuryMcpHubError';
}

export interface FuryMcpSource {
  readonly sourceId: string;
  readonly name: string;
  readonly origin: string;
  readonly configPath: string;
  readonly scope: 'project' | 'user';
  readonly transport: 'stdio' | 'streamable_http' | 'sse' | 'unknown';
  readonly locality: 'local' | 'remote';
  /** Redacted, display-safe. */
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly envNames: readonly string[];
  readonly headerNames: readonly string[];
}

export interface FuryMcpToolHealth {
  readonly name: string;
  readonly riskClass: string;
  readonly readOnly: boolean;
}

interface SourceState {
  enabled: boolean;
  trusted: boolean;
  defaultPolicy: FuryMcpPolicy;
  tools: Record<string, FuryMcpPolicy>;
  health?: { at: number; ok: boolean; toolCount: number; protocolVersion?: string; tools: FuryMcpToolHealth[]; error?: string };
}

interface HubState {
  format: 'furypipe-mcp-hub-state/v1';
  sources: Record<string, SourceState>;
}

export interface FuryMcpSourceView extends FuryMcpSource {
  readonly enabled: boolean;
  readonly trusted: boolean;
  readonly defaultPolicy: FuryMcpPolicy;
  readonly toolPolicies: Readonly<Record<string, FuryMcpPolicy>>;
  readonly health?: SourceState['health'];
}

export interface FuryMcpDecision {
  readonly decision: 'ALLOW' | 'ASK' | 'DENY';
  readonly reason: string;
}

const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_SOURCES = 256;
const SECRET_FLAG = /(?:token|secret|password|passwd|api[-_]?key|auth|credential|bearer)/iu;
const SECRET_VALUE = /^(?:sk-|ghp_|gho_|github_pat_|xox[abp]-|AKIA|AIza|glpat-)|^[A-Za-z0-9+/_=-]{40,}$/u;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 64) : []);

export function redactFuryMcpArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const eq = a.indexOf('=');
    if (eq > 0 && SECRET_FLAG.test(a.slice(0, eq))) out.push(`${a.slice(0, eq)}=[redacted]`);
    else if (i > 0 && /^--?[\w-]+$/u.test(args[i - 1]!) && SECRET_FLAG.test(args[i - 1]!)) out.push('[redacted]');
    else if (SECRET_VALUE.test(a)) out.push('[redacted]');
    else out.push(a);
  }
  return out;
}

export function redactFuryMcpUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    const hadQuery = url.search !== '';
    url.search = '';
    url.hash = '';
    return `${url.toString()}${hadQuery ? '?[redacted]' : ''}`;
  } catch {
    return '[invalid-url]';
  }
}

function isLoopback(value: string): boolean {
  try {
    const host = new URL(value).hostname.replace(/^\[|\]$/gu, '');
    return host === 'localhost' || host === '::1' || /^127\./u.test(host);
  } catch {
    return false;
  }
}

interface ParsedServer {
  readonly name: string;
  readonly transport: FuryMcpSource['transport'];
  readonly command?: string;
  readonly args: readonly string[];
  readonly url?: string;
  readonly envNames: readonly string[];
  readonly headerNames: readonly string[];
}

function fromStandard(name: string, v: Raw): ParsedServer | null {
  const type = typeof v.type === 'string' ? v.type.toLowerCase() : undefined;
  const envNames = isObj(v.env) ? Object.keys(v.env) : isObj(v.environment) ? Object.keys(v.environment) : [];
  const headerNames = isObj(v.headers) ? Object.keys(v.headers) : [];
  // OpenCode: { type: 'local', command: [cmd, ...args] } / { type: 'remote', url }
  if (Array.isArray(v.command)) {
    const [command, ...args] = strs(v.command);
    return command ? { name, transport: 'stdio', command, args, envNames, headerNames } : null;
  }
  if (typeof v.command === 'string') return { name, transport: 'stdio', command: v.command, args: strs(v.args), envNames, headerNames };
  if (typeof v.url === 'string' || typeof v.serverUrl === 'string') {
    const url = (v.url ?? v.serverUrl) as string;
    const transport = type === 'sse' ? 'sse' : 'streamable_http';
    return { name, transport, url, args: [], envNames, headerNames };
  }
  return null;
}

function serversIn(map: unknown): ParsedServer[] {
  if (!isObj(map)) return [];
  return Object.entries(map).flatMap(([name, v]) => (isObj(v) && /^[\w.@-]{1,64}$/u.test(name) ? [fromStandard(name, v)].filter((s): s is ParsedServer => s !== null) : []));
}

/** Minimal reader for Codex `[mcp_servers.<name>]` tables (command, args, url, env keys). */
export function parseCodexMcpToml(text: string): ParsedServer[] {
  const servers = new Map<string, { command?: string; args: string[]; url?: string; env: string[]; headers: string[] }>();
  let current: string | undefined;
  let sub: 'env' | 'headers' | undefined;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(/\s+#.*$/u, '').trim();
    const table = /^\[mcp_servers\.("?)([\w@-]+)\1(?:\.(env|http_headers|headers))?\]$/u.exec(line);
    if (table) {
      current = table[2]!;
      sub = table[3] === 'env' ? 'env' : table[3] ? 'headers' : undefined;
      if (!servers.has(current)) servers.set(current, { args: [], env: [], headers: [] });
      continue;
    }
    if (line.startsWith('[')) {
      current = undefined;
      continue;
    }
    if (!current) continue;
    const kv = /^([\w-]+)\s*=\s*(.+)$/u.exec(line);
    if (!kv) continue;
    const entry = servers.get(current)!;
    if (sub === 'env') entry.env.push(kv[1]!);
    else if (sub === 'headers') entry.headers.push(kv[1]!);
    else if (kv[1] === 'command') entry.command = /^"(.*)"$/u.exec(kv[2]!)?.[1];
    else if (kv[1] === 'url') entry.url = /^"(.*)"$/u.exec(kv[2]!)?.[1];
    else if (kv[1] === 'args') entry.args = [...kv[2]!.matchAll(/"((?:[^"\\]|\\.)*)"/gu)].map((m) => m[1]!);
    else if (kv[1] === 'env' || kv[1] === 'http_headers') entry[kv[1] === 'env' ? 'env' : 'headers'].push(...[...kv[2]!.matchAll(/([\w-]+)\s*=/gu)].map((m) => m[1]!));
  }
  return [...servers].flatMap(([name, s]): ParsedServer[] => (s.command
    ? [{ name, transport: 'stdio', command: s.command, args: s.args, envNames: s.env, headerNames: s.headers }]
    : s.url ? [{ name, transport: 'streamable_http', url: s.url, args: [], envNames: s.env, headerNames: s.headers }] : []));
}

interface ConfigSpec {
  readonly origin: string;
  readonly scope: 'project' | 'user';
  readonly file: string;
  readonly read: (text: string) => ParsedServer[];
}

function configSpecs(projectRoot: string, homeDir: string): ConfigSpec[] {
  const json = (pick: (j: Raw) => unknown) => (text: string) => {
    const parsed = JSON.parse(text) as unknown;
    return isObj(parsed) ? serversIn(pick(parsed)) : [];
  };
  const abs = path.resolve(projectRoot);
  return [
    { origin: 'project-furypipe', scope: 'project', file: path.join(projectRoot, '.furypipe', 'mcp.json'), read: json((j) => j.mcpServers) },
    { origin: 'project-mcp', scope: 'project', file: path.join(projectRoot, '.mcp.json'), read: json((j) => j.mcpServers) },
    { origin: 'project-cursor', scope: 'project', file: path.join(projectRoot, '.cursor', 'mcp.json'), read: json((j) => j.mcpServers) },
    { origin: 'project-vscode', scope: 'project', file: path.join(projectRoot, '.vscode', 'mcp.json'), read: json((j) => j.servers) },
    { origin: 'project-opencode', scope: 'project', file: path.join(projectRoot, 'opencode.json'), read: json((j) => j.mcp) },
    { origin: 'user-claude', scope: 'user', file: path.join(homeDir, '.claude.json'), read: (t) => { const j = JSON.parse(t) as Raw; const projects = isObj(j.projects) ? j.projects : {}; const p = projects[abs]; return [...serversIn(j.mcpServers), ...(isObj(p) ? serversIn(p.mcpServers) : [])]; } },
    { origin: 'user-cursor', scope: 'user', file: path.join(homeDir, '.cursor', 'mcp.json'), read: json((j) => j.mcpServers) },
    { origin: 'user-opencode', scope: 'user', file: path.join(homeDir, '.config', 'opencode', 'opencode.json'), read: json((j) => j.mcp) },
    { origin: 'user-codex', scope: 'user', file: path.join(homeDir, '.codex', 'config.toml'), read: parseCodexMcpToml },
  ];
}

export async function discoverFuryMcpSources(options: { readonly projectRoot: string; readonly homeDir?: string }): Promise<{ readonly sources: readonly FuryMcpSource[]; readonly configs: readonly { readonly origin: string; readonly path: string; readonly status: 'found' | 'absent' | 'invalid' | 'too-large' }[] }> {
  const sources: FuryMcpSource[] = [];
  const configs: { origin: string; path: string; status: 'found' | 'absent' | 'invalid' | 'too-large' }[] = [];
  for (const spec of configSpecs(options.projectRoot, options.homeDir ?? os.homedir())) {
    let text: string;
    try {
      const info = await stat(spec.file);
      if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
      if (info.size > MAX_CONFIG_BYTES) {
        configs.push({ origin: spec.origin, path: spec.file, status: 'too-large' });
        continue;
      }
      text = await readFile(spec.file, 'utf8');
    } catch {
      configs.push({ origin: spec.origin, path: spec.file, status: 'absent' });
      continue;
    }
    let parsed: ParsedServer[];
    try {
      parsed = spec.read(text);
    } catch {
      configs.push({ origin: spec.origin, path: spec.file, status: 'invalid' });
      continue;
    }
    configs.push({ origin: spec.origin, path: spec.file, status: 'found' });
    for (const s of parsed) {
      if (sources.length >= MAX_SOURCES) break;
      const url = s.url ? redactFuryMcpUrl(s.url) : undefined;
      sources.push(Object.freeze({
        sourceId: `${spec.origin}.${s.name}`.replace(/[^A-Za-z0-9._:-]/gu, '_').slice(0, 128),
        name: s.name, origin: spec.origin, configPath: spec.file, scope: spec.scope,
        transport: s.transport,
        locality: s.transport === 'stdio' || (s.url !== undefined && isLoopback(s.url)) ? 'local' : 'remote',
        ...(s.command ? { command: s.command, args: Object.freeze(redactFuryMcpArgs(s.args)) } : {}),
        ...(url ? { url } : {}),
        envNames: Object.freeze([...s.envNames].sort()),
        headerNames: Object.freeze([...s.headerNames].sort()),
      }));
    }
  }
  return Object.freeze({ sources: Object.freeze(sources), configs: Object.freeze(configs) });
}

export type FuryMcpProbe = (config: McpDirectRuntimeConfig) => Promise<McpDirectInventoryProbeEvidence>;

export function createFuryMcpHub(options: {
  readonly projectRoot: string;
  readonly stateDir: string;
  readonly homeDir?: string;
  readonly now?: () => number;
  /** Injected for tests; defaults to MCP Direct inventory probing. */
  readonly probe?: FuryMcpProbe;
}) {
  const now = options.now ?? Date.now;
  const statePath = path.join(options.stateDir, 'state.json');
  const probe: FuryMcpProbe = options.probe ?? ((config) => probeMcpDirectInventory(config, { clientInfo: { name: 'furypipe-mcp-hub', version: '1' }, connectTimeoutMs: 10_000, listTimeoutMs: 10_000, probeTimeoutMs: 3_000 }));

  const load = async (): Promise<HubState> => {
    try {
      const parsed = JSON.parse(await readFile(statePath, 'utf8')) as HubState;
      if (parsed?.format !== 'furypipe-mcp-hub-state/v1' || !isObj(parsed.sources)) throw new FuryMcpHubError('MCP hub state has an unknown format');
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { format: 'furypipe-mcp-hub-state/v1', sources: {} };
      throw error;
    }
  };
  const save = async (state: HubState) => {
    await mkdir(options.stateDir, { recursive: true });
    const tmp = `${statePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, statePath);
  };
  const stateOf = (state: HubState, id: string): SourceState => (state.sources[id] ??= { enabled: true, trusted: false, defaultPolicy: 'ASK', tools: {} });

  // Raw (unredacted) configs are needed to launch a probe; they stay in memory.
  const rawFor = async (sourceId: string): Promise<{ source: FuryMcpSource; raw: ParsedServer }> => {
    const { sources } = await discoverFuryMcpSources(options);
    const source = sources.find((s) => s.sourceId === sourceId);
    if (!source) throw new FuryMcpHubError(`unknown MCP source: ${sourceId}`);
    const spec = configSpecs(options.projectRoot, options.homeDir ?? os.homedir()).find((c) => c.origin === source.origin)!;
    const raw = spec.read(await readFile(spec.file, 'utf8')).find((s) => s.name === source.name)!;
    return { source, raw };
  };

  const view = (s: FuryMcpSource, st: SourceState | undefined): FuryMcpSourceView => Object.freeze({
    ...s,
    enabled: st?.enabled ?? true,
    trusted: st?.trusted ?? false,
    defaultPolicy: st?.defaultPolicy ?? 'ASK',
    toolPolicies: Object.freeze({ ...(st?.tools ?? {}) }),
    ...(st?.health ? { health: st.health } : {}),
  });

  const list = async () => {
    const [{ sources, configs }, state] = await Promise.all([discoverFuryMcpSources(options), load()]);
    return Object.freeze({ sources: sources.map((s) => view(s, state.sources[s.sourceId])), configs });
  };

  const mutate = async (sourceId: string, change: (s: SourceState) => void) => {
    const { sources } = await discoverFuryMcpSources(options);
    const source = sources.find((s) => s.sourceId === sourceId);
    if (!source) throw new FuryMcpHubError(`unknown MCP source: ${sourceId}`);
    const state = await load();
    change(stateOf(state, sourceId));
    await save(state);
    return view(source, state.sources[sourceId]);
  };

  const assertPolicy = (p: unknown): FuryMcpPolicy => {
    if (!(FURY_MCP_POLICIES as readonly unknown[]).includes(p)) throw new FuryMcpHubError(`policy must be one of ${FURY_MCP_POLICIES.join(', ')}`);
    return p as FuryMcpPolicy;
  };

  return Object.freeze({
    list,
    setEnabled: (sourceId: string, enabled: boolean) => mutate(sourceId, (s) => { s.enabled = enabled; }),
    setTrusted: (sourceId: string, trusted: boolean) => mutate(sourceId, (s) => { s.trusted = trusted; }),
    setDefaultPolicy: async (sourceId: string, policy: FuryMcpPolicy) => { const p = assertPolicy(policy); return mutate(sourceId, (s) => { s.defaultPolicy = p; }); },
    setToolPolicy: async (sourceId: string, tool: string, policy: FuryMcpPolicy | null) => {
      if (typeof tool !== 'string' || !/^[\w./:-]{1,128}$/u.test(tool)) throw new FuryMcpHubError('invalid tool name');
      const p = policy === null ? null : assertPolicy(policy);
      return mutate(sourceId, (s) => { if (p === null) delete s.tools[tool]; else s.tools[tool] = p; });
    },
    /** Decide a call from operator policy. READ_ONLY allows only tools a trusted probe saw as read-only. */
    async decide(sourceId: string, tool: string): Promise<FuryMcpDecision> {
      const state = (await load()).sources[sourceId];
      const known = (await discoverFuryMcpSources(options)).sources.some((s) => s.sourceId === sourceId);
      if (!known) return { decision: 'DENY', reason: 'unknown source' };
      if (state && !state.enabled) return { decision: 'DENY', reason: 'source disabled' };
      const explicit = state?.tools[tool];
      const policy = explicit ?? state?.defaultPolicy ?? 'ASK';
      const via = explicit ? 'tool policy' : 'source default';
      if (policy === 'READ_ONLY') {
        const seen = state?.health?.tools.find((t) => t.name === tool);
        if (!state?.trusted) return { decision: 'DENY', reason: `READ_ONLY (${via}) needs a trusted source` };
        if (!seen) return { decision: 'DENY', reason: `READ_ONLY (${via}): tool not seen by a health probe` };
        return seen.readOnly ? { decision: 'ALLOW', reason: `READ_ONLY (${via}): probed read-only` } : { decision: 'DENY', reason: `READ_ONLY (${via}): tool may mutate` };
      }
      return { decision: policy, reason: via };
    },
    /** Health probe via MCP Direct: no configured env values or headers are sent. */
    async probe(sourceId: string, request: { readonly allowRemote?: boolean } = {}) {
      const { source, raw } = await rawFor(sourceId);
      const state = await load();
      const st = stateOf(state, sourceId);
      if (!st.enabled) throw new FuryMcpHubError('source is disabled');
      if (source.transport === 'sse' || source.transport === 'unknown') throw new FuryMcpHubError(`${source.transport} transport is not probed (MCP Direct supports stdio and streamable HTTP)`);
      // A project config comes from the repository: launching its command runs repository-chosen code.
      if (source.scope === 'project' && source.transport === 'stdio' && !st.trusted) throw new FuryMcpHubError('project MCP servers start a command chosen by the repository; mark the source trusted before probing it');
      if (source.locality === 'remote' && request.allowRemote !== true) throw new FuryMcpHubError('remote MCP servers are probed only with allowRemote: true');
      const trust = st.trusted ? 'trusted' as const : 'untrusted' as const;
      let provisional: McpDirectRuntimeConfig;
      if (source.transport === 'stdio') {
        provisional = { source: { sourceId, transport: 'stdio', endpointFingerprint: '0'.repeat(64), trust }, command: raw.command!, args: [...raw.args], cwd: options.projectRoot };
      } else {
        // URL credentials and query strings (often API keys) are stripped: probes use no credential.
        const url = new URL(raw.url!);
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        provisional = { source: { sourceId, transport: 'streamable_http', endpointFingerprint: '0'.repeat(64), trust }, url: url.toString(), ...(source.locality === 'remote' ? { allowedHosts: [url.hostname] } : {}) };
      }
      const config = { ...provisional, source: { ...provisional.source, endpointFingerprint: deriveMcpDirectEndpointFingerprint(provisional) } } as McpDirectRuntimeConfig;
      try {
        const evidence = await probe(config);
        const tools = (evidence.lifecycle.inventory ?? []).map((t) => ({ name: t.name, riskClass: t.risk.riskClass, readOnly: t.risk.trust === 'trusted' && t.risk.resolvedHints.readOnly }));
        st.health = { at: now(), ok: evidence.lifecycle.healthy, toolCount: evidence.toolCount, ...(evidence.protocolVersion ? { protocolVersion: evidence.protocolVersion } : {}), tools };
      } catch (error) {
        st.health = { at: now(), ok: false, toolCount: 0, tools: [], error: (error instanceof Error ? error.message : 'probe failed').slice(0, 300) };
      }
      await save(state);
      return view(source, st);
    },
  });
}

export type FuryMcpHub = ReturnType<typeof createFuryMcpHub>;
