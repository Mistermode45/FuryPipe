// Universal Harness Hub — registry + safe discovery of agent runtimes.
//
// A harness (runtime) is independent of the model and the provider: Claude
// Code can run against Anthropic or an Anthropic-compatible local server,
// Codex against OpenAI or `--oss` local backends, and so on. The registry
// records, per harness, the preferred integration path (ACP/official protocol >
// SDK/API > A2A > structured CLI > PTY) and how it can be pointed at a local
// model. Discovery only resolves executables on PATH and runs `--version`
// with a timeout, no shell (Windows .cmd shims go through the hardened
// FuryLink cmd.exe boundary) and a minimal environment. It never reads
// credential files or auth state.
import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

import { furyLinkEnvValue, furyLinkPathCandidates, furyLinkWindowsCommandLine } from './fury-link/index.js';

export const FURY_HARNESS_DISCOVERY_FORMAT = 'furypipe-harness-discovery/v1' as const;

export type FuryHarnessIntegration = 'official-protocol' | 'official-sdk' | 'acp' | 'a2a' | 'structured-cli' | 'pty' | 'native';
export type FuryLocalModelMechanism = 'anthropic-compatible-base-url' | 'oss-flag' | 'provider-config' | 'native' | 'none' | 'unverified';
export type FuryEvidenceLevel = 'OFFICIAL_FACT' | 'COMMUNITY' | 'PRIOR_KNOWLEDGE' | 'BUILTIN';

export interface FuryHarnessDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly executables: readonly string[];
  readonly versionArgs: readonly string[];
  readonly integrations: readonly FuryHarnessIntegration[];
  readonly protocols: readonly ('mcp' | 'acp' | 'a2a')[];
  readonly skillsDirectories: readonly string[];
  readonly localModel: { readonly mechanism: FuryLocalModelMechanism; readonly note: string };
  readonly capabilities: {
    readonly streaming: boolean | 'unverified';
    readonly resume: boolean | 'unverified';
    readonly subagents: boolean | 'unverified';
  };
  readonly evidence: FuryEvidenceLevel;
  readonly source?: string;
}

export interface FuryHarnessStatus {
  readonly id: string;
  readonly displayName: string;
  readonly installed: boolean;
  readonly executable?: string;
  readonly version?: string;
  readonly versionStatus: 'ok' | 'not-installed' | 'timeout' | 'failed' | 'not-executed' | 'builtin';
  /** Authentication is never probed: FuryPipe does not read other tools' credentials. */
  readonly authentication: 'not-probed';
  readonly definition: FuryHarnessDefinition;
}

export interface FuryHarnessDiscovery {
  readonly format: typeof FURY_HARNESS_DISCOVERY_FORMAT;
  readonly platform: NodeJS.Platform;
  readonly harnesses: readonly FuryHarnessStatus[];
}

export type FuryVersionRunner = (file: string, args: readonly string[], options: { readonly timeoutMs: number; readonly env: NodeJS.ProcessEnv; readonly windowsVerbatimArguments?: boolean }) => Promise<{ readonly stdout: string; readonly stderr: string }>;

const def = (d: FuryHarnessDefinition): FuryHarnessDefinition => Object.freeze(d);

