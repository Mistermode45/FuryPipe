import type {
  FuryKernelMemoryBridge,
} from './fury-kernel-memory-bridge-node.js';
import type {
  FuryGatewayLocalMemoryConfig,
} from './gateway-local-memory-runtime-node.js';
import {
  FURY_GATEWAY_MEMORY_EXECUTION_COMMAND_NAMES,
  FURY_GATEWAY_MEMORY_STATE_COMMAND_NAMES,
  type FuryGatewayMemoryExecutionCommandName,
  type FuryGatewayMemoryStateCommandName,
} from './gateway-memory-command-node.js';
import type { LongTermMemoryScopeKind } from './long-term-memory.js';

export const FURY_GATEWAY_MEMORY_RESULT_FORMAT =
  'furypipe-gateway-memory-result/v1' as const;

export interface FuryGatewayMemoryAdapterOptions {
  readonly bridge: FuryKernelMemoryBridge;
  readonly config: FuryGatewayLocalMemoryConfig;
  readonly maxResultBytes?: number;
}

export interface FuryGatewayMemoryCommandResult {
  readonly format: typeof FURY_GATEWAY_MEMORY_RESULT_FORMAT;
  readonly commandName:
    | FuryGatewayMemoryStateCommandName
    | FuryGatewayMemoryExecutionCommandName;
  readonly status: 'ok' | 'rejected';
  readonly result?: unknown;
  readonly error?: {
    readonly code: string;
  };
  readonly authority: 'memory-governance';
  readonly executionAuthority: false;
}

export interface FuryGatewayMemoryAdapter {
  dispatchState(
    commandName: FuryGatewayMemoryStateCommandName,
    input: unknown,
  ): FuryGatewayMemoryCommandResult;
  dispatchExecution(
    commandName: FuryGatewayMemoryExecutionCommandName,
    input: unknown,
  ): Promise<FuryGatewayMemoryCommandResult>;
}

const DEFAULT_MAX_RESULT_BYTES = 32 * 1024;
const HARD_MAX_RESULT_BYTES = 128 * 1024;
const MAX_MEMORY_KEY_CHARS = 512;
const SCOPE_KINDS = Object.freeze([
  'global',
  'workspace',
  'project',
  'user',
  'agent',
] as const satisfies readonly LongTermMemoryScopeKind[]);

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

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new Error(`${label} must be a plain object`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !allowed.has(key)
    ) {
      throw new Error(`${label} contains unsupported fields`);
    }
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new Error(`${label} is missing a required field`);
    }
  }
  return record;
}

function memoryKey(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.length > MAX_MEMORY_KEY_CHARS
    || value.includes('\0')
  ) {
    throw new Error('memory key is invalid');
  }
  return value.trim();
}

function scopeKind(value: unknown): LongTermMemoryScopeKind {
  if (
    typeof value !== 'string'
    || !SCOPE_KINDS.includes(value as LongTermMemoryScopeKind)
  ) {
    throw new Error('memory scope kind is invalid');
  }
  return value as LongTermMemoryScopeKind;
}

function ok(
  commandName:
    | FuryGatewayMemoryStateCommandName
    | FuryGatewayMemoryExecutionCommandName,
  result: unknown,
): FuryGatewayMemoryCommandResult {
  return Object.freeze({
    format: FURY_GATEWAY_MEMORY_RESULT_FORMAT,
    commandName,
    status: 'ok' as const,
    result,
    authority: 'memory-governance' as const,
    executionAuthority: false as const,
  });
}

function rejected(
  commandName:
    | FuryGatewayMemoryStateCommandName
    | FuryGatewayMemoryExecutionCommandName,
  code: string,
): FuryGatewayMemoryCommandResult {
  return Object.freeze({
    format: FURY_GATEWAY_MEMORY_RESULT_FORMAT,
    commandName,
    status: 'rejected' as const,
    error: Object.freeze({ code }),
    authority: 'memory-governance' as const,
    executionAuthority: false as const,
  });
}

function boundResult(
  result: FuryGatewayMemoryCommandResult,
  maxResultBytes: number,
): FuryGatewayMemoryCommandResult {
  let encoded: string;
  try {
    encoded = JSON.stringify(result);
  } catch {
    return rejected(result.commandName, 'memory-result-not-serializable');
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxResultBytes) {
    return rejected(result.commandName, 'memory-result-too-large');
  }
  return result;
}

function safeRejectedCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/scope is not configured/i.test(message)) return 'memory-scope-not-configured';
  if (/concurrency limit/i.test(message)) return 'memory-backpressure';
  if (/permit expired/i.test(message)) return 'memory-permit-expired';
  if (/input|key|scope kind/i.test(message)) return 'memory-input-invalid';
  return 'memory-operation-rejected';
}

function isStateCommand(
  value: string,
): value is FuryGatewayMemoryStateCommandName {
  return (FURY_GATEWAY_MEMORY_STATE_COMMAND_NAMES as readonly string[]).includes(value);
}

function isExecutionCommand(
  value: string,
): value is FuryGatewayMemoryExecutionCommandName {
  return (FURY_GATEWAY_MEMORY_EXECUTION_COMMAND_NAMES as readonly string[]).includes(value);
}

export function createFuryGatewayMemoryAdapter(
  options: FuryGatewayMemoryAdapterOptions,
): FuryGatewayMemoryAdapter {
  if (
    !options
    || typeof options !== 'object'
    || !options.bridge
    || !options.config
    || options.config.enabled !== true
  ) {
    throw new Error('Gateway memory adapter requires an enabled local memory runtime');
  }
  const maxResultBytes = boundedInteger(
    options.maxResultBytes,
    DEFAULT_MAX_RESULT_BYTES,
    1024,
    HARD_MAX_RESULT_BYTES,
    'maxResultBytes',
  );

  return Object.freeze({
    dispatchState(
      commandName: FuryGatewayMemoryStateCommandName,
      input: unknown,
    ): FuryGatewayMemoryCommandResult {
      if (typeof commandName !== 'string' || !isStateCommand(commandName)) {
        throw new Error('Gateway memory state command is unsupported');
      }
      try {
        exactRecord(input, [], [], 'memory.status input');
        return boundResult(
          ok(commandName, options.config),
          maxResultBytes,
        );
      } catch {
        return rejected(commandName, 'memory-input-invalid');
      }
    },

    async dispatchExecution(
      commandName: FuryGatewayMemoryExecutionCommandName,
      input: unknown,
    ): Promise<FuryGatewayMemoryCommandResult> {
      if (typeof commandName !== 'string' || !isExecutionCommand(commandName)) {
        throw new Error('Gateway memory execution command is unsupported');
      }
      try {
        const record = exactRecord(
          input,
          ['key', 'scopeKind'],
          ['key', 'scopeKind'],
          `${commandName} input`,
        );
        const operationInput = Object.freeze({
          key: memoryKey(record.key),
          scopeKind: scopeKind(record.scopeKind),
        });
        const result = commandName === 'memory.purge'
          ? await options.bridge.purge(operationInput)
          : await options.bridge.forget(operationInput);
        return boundResult(ok(commandName, result), maxResultBytes);
      } catch (error) {
        return rejected(commandName, safeRejectedCode(error));
      }
    },
  });
}
