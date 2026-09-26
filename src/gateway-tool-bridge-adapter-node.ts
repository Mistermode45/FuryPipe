import type {
  FuryKernelToolBridge,
} from './fury-kernel-tool-bridge-node.js';
import {
  FURY_GATEWAY_TOOL_EXECUTION_COMMAND_NAMES,
  FURY_GATEWAY_TOOL_STATE_COMMAND_NAMES,
  type FuryGatewayToolExecutionCommandName,
  type FuryGatewayToolStateCommandName,
} from './gateway-tool-command-node.js';

export const FURY_GATEWAY_TOOL_RESULT_FORMAT =
  'furypipe-gateway-tool-result/v1' as const;

export interface FuryGatewayToolBridgeAdapterOptions {
  readonly bridge: FuryKernelToolBridge;
  readonly maxResultBytes?: number;
}

export interface FuryGatewayToolCommandResult {
  readonly format: typeof FURY_GATEWAY_TOOL_RESULT_FORMAT;
  readonly commandName:
    | FuryGatewayToolStateCommandName
    | FuryGatewayToolExecutionCommandName;
  readonly status: 'ok' | 'rejected';
  readonly result?: unknown;
  readonly error?: {
    readonly code: string;
  };
  readonly authority: 'tool-governance';
  readonly executionAuthority: false;
}

export interface FuryGatewayToolBridgeAdapter {
  dispatchState(
    commandName: FuryGatewayToolStateCommandName,
    input: unknown,
  ): FuryGatewayToolCommandResult;
  dispatchExecution(
    commandName: FuryGatewayToolExecutionCommandName,
    input: unknown,
  ): Promise<FuryGatewayToolCommandResult>;
}

