import { randomBytes } from 'node:crypto';

export const FURY_KERNEL_CONVERSATION_FORMAT = 'furypipe-kernel-conversation/v1' as const;
export const FURY_KERNEL_MESSAGE_FORMAT = 'furypipe-kernel-message/v1' as const;
export const FURY_KERNEL_TURN_FORMAT = 'furypipe-kernel-turn/v1' as const;

export type FuryKernelMessageRole = 'user' | 'assistant';
export type FuryKernelTurnStatus = 'accepted' | 'completed' | 'cancelled';

export interface FuryKernelMessage {
  readonly format: typeof FURY_KERNEL_MESSAGE_FORMAT;
  readonly messageId: string;
  readonly role: FuryKernelMessageRole;
  readonly content: string;
  readonly createdAt: number;
}

export interface FuryKernelTurn {
  readonly format: typeof FURY_KERNEL_TURN_FORMAT;
  readonly turnId: string;
  readonly requestMessageId: string;
  readonly responseMessageId?: string;
  readonly status: FuryKernelTurnStatus;
  readonly createdAt: number;
  readonly completedAt?: number;
  readonly executionAuthority: false;
}

export interface FuryKernelConversationSnapshot {
  readonly format: typeof FURY_KERNEL_CONVERSATION_FORMAT;
  readonly conversationId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messages: readonly FuryKernelMessage[];
  readonly turns: readonly FuryKernelTurn[];
  readonly activeTurnId?: string;
  readonly authority: 'conversation-state';
  readonly executionAuthority: false;
}

export interface FuryKernelAcceptedTurn {
  readonly format: typeof FURY_KERNEL_TURN_FORMAT;
  readonly conversationId: string;
  readonly turn: FuryKernelTurn;
  readonly status: 'accepted';
  readonly executionAuthority: false;
}

export interface FuryKernelCompletedTurn {
  readonly format: typeof FURY_KERNEL_TURN_FORMAT;
  readonly conversationId: string;
  readonly turn: FuryKernelTurn;
  readonly status: 'completed';
  readonly executionAuthority: false;
}

export interface FuryKernelCancelledTurn {
  readonly format: typeof FURY_KERNEL_TURN_FORMAT;
  readonly conversationId: string;
  readonly turn: FuryKernelTurn;
  readonly status: 'cancelled';
  readonly executionAuthority: false;
}

export interface FuryKernelConversationOptions {
  readonly now?: () => number;
  readonly maxConversations?: number;
  readonly maxMessagesPerConversation?: number;
  readonly maxTurnsPerConversation?: number;
  readonly maxMessageBytes?: number;
  readonly maxConversationBytes?: number;
  readonly maxInFlightTurns?: number;
}

export interface FuryKernelOpenConversationInput {
  readonly conversationId?: string;
}

export interface FuryKernelSubmitMessageInput {
  readonly conversationId: string;
  readonly messageId: string;
  readonly content: string;
}

export interface FuryKernelCompleteTurnInput {
  readonly conversationId: string;
  readonly turnId: string;
  readonly messageId: string;
  readonly content: string;
}

export interface FuryKernelCancelTurnInput {
  readonly conversationId: string;
  readonly turnId: string;
}

export interface FuryKernelConversationStore {
  openConversation(input?: FuryKernelOpenConversationInput): FuryKernelConversationSnapshot;
  inspectConversation(conversationId: string): FuryKernelConversationSnapshot;
  submitUserMessage(input: FuryKernelSubmitMessageInput): FuryKernelAcceptedTurn;
  completeTurn(input: FuryKernelCompleteTurnInput): FuryKernelCompletedTurn;
  cancelTurn(input: FuryKernelCancelTurnInput): FuryKernelCancelledTurn;
  activeConversationCount(): number;
  inFlightTurnCount(): number;
}

export type FuryKernelConversationErrorCode =
  | 'invalid-config'
  | 'invalid-conversation'
  | 'invalid-message'
  | 'conversation-limit'
  | 'message-limit'
  | 'turn-limit'
  | 'byte-limit'
  | 'turn-in-flight'
  | 'in-flight-limit'
  | 'message-replay'
  | 'turn-not-found'
  | 'turn-terminal';

export class FuryKernelConversationError extends Error {
  readonly code: FuryKernelConversationErrorCode;

  constructor(code: FuryKernelConversationErrorCode, message: string) {
    super(message);
    this.name = 'FuryKernelConversationError';
    this.code = code;
  }
}

interface MutableTurn {
  readonly turnId: string;
  readonly requestMessageId: string;
  responseMessageId?: string;
  status: FuryKernelTurnStatus;
  readonly createdAt: number;
  completedAt?: number;
}