export const FURY_HARNESS_REGISTRY: readonly FuryHarnessDefinition[] = Object.freeze([
  def({
    id: 'furypipe-native', displayName: 'FuryPipe Native', executables: [], versionArgs: [],
    integrations: ['native'], protocols: ['mcp', 'acp', 'a2a'], skillsDirectories: ['.furypipe/skills'],
    localModel: { mechanism: 'native', note: 'Uses the FuryPipe model fabric directly.' },
    capabilities: { streaming: true, resume: true, subagents: true }, evidence: 'BUILTIN',
  }),
  def({
    id: 'claude-code', displayName: 'Claude Code', executables: ['claude'], versionArgs: ['--version'],
    integrations: ['official-sdk', 'structured-cli'], protocols: ['mcp'], skillsDirectories: ['.claude/skills'],
    localModel: { mechanism: 'anthropic-compatible-base-url', note: 'ANTHROPIC_BASE_URL to an Anthropic-compatible server (Ollama ≥0.14, LM Studio, llama.cpp).' },
    capabilities: { streaming: true, resume: true, subagents: true }, evidence: 'OFFICIAL_FACT',
    source: 'https://docs.ollama.com/integrations/claude-code',
  }),
  def({
    id: 'codex', displayName: 'Codex CLI', executables: ['codex'], versionArgs: ['--version'],
    integrations: ['official-sdk', 'structured-cli'], protocols: ['mcp'], skillsDirectories: ['.agents/skills'],
    localModel: { mechanism: 'oss-flag', note: '--oss with --local-provider ollama|lmstudio.' },
    capabilities: { streaming: true, resume: true, subagents: 'unverified' }, evidence: 'COMMUNITY',
    source: 'https://ynaito.dev/en/writing/codex-cli-local-models-oss/',
  }),
  def({
    id: 'gemini-cli', displayName: 'Gemini CLI', executables: ['gemini'], versionArgs: ['--version'],
    integrations: ['structured-cli'], protocols: ['mcp'], skillsDirectories: [],
    localModel: { mechanism: 'unverified', note: 'Not verified in this session.' },
    capabilities: { streaming: 'unverified', resume: 'unverified', subagents: 'unverified' }, evidence: 'PRIOR_KNOWLEDGE',
  }),
  def({
    id: 'opencode', displayName: 'OpenCode', executables: ['opencode'], versionArgs: ['--version'],
    integrations: ['acp', 'structured-cli'], protocols: ['mcp', 'acp'], skillsDirectories: ['.opencode/skills'],
    localModel: { mechanism: 'provider-config', note: 'Provider configuration; not re-verified in this session.' },
    capabilities: { streaming: 'unverified', resume: 'unverified', subagents: 'unverified' }, evidence: 'PRIOR_KNOWLEDGE',
  }),
  def({
    id: 'openclaw', displayName: 'OpenClaw', executables: ['openclaw'], versionArgs: ['--version'],
    integrations: ['acp', 'structured-cli'], protocols: ['mcp', 'acp'], skillsDirectories: [],
    localModel: { mechanism: 'provider-config', note: 'Gateway provider configuration.' },
    capabilities: { streaming: true, resume: true, subagents: true }, evidence: 'OFFICIAL_FACT',
    source: 'https://docs.openclaw.ai/cli/acp',
  }),
  def({
    id: 'openhands', displayName: 'OpenHands', executables: ['openhands'], versionArgs: ['--version'],
    integrations: ['structured-cli'], protocols: ['mcp'], skillsDirectories: [],
    localModel: { mechanism: 'provider-config', note: 'Not re-verified in this session.' },
    capabilities: { streaming: 'unverified', resume: 'unverified', subagents: 'unverified' }, evidence: 'PRIOR_KNOWLEDGE',
  }),
  def({
    id: 'goose', displayName: 'Goose', executables: ['goose'], versionArgs: ['--version'],
    integrations: ['structured-cli'], protocols: ['mcp'], skillsDirectories: [],
    localModel: { mechanism: 'provider-config', note: 'Not re-verified in this session.' },
    capabilities: { streaming: 'unverified', resume: 'unverified', subagents: 'unverified' }, evidence: 'PRIOR_KNOWLEDGE',
  }),
  def({
    id: 'kilo', displayName: 'Kilo', executables: ['kilo', 'kilocode'], versionArgs: ['--version'],
    integrations: ['structured-cli'], protocols: ['mcp'], skillsDirectories: [],
    localModel: { mechanism: 'unverified', note: 'Executable name and local-model path not verified in this session.' },
    capabilities: { streaming: 'unverified', resume: 'unverified', subagents: 'unverified' }, evidence: 'PRIOR_KNOWLEDGE',
  }),
  // Protocol-level entries: any agent speaking ACP (stdio) or A2A (remote) is driven through
  // the governed ACP/A2A runtimes of the foundation. They are configured, not found on PATH.
  def({
    id: 'acp-generic', displayName: 'Any ACP agent', executables: [], versionArgs: [],
    integrations: ['acp'], protocols: ['acp', 'mcp'], skillsDirectories: [],
    localModel: { mechanism: 'unverified', note: 'Depends on the configured agent.' },
    capabilities: { streaming: true, resume: 'unverified', subagents: 'unverified' }, evidence: 'BUILTIN',
    source: 'src/acp-external-client-runtime-node.ts',
  }),
  def({
    id: 'a2a-generic', displayName: 'Any A2A agent', executables: [], versionArgs: [],
    integrations: ['a2a'], protocols: ['a2a'], skillsDirectories: [],
    localModel: { mechanism: 'none', note: 'Remote agent: its models are its own.' },
    capabilities: { streaming: 'unverified', resume: 'unverified', subagents: 'unverified' }, evidence: 'BUILTIN',
    source: 'src/a2a-remote-adapter-node.ts',
  }),
]);

