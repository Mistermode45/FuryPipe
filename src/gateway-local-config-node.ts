import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  FURYPIPE_GATEWAY_DEFAULT_HOST,
  FURYPIPE_GATEWAY_DEFAULT_PORT,
  parseFuryPipeGatewayPort,
} from './runtime-defaults.js';

export type FuryGatewayLocalHost = '127.0.0.1' | '::1' | 'localhost';

export interface FuryGatewayLocalConfig {
  readonly host: FuryGatewayLocalHost;
  readonly port: number;
  readonly origin: string;
  readonly bootstrapTtlMs: number;
  readonly browserSessionTtlMs: number;
  readonly maxEventHistory: number;
}

export interface FuryGatewayLocalConfigSources {
  readonly file: string;
  readonly host: 'default' | 'file' | 'env';
  readonly port: 'default' | 'file' | 'env';
  readonly bootstrapTtlMs: 'default' | 'file';
  readonly browserSessionTtlMs: 'default' | 'file';
  readonly maxEventHistory: 'default' | 'file';
}

export interface FuryGatewayLocalConfigResolution {
  readonly config: FuryGatewayLocalConfig;
  readonly sources: FuryGatewayLocalConfigSources;
}

export interface FuryGatewayLocalConfigOptions {
  readonly file?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export type FuryGatewayLocalConfigErrorCode =
  | 'invalid-config'
  | 'config-too-large'
  | 'config-not-regular';

export class FuryGatewayLocalConfigError extends Error {
  readonly code: FuryGatewayLocalConfigErrorCode;

  constructor(code: FuryGatewayLocalConfigErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayLocalConfigError';
    this.code = code;
  }
}

const MAX_CONFIG_BYTES = 1024 * 1024;
const DEFAULT_BOOTSTRAP_TTL_MS = 60_000;
const DEFAULT_BROWSER_SESSION_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_EVENT_HISTORY = 512;

const GATEWAY_KEYS = new Set([
  'host',
  'port',
  'bootstrapTtlMs',
  'browserSessionTtlMs',
  'maxEventHistory',
]);

export function defaultFuryGatewayConfigFile(): string {
  return path.join(os.homedir(), '.config', 'furypipe', 'config.json');
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new FuryGatewayLocalConfigError(
      'invalid-config',
      `${label} must be an integer between ${min} and ${max}`,
    );
  }
  return value as number;
}

function parseHost(value: unknown, label: string): FuryGatewayLocalHost {
  if (value === '127.0.0.1' || value === '::1' || value === 'localhost') return value;
  throw new FuryGatewayLocalConfigError(
    'invalid-config',
    `${label} must be one of 127.0.0.1, ::1, localhost`,
  );
}

function parseFile(file: string): Record<string, unknown> {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }

  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new FuryGatewayLocalConfigError(
      'config-not-regular',
      'FuryPipe config must be a regular non-symlink file',
    );
  }
  if (stat.size > MAX_CONFIG_BYTES) {
    throw new FuryGatewayLocalConfigError(
      'config-too-large',
      `FuryPipe config exceeds ${MAX_CONFIG_BYTES} bytes`,
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new FuryGatewayLocalConfigError(
      'invalid-config',
      'FuryPipe config is not valid JSON',
    );
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new FuryGatewayLocalConfigError(
      'invalid-config',
      'FuryPipe config root must be a JSON object',
    );
  }
  return decoded as Record<string, unknown>;
}

function gatewayBlock(root: Record<string, unknown>): Record<string, unknown> {
  const value = root.gateway;
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FuryGatewayLocalConfigError(
      'invalid-config',
      'FuryPipe config gateway must be a JSON object',
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FuryGatewayLocalConfigError(
      'invalid-config',
      'FuryPipe config gateway must be a plain object',
    );
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!GATEWAY_KEYS.has(key)) {
      throw new FuryGatewayLocalConfigError(
        'invalid-config',
        `unsupported FuryPipe gateway config field: ${key}`,
      );
    }
  }
  return record;
}

function hostForOrigin(host: FuryGatewayLocalHost): string {
  return host === '::1' ? '[::1]' : host;
}

export function resolveFuryGatewayLocalConfig(
  options: FuryGatewayLocalConfigOptions = {},
): FuryGatewayLocalConfigResolution {
  const env = options.env ?? process.env;
  const file = options.file ?? (env.FURYPIPE_CONFIG?.trim() || defaultFuryGatewayConfigFile());
  const root = parseFile(file);
  const gateway = gatewayBlock(root);

  let hostSource: FuryGatewayLocalConfigSources['host'] =
    gateway.host === undefined ? 'default' : 'file';
  let host = gateway.host === undefined
    ? FURYPIPE_GATEWAY_DEFAULT_HOST
    : parseHost(gateway.host, 'gateway.host');

  const envHost = env.FURYPIPE_GATEWAY_HOST?.trim();
  if (envHost) {
    host = parseHost(envHost, 'FURYPIPE_GATEWAY_HOST');
    hostSource = 'env';
  }

  let portSource: FuryGatewayLocalConfigSources['port'] =
    gateway.port === undefined ? 'default' : 'file';
  let port = gateway.port === undefined
    ? FURYPIPE_GATEWAY_DEFAULT_PORT
    : boundedInteger(gateway.port, FURYPIPE_GATEWAY_DEFAULT_PORT, 1, 65535, 'gateway.port');

  const envPort = env.FURYPIPE_GATEWAY_PORT?.trim();
  if (envPort) {
    try {
      port = parseFuryPipeGatewayPort(envPort);
    } catch (error) {
      throw new FuryGatewayLocalConfigError(
        'invalid-config',
        (error as Error).message,
      );
    }
    portSource = 'env';
  }

  const bootstrapTtlMs = boundedInteger(
    gateway.bootstrapTtlMs,
    DEFAULT_BOOTSTRAP_TTL_MS,
    10_000,
    5 * 60_000,
    'gateway.bootstrapTtlMs',
  );
  const browserSessionTtlMs = boundedInteger(
    gateway.browserSessionTtlMs,
    DEFAULT_BROWSER_SESSION_TTL_MS,
    30_000,
    60 * 60_000,
    'gateway.browserSessionTtlMs',
  );
  const maxEventHistory = boundedInteger(
    gateway.maxEventHistory,
    DEFAULT_MAX_EVENT_HISTORY,
    1,
    4096,
    'gateway.maxEventHistory',
  );

  const origin = `http://${hostForOrigin(host)}:${port}`;

  return Object.freeze({
    config: Object.freeze({
      host,
      port,
      origin,
      bootstrapTtlMs,
      browserSessionTtlMs,
      maxEventHistory,
    }),
    sources: Object.freeze({
      file,
      host: hostSource,
      port: portSource,
      bootstrapTtlMs: gateway.bootstrapTtlMs === undefined ? 'default' : 'file',
      browserSessionTtlMs:
        gateway.browserSessionTtlMs === undefined ? 'default' : 'file',
      maxEventHistory: gateway.maxEventHistory === undefined ? 'default' : 'file',
    }),
  });
}