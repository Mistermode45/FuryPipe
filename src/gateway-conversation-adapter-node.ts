import {
  FURY_GATEWAY_COMMAND_FORMAT,
  type FuryGatewayCommandDefinition,
} from './gateway-command-authorization-node.js';
import {
  FuryKernelConversationError,
  type FuryKernelConversationStore,
} from './fury-kernel.js';

export const FURY_GATEWAY_CONVERSATION_RESULT_FORMAT =
  'furypipe-gateway-conversation-result/v1' as const;

export const FURY_GATEWAY_CONVERSATION_COMMAND_NAMES = Object.freeze([
  'conversation.open',
  'conversation.inspect',
  'conversation.message.submit',
  'conversation.cancel',
  'conversation.close',
] as const);

export type FuryGatewayConversationCommandName =
  (typeof FURY_GATEWAY_CONVERSATION_COMMAND_NAMES)[number];

export const FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS =
  Object.freeze([
    Object.freeze({
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'conversation.open',
      allowedRoles: Object.freeze(['operator'] as const),
      requiredScopes: Object.freeze(['conversations.write'] as const),
      requiredPluginPermissions: Object.freeze([]),
      riskClass: 'write',
      requiresFreshApproval: false,
    }),
    Object.freeze({
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'conversation.inspect',
      allowedRoles: Object.freeze(['operator'] as const),
      requiredScopes: Object.freeze(['conversations.inspect'] as const),
      requiredPluginPermissions: Object.freeze([]),
      riskClass: 'read',
      requiresFreshApproval: false,
    }),
    Object.freeze({
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'conversation.message.submit',
      allowedRoles: Object.freeze(['operator'] as const),
      requiredScopes: Object.freeze(['conversations.write'] as const),
      requiredPluginPermissions: Object.freeze([]),
      riskClass: 'write',
      requiresFreshApproval: false,
    }),
    Object.freeze({
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'conversation.cancel',
      allowedRoles: Object.freeze(['operator'] as const),
      requiredScopes: Object.freeze(['conversations.write'] as const),
      requiredPluginPermissions: Object.freeze([]),
      riskClass: 'write',
      requiresFreshApproval: false,
    }),
    Object.freeze({
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'conversation.close',
      allowedRoles: Object.freeze(['operator'] as const),
      requiredScopes: Object.freeze(['conversations.write'] as const),
      requiredPluginPermissions: Object.freeze([]),
      riskClass: 'write',
      requiresFreshApproval: false,
    }),
  ] satisfies readonly FuryGatewayCommandDefinition[]);

export type FuryGatewayConversationResultStatus = 'ok' | 'rejected';

export interface FuryGatewayConversationCommandResult {
  readonly format: typeof FURY_GATEWAY_CONVERSATION_RESULT_FORMAT;
  readonly commandName: FuryGatewayConversationCommandName;
  readonly status: FuryGatewayConversationResultStatus;
  readonly result?: unknown;
  readonly error?: {
    readonly code: string;
  };
  readonly authority: 'conversation-state';
  readonly executionAuthority: false;
}

export interface FuryGatewayConversationAdapterOptions {
  readonly kernel: FuryKernelConversationStore;
  /**
   * Upper bound for the serialized result returned to the Gateway host.
   * Oversized results fail closed instead of relying on transport truncation.
   */
  readonly maxResultBytes?: number;
}

export interface FuryGatewayConversationAdapter {
  dispatch(
    commandName: FuryGatewayConversationCommandName,
    input: unknown,
  ): FuryGatewayConversationCommandResult;
}

const DEFAULT_MAX_RESULT_BYTES = 48 * 1024;
const MIN_MAX_RESULT_BYTES = 1024;
const HARD_MAX_RESULT_BYTES = 60 * 1024;
const MAX_INSPECTION_PAGE = 32;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new FuryKernelConversationError(
      'invalid-message',
      `${label} must be a plain object`,
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new FuryKernelConversationError(
      'invalid-message',
      `${label} must not contain symbol keys`,
    );
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
      throw new FuryKernelConversationError(
        'invalid-message',
        `${label} contains unsupported fields`,
      );
    }
  }
  return record;
}

function exactString(
  value: unknown,
  label: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new FuryKernelConversationError(
      'invalid-message',
      `${label} must be a non-empty string`,
    );
  }
  return value;
}

function optionalOffset(
  value: unknown,
  label: string,
): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new FuryKernelConversationError(
      'invalid-message',
      `${label} must be a non-negative safe integer`,
    );
  }
  return value as number;
}

function optionalLimit(
  value: unknown,
  label: string,
): number {
  if (value === undefined) return 16;
  if (
    !Number.isSafeInteger(value)
    || (value as number) < 1
    || (value as number) > MAX_INSPECTION_PAGE
  ) {
    throw new FuryKernelConversationError(
      'invalid-message',
      `${label} must be an integer between 1 and ${MAX_INSPECTION_PAGE}`,
    );
  }
  return value as number;
}

function ok(
  commandName: FuryGatewayConversationCommandName,
  result: unknown,
): FuryGatewayConversationCommandResult {
  return Object.freeze({
    format: FURY_GATEWAY_CONVERSATION_RESULT_FORMAT,
    commandName,
    status: 'ok' as const,
    result,
    authority: 'conversation-state' as const,
    executionAuthority: false as const,
  });
}