interface ConversationState {
  readonly conversationId: string;
  readonly createdAt: number;
  updatedAt: number;
  readonly messages: FuryKernelMessage[];
  readonly turns: MutableTurn[];
  readonly messageIds: Set<string>;
  bytes: number;
  activeTurnId?: string;
}

const DEFAULT_MAX_CONVERSATIONS = 32;
const HARD_MAX_CONVERSATIONS = 4096;
const DEFAULT_MAX_MESSAGES = 256;
const HARD_MAX_MESSAGES = 8192;
const DEFAULT_MAX_TURNS = 128;
const HARD_MAX_TURNS = 4096;
const DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024;
const HARD_MAX_MESSAGE_BYTES = 1024 * 1024;
const DEFAULT_MAX_CONVERSATION_BYTES = 1024 * 1024;
const HARD_MAX_CONVERSATION_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_IN_FLIGHT_TURNS = 16;
const HARD_MAX_IN_FLIGHT_TURNS = 1024;

const CONVERSATION_ID_RE = /^fkc_[A-Za-z0-9_-]{24}$/u;
const TURN_ID_RE = /^fkt_[A-Za-z0-9_-]{24}$/u;
const MESSAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u;

function finiteNow(now: () => number): number {
  const value = now();
  const normalized = Math.floor(value);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(normalized)) {
    throw new FuryKernelConversationError(
      'invalid-config',
      'Fury Kernel conversation clock must return a safe non-negative timestamp',
    );
  }
  return normalized;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new FuryKernelConversationError(
      'invalid-config',
      `${label} must be an integer between ${min} and ${max}`,
    );
  }
  return resolved;
}

