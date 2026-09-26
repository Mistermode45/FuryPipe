import { execFile } from 'node:child_process';

import type { FuryHarnessDiscovery } from './fury-harness-hub.js';
import { furyLinkEnvValue, furyLinkWindowsCommandLine } from './fury-link/index.js';

export type FuryAccountProviderId = 'anthropic' | 'openai' | 'google';
export type FuryAccountVerificationState = 'authenticated' | 'not-authenticated' | 'unknown' | 'not-probed';

export interface FuryAccountVerification {
  readonly provider: FuryAccountProviderId;
  readonly state: FuryAccountVerificationState;
  readonly method?: string;
  readonly subscription?: string;
  readonly runtime?: string;
}

export interface FuryAccountStatusCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type FuryAccountStatusRunner = (
  executable: string,
  args: readonly string[],
  options: {
    readonly timeoutMs: number;
    readonly env: NodeJS.ProcessEnv;
    readonly windowsVerbatimArguments?: boolean;
  },
) => Promise<FuryAccountStatusCommandResult>;

const MAX_OUTPUT = 64 * 1024;

function bounded(value: string): string {
  return value.length > MAX_OUTPUT ? value.slice(-MAX_OUTPUT) : value;
}

function minimalEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const keys = platform === 'win32'
    ? ['PATH','PATHEXT','SystemRoot','ComSpec','USERPROFILE','HOME','APPDATA','LOCALAPPDATA','TEMP','TMP','LANG']
    : ['PATH','HOME','XDG_CONFIG_HOME','TMPDIR','LANG'];
  const out: NodeJS.ProcessEnv = { NO_COLOR: '1' };
  for (const key of keys) {
    const value = furyLinkEnvValue(env, key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const defaultRunner: FuryAccountStatusRunner = (executable, args, options) =>
  new Promise((resolve) => {
    execFile(executable, [...args], {
      shell: false,
      windowsHide: true,
      timeout: options.timeoutMs,
      maxBuffer: MAX_OUTPUT,
      env: options.env,
      windowsVerbatimArguments: options.windowsVerbatimArguments ?? false,
    }, (error, stdout, stderr) => {
      const rawCode = (error as (NodeJS.ErrnoException & { code?: number | string }) | null)?.code;
      resolve({
        exitCode: error ? (typeof rawCode === 'number' ? rawCode : 1) : 0,
        stdout: bounded(String(stdout ?? '')),
        stderr: bounded(String(stderr ?? error?.message ?? '')),
      });
    });
  });

function commandFor(
  executable: string,
  args: readonly string[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): { readonly executable: string; readonly args: readonly string[]; readonly windowsVerbatimArguments: boolean } {
  if (platform === 'win32' && /\.(?:cmd|bat)$/iu.test(executable)) {
    const comspec = furyLinkEnvValue(env, 'ComSpec') ?? 'cmd.exe';
    return Object.freeze({
      executable: comspec,
      args: Object.freeze(['/d','/s','/c',`"${furyLinkWindowsCommandLine([executable, ...args])}"`]),
      windowsVerbatimArguments: true,
    });
  }
  return Object.freeze({ executable, args: Object.freeze([...args]), windowsVerbatimArguments: false });
}

function claudeVerification(result: FuryAccountStatusCommandResult): FuryAccountVerification {
  const raw = `${result.stdout}\n${result.stderr}`.trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const body = JSON.parse(raw.slice(start, end + 1)) as {
        loggedIn?: unknown;
        authMethod?: unknown;
        subscriptionType?: unknown;
      };
      if (body.loggedIn === true) {
        return Object.freeze({
          provider:'anthropic',
          state:'authenticated',
          ...(typeof body.authMethod === 'string' ? { method:body.authMethod.slice(0,80) } : {}),
          ...(typeof body.subscriptionType === 'string' && body.subscriptionType ? { subscription:body.subscriptionType.slice(0,80) } : {}),
          runtime:'Claude Code',
        });
      }
      if (body.loggedIn === false) return Object.freeze({ provider:'anthropic', state:'not-authenticated', runtime:'Claude Code' });
    } catch {}
  }
  return Object.freeze({ provider:'anthropic', state: result.exitCode === 0 ? 'unknown' : 'not-authenticated', runtime:'Claude Code' });
}

function codexVerification(result: FuryAccountStatusCommandResult): FuryAccountVerification {
  const raw = `${result.stdout}\n${result.stderr}`.trim();
  if (/Logged in using ChatGPT/iu.test(raw)) return Object.freeze({ provider:'openai', state:'authenticated', method:'ChatGPT', runtime:'Codex CLI' });
  if (/Logged in using an API key/iu.test(raw)) return Object.freeze({ provider:'openai', state:'authenticated', method:'API key', runtime:'Codex CLI' });
  const match = /Logged in using\s+([^\r\n]+)/iu.exec(raw);
  if (match) return Object.freeze({ provider:'openai', state:'authenticated', method:match[1]!.trim().slice(0,80), runtime:'Codex CLI' });
  if (/Not logged in/iu.test(raw)) return Object.freeze({ provider:'openai', state:'not-authenticated', runtime:'Codex CLI' });
  return Object.freeze({ provider:'openai', state: result.exitCode === 0 ? 'unknown' : 'not-authenticated', runtime:'Codex CLI' });
}

/**
 * Verify account state only through official CLI status commands.
 * FuryPipe does not read browser cookies, OAuth stores, keychains or token files.
 */
export async function probeFuryAccountStatuses(
  discovery: FuryHarnessDiscovery,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
    readonly runner?: FuryAccountStatusRunner;
  } = {},
): Promise<Readonly<Record<FuryAccountProviderId, FuryAccountVerification>>> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const runner = options.runner ?? defaultRunner;
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 5_000, 500), 15_000);
  const result: Record<FuryAccountProviderId, FuryAccountVerification> = {
    anthropic: Object.freeze({ provider:'anthropic', state:'not-probed' }),
    openai: Object.freeze({ provider:'openai', state:'not-probed' }),
    google: Object.freeze({ provider:'google', state:'not-probed' }),
  };

  const claude = discovery.harnesses.find((h) => h.id === 'claude-code' && h.installed && h.executable);
  if (claude?.executable) {
    const cmd = commandFor(claude.executable, ['auth','status'], platform, env);
    result.anthropic = claudeVerification(await runner(cmd.executable, cmd.args, {
      timeoutMs, env:minimalEnv(env,platform), windowsVerbatimArguments:cmd.windowsVerbatimArguments,
    }));
  }

  const codex = discovery.harnesses.find((h) => h.id === 'codex' && h.installed && h.executable);
  if (codex?.executable) {
    const cmd = commandFor(codex.executable, ['login','status'], platform, env);
    result.openai = codexVerification(await runner(cmd.executable, cmd.args, {
      timeoutMs, env:minimalEnv(env,platform), windowsVerbatimArguments:cmd.windowsVerbatimArguments,
    }));
  }

  // Gemini CLI currently exposes authentication through its interactive /auth
  // UX rather than a stable non-interactive account-status command.
  return Object.freeze(result);
}
