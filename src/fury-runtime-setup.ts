import { execFile } from 'node:child_process';
import os from 'node:os';

export const FURY_RUNTIME_SETUP_FORMAT = 'furypipe-runtime-setup/v1' as const;
export type FuryRuntimeSetupId = 'ollama' | 'lmstudio';

export interface FuryRuntimeSetupResult {
  readonly format: typeof FURY_RUNTIME_SETUP_FORMAT;
  readonly runtime: FuryRuntimeSetupId;
  readonly platform: NodeJS.Platform;
  readonly status: 'installed' | 'unsupported';
  readonly command: readonly string[];
  readonly next: string;
}

export interface FuryRuntimeSetupCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type FuryRuntimeSetupRunner = (
  executable: string,
  args: readonly string[],
  options: { readonly timeoutMs: number },
) => Promise<FuryRuntimeSetupCommandResult>;

const WINDOWS_PACKAGES: Readonly<Record<FuryRuntimeSetupId, string>> = Object.freeze({
  ollama: 'Ollama.Ollama',
  lmstudio: 'ElementLabs.LMStudio',
});

function bounded(value: string): string {
  return value.length > 8192 ? value.slice(-8192) : value;
}

const defaultRunner: FuryRuntimeSetupRunner = (executable, args, options) =>
  new Promise((resolve) => {
    execFile(
      executable,
      [...args],
      { windowsHide: true, shell: false, timeout: options.timeoutMs, maxBuffer: 256 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const rawCode = (error as NodeJS.ErrnoException & { code?: number | string }).code;
          const code = typeof rawCode === 'number' ? rawCode : -1;
          resolve({ exitCode: code, stdout: bounded(String(stdout ?? '')), stderr: bounded(String(stderr ?? error.message)) });
          return;
        }
        resolve({ exitCode: 0, stdout: bounded(String(stdout ?? '')), stderr: bounded(String(stderr ?? '')) });
      },
    );
  });

export async function installFuryLocalRuntime(
  runtime: FuryRuntimeSetupId,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly runner?: FuryRuntimeSetupRunner;
    readonly timeoutMs?: number;
  } = {},
): Promise<FuryRuntimeSetupResult> {
  if (runtime !== 'ollama' && runtime !== 'lmstudio') throw new TypeError('unsupported runtime setup id');
  const platform = options.platform ?? os.platform();

  if (platform !== 'win32') {
    return Object.freeze({
      format: FURY_RUNTIME_SETUP_FORMAT,
      runtime,
      platform,
      status: 'unsupported',
      command: Object.freeze([]),
      next: 'Automatic installation is currently available on Windows; use the runtime setup guide on this platform.',
    });
  }

  const pkg = WINDOWS_PACKAGES[runtime];
  const command = Object.freeze([
    'winget', 'install', '--id', pkg, '--exact', '--source', 'winget', '--silent',
    '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity',
  ]);
  const result = await (options.runner ?? defaultRunner)(
    command[0]!,
    command.slice(1),
    { timeoutMs: Math.min(Math.max(options.timeoutMs ?? 10 * 60_000, 30_000), 15 * 60_000) },
  );

  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout || 'winget failed').replace(/[\r\n]+/gu, ' ').slice(0, 400);
    throw Object.assign(new Error(`${runtime} installation failed: ${detail}`), { status: 502 });
  }

  return Object.freeze({
    format: FURY_RUNTIME_SETUP_FORMAT,
    runtime,
    platform,
    status: 'installed',
    command,
    next: runtime === 'ollama'
      ? 'Ollama is installed. FuryPipe will detect its local API automatically.'
      : 'LM Studio is installed. Start its local server once and FuryPipe will detect it automatically.',
  });
}