function assertExactKeys(
  value: unknown,
  allowedKeys: readonly string[],
  code: FuryKernelConversationErrorCode,
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FuryKernelConversationError(code, `${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FuryKernelConversationError(code, `${label} must use a plain-object prototype`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new FuryKernelConversationError(code, `${label} must not contain symbol keys`);
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || !allowed.has(key)) {
      throw new FuryKernelConversationError(code, `${label} contains unsupported fields`);
    }
  }
}

function canonicalId(
  value: unknown,
  pattern: RegExp,
  code: FuryKernelConversationErrorCode,
  label: string,
): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new FuryKernelConversationError(code, `${label} is invalid`);
  }
  return value;
}

function conversationId(value: unknown): string {
  return canonicalId(value, CONVERSATION_ID_RE, 'invalid-conversation', 'conversation ID');
}

function messageId(value: unknown): string {
  return canonicalId(value, MESSAGE_ID_RE, 'invalid-message', 'message ID');
}

function turnId(value: unknown): string {
  return canonicalId(value, TURN_ID_RE, 'turn-not-found', 'turn ID');
}

function messageContent(value: unknown, maxBytes: number): { readonly content: string; readonly bytes: number } {
  if (typeof value !== 'string' || value.length === 0 || !/\S/u.test(value) || value.includes('\0')) {
    throw new FuryKernelConversationError(
      'invalid-message',
      'conversation message must be non-empty text without NUL bytes',
    );
  }
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > maxBytes) {
    throw new FuryKernelConversationError(
      'byte-limit',
      'conversation message exceeds its UTF-8 byte limit',
    );
  }
  return Object.freeze({ content: value, bytes });
}

function nextOpaqueId(prefix: 'fkc_' | 'fkt_', exists: (id: string) => boolean): string {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = `${prefix}${randomBytes(18).toString('base64url')}`;
    if (!exists(candidate)) return candidate;
  }
  throw new FuryKernelConversationError('invalid-config', 'could not allocate a unique Fury Kernel identifier');
}

function cloneMessage(message: FuryKernelMessage): FuryKernelMessage {
  return Object.freeze({ ...message });
}

function cloneTurn(turn: MutableTurn): FuryKernelTurn {
  return Object.freeze({
    format: FURY_KERNEL_TURN_FORMAT,
    turnId: turn.turnId,
    requestMessageId: turn.requestMessageId,
    ...(turn.responseMessageId === undefined ? {} : { responseMessageId: turn.responseMessageId }),
    status: turn.status,
    createdAt: turn.createdAt,
    ...(turn.completedAt === undefined ? {} : { completedAt: turn.completedAt }),
    executionAuthority: false,
  });
}

function snapshot(state: ConversationState): FuryKernelConversationSnapshot {
  return Object.freeze({
    format: FURY_KERNEL_CONVERSATION_FORMAT,
    conversationId: state.conversationId,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    messages: Object.freeze(state.messages.map(cloneMessage)),
    turns: Object.freeze(state.turns.map(cloneTurn)),
    ...(state.activeTurnId === undefined ? {} : { activeTurnId: state.activeTurnId }),
    authority: 'conversation-state' as const,
    executionAuthority: false as const,
  });
}

function findTurn(state: ConversationState, id: string): MutableTurn {
  const found = state.turns.find((turn) => turn.turnId === id);
  if (!found) {
    throw new FuryKernelConversationError('turn-not-found', 'conversation turn was not found');
  }
  return found;
}

export function createFuryKernelConversationStore(
  options: FuryKernelConversationOptions = {},
): FuryKernelConversationStore {
  const now = options.now ?? Date.now;
  const maxConversations = boundedInteger(
    options.maxConversations,
    DEFAULT_MAX_CONVERSATIONS,
    1,
    HARD_MAX_CONVERSATIONS,
    'maxConversations',
  );
  const maxMessages = boundedInteger(
    options.maxMessagesPerConversation,
    DEFAULT_MAX_MESSAGES,
    2,
    HARD_MAX_MESSAGES,
    'maxMessagesPerConversation',
  );
  const maxTurns = boundedInteger(
    options.maxTurnsPerConversation,
    DEFAULT_MAX_TURNS,
    1,
    HARD_MAX_TURNS,
    'maxTurnsPerConversation',
  );
  const maxMessageBytes = boundedInteger(
    options.maxMessageBytes,
    DEFAULT_MAX_MESSAGE_BYTES,
    1,
    HARD_MAX_MESSAGE_BYTES,
    'maxMessageBytes',
  );
  const maxConversationBytes = boundedInteger(
    options.maxConversationBytes,
    DEFAULT_MAX_CONVERSATION_BYTES,
    maxMessageBytes,
    HARD_MAX_CONVERSATION_BYTES,
    'maxConversationBytes',
  );
  const maxInFlightTurns = boundedInteger(
    options.maxInFlightTurns,
    DEFAULT_MAX_IN_FLIGHT_TURNS,
    1,
    HARD_MAX_IN_FLIGHT_TURNS,
    'maxInFlightTurns',
  );

  const conversations = new Map<string, ConversationState>();
  let inFlightTurns = 0;

  const requireConversation = (id: string): ConversationState => {
    const canonical = conversationId(id);
    const state = conversations.get(canonical);
    if (!state) {
      throw new FuryKernelConversationError(
        'invalid-conversation',
        'conversation does not exist in this Fury Kernel process',
      );
    }
    return state;
  };

  return Object.freeze({
    openConversation(input: FuryKernelOpenConversationInput = {}): FuryKernelConversationSnapshot {
      assertExactKeys(input, ['conversationId'], 'invalid-conversation', 'conversation input');
      if (conversations.size >= maxConversations) {
        throw new FuryKernelConversationError('conversation-limit', 'active conversation limit reached');
      }
      let id: string;
      if (input.conversationId === undefined) {
        id = nextOpaqueId('fkc_', (candidate) => conversations.has(candidate));
      } else {
        id = conversationId(input.conversationId);
        if (conversations.has(id)) {
          throw new FuryKernelConversationError('invalid-conversation', 'conversation ID already exists');
        }
      }
      const at = finiteNow(now);
      const state: ConversationState = {
        conversationId: id,
        createdAt: at,
        updatedAt: at,
        messages: [],
        turns: [],
        messageIds: new Set<string>(),
        bytes: 0,
      };
      conversations.set(id, state);
      return snapshot(state);
    },

    inspectConversation(id: string): FuryKernelConversationSnapshot {
      return snapshot(requireConversation(id));
    },

    submitUserMessage(input: FuryKernelSubmitMessageInput): FuryKernelAcceptedTurn {
      assertExactKeys(
        input,
        ['conversationId', 'messageId', 'content'],
        'invalid-message',
        'message input',
      );
      const state = requireConversation(input.conversationId);
      const id = messageId(input.messageId);
      const body = messageContent(input.content, maxMessageBytes);

      if (state.activeTurnId !== undefined) {
        throw new FuryKernelConversationError(
          'turn-in-flight',
          'conversation already has an active turn',
        );
      }
      if (inFlightTurns >= maxInFlightTurns) {
        throw new FuryKernelConversationError('in-flight-limit', 'global in-flight turn limit reached');
      }
      if (state.messageIds.has(id)) {
        throw new FuryKernelConversationError('message-replay', 'message ID has already been used');
      }
      if (state.messages.length + 2 > maxMessages) {
        throw new FuryKernelConversationError(
          'message-limit',
          'conversation does not have capacity for a complete request/response turn',
        );
      }
      if (state.turns.length >= maxTurns) {
        throw new FuryKernelConversationError('turn-limit', 'conversation turn limit reached');
      }
      if (state.bytes + body.bytes > maxConversationBytes) {
        throw new FuryKernelConversationError('byte-limit', 'conversation byte limit reached');
      }

      const at = finiteNow(now);
      const turn = {
        turnId: nextOpaqueId(
          'fkt_',
          (candidate) => [...conversations.values()]
            .some((conversation) => conversation.turns.some((existing) => existing.turnId === candidate)),
        ),
        requestMessageId: id,
        status: 'accepted' as const,
        createdAt: at,
      } satisfies MutableTurn;
      const message: FuryKernelMessage = Object.freeze({
        format: FURY_KERNEL_MESSAGE_FORMAT,
        messageId: id,
        role: 'user',
        content: body.content,
        createdAt: at,
      });

      state.messages.push(message);
      state.messageIds.add(id);
      state.turns.push(turn);
      state.bytes += body.bytes;
      state.activeTurnId = turn.turnId;
      state.updatedAt = at;
      inFlightTurns += 1;

      return Object.freeze({
        format: FURY_KERNEL_TURN_FORMAT,
        conversationId: state.conversationId,
        turn: cloneTurn(turn),
        status: 'accepted' as const,
        executionAuthority: false as const,
      });
    },

    completeTurn(input: FuryKernelCompleteTurnInput): FuryKernelCompletedTurn {
      assertExactKeys(
        input,
        ['conversationId', 'turnId', 'messageId', 'content'],
        'invalid-message',
        'turn completion input',
      );
      const state = requireConversation(input.conversationId);
      const requestedTurnId = turnId(input.turnId);
      const turn = findTurn(state, requestedTurnId);
      if (turn.status !== 'accepted' || state.activeTurnId !== turn.turnId) {
        throw new FuryKernelConversationError('turn-terminal', 'conversation turn is no longer active');
      }
      const responseId = messageId(input.messageId);
      if (state.messageIds.has(responseId)) {
        throw new FuryKernelConversationError('message-replay', 'message ID has already been used');
      }
      const body = messageContent(input.content, maxMessageBytes);
      if (state.messages.length + 1 > maxMessages) {
        throw new FuryKernelConversationError('message-limit', 'conversation message limit reached');
      }
      if (state.bytes + body.bytes > maxConversationBytes) {
        throw new FuryKernelConversationError('byte-limit', 'conversation byte limit reached');
      }

      const at = finiteNow(now);
      const response: FuryKernelMessage = Object.freeze({
        format: FURY_KERNEL_MESSAGE_FORMAT,
        messageId: responseId,
        role: 'assistant',
        content: body.content,
        createdAt: at,
      });
      state.messages.push(response);
      state.messageIds.add(responseId);
      state.bytes += body.bytes;
      state.updatedAt = at;
      delete state.activeTurnId;
      turn.status = 'completed';
      turn.responseMessageId = responseId;
      turn.completedAt = at;
      inFlightTurns -= 1;

      return Object.freeze({
        format: FURY_KERNEL_TURN_FORMAT,
        conversationId: state.conversationId,
        turn: cloneTurn(turn),
        status: 'completed' as const,
        executionAuthority: false as const,
      });
    },

    cancelTurn(input: FuryKernelCancelTurnInput): FuryKernelCancelledTurn {
      assertExactKeys(
        input,
        ['conversationId', 'turnId'],
        'turn-not-found',
        'turn cancellation input',
      );
      const state = requireConversation(input.conversationId);
      const requestedTurnId = turnId(input.turnId);
      const turn = findTurn(state, requestedTurnId);
      if (turn.status !== 'accepted' || state.activeTurnId !== turn.turnId) {
        throw new FuryKernelConversationError('turn-terminal', 'conversation turn is no longer active');
      }
      const at = finiteNow(now);
      turn.status = 'cancelled';
      turn.completedAt = at;
      state.updatedAt = at;
      delete state.activeTurnId;
      inFlightTurns -= 1;

      return Object.freeze({
        format: FURY_KERNEL_TURN_FORMAT,
        conversationId: state.conversationId,
        turn: cloneTurn(turn),
        status: 'cancelled' as const,
        executionAuthority: false as const,
      });
    },

    activeConversationCount(): number {
      return conversations.size;
    },

    inFlightTurnCount(): number {
      return inFlightTurns;
    },
  });
}