function rejected(
  commandName: FuryGatewayConversationCommandName,
  code: string,
): FuryGatewayConversationCommandResult {
  return Object.freeze({
    format: FURY_GATEWAY_CONVERSATION_RESULT_FORMAT,
    commandName,
    status: 'rejected' as const,
    error: Object.freeze({ code }),
    authority: 'conversation-state' as const,
    executionAuthority: false as const,
  });
}

function boundResult(
  result: FuryGatewayConversationCommandResult,
  maxResultBytes: number,
): FuryGatewayConversationCommandResult {
  let encoded: string;
  try {
    encoded = JSON.stringify(result);
  } catch {
    return rejected(result.commandName, 'result-not-serializable');
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxResultBytes) {
    return rejected(result.commandName, 'result-too-large');
  }
  return result;
}

function isCommandName(value: string): value is FuryGatewayConversationCommandName {
  return (FURY_GATEWAY_CONVERSATION_COMMAND_NAMES as readonly string[]).includes(value);
}

export function createFuryGatewayConversationAdapter(
  options: FuryGatewayConversationAdapterOptions,
): FuryGatewayConversationAdapter {
  if (!options || typeof options !== 'object' || !options.kernel) {
    throw new Error('Gateway conversation adapter requires a Fury Kernel conversation store');
  }
  const maxResultBytes = boundedInteger(
    options.maxResultBytes,
    DEFAULT_MAX_RESULT_BYTES,
    MIN_MAX_RESULT_BYTES,
    HARD_MAX_RESULT_BYTES,
    'maxResultBytes',
  );

  return Object.freeze({
    dispatch(
      commandName: FuryGatewayConversationCommandName,
      input: unknown,
    ): FuryGatewayConversationCommandResult {
      if (typeof commandName !== 'string' || !isCommandName(commandName)) {
        throw new Error('Gateway conversation command is unsupported');
      }

      try {
        let result: FuryGatewayConversationCommandResult;
        if (commandName === 'conversation.open') {
          exactRecord(input, [], 'conversation.open input');
          result = ok(commandName, options.kernel.openConversation());
        } else if (commandName === 'conversation.inspect') {
          const record = exactRecord(
            input,
            ['conversationId', 'messageOffset', 'messageLimit', 'turnOffset', 'turnLimit'],
            'conversation.inspect input',
          );
          const snapshot = options.kernel.inspectConversation(
            exactString(record.conversationId, 'conversationId'),
          );
          const messageOffset = optionalOffset(record.messageOffset, 'messageOffset');
          const messageLimit = optionalLimit(record.messageLimit, 'messageLimit');
          const turnOffset = optionalOffset(record.turnOffset, 'turnOffset');
          const turnLimit = optionalLimit(record.turnLimit, 'turnLimit');
          const messages = snapshot.messages.slice(
            messageOffset,
            messageOffset + messageLimit,
          );
          const turns = snapshot.turns.slice(
            turnOffset,
            turnOffset + turnLimit,
          );
          result = ok(commandName, Object.freeze({
            format: snapshot.format,
            conversationId: snapshot.conversationId,
            createdAt: snapshot.createdAt,
            updatedAt: snapshot.updatedAt,
            ...(snapshot.activeTurnId === undefined
              ? {}
              : { activeTurnId: snapshot.activeTurnId }),
            authority: snapshot.authority,
            executionAuthority: false as const,
            messages: Object.freeze([...messages]),
            turns: Object.freeze([...turns]),
            page: Object.freeze({
              messageOffset,
              messageLimit,
              totalMessages: snapshot.messages.length,
              ...(messageOffset + messages.length < snapshot.messages.length
                ? { nextMessageOffset: messageOffset + messages.length }
                : {}),
              turnOffset,
              turnLimit,
              totalTurns: snapshot.turns.length,
              ...(turnOffset + turns.length < snapshot.turns.length
                ? { nextTurnOffset: turnOffset + turns.length }
                : {}),
            }),
          }));
        } else if (commandName === 'conversation.message.submit') {
          const record = exactRecord(
            input,
            ['conversationId', 'messageId', 'content'],
            'conversation.message.submit input',
          );
          result = ok(commandName, options.kernel.submitUserMessage({
            conversationId: exactString(record.conversationId, 'conversationId'),
            messageId: exactString(record.messageId, 'messageId'),
            content: exactString(record.content, 'content'),
          }));
        } else if (commandName === 'conversation.cancel') {
          const record = exactRecord(
            input,
            ['conversationId', 'turnId'],
            'conversation.cancel input',
          );
          result = ok(commandName, options.kernel.cancelTurn({
            conversationId: exactString(record.conversationId, 'conversationId'),
            turnId: exactString(record.turnId, 'turnId'),
          }));
        } else {
          const record = exactRecord(
            input,
            ['conversationId'],
            'conversation.close input',
          );
          result = ok(commandName, options.kernel.closeConversation(
            exactString(record.conversationId, 'conversationId'),
          ));
        }
        return boundResult(result, maxResultBytes);
      } catch (error) {
        if (error instanceof FuryKernelConversationError) {
          return rejected(commandName, error.code);
        }
        throw error;
      }
    },
  });
}
