import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const FURY_BETA_CONFIG_FORMAT = 'furypipe-beta-config/v1' as const;
export const FURY_BETA_CONFIG_MIGRATION_ID = 'phase10-beta-config-v1' as const;
export const FURY_BETA_CONFIG_MAX_BYTES = 1024 * 1024;

export type FuryBetaConfigStatus = 'missing' | 'legacy' | 'current' | 'invalid' | 'unsupported';
export type FuryBetaConfigMode = 'legacy' | 'opted-out' | 'recommended';
export type FuryBetaConfigRollback = 'not-required' | 'available' | 'manual-reconciliation';

export interface FuryBetaConfigObservation {
  readonly format: typeof FURY_BETA_CONFIG_FORMAT;
  readonly path: string;
  readonly status: FuryBetaConfigStatus;
  readonly schemaVersion: number | null;
  readonly mode: FuryBetaConfigMode | null;
  readonly migrationId: string | null;
  readonly digestSha256: string | null;
  readonly rollback: FuryBetaConfigRollback;
  readonly reasonCodes: readonly string[];
}

export interface FuryBetaConfigMigrationResult {
  readonly path: string;
  readonly status: 'migrated' | 'already-current' | 'rolled-back' | 'already-rolled-back';
  readonly migrationId: typeof FURY_BETA_CONFIG_MIGRATION_ID;
  readonly digestSha256: string | null;
  readonly rollback: FuryBetaConfigRollback;
}

interface LoadedConfig {
  readonly path: string;
  readonly value: Record<string, unknown> | undefined;
  readonly observation: FuryBetaConfigObservation;
}

const BETA_KEYS = Object.freeze(['format', 'schemaVersion', 'mode', 'migrationId'] as const);
const MODES = new Set<string>(['legacy', 'opted-out', 'recommended']);
const MIGRATION_ID = /^[a-z0-9][a-z0-9.-]{0,95}$/u;

function freezeReasons(reasons: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(reasons)].sort((a, b) => a.localeCompare(b)));
}

function observation(
  filePath: string,
  status: FuryBetaConfigStatus,
  fields: Partial<Omit<FuryBetaConfigObservation, 'format' | 'path' | 'status'>> = {},
): FuryBetaConfigObservation {
  return Object.freeze({
    format: FURY_BETA_CONFIG_FORMAT,
    path: filePath,
    status,
    schemaVersion: fields.schemaVersion ?? null,
    mode: fields.mode ?? null,
    migrationId: fields.migrationId ?? null,
    digestSha256: fields.digestSha256 ?? null,
    rollback: fields.rollback ?? 'manual-reconciliation',
    reasonCodes: freezeReasons(fields.reasonCodes ?? []),
  });
}

function isPlainDataObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Object.getOwnPropertyNames(record).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor?.enumerable === true && 'value' in descriptor;
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (isPlainDataObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError('beta config contains unsupported data');
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function validateBetaMarker(
  beta: unknown,
  filePath: string,
  configDigest: string,
): FuryBetaConfigObservation {
  if (!isPlainDataObject(beta)) {
    return observation(filePath, 'invalid', {
      digestSha256: configDigest,
      rollback: 'manual-reconciliation',
      reasonCodes: ['beta-marker-invalid'],
    });
  }

  const keys = Object.getOwnPropertyNames(beta);
  if (keys.some((key) => !BETA_KEYS.includes(key as (typeof BETA_KEYS)[number]))) {
    return observation(filePath, 'invalid', {
      digestSha256: configDigest,
      rollback: 'manual-reconciliation',
      reasonCodes: ['beta-marker-fields-unsupported'],
    });
  }

  const schemaVersion = beta.schemaVersion;
  if (schemaVersion !== 1) {
    return observation(
      filePath,
      Number.isSafeInteger(schemaVersion) && (schemaVersion as number) > 1 ? 'unsupported' : 'invalid',
      {
        schemaVersion: typeof schemaVersion === 'number' && Number.isSafeInteger(schemaVersion)
          ? schemaVersion
          : null,
        digestSha256: configDigest,
        rollback: 'manual-reconciliation',
        reasonCodes: [schemaVersion !== undefined && (schemaVersion as number) > 1
          ? 'beta-schema-unsupported'
          : 'beta-schema-invalid'],
      },
    );
  }
  if (beta.format !== FURY_BETA_CONFIG_FORMAT
    || typeof beta.mode !== 'string'
    || !MODES.has(beta.mode)
    || typeof beta.migrationId !== 'string'
    || !MIGRATION_ID.test(beta.migrationId)) {
    return observation(filePath, 'invalid', {
      schemaVersion: 1,
      digestSha256: configDigest,
      rollback: 'manual-reconciliation',
      reasonCodes: ['beta-marker-invalid'],
    });
  }

  const mode = beta.mode as FuryBetaConfigMode;
  const migrationId = beta.migrationId;
  return observation(filePath, 'current', {
    schemaVersion: 1,
    mode,
    migrationId,
    digestSha256: configDigest,
    rollback: migrationId === FURY_BETA_CONFIG_MIGRATION_ID && mode === 'legacy'
      ? 'available'
      : 'manual-reconciliation',
    reasonCodes: mode === 'legacy' ? ['beta-legacy-mode'] : [`beta-mode-${mode}`],
  });
}

export function inspectBetaConfigValue(
  value: unknown,
  filePath: string,
): FuryBetaConfigObservation {
  if (value === undefined) {
    return observation(filePath, 'missing', {
      rollback: 'not-required',
      reasonCodes: ['config-missing'],
    });
  }
  if (!isPlainDataObject(value)) {
    return observation(filePath, 'invalid', {
      rollback: 'manual-reconciliation',
      reasonCodes: ['config-root-invalid'],
    });
  }

  let configDigest: string;
  try {
    configDigest = digest(value);
  } catch {
    return observation(filePath, 'invalid', {
      rollback: 'manual-reconciliation',
      reasonCodes: ['config-data-invalid'],
    });
  }

  if (!Object.prototype.hasOwnProperty.call(value, 'beta')) {
    return observation(filePath, 'legacy', {
      digestSha256: configDigest,
      rollback: 'not-required',
      reasonCodes: ['legacy-config'],
    });
  }
  return validateBetaMarker(value.beta, filePath, configDigest);
}

export function inspectBetaConfigText(text: string, filePath: string): FuryBetaConfigObservation {
  if (Buffer.byteLength(text, 'utf8') > FURY_BETA_CONFIG_MAX_BYTES) {
    return observation(filePath, 'invalid', {
      rollback: 'manual-reconciliation',
      reasonCodes: ['config-too-large'],
    });
  }
  try {
    return inspectBetaConfigValue(JSON.parse(text) as unknown, filePath);
  } catch {
    return observation(filePath, 'invalid', {
      rollback: 'manual-reconciliation',
      reasonCodes: ['config-invalid-json'],
    });
  }
}

function readLoadedConfig(filePath: string): LoadedConfig {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      return {
        path: filePath,
        value: undefined,
        observation: observation(filePath, 'invalid', {
          rollback: 'manual-reconciliation',
          reasonCodes: ['config-symlink'],
        }),
      };
    }
    if (!stat.isFile()) {
      return {
        path: filePath,
        value: undefined,
        observation: observation(filePath, 'invalid', {
          rollback: 'manual-reconciliation',
          reasonCodes: ['config-not-file'],
        }),
      };
    }
    if (stat.size > FURY_BETA_CONFIG_MAX_BYTES) {
      return {
        path: filePath,
        value: undefined,
        observation: observation(filePath, 'invalid', {
          rollback: 'manual-reconciliation',
          reasonCodes: ['config-too-large'],
        }),
      };
    }
    const text = fs.readFileSync(filePath, 'utf8');
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      return {
        path: filePath,
        value: undefined,
        observation: observation(filePath, 'invalid', {
          rollback: 'manual-reconciliation',
          reasonCodes: ['config-invalid-json'],
        }),
      };
    }
    return {
      path: filePath,
      value: isPlainDataObject(value) ? value : undefined,
      observation: inspectBetaConfigValue(value, filePath),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        path: filePath,
        value: undefined,
        observation: inspectBetaConfigValue(undefined, filePath),
      };
    }
    return {
      path: filePath,
      value: undefined,
      observation: observation(filePath, 'invalid', {
        rollback: 'manual-reconciliation',
        reasonCodes: ['config-unreadable'],
      }),
    };
  }
}

export function inspectBetaConfigFile(filePath: string): FuryBetaConfigObservation {
  return readLoadedConfig(filePath).observation;
}

function writeAtomicConfig(filePath: string, value: Record<string, unknown>): void {
  const parent = path.dirname(filePath);
  const parentExists = fs.existsSync(parent);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!parentExists) fs.chmodSync(parent, 0o700);
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${canonicalJson(value)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      // Keep the original failure. A leftover is visible to the next inspection.
    }
  }
}

function migrationMarker(): Record<string, unknown> {
  return {
    format: FURY_BETA_CONFIG_FORMAT,
    schemaVersion: 1,
    mode: 'legacy',
    migrationId: FURY_BETA_CONFIG_MIGRATION_ID,
  };
}

function mutationResult(
  filePath: string,
  status: FuryBetaConfigMigrationResult['status'],
): FuryBetaConfigMigrationResult {
  const current = inspectBetaConfigFile(filePath);
  return Object.freeze({
    path: filePath,
    status,
    migrationId: FURY_BETA_CONFIG_MIGRATION_ID,
    digestSha256: current.digestSha256,
    rollback: current.rollback,
  });
}

export function migrateBetaConfigFile(filePath: string): FuryBetaConfigMigrationResult {
  const loaded = readLoadedConfig(filePath);
  if (loaded.observation.status === 'current'
    && loaded.observation.migrationId === FURY_BETA_CONFIG_MIGRATION_ID
    && loaded.observation.mode === 'legacy') {
    return mutationResult(filePath, 'already-current');
  }
  if (loaded.observation.status !== 'missing' && loaded.observation.status !== 'legacy') {
    throw new Error(`beta config migration requires reconciliation-required state: ${loaded.observation.status}`);
  }
  const next = { ...(loaded.value ?? {}) };
  next.beta = migrationMarker();
  writeAtomicConfig(filePath, next);
  return mutationResult(filePath, 'migrated');
}

export function rollbackBetaConfigFile(filePath: string): FuryBetaConfigMigrationResult {
  const loaded = readLoadedConfig(filePath);
  if (loaded.observation.status === 'missing' || loaded.observation.status === 'legacy') {
    return mutationResult(filePath, 'already-rolled-back');
  }
  if (loaded.observation.status !== 'current'
    || loaded.observation.migrationId !== FURY_BETA_CONFIG_MIGRATION_ID
    || loaded.observation.mode !== 'legacy'
    || !loaded.value) {
    throw new Error('beta config rollback requires reconciliation-required state');
  }
  const next = { ...loaded.value };
  delete next.beta;
  writeAtomicConfig(filePath, next);
  return mutationResult(filePath, 'rolled-back');
}
