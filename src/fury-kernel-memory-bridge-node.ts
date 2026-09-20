import { randomBytes } from 'node:crypto';

import type {
  ContinuousMemoryEngine,
  ContinuousMemoryScopes,
} from './continuous-memory.js';
import type { LongTermMemoryScopeKind } from './long-term-memory.js';

export const FURY_KERNEL_MEMORY_BRIDGE_FORMAT =
  'furypipe-kernel-memory-bridge/v1' as const;

export interface FuryKernelMemoryOperationInput {
  readonly key: string;
  readonly scopeKind: LongTermMemoryScopeKind;
}

export interface FuryKernelMemoryOperationReceipt {
  readonly format: typeof FURY_KERNEL_MEMORY_BRIDGE_FORMAT;
  readonly operation: 'forget' | 'purge';
  readonly status: 'completed';
  readonly memoryId: string;
  readonly keyDigest: string;
  readonly scopeKind: LongTermMemoryScopeKind;
  readonly hard: boolean;
  readonly deletedRevisions: number;
  readonly deletedPayloads: number;
  readonly authority: 'memory-governance';
  readonly executionAuthority: false;
}

export interface FuryKernelMemoryBridgeOptions {
  readonly engine: ContinuousMemoryEngine;
  readonly scopes: ContinuousMemoryScopes;
  readonly now?: () => number;
  readonly permitTtlMs?: number;
  readonly maxConcurrentOperations?: number;
}

export interface FuryKernelMemoryBridge {
  forget(input: FuryKernelMemoryOperationInput): Promise<FuryKernelMemoryOperationReceipt>;
  purge(input: FuryKernelMemoryOperationInput): Promise<FuryKernelMemoryOperationReceipt>;
  activeOperationCount(): number;
}

interface FuryKernelMemoryOperationPermit {
  readonly format: 'furypipe-kernel-memory-operation-permit/v1';
  readonly permitId: string;
  readonly operation: 'forget' | 'purge';
  readonly key: string;
  readonly scopeKind: LongTermMemoryScopeKind;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly authority: 'memory-operation-permit';
  readonly executionAuthority: true;
}

const PERMIT_EVIDENCE = new WeakSet<object>();
const SCOPE_KINDS = Object.freeze([
  'global',
  'workspace',
  'project',
  'user',
  'agent',
] as const satisfies readonly LongTermMemoryScopeKind[]);

