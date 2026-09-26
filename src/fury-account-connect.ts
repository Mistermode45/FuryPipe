import { spawn } from 'node:child_process';

import type { FuryHarnessDiscovery } from './fury-harness-hub.js';
import { furyLinkEnvValue, furyLinkWindowsCommandLine } from './fury-link/index.js';

export type FuryAccountProvider = 'anthropic' | 'openai' | 'google';
export type FuryAccountLoginLauncher = (
  executable: string,
  args: readonly string[],
  options: { readonly windowsVerbatimArguments?: boolean; readonly env: NodeJS.ProcessEnv },
) => void;

const DEFINITIONS = Object.freeze({
  anthropic: { harnessId: 'claude-code', label: 'Claude / Anthropic', args: ['auth', 'login'] as const },
  openai: { harnessId: 'codex', label: 'ChatGPT / OpenAI / Codex', args: ['login'] as const },
  google: { harnessId: 'gemini-cli', label: 'Gemini / Google', args: [] as const },
});

function loginEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keys = ['PATH','PATHEXT','SystemRoot','ComSpec','USERPROFILE','HOME','APPDATA','LOCALAPPDATA','TEMP','TMP','LANG'];
  const out: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = furyLinkEnvValue(env, key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const defaultLauncher: FuryAccountLoginLauncher = (executable, args, options) => {
  const child = spawn(executable, [...args], {
    detached: true,
    stdio: 'ignore',
    shell: false,
    windowsHide: false,
    windowsVerbatimArguments: options.windowsVerbatimArguments ?? false,
    env: options.env,
  });
  child.unref();
};

export function launchFuryAccountLogin(
  provider: FuryAccountProvider,
  discovery: FuryHarnessDiscovery,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly env?: NodeJS.ProcessEnv;
    readonly launcher?: FuryAccountLoginLauncher;
  } = {},
): { readonly provider: FuryAccountProvider; readonly label: string; readonly status: 'launched' | 'runtime-missing' | 'unsupported'; readonly runtime?: string; readonly next: string } {
  const definition = DEFINITIONS[provider];
  if (!definition) throw new TypeError('unsupported account provider');
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return Object.freeze({ provider, label: definition.label, status: 'unsupported', next: 'Automatic account sign-in launch is currently available on Windows.' });
  }
  const harness = discovery.harnesses.find((h) => h.id === definition.harnessId && h.installed && h.executable);
  if (!harness?.executable) {
    return Object.freeze({ provider, label: definition.label, status: 'runtime-missing', next: `${harness?.displayName ?? definition.harnessId} must be installed before FuryPipe can launch its official sign-in flow.` });
  }

  const env = options.env ?? process.env;
  let executable = harness.executable;
  let args: readonly string[] = definition.args;
  let windowsVerbatimArguments = false;
  if (/\.(?:cmd|bat)$/iu.test(executable)) {
    const comspec = furyLinkEnvValue(env, 'ComSpec') ?? 'cmd.exe';
    const command = furyLinkWindowsCommandLine([executable, ...definition.args]);
    executable = comspec;
    args = ['/d', '/s', '/c', `"${command}"`];
    windowsVerbatimArguments = true;
  }
  (options.launcher ?? defaultLauncher)(executable, args, { windowsVerbatimArguments, env: loginEnv(env) });

  return Object.freeze({
    provider,
    label: definition.label,
    status: 'launched',
    runtime: harness.displayName,
    next: provider === 'google'
      ? 'Gemini CLI opened in a separate console. Choose Sign in with Google and finish the browser flow.'
      : `${definition.label} sign-in opened in a separate console/browser. Finish the official login flow, then refresh Connections.`,
  });
}
