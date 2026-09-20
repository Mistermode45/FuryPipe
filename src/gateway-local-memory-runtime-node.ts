import * as fs from 'node:fs';
import { isAbsolute } from 'node:path';

import {
  createRecoveryStore,
  type RecoveryStore,
} from './core/recovery-store.js';
import {
  createContinuousMemoryEngine,
  type ContinuousMemoryAnalyzer,
  type ContinuousMemoryEngine,
  type ContinuousMemoryPolicy,
  type ContinuousMemoryScopes,
} from './continuous-memory.js';

export const FURY_GATEWAY_LOCAL_MEMORY_CONFIG_FORMAT =
  'furypipe-gateway-local-memory-config/v1' as const;

export interface FuryGatewayLocalMemoryPolicySummary {
  readonly allowInferred: boolean;
  readonly allowSensitive: boolean;
}

export type FuryGatewayLocalMemoryConfig =
  | {
      readonly format: typeof FURY_GATEWAY_LOCAL_MEMORY_CONFIG_FORMAT;
      readonly enabled: false;
    }
  | {
      readonly format: typeof FURY_GATEWAY_LOCAL_MEMORY_CONFIG_FORMAT;
      readonly enabled: true;
      readonly encrypted: true;
      readonly scopeKinds: readonly (keyof ContinuousMemoryScopes)[];
      readonly policy: FuryGatewayLocalMemoryPolicySummary;
      readonly learningEnabled: boolean;
      readonly quotas: {
        readonly maxObjectBytes: number;
        readonly maxTotalBytes: number;
        readonly maxGlobalBytes: number;
      };
    };

export interface FuryGatewayLocalMemoryRuntime {
  readonly config: FuryGatewayLocalMemoryConfig;
  readonly engine?: ContinuousMemoryEngine;
  readonly recovery?: RecoveryStore;
  /** Raw host-owned scope IDs. Process-local only; never serialize this runtime. */
  readonly scopes?: ContinuousMemoryScopes;
}

export interface FuryGatewayLocalMemoryRuntimeOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly file?: string;
  /** Optional process-local analyzer. Never sourced from browser/config JSON. */
  readonly analyzer?: ContinuousMemoryAnalyzer;
}

interface MemoryFileConfig {
  readonly recovery: {
    readonly root: string;
    readonly namespace: string;
    readonly maxObjectBytes: number;
    readonly maxTotalBytes: number;
    readonly maxGlobalBytes: number;
    readonly encryption: {
      readonly activeKeyId: string;
      readonly keys: Readonly<Record<string, Uint8Array>>;
    };
  };
  readonly scopes: ContinuousMemoryScopes;
  readonly policy: FuryGatewayLocalMemoryPolicySummary;
}

const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_PATH_CHARS = 4096;
const MAX_NAMESPACE_CHARS = 64;
const MAX_SCOPE_CHARS = 1024;
const MAX_KEYS = 8;
const MAX_ENV_NAME = 128;
const KEY_ID_RE = /^[A-Za-z0-9._-]{1,64}$/u;
const NAMESPACE_RE = /^[A-Za-z0-9._-]{1,64}$/u;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const BASE64_32_RE = /^[A-Za-z0-9+/]{43}=$/u;

const DEFAULT_MAX_OBJECT_BYTES = 256 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_GLOBAL_BYTES = 256 * 1024 * 1024;
const HARD_MAX_OBJECT_BYTES = 16 * 1024 * 1024;
const HARD_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const HARD_MAX_GLOBAL_BYTES = 4 * 1024 * 1024 * 1024;

const SCOPE_ORDER = Object.freeze([
  'global',
  'workspace',
  'project',
  'user',
  'agent',
] as const);

const NO_LEARNING_ANALYZER: ContinuousMemoryAnalyzer = Object.freeze({
  async extractCandidates() {
    return Object.freeze([]);
  },
});

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} must be a plain JSON object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`${label} must not contain symbol keys`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      throw new Error(`${label} contains unsupported field: ${key}`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new Error(`${label} is missing required field: ${key}`);
    }
  }
}

function boundedText(
  value: unknown,
  label: string,
  maxChars: number,
): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.length > maxChars
    || value.includes('\0')
    || /[\r\n]/u.test(value)
  ) {
    throw new Error(`${label} must be bounded single-line text`);
  }
  return value.trim();
}

function boundedBytes(
  value: unknown,
  fallback: number,
  hardMax: number,
  label: string,
): number {
  const resolved = value === undefined ? fallback : value;
  if (
    typeof resolved !== 'number'
    || !Number.isSafeInteger(resolved)
    || resolved < 1
    || resolved > hardMax
  ) {
    throw new Error(`${label} must be an integer from 1 to ${hardMax}`);
  }
  return resolved;
}