const DEFAULT_PERMIT_TTL_MS = 10_000;
const MAX_PERMIT_TTL_MS = 60_000;
const DEFAULT_MAX_CONCURRENT_OPERATIONS = 4;
const HARD_MAX_CONCURRENT_OPERATIONS = 32;
const MAX_MEMORY_KEY_CHARS = 512;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}`);
  }
  return resolved;
}

function finiteNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Fury Kernel memory bridge clock is invalid');
  }
  return value;
}

function validateScopes(scopes: ContinuousMemoryScopes): ContinuousMemoryScopes {
  if (!scopes || typeof scopes !== 'object' || Array.isArray(scopes)) {
    throw new Error('Fury Kernel memory bridge scopes are required');
  }
  const output: Partial<Record<LongTermMemoryScopeKind, string>> = {};
  for (const kind of SCOPE_KINDS) {
    const value = scopes[kind];
    if (value === undefined) continue;
    if (
      typeof value !== 'string'
      || value.trim().length === 0
      || value.length > 1024
      || value.includes('\0')
    ) {
      throw new Error('Fury Kernel memory bridge contains an invalid scope');
    }
    output[kind] = value;
  }
  if (Object.keys(output).length === 0) {
    throw new Error('Fury Kernel memory bridge requires at least one configured scope');
  }
  return Object.freeze(output);
}

function validateInput(
  input: FuryKernelMemoryOperationInput,
  scopes: ContinuousMemoryScopes,
): FuryKernelMemoryOperationInput {
  if (
    !input
    || typeof input !== 'object'
    || Array.isArray(input)
    || Object.getPrototypeOf(input) !== Object.prototype
    || Object.getOwnPropertySymbols(input).length > 0
  ) {
    throw new Error('memory operation input must be a plain object');
  }
  const record = input as unknown as Record<string, unknown>;
  const names = Object.getOwnPropertyNames(record);
  if (
    names.length !== 2
    || !names.includes('key')
    || !names.includes('scopeKind')
  ) {
    throw new Error('memory operation input contains unsupported fields');
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(record, name);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new Error('memory operation input must contain plain data fields');
    }
  }
  if (
    typeof input.key !== 'string'
    || input.key.trim().length === 0
    || input.key.length > MAX_MEMORY_KEY_CHARS
    || input.key.includes('\0')
  ) {
    throw new Error('memory key must be bounded non-empty text');
  }
  if (
    !SCOPE_KINDS.includes(input.scopeKind)
    || scopes[input.scopeKind] === undefined
  ) {
    throw new Error('memory scope is not configured');
  }
  return Object.freeze({
    key: input.key.trim(),
    scopeKind: input.scopeKind,
  });
}

function createPermit(
  operation: 'forget' | 'purge',
  input: FuryKernelMemoryOperationInput,
  now: () => number,
  permitTtlMs: number,
): FuryKernelMemoryOperationPermit {
  const issuedAt = finiteNow(now);
  const expiresAt = issuedAt + permitTtlMs;
  if (!Number.isSafeInteger(expiresAt)) {
    throw new Error('memory operation permit expiry is invalid');
  }
  const permit = Object.freeze({
    format: 'furypipe-kernel-memory-operation-permit/v1' as const,
    permitId: randomBytes(18).toString('base64url'),
    operation,
    key: input.key,
    scopeKind: input.scopeKind,
    issuedAt,
    expiresAt,
    authority: 'memory-operation-permit' as const,
    executionAuthority: true as const,
  });
  PERMIT_EVIDENCE.add(permit);
  return permit;
}

function consumePermit(
  permit: FuryKernelMemoryOperationPermit,
  now: () => number,
): FuryKernelMemoryOperationPermit {
  if (!PERMIT_EVIDENCE.has(permit)) {
    throw new Error('memory operation requires process-local permit evidence');
  }
  PERMIT_EVIDENCE.delete(permit);
  if (finiteNow(now) > permit.expiresAt) {
    throw new Error('memory operation permit expired');
  }
  return permit;
}

export function createFuryKernelMemoryBridge(
  options: FuryKernelMemoryBridgeOptions,
): FuryKernelMemoryBridge {
  if (
    !options
    || typeof options !== 'object'
    || !options.engine
    || typeof options.engine.forget !== 'function'
  ) {
    throw new Error('Fury Kernel memory bridge requires a Continuous Memory engine');
  }
  const scopes = validateScopes(options.scopes);
  const now = options.now ?? Date.now;
  finiteNow(now);
  const permitTtlMs = boundedInteger(
    options.permitTtlMs,
    DEFAULT_PERMIT_TTL_MS,
    1,
    MAX_PERMIT_TTL_MS,
    'permitTtlMs',
  );
  const maxConcurrentOperations = boundedInteger(
    options.maxConcurrentOperations,
    DEFAULT_MAX_CONCURRENT_OPERATIONS,
    1,
    HARD_MAX_CONCURRENT_OPERATIONS,
    'maxConcurrentOperations',
  );
  let activeOperations = 0;

  const execute = async (
    operation: 'forget' | 'purge',
    rawInput: FuryKernelMemoryOperationInput,
  ): Promise<FuryKernelMemoryOperationReceipt> => {
    if (activeOperations >= maxConcurrentOperations) {
      throw new Error('memory operation concurrency limit exceeded');
    }
    const input = validateInput(rawInput, scopes);
    const permit = createPermit(operation, input, now, permitTtlMs);

    activeOperations += 1;
    try {
      const consumed = consumePermit(permit, now);
      const result = await options.engine.forget({
        key: consumed.key,
        scopeKind: consumed.scopeKind,
        scopes,
        hard: consumed.operation === 'purge',
        now: finiteNow(now),
      });
      return Object.freeze({
        format: FURY_KERNEL_MEMORY_BRIDGE_FORMAT,
        operation: consumed.operation,
        status: 'completed' as const,
        memoryId: result.memoryId,
        keyDigest: result.keyDigest,
        scopeKind: result.scopeKind,
        hard: result.hard,
        deletedRevisions: result.deletedRevisions,
        deletedPayloads: result.deletedPayloads,
        authority: 'memory-governance' as const,
        executionAuthority: false as const,
      });
    } finally {
      activeOperations -= 1;
    }
  };

  return Object.freeze({
    forget(input: FuryKernelMemoryOperationInput) {
      return execute('forget', input);
    },
    purge(input: FuryKernelMemoryOperationInput) {
      return execute('purge', input);
    },
    activeOperationCount(): number {
      return activeOperations;
    },
  });
}