const VERSION_PATTERN = /\b(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]{1,32})?)\b/u;
const MAX_VERSION_OUTPUT = 16 * 1024;

function isExecutableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform === 'win32') return true;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve an executable name against PATH (and PATHEXT on Windows). Never consults a shell. */
export function resolveFuryExecutable(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(name)) return undefined;
  const pathValue = furyLinkEnvValue(env, 'PATH') ?? '';
  const sep = platform === 'win32' ? ';' : delimiter;
  for (const dir of pathValue.split(sep)) {
    if (!dir || !isAbsolute(dir)) continue; // relative PATH entries are a hijack vector
    for (const candidate of furyLinkPathCandidates(name, env, platform)) {
      const full = join(dir, candidate);
      if (isExecutableFile(full, platform)) return full;
    }
  }
  return undefined;
}

function minimalEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const keep = platform === 'win32'
    ? ['PATH', 'PATHEXT', 'SystemRoot', 'ComSpec', 'USERPROFILE', 'TEMP', 'TMP']
    : ['PATH', 'HOME', 'TMPDIR', 'LANG'];
  const out: NodeJS.ProcessEnv = { NO_COLOR: '1', CI: '1' };
  for (const key of keep) {
    const value = furyLinkEnvValue(env, key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const defaultRunner: FuryVersionRunner = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, [...args], {
    timeout: options.timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_VERSION_OUTPUT,
    env: options.env,
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: options.windowsVerbatimArguments ?? false,
    encoding: 'utf8',
  }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stdout, stderr }));
    else resolve({ stdout, stderr });
  });
});

export async function discoverFuryHarnesses(options: {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly timeoutMs?: number;
  readonly runner?: FuryVersionRunner;
  readonly registry?: readonly FuryHarnessDefinition[];
} = {}): Promise<FuryHarnessDiscovery> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 5_000, 100), 30_000);
  const runner = options.runner ?? defaultRunner;
  const registry = options.registry ?? FURY_HARNESS_REGISTRY;
  const runEnv = minimalEnv(env, platform);

  const harnesses = await Promise.all(registry.map(async (definition): Promise<FuryHarnessStatus> => {
    const baseStatus = { id: definition.id, displayName: definition.displayName, authentication: 'not-probed' as const, definition };
    if (definition.integrations.includes('native')) {
      return Object.freeze({ ...baseStatus, installed: true, versionStatus: 'builtin' as const });
    }
    // Protocol entries (ACP/A2A) are configured endpoints: nothing to look up or run.
    if (definition.executables.length === 0) return Object.freeze({ ...baseStatus, installed: false, versionStatus: 'not-executed' as const });
    let executable: string | undefined;
    for (const name of definition.executables) {
      executable = resolveFuryExecutable(name, env, platform);
      if (executable) break;
    }
    if (!executable) return Object.freeze({ ...baseStatus, installed: false, versionStatus: 'not-installed' as const });

    let file = executable;
    let args: readonly string[] = definition.versionArgs;
    let windowsVerbatimArguments = false;
    if (platform === 'win32' && /\.(?:cmd|bat)$/iu.test(executable)) {
      file = furyLinkEnvValue(env, 'ComSpec') ?? 'cmd.exe';
      args = ['/d', '/s', '/c', `"${furyLinkWindowsCommandLine([executable, ...definition.versionArgs])}"`];
      windowsVerbatimArguments = true;
    }
    try {
      const { stdout, stderr } = await runner(file, args, { timeoutMs, env: runEnv, windowsVerbatimArguments });
      const match = VERSION_PATTERN.exec(`${stdout}\n${stderr}`.slice(0, MAX_VERSION_OUTPUT));
      return Object.freeze({ ...baseStatus, installed: true, executable, ...(match ? { version: match[1] } : {}), versionStatus: match ? 'ok' as const : 'failed' as const });
    } catch (error) {
      const timedOut = (error as { killed?: boolean; code?: unknown }).killed === true || (error as { code?: unknown }).code === 'ETIMEDOUT';
      return Object.freeze({ ...baseStatus, installed: true, executable, versionStatus: timedOut ? 'timeout' as const : 'failed' as const });
    }
  }));

  return Object.freeze({ format: FURY_HARNESS_DISCOVERY_FORMAT, platform, harnesses: Object.freeze(harnesses) });
}