function parseScopes(value: unknown): ContinuousMemoryScopes {
  const record = plainRecord(value, 'memory scopes');
  exactKeys(record, SCOPE_ORDER, [], 'memory scopes');
  const output: Partial<Record<(typeof SCOPE_ORDER)[number], string>> = {};
  for (const kind of SCOPE_ORDER) {
    if (record[kind] === undefined) continue;
    output[kind] = boundedText(
      record[kind],
      `memory scopes.${kind}`,
      MAX_SCOPE_CHARS,
    );
  }
  if (Object.keys(output).length === 0) {
    throw new Error('memory scopes require at least one configured scope');
  }
  return Object.freeze(output);
}

function parsePolicy(value: unknown): FuryGatewayLocalMemoryPolicySummary {
  if (value === undefined) {
    return Object.freeze({
      allowInferred: false,
      allowSensitive: false,
    });
  }
  const record = plainRecord(value, 'memory policy');
  exactKeys(
    record,
    ['allowInferred', 'allowSensitive'],
    [],
    'memory policy',
  );
  const allowInferred = record.allowInferred ?? false;
  const allowSensitive = record.allowSensitive ?? false;
  if (typeof allowInferred !== 'boolean' || typeof allowSensitive !== 'boolean') {
    throw new Error('memory policy flags must be booleans');
  }
  return Object.freeze({ allowInferred, allowSensitive });
}

function decodeKey(
  env: Readonly<Record<string, string | undefined>>,
  envNameRaw: unknown,
  label: string,
): Uint8Array {
  const envName = boundedText(envNameRaw, label, MAX_ENV_NAME);
  if (!ENV_NAME_RE.test(envName)) {
    throw new Error(`${label} must be a host environment variable name`);
  }
  const encoded = env[envName];
  if (
    encoded === undefined
    || !BASE64_32_RE.test(encoded)
  ) {
    throw new Error('memory encryption key material must contain one canonical base64 AES-256 key');
  }
  const decoded = Buffer.from(encoded, 'base64');
  if (
    decoded.byteLength !== 32
    || decoded.toString('base64') !== encoded
  ) {
    throw new Error('memory encryption key material must decode to exactly 32 bytes');
  }
  return new Uint8Array(decoded);
}

