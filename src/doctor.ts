import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { discoverOpenClaw, type OpenClawDiscovery } from './openclaw.js';
import { createI18n } from './i18n/index.js';
import { CORE_CATALOGS } from './i18n/catalogs.js';
import { resolveSupportedLocale } from './i18n/runtime.js';

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
  readonly openclaw?: Pick<OpenClawDiscovery, 'format' | 'paths' | 'config' | 'workspace' | 'security'>;
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
  const openclaw = discoverOpenClaw();
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
    openclaw: {
      format: openclaw.format,
      paths: openclaw.paths,
      config: openclaw.config,
      workspace: openclaw.workspace,
      security: openclaw.security,
    },
  };
}

function normalizeSystemLocaleCandidate(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw || raw.length > 256 || raw.includes('\0')) return undefined;
  const upper = raw.toUpperCase();
  if (upper === 'C' || upper === 'POSIX' || upper.startsWith('C.')) return undefined;
  const base = raw.split('@', 1)[0]!.split('.', 1)[0]!.replaceAll('_', '-').trim();
  if (!base) return undefined;
  try {
    return new Intl.Locale(base).toString();
  } catch {
    return undefined;
  }
}

export interface DoctorLocaleOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly intlLocale?: string;
}

export function resolveDoctorLocale(
  explicitLocale?: string,
  options: DoctorLocaleOptions = {},
): string {
  const explicit = explicitLocale?.trim();
  if (explicit) {
    try {
      return new Intl.Locale(explicit).toString();
    } catch {
      throw new RangeError(`invalid BCP-47 locale: ${explicitLocale}`);
    }
  }

  const env = options.env ?? process.env;
  const preferences: string[] = [];
  const add = (value: string | undefined): void => {
    const normalized = normalizeSystemLocaleCandidate(value);
    if (normalized && !preferences.includes(normalized)) preferences.push(normalized);
  };

  add(env.LC_ALL);
  add(env.LC_MESSAGES);

  const language = env.LANGUAGE?.trim();
  if (language && language.length <= 1024 && !language.includes('\0')) {
    for (const value of language.split(':').slice(0, 8)) add(value);
  }

  add(env.LANG);
  add(options.intlLocale ?? Intl.DateTimeFormat().resolvedOptions().locale);

  return resolveSupportedLocale(preferences, ['en', 'fr'], 'en');
}

export function renderDoctorReport(report: DoctorReport, json = false, locale = 'en'): string {
  if (json) return JSON.stringify(report, null, 2);
  const i18n = createI18n({ catalogs: CORE_CATALOGS, defaultLocale: 'en' });
  const t = (key: string): string => i18n.translate(locale, key);
  const check = (value: DoctorCheck): string => value.value ? `${value.status} (${value.value})` : value.status;
  return [
    t('doctor.title'),
    `${t('doctor.osArch')}: ${report.platform.os} / ${report.platform.arch}`,
    `${t('doctor.node')}: ${report.runtime.node}`,
    `${t('doctor.npm')}: ${check(report.runtime.npm)}`,
    `${t('doctor.pnpm')}: ${check(report.runtime.pnpm)}`,
    `${t('doctor.shell')}: ${report.platform.shell}`,
    `${t('doctor.listen')}: ${report.network.host}:${report.network.port}`,
    `${t('doctor.upstream')}: ${report.network.upstream}`,
    `${t('doctor.config')}: ${report.paths.config}`,
    `${t('doctor.events')}: ${report.paths.events}`,
    `${t('doctor.docker')}: ${check(report.tools.docker)}`,
    `${t('doctor.browserOpen')}: ${check(report.tools.browser)}`,
    `${t('doctor.claude')}: ${check(report.tools.claude)}`,
    `${t('doctor.codex')}: ${check(report.tools.codex)}`,
    `${t('doctor.openclaw')}: ${check(report.tools.openclaw)}`,
    ...(report.openclaw ? [
      `${t('doctor.openclawConfig')}: ${report.openclaw.config.status} (${report.openclaw.config.path})`,
      `${t('doctor.openclawWorkspace')}: ${report.openclaw.workspace.exists ? 'present' : 'missing'} (${report.openclaw.workspace.path})`,
      `${t('doctor.openclawSecrets')}: ${report.openclaw.config.secretBearingPaths.length}`,
    ] : []),
  ].join('\n');
}
