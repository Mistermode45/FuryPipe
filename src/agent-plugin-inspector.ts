import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isIP } from 'node:net';

export const AGENT_PLUGINS_SPEC_VERSION = '1.0.0' as const;
export const AGENT_PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json' as const;
export const AGENT_PLUGIN_MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json' as const;

const MAX_JSON_BYTES = 256 * 1024;
const MAX_SKILLS = 256;
const MAX_MCP_SERVERS = 128;
const PLUGIN_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;
const SERVER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const MANIFEST_KEYS = new Set([
  '$schema', 'name', 'version', 'description', 'author', 'homepage',
  'repository', 'license', 'keywords', 'extensions',
]);
const AUTHOR_KEYS = new Set(['name', 'email', 'url']);
const MCP_TOP_LEVEL_KEYS = new Set(['$schema', 'mcpServers']);
const STDIO_KEYS = new Set(['type', 'command', 'args', 'env', 'cwd']);
const REMOTE_KEYS = new Set(['type', 'url', 'headers']);
const CREDENTIAL_HEADER_NAMES = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie',
  'x-api-key', 'api-key', 'x-goog-api-key',
]);
const SECRET_LIKE_ENV = /(?:^|_)(?:api_?key|token|secret|password|passwd|credential|private_?key)(?:$|_)/iu;

export interface AgentPluginManifestInspection {
  readonly schema: typeof AGENT_PLUGIN_SCHEMA;
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly author?: {
    readonly name?: string;
    readonly email?: string;
    readonly url?: string;
  };
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly keywords: readonly string[];
  readonly extensionNamespaces: readonly string[];
  readonly ignoredUnknownFields: readonly string[];
}

export interface AgentPluginSkillDiscovery {
  readonly directory: string;
  readonly skillMd: string;
  readonly validation: 'NOT_EXECUTED';
  readonly reason: 'requires-agent-skills-validator';
}

export type AgentPluginMcpTransport = 'stdio' | 'streamable-http' | 'sse';

export interface AgentPluginMcpServerInspection {
  readonly id: string;
  readonly transport: AgentPluginMcpTransport;
  readonly command?: string;
  readonly url?: string;
  readonly cwd?: string;
  readonly argumentCount: number;
  readonly environmentNames: readonly string[];
  readonly headerNames: readonly string[];
  readonly furyPipeEligible: boolean;
  readonly blockers: readonly string[];
}

export interface AgentPluginPackageInspection {
  readonly format: 'furypipe-agent-plugin-inspection/v1';
  readonly specificationVersion: typeof AGENT_PLUGINS_SPEC_VERSION;
  readonly pluginRoot: string;
  readonly manifest: AgentPluginManifestInspection;
  readonly skills: readonly AgentPluginSkillDiscovery[];
  readonly mcp: {
    readonly present: boolean;
    readonly configurationValid: boolean;
    readonly servers: readonly AgentPluginMcpServerInspection[];
    readonly warnings: readonly string[];
  };
  readonly execution: {
    readonly packageInstalled: false;
    readonly skillExecuted: false;
    readonly subprocessExecuted: false;
    readonly networkConnectionExecuted: false;
  };
}

