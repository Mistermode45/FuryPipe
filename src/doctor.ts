import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export interface DoctorCheck {
  readonly status: 'available' | 'unavailable' | 'configured' | 'not_configured';
  readonly value?: string;
}

export interface DoctorReport {
  readonly platform: {
    readonly os: string;
    readonly arch: string;
    readonly shell: string;
    readonly cwd: string;
    readonly executable: string;
  };
  readonly runtime: {
    readonly node: string;
    readonly npm: DoctorCheck;
    readonly pnpm: DoctorCheck;
  };
  readonly network: {
    readonly host: string;
    readonly port: number;
    readonly upstream: string;
  };
  readonly paths: {
    readonly config: string;
    readonly events: string;
  };
  readonly tools: {
    readonly docker: DoctorCheck;
    readonly browser: DoctorCheck;
    readonly claude: DoctorCheck;
    readonly codex: DoctorCheck;
    readonly openclaw: DoctorCheck;
  };
}

function commandVersion(command: string): DoctorCheck {
  try {
    const output = process.platform === 'win32' && (command === 'npm' || command === 'pnpm')
      ? execFileSync('cmd.exe', ['/d', '/s', '/c', `${command} --version`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      : execFileSync(command, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return output ? { status: 'available', value: output.split(/\r?\n/, 1)[0] } : { status: 'available' };
  } catch {
    return { status: 'unavailable' };
  }
}

function commandAvailable(command: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function browserCheck(): DoctorCheck {
  const candidates = process.platform === 'win32'
    ? ['explorer.exe']
    : process.platform === 'darwin'
      ? ['open']
      : ['xdg-open'];
  for (const candidate of candidates) {
    if (commandAvailable(candidate)) return { status: 'available', value: candidate };
  }
  return { status: 'unavailable' };
}

function configured(value: string | undefined, fallback: string): DoctorCheck {
  return value?.trim() ? { status: 'configured', value: fallback } : { status: 'not_configured' };
}

function safeUpstream(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return 'https://api.anthropic.com';
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[configured upstream]';
  }
}

/** Collect local platform facts only. Credentials and header values are never read. */
export function collectDoctorReport(): DoctorReport {
  const home = os.homedir();
  const port = Number(process.env.PORT ?? 47821);
  return {
    platform: {
      os: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
      shell: process.env.ComSpec ?? process.env.SHELL ?? 'unknown',
      cwd: process.cwd(),
      executable: process.execPath,
    },
    runtime: {
      node: process.versions.node,
      npm: commandVersion('npm'),
      pnpm: commandVersion('pnpm'),
    },
    network: {
      host: process.env.HOST?.trim() || '127.0.0.1',
      port: Number.isSafeInteger(port) && port > 0 && port <= 65535 ? port : 47821,
      upstream: safeUpstream(process.env.ANTHROPIC_UPSTREAM ?? process.env.PXPIPE_UPSTREAM),
    },
    paths: {
      config: process.env.PXPIPE_CONFIG ?? path.join(home, '.config', 'pxpipe', 'config.json'),
      events: process.env.PXPIPE_LOG ?? path.join(home, '.pxpipe', 'events.jsonl'),
    },
    tools: {
      docker: commandVersion('docker'),
      browser: browserCheck(),
      claude: commandVersion('claude'),
      codex: commandVersion('codex'),
      openclaw: commandVersion('openclaw'),
    },
  };
}

export function renderDoctorReport(report: DoctorReport, json = false): string {
  if (json) return JSON.stringify(report, null, 2);
  const check = (value: DoctorCheck): string => value.value ? `${value.status} (${value.value})` : value.status;
  return [
    'FuryPipe doctor',
    `OS/arch: ${report.platform.os} / ${report.platform.arch}`,
    `Node: ${report.runtime.node}`,
    `npm: ${check(report.runtime.npm)}`,
    `pnpm: ${check(report.runtime.pnpm)}`,
    `Shell: ${report.platform.shell}`,
    `Listen: ${report.network.host}:${report.network.port}`,
    `Upstream: ${report.network.upstream}`,
    `Config: ${report.paths.config}`,
    `Events: ${report.paths.events}`,
    `Docker: ${check(report.tools.docker)}`,
    `Browser open: ${check(report.tools.browser)}`,
    `Claude: ${check(report.tools.claude)}`,
    `Codex: ${check(report.tools.codex)}`,
    `OpenClaw: ${check(report.tools.openclaw)}`,
  ].join('\n');
}