const DEFAULT_MAX_RESULT_BYTES = 128 * 1024;
const HARD_MAX_RESULT_BYTES = 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

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
  ) {
    throw new Error(`${label} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`${label} must not contain symbol keys`);
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

function safeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`${label} must be a bounded safe identifier`);
  }
  return value;
}

function ok(
  commandName:
    | FuryGatewayToolStateCommandName
    | FuryGatewayToolExecutionCommandName,
  result: unknown,
): FuryGatewayToolCommandResult {
  return Object.freeze({
    format: FURY_GATEWAY_TOOL_RESULT_FORMAT,
    commandName,
    status: 'ok' as const,
    result,
    authority: 'tool-governance' as const,
    executionAuthority: false as const,
  });
}

function rejected(
  commandName:
    | FuryGatewayToolStateCommandName
    | FuryGatewayToolExecutionCommandName,
  code: string,
): FuryGatewayToolCommandResult {
  return Object.freeze({
    format: FURY_GATEWAY_TOOL_RESULT_FORMAT,
    commandName,
    status: 'rejected' as const,
    error: Object.freeze({ code }),
    authority: 'tool-governance' as const,
    executionAuthority: false as const,
  });
}

function boundResult(
  result: FuryGatewayToolCommandResult,
  maxResultBytes: number,
): FuryGatewayToolCommandResult {
  let encoded: string;
  try {
    encoded = JSON.stringify(result);
  } catch {
    return rejected(result.commandName, 'tool-result-not-serializable');
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxResultBytes) {
    return rejected(result.commandName, 'tool-result-too-large');
  }
  return result;
}

function isStateCommand(value: string): value is FuryGatewayToolStateCommandName {
  return (FURY_GATEWAY_TOOL_STATE_COMMAND_NAMES as readonly string[]).includes(value);
}

function isExecutionCommand(
  value: string,
): value is FuryGatewayToolExecutionCommandName {
  return (FURY_GATEWAY_TOOL_EXECUTION_COMMAND_NAMES as readonly string[]).includes(value);
}

function expectedTransportFamily(
  commandName: FuryGatewayToolExecutionCommandName,
): 'stdio' | 'http' | undefined {
  if (commandName.endsWith('.stdio')) return 'stdio';
  if (commandName.endsWith('.http')) return 'http';
  return undefined;
}

function safeRejectedCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/not configured/i.test(message)) return 'tool-source-not-configured';
  if (/missing or expired/i.test(message)) return 'tool-proposal-missing-or-expired';
  if (/not approved/i.test(message)) return 'tool-proposal-not-approved';
  if (/capacity/i.test(message)) return 'tool-proposal-capacity';
  if (/probe concurrency/i.test(message)) return 'tool-probe-backpressure';
  if (/execution concurrency/i.test(message)) return 'tool-execution-backpressure';
  if (/schema validation/i.test(message)) return 'tool-arguments-invalid';
  if (/not awaiting operator approval/i.test(message)) return 'tool-approval-not-pending';
  return 'tool-bridge-operation-rejected';
}

export function createFuryGatewayToolBridgeAdapter(
  options: FuryGatewayToolBridgeAdapterOptions,
): FuryGatewayToolBridgeAdapter {
  if (!options || typeof options !== 'object' || !options.bridge) {
    throw new Error('Gateway tool bridge adapter requires a governed tool bridge');
  }
  const maxResultBytes = boundedInteger(
    options.maxResultBytes,
    DEFAULT_MAX_RESULT_BYTES,
    1024,
    HARD_MAX_RESULT_BYTES,
    'maxResultBytes',
  );

  const transportForSource = (
    sourceId: string,
  ): 'stdio' | 'streamable_http' | 'sse' | undefined =>
    options.bridge.inspectSources()
      .find((source) => source.sourceId === sourceId)
      ?.transport;

  const requireCommandTransport = (
    commandName: FuryGatewayToolExecutionCommandName,
    actual: 'stdio' | 'streamable_http' | 'sse' | undefined,
  ): void => {
    const expected = expectedTransportFamily(commandName);
    if (expected === 'stdio' && actual !== 'stdio') {
      throw new Error('tool source transport does not match admitted command');
    }
    if (expected === 'http' && actual !== 'streamable_http' && actual !== 'sse') {
      throw new Error('tool source transport does not match admitted command');
    }
  };

  return Object.freeze({
    dispatchState(
      commandName: FuryGatewayToolStateCommandName,
      input: unknown,
    ): FuryGatewayToolCommandResult {
      if (typeof commandName !== 'string' || !isStateCommand(commandName)) {
        throw new Error('Gateway tool state command is unsupported');
      }
      try {
        let result: FuryGatewayToolCommandResult;
        if (commandName === 'tools.sources.inspect') {
          exactRecord(input, [], [], 'tools.sources.inspect input');
          result = ok(commandName, options.bridge.inspectSources());
        } else {
          const record = exactRecord(
            input,
            ['proposalId'],
            ['proposalId'],
            'tools.discard input',
          );
          const proposalId = safeId(record.proposalId, 'proposalId');
          result = ok(commandName, Object.freeze({
            discarded: options.bridge.discard(proposalId),
          }));
        }
        return boundResult(result, maxResultBytes);
      } catch (error) {
        return rejected(commandName, safeRejectedCode(error));
      }
    },

    async dispatchExecution(
      commandName: FuryGatewayToolExecutionCommandName,
      input: unknown,
    ): Promise<FuryGatewayToolCommandResult> {
      if (typeof commandName !== 'string' || !isExecutionCommand(commandName)) {
        throw new Error('Gateway tool execution command is unsupported');
      }
      try {
        let result: FuryGatewayToolCommandResult;

        if (
          commandName === 'tools.source.inspect.stdio'
          || commandName === 'tools.source.inspect.http'
        ) {
          const record = exactRecord(
            input,
            ['sourceId'],
            ['sourceId'],
            'tools.source.inspect input',
          );
          const sourceId = safeId(record.sourceId, 'sourceId');
          requireCommandTransport(commandName, transportForSource(sourceId));
          result = ok(commandName, await options.bridge.inspectSource(sourceId));
        } else if (
          commandName === 'tools.propose.stdio'
          || commandName === 'tools.propose.http'
        ) {
          const record = exactRecord(
            input,
            ['sourceId', 'toolName', 'arguments'],
            ['sourceId', 'toolName'],
            'tools.propose input',
          );
          const sourceId = safeId(record.sourceId, 'sourceId');
          const toolName = safeId(record.toolName, 'toolName');
          requireCommandTransport(commandName, transportForSource(sourceId));
          result = ok(commandName, await options.bridge.propose({
            sourceId,
            toolName,
            ...(Object.prototype.hasOwnProperty.call(record, 'arguments')
              ? { arguments: record.arguments }
              : {}),
          }));
        } else if (commandName === 'tools.approve') {
          const record = exactRecord(
            input,
            ['proposalId'],
            ['proposalId'],
            'tools.approve input',
          );
          result = ok(
            commandName,
            options.bridge.approve(safeId(record.proposalId, 'proposalId')),
          );
        } else {
          const record = exactRecord(
            input,
            ['proposalId'],
            ['proposalId'],
            'tools.execute input',
          );
          const proposalId = safeId(record.proposalId, 'proposalId');
          requireCommandTransport(
            commandName,
            options.bridge.proposalTransport(proposalId),
          );
          result = ok(commandName, await options.bridge.execute(proposalId));
        }

        return boundResult(result, maxResultBytes);
      } catch (error) {
        if (
          error instanceof Error
          && /transport does not match admitted command/i.test(error.message)
        ) {
          return rejected(commandName, 'tool-transport-mismatch');
        }
        return rejected(commandName, safeRejectedCode(error));
      }
    },
  });
}