function parseFile(
  file: string,
  env: Readonly<Record<string, string | undefined>>,
): MemoryFileConfig {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    throw new Error(
      `WebChat memory config file is unavailable: ${(error as NodeJS.ErrnoException).code ?? 'read-failed'}`,
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('WebChat memory config must be a regular non-symlink file');
  }
  if (stat.size > MAX_CONFIG_BYTES) {
    throw new Error(`WebChat memory config exceeds ${MAX_CONFIG_BYTES} bytes`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('WebChat memory config is not valid JSON');
  }

  const root = plainRecord(parsed, 'WebChat memory config');
  exactKeys(
    root,
    ['format', 'recovery', 'scopes', 'policy'],
    ['format', 'recovery', 'scopes'],
    'WebChat memory config',
  );
  if (root.format !== FURY_GATEWAY_LOCAL_MEMORY_CONFIG_FORMAT) {
    throw new Error('WebChat memory config format is unsupported');
  }

  const recoveryRecord = plainRecord(root.recovery, 'memory recovery');
  exactKeys(
    recoveryRecord,
    [
      'root',
      'namespace',
      'maxObjectBytes',
      'maxTotalBytes',
      'maxGlobalBytes',
      'encryption',
    ],
    ['root', 'namespace', 'encryption'],
    'memory recovery',
  );

  const recoveryRoot = boundedText(
    recoveryRecord.root,
    'memory recovery.root',
    MAX_PATH_CHARS,
  );
  if (!isAbsolute(recoveryRoot)) {
    throw new Error('memory recovery.root must be an absolute path');
  }

  const namespace = boundedText(
    recoveryRecord.namespace,
    'memory recovery.namespace',
    MAX_NAMESPACE_CHARS,
  );
  if (!NAMESPACE_RE.test(namespace)) {
    throw new Error('memory recovery.namespace must be a bounded safe identifier');
  }

  const maxObjectBytes = boundedBytes(
    recoveryRecord.maxObjectBytes,
    DEFAULT_MAX_OBJECT_BYTES,
    HARD_MAX_OBJECT_BYTES,
    'memory recovery.maxObjectBytes',
  );
  const maxTotalBytes = boundedBytes(
    recoveryRecord.maxTotalBytes,
    DEFAULT_MAX_TOTAL_BYTES,
    HARD_MAX_TOTAL_BYTES,
    'memory recovery.maxTotalBytes',
  );
  const maxGlobalBytes = boundedBytes(
    recoveryRecord.maxGlobalBytes,
    DEFAULT_MAX_GLOBAL_BYTES,
    HARD_MAX_GLOBAL_BYTES,
    'memory recovery.maxGlobalBytes',
  );
  if (maxTotalBytes < maxObjectBytes) {
    throw new Error('memory maxTotalBytes must be at least maxObjectBytes');
  }
  if (maxGlobalBytes < maxTotalBytes) {
    throw new Error('memory maxGlobalBytes must be at least maxTotalBytes');
  }

  const encryptionRecord = plainRecord(
    recoveryRecord.encryption,
    'memory recovery.encryption',
  );
  exactKeys(
    encryptionRecord,
    ['activeKeyId', 'keys'],
    ['activeKeyId', 'keys'],
    'memory recovery.encryption',
  );
  const activeKeyId = boundedText(
    encryptionRecord.activeKeyId,
    'memory recovery.encryption.activeKeyId',
    64,
  );
  if (!KEY_ID_RE.test(activeKeyId)) {
    throw new Error('memory encryption activeKeyId is invalid');
  }

  const keyRefs = plainRecord(
    encryptionRecord.keys,
    'memory recovery.encryption.keys',
  );
  const keyEntries = Object.entries(keyRefs);
  if (keyEntries.length < 1 || keyEntries.length > MAX_KEYS) {
    throw new Error(`memory encryption keyring must contain 1-${MAX_KEYS} keys`);
  }
  const resolvedKeys: Record<string, Uint8Array> = {};
  for (const [keyId, envName] of keyEntries) {
    if (!KEY_ID_RE.test(keyId)) {
      throw new Error('memory encryption key ID is invalid');
    }
    resolvedKeys[keyId] = decodeKey(
      env,
      envName,
      `memory encryption key ${keyId}`,
    );
  }
  if (!Object.prototype.hasOwnProperty.call(resolvedKeys, activeKeyId)) {
    throw new Error('memory encryption active key is not present in keyring');
  }

  const scopes = parseScopes(root.scopes);
  const policy = parsePolicy(root.policy);

  // Keep resolved secret bytes process-local. The returned public config below
  // intentionally contains no path, raw scope IDs, key IDs or environment names.
  const recovery = Object.freeze({
    root: recoveryRoot,
    namespace,
    maxObjectBytes,
    maxTotalBytes,
    maxGlobalBytes,
    encryption: Object.freeze({
      activeKeyId,
      keys: Object.freeze(resolvedKeys),
    }),
  });

  return Object.freeze({
    recovery,
    scopes,
    policy,
  });
}

export function createFuryGatewayLocalMemoryRuntime(
  options: FuryGatewayLocalMemoryRuntimeOptions = {},
): FuryGatewayLocalMemoryRuntime {
  const env = options.env ?? process.env;
  const file = options.file ?? env.FURYPIPE_WEBCHAT_MEMORY_CONFIG?.trim();

  if (!file) {
    return Object.freeze({
      config: Object.freeze({
        format: FURY_GATEWAY_LOCAL_MEMORY_CONFIG_FORMAT,
        enabled: false as const,
      }),
    });
  }

  if (
    file.length > MAX_PATH_CHARS
    || file.includes('\0')
    || !isAbsolute(file)
  ) {
    throw new Error(
      'FURYPIPE_WEBCHAT_MEMORY_CONFIG path must be an absolute path',
    );
  }

  const parsed = parseFile(file, env);
  if (parsed.policy.allowInferred && options.analyzer === undefined) {
    throw new Error(
      'inferred WebChat memory requires an explicit process-local analyzer',
    );
  }

  const recovery = createRecoveryStore(parsed.recovery.root, {
    namespace: parsed.recovery.namespace,
    maxObjectBytes: parsed.recovery.maxObjectBytes,
    maxTotalBytes: parsed.recovery.maxTotalBytes,
    maxGlobalBytes: parsed.recovery.maxGlobalBytes,
    encryption: {
      activeKeyId: parsed.recovery.encryption.activeKeyId,
      keys: parsed.recovery.encryption.keys,
      allowLegacyPlaintext: false,
    },
  });

  const policy: Partial<ContinuousMemoryPolicy> = {
    allowInferred: parsed.policy.allowInferred,
    allowSensitive: parsed.policy.allowSensitive,
  };
  const engine = createContinuousMemoryEngine({
    recovery,
    analyzer: options.analyzer ?? NO_LEARNING_ANALYZER,
    policy,
  });

  const scopeKinds = Object.freeze(
    SCOPE_ORDER.filter((kind) => parsed.scopes[kind] !== undefined),
  );

  return Object.freeze({
    config: Object.freeze({
      format: FURY_GATEWAY_LOCAL_MEMORY_CONFIG_FORMAT,
      enabled: true as const,
      encrypted: true as const,
      scopeKinds,
      policy: parsed.policy,
      learningEnabled: options.analyzer !== undefined,
      quotas: Object.freeze({
        maxObjectBytes: parsed.recovery.maxObjectBytes,
        maxTotalBytes: parsed.recovery.maxTotalBytes,
        maxGlobalBytes: parsed.recovery.maxGlobalBytes,
      }),
    }),
    engine,
    recovery,
    scopes: parsed.scopes,
  });
}