function boundedString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value.includes('\0')) {
    throw new Error(`${label} must be a bounded non-empty string`);
  }
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayOfStrings(value: unknown, label: string, maxItems: number, maxLength: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must be a bounded string array`);
  return Object.freeze(value.map((item, index) => boundedString(item, `${label}[${index}]`, maxLength)));
}

function readBoundedJson(path: string, label: string): unknown {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`${label} must resolve to a regular file`);
  if (stat.size < 2 || stat.size > MAX_JSON_BYTES) throw new Error(`${label} exceeds its size boundary`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function realRoot(root: string): string {
  const raw = boundedString(root, 'Agent Plugin root', 4096);
  const resolved = realpathSync(resolve(raw));
  if (!statSync(resolved).isDirectory()) throw new Error('Agent Plugin root must be a directory');
  return resolved;
}

function contained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function resolveContainedExisting(root: string, path: string, label: string): string {
  const resolved = realpathSync(path);
  if (!contained(root, resolved)) throw new Error(`${label} resolves outside the plugin root`);
  return resolved;
}

function fileWithinRoot(root: string, path: string, label: string): string {
  const resolved = resolveContainedExisting(root, path, label);
  if (!statSync(resolved).isFile()) throw new Error(`${label} must resolve to a regular file`);
  return resolved;
}

function directoryWithinRoot(root: string, path: string, label: string): string {
  const resolved = resolveContainedExisting(root, path, label);
  if (!statSync(resolved).isDirectory()) throw new Error(`${label} must resolve to a directory`);
  return resolved;
}

function validatePluginName(name: string): void {
  if (!PLUGIN_NAME.test(name) || name.includes('--') || name.includes('..')) {
    throw new Error('Agent Plugin name violates the v1 name constraints');
  }
}

function optionalString(value: unknown, label: string, max: number): string | undefined {
  return value === undefined ? undefined : boundedString(value, label, max);
}

function inspectManifest(root: string): AgentPluginManifestInspection {
  const manifestPath = fileWithinRoot(root, join(root, 'plugin.json'), 'plugin.json');
  const manifest = object(readBoundedJson(manifestPath, 'plugin.json'), 'plugin.json');
  if (manifest.$schema !== AGENT_PLUGIN_SCHEMA) {
    throw new Error('plugin.json targets an unsupported Agent Plugins schema');
  }

  const name = boundedString(manifest.name, 'plugin.json name', 64);
  validatePluginName(name);
  const unknown = Object.keys(manifest).filter((key) => !MANIFEST_KEYS.has(key)).sort();
  const version = optionalString(manifest.version, 'plugin.json version', 128);
  const description = optionalString(manifest.description, 'plugin.json description', 4096);
  const homepage = optionalString(manifest.homepage, 'plugin.json homepage', 2048);
  const repository = optionalString(manifest.repository, 'plugin.json repository', 2048);
  const license = optionalString(manifest.license, 'plugin.json license', 256);

  let author: AgentPluginManifestInspection['author'];
  if (manifest.author !== undefined) {
    const rawAuthor = object(manifest.author, 'plugin.json author');
    if (Object.keys(rawAuthor).some((key) => !AUTHOR_KEYS.has(key))) {
      throw new Error('plugin.json author contains unknown fields');
    }
    author = Object.freeze({
      ...(rawAuthor.name === undefined ? {} : { name: boundedString(rawAuthor.name, 'author.name', 512) }),
      ...(rawAuthor.email === undefined ? {} : { email: boundedString(rawAuthor.email, 'author.email', 512) }),
      ...(rawAuthor.url === undefined ? {} : { url: boundedString(rawAuthor.url, 'author.url', 2048) }),
    });
  }

  const keywords = manifest.keywords === undefined
    ? Object.freeze([] as string[])
    : arrayOfStrings(manifest.keywords, 'plugin.json keywords', 128, 256);

  let extensionNamespaces: readonly string[] = Object.freeze([]);
  if (manifest.extensions !== undefined
    && manifest.extensions
    && typeof manifest.extensions === 'object'
    && !Array.isArray(manifest.extensions)) {
    extensionNamespaces = Object.freeze(Object.keys(manifest.extensions as Record<string, unknown>).sort());
  }

  return Object.freeze({
    schema: AGENT_PLUGIN_SCHEMA,
    name,
    ...(version === undefined ? {} : { version }),
    ...(description === undefined ? {} : { description }),
    ...(author === undefined ? {} : { author }),
    ...(homepage === undefined ? {} : { homepage }),
    ...(repository === undefined ? {} : { repository }),
    ...(license === undefined ? {} : { license }),
    keywords,
    extensionNamespaces,
    ignoredUnknownFields: Object.freeze(unknown),
  });
}

function discoverSkills(root: string): readonly AgentPluginSkillDiscovery[] {
  const path = join(root, 'skills');
  try {
    lstatSync(path);
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ENOENT') return Object.freeze([]);
    throw caught;
  }

  const skillsRoot = directoryWithinRoot(root, path, 'skills/');
  const entries = readdirSync(skillsRoot, { withFileTypes: true });
  if (entries.length > MAX_SKILLS) throw new Error('Agent Plugin contains too many skill candidates');

  const discoveries: AgentPluginSkillDiscovery[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const skillPath = join(skillsRoot, entry.name);
    let resolvedSkillDir: string;
    try {
      resolvedSkillDir = directoryWithinRoot(root, skillPath, `skill ${entry.name}`);
    } catch {
      continue;
    }
    let resolvedSkillMd: string;
    try {
      resolvedSkillMd = fileWithinRoot(root, join(resolvedSkillDir, 'SKILL.md'), `skill ${entry.name} SKILL.md`);
    } catch {
      continue;
    }
    discoveries.push(Object.freeze({
      directory: `./skills/${entry.name}`,
      skillMd: `./${relative(root, resolvedSkillMd).split(sep).join('/')}`,
      validation: 'NOT_EXECUTED',
      reason: 'requires-agent-skills-validator',
    }));
  }
  return Object.freeze(discoveries);
}

function normalizeLoopbackHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/gu, '');
}

function isLoopbackHost(hostname: string): boolean {
  const host = normalizeLoopbackHost(hostname);
  if (host === 'localhost' || host === '::1') return true;
  if (isIP(host) === 4) return Number(host.split('.')[0]) === 127;
  return false;
}

function rootedExpressionSafe(value: string, token: '${PLUGIN_ROOT}' | '${PLUGIN_DATA}'): boolean {
  if (value === token) return true;
  if (!value.startsWith(`${token}/`)) return false;
  const suffix = value.slice(token.length + 1);
  return suffix.length > 0 && suffix.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function pluginRelativeSafe(root: string, value: string): boolean {
  return value.startsWith('./') && !value.includes('\0') && contained(root, resolve(root, value));
}

function stringRecord(value: unknown, label: string, maxEntries: number): Record<string, string> {
  if (value === undefined) return {};
  const raw = object(value, label);
  if (Object.keys(raw).length > maxEntries) throw new Error(`${label} has too many entries`);
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(raw)) {
    if (!key || key.length > 256 || key.includes('\0')) throw new Error(`${label} key is invalid`);
    output[key] = boundedString(item, `${label}.${key}`, 4096);
  }
  return output;
}

function inspectStdio(root: string, id: string, raw: Record<string, unknown>): AgentPluginMcpServerInspection {
  const blockers: string[] = [];
  const unknown = Object.keys(raw).filter((key) => !STDIO_KEYS.has(key));
  if (unknown.length > 0) blockers.push(`unknown stdio fields: ${unknown.sort().join(', ')}`);

  let command: string | undefined;
  try {
    command = boundedString(raw.command, `mcp server ${id} command`, 4096);
    if (/[\s\u0000-\u001f\u007f]/u.test(command)) blockers.push('stdio command must be a single executable token');
    else if (command.startsWith('./')) {
      if (!pluginRelativeSafe(root, command)) blockers.push('stdio command escapes the plugin root');
      else {
        try { fileWithinRoot(root, resolve(root, command), 'stdio command'); }
        catch { blockers.push('stdio plugin-relative command is missing or escapes the plugin root'); }
      }
    } else if (command.includes('/') || command.includes('\\')) {
      blockers.push('stdio command must be a bare executable or ./ plugin-relative path');
    }
  } catch {
    blockers.push('stdio command is invalid');
  }

  const args = (() => {
    try { return raw.args === undefined ? Object.freeze([] as string[]) : arrayOfStrings(raw.args, `mcp server ${id} args`, 256, 4096); }
    catch { blockers.push('stdio args are invalid'); return Object.freeze([] as string[]); }
  })();

  let env: Record<string, string> = {};
  try { env = stringRecord(raw.env, `mcp server ${id} env`, 128); }
  catch { blockers.push('stdio env is invalid'); }
  const environmentNames = Object.keys(env).sort();
  if (environmentNames.some((name) => name === 'PLUGIN_ROOT' || name === 'PLUGIN_DATA')) {
    blockers.push('stdio env must not override PLUGIN_ROOT or PLUGIN_DATA');
  }
  if (environmentNames.some((name) => SECRET_LIKE_ENV.test(name))) {
    blockers.push('stdio env declares a secret-like variable; FuryPipe requires host-owned secret injection');
  }

  let cwd: string | undefined;
  if (raw.cwd !== undefined) {
    try {
      cwd = boundedString(raw.cwd, `mcp server ${id} cwd`, 4096);
      if (cwd.startsWith('./')) {
        if (!pluginRelativeSafe(root, cwd)) blockers.push('stdio cwd escapes the plugin root');
      } else if (!rootedExpressionSafe(cwd, '${PLUGIN_ROOT}') && !rootedExpressionSafe(cwd, '${PLUGIN_DATA}')) {
        blockers.push('stdio cwd must be ./, PLUGIN_ROOT or PLUGIN_DATA rooted');
      }
    } catch {
      blockers.push('stdio cwd is invalid');
    }
  }

  return Object.freeze({
    id,
    transport: 'stdio',
    ...(command === undefined ? {} : { command }),
    ...(cwd === undefined ? {} : { cwd }),
    argumentCount: args.length,
    environmentNames: Object.freeze(environmentNames),
    headerNames: Object.freeze([]),
    furyPipeEligible: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}

function inspectRemote(
  id: string,
  raw: Record<string, unknown>,
  transport: 'streamable-http' | 'sse',
): AgentPluginMcpServerInspection {
  const blockers: string[] = [];
  const unknown = Object.keys(raw).filter((key) => !REMOTE_KEYS.has(key));
  if (unknown.length > 0) blockers.push(`unknown remote fields: ${unknown.sort().join(', ')}`);

  let urlValue: string | undefined;
  try {
    urlValue = boundedString(raw.url, `mcp server ${id} url`, 4096);
    const url = new URL(urlValue);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
      blockers.push('remote MCP URL violates transport rules');
    } else if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
      blockers.push('non-loopback remote MCP requires HTTPS');
    }
  } catch {
    blockers.push('remote MCP URL is invalid');
  }

  let headers: Record<string, string> = {};
  try { headers = stringRecord(raw.headers, `mcp server ${id} headers`, 128); }
  catch { blockers.push('remote MCP headers are invalid'); }

  const canonicalHeaders = new Set<string>();
  const headerNames: string[] = [];
  for (const name of Object.keys(headers)) {
    const canonical = name.toLowerCase();
    if (!HEADER_NAME.test(name) || name.length > 128) blockers.push(`invalid header name: ${name}`);
    if (canonicalHeaders.has(canonical)) blockers.push(`duplicate case-insensitive header: ${canonical}`);
    canonicalHeaders.add(canonical);
    headerNames.push(canonical);
    if (CREDENTIAL_HEADER_NAMES.has(canonical)) {
      blockers.push(`credential-bearing header is not allowed in portable plugin data: ${canonical}`);
    }
  }

  return Object.freeze({
    id,
    transport,
    ...(urlValue === undefined ? {} : { url: urlValue }),
    argumentCount: 0,
    environmentNames: Object.freeze([]),
    headerNames: Object.freeze([...new Set(headerNames)].sort()),
    furyPipeEligible: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}

function inspectMcp(root: string): AgentPluginPackageInspection['mcp'] {
  const path = join(root, 'mcp.json');
  try { lstatSync(path); }
  catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({ present: false, configurationValid: true, servers: Object.freeze([]), warnings: Object.freeze([]) });
    }
    throw caught;
  }

  let raw: Record<string, unknown>;
  try {
    const resolved = fileWithinRoot(root, path, 'mcp.json');
    raw = object(readBoundedJson(resolved, 'mcp.json'), 'mcp.json');
  } catch (caught) {
    return Object.freeze({
      present: true,
      configurationValid: false,
      servers: Object.freeze([]),
      warnings: Object.freeze([caught instanceof Error ? caught.message : 'mcp.json is invalid']),
    });
  }

  const unknown = Object.keys(raw).filter((key) => !MCP_TOP_LEVEL_KEYS.has(key));
  const warnings: string[] = [];
  if (unknown.length > 0) warnings.push(`unknown mcp.json fields: ${unknown.sort().join(', ')}`);
  if (raw.$schema !== AGENT_PLUGIN_MCP_SCHEMA) warnings.push('mcp.json targets an unsupported Agent Plugins schema');
  if (warnings.length > 0) {
    return Object.freeze({ present: true, configurationValid: false, servers: Object.freeze([]), warnings: Object.freeze(warnings) });
  }

  let serversRaw: Record<string, unknown>;
  try { serversRaw = object(raw.mcpServers, 'mcp.json mcpServers'); }
  catch {
    return Object.freeze({
      present: true,
      configurationValid: false,
      servers: Object.freeze([]),
      warnings: Object.freeze(['mcpServers is invalid']),
    });
  }
  if (Object.keys(serversRaw).length > MAX_MCP_SERVERS) {
    return Object.freeze({
      present: true,
      configurationValid: false,
      servers: Object.freeze([]),
      warnings: Object.freeze(['mcp.json contains too many server entries']),
    });
  }

  const servers: AgentPluginMcpServerInspection[] = [];
  for (const [id, value] of Object.entries(serversRaw).sort(([a], [b]) => a.localeCompare(b))) {
    if (!SERVER_ID.test(id)) { warnings.push(`invalid MCP server id skipped: ${id}`); continue; }
    let server: Record<string, unknown>;
    try { server = object(value, `mcp server ${id}`); }
    catch { warnings.push(`invalid MCP server entry skipped: ${id}`); continue; }

    if (server.type === 'stdio') servers.push(inspectStdio(root, id, server));
    else if (server.type === 'streamable-http' || server.type === 'sse') {
      servers.push(inspectRemote(id, server, server.type));
    } else warnings.push(`unsupported MCP server type skipped: ${id}`);
  }

  return Object.freeze({
    present: true,
    configurationValid: true,
    servers: Object.freeze(servers),
    warnings: Object.freeze(warnings),
  });
}

export function inspectAgentPluginPackage(rootPath: string): AgentPluginPackageInspection {
  const root = realRoot(rootPath);
  return Object.freeze({
    format: 'furypipe-agent-plugin-inspection/v1',
    specificationVersion: AGENT_PLUGINS_SPEC_VERSION,
    pluginRoot: root,
    manifest: inspectManifest(root),
    skills: discoverSkills(root),
    mcp: inspectMcp(root),
    execution: Object.freeze({
      packageInstalled: false,
      skillExecuted: false,
      subprocessExecuted: false,
      networkConnectionExecuted: false,
    }),
  });
}
