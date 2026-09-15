import type { ProviderFabricProtocol } from './core/provider-fabric.js';
import {
  FuryGovernedProviderExecutorError,
  type FuryGovernedProviderExecutorErrorCode,
} from './provider-execution-errors.js';

export const MAX_PROVIDER_TRANSPORTS = 32;
export const MAX_PROVIDER_RESPONSE_BYTES = 1_048_576;
export const MAX_PROVIDER_EXECUTION_PERMIT_TTL_MS = 60_000;

const PROVIDER_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const PROTOCOLS = new Set<ProviderFabricProtocol>(['anthropic', 'openai', 'google']);

export function fail(
  code: FuryGovernedProviderExecutorErrorCode,
  transportInvoked = false,
): never {
  throw new FuryGovernedProviderExecutorError(code, { transportInvoked });
}

export function ownDataRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('expected a plain data object');
  }

  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError('object properties are not safely readable');
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('expected a plain data object');
  }

  const record = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== 'string') throw new TypeError('symbol properties are not supported');
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new TypeError('object properties are not safely readable');
    }
    if (!descriptor || !('value' in descriptor)) throw new TypeError('accessor properties are not supported');
    Object.defineProperty(record, key, { value: descriptor.value, enumerable: true });
  }
  return record;
}

export function assertKnownKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new TypeError('object contains an unsupported field');
  }
}

export function exactIdentifier(value: unknown, maxLength = 256): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maxLength
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function canonicalProviderId(value: unknown): value is string {
  return typeof value === 'string' && PROVIDER_ID.test(value);
}

export function isProviderProtocol(value: unknown): value is ProviderFabricProtocol {
  return typeof value === 'string' && PROTOCOLS.has(value as ProviderFabricProtocol);
}

export function safeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
