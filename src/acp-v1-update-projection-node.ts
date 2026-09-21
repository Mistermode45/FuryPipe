import type * as acp from '@agentclientprotocol/sdk';

export const FURY_ACP_V1_DISPLAY_UPDATE_FORMAT =
  'furypipe-acp-v1-display-update/v1' as const;

export type FuryAcpV1DisplayUpdateInput =
  | Readonly<{
      type: 'message';
      text: string;
    }>
  | Readonly<{
      type: 'plan';
      entries: readonly FuryAcpV1PlanEntryInput[];
    }>
  | Readonly<{
      type: 'tool_call';
      toolCallId: string;
      title: string;
      toolKind?: acp.ToolKind;
      status?: acp.ToolCallStatus;
      contentText?: string;
    }>
  | Readonly<{
      type: 'tool_call_update';
      toolCallId: string;
      title?: string;
      toolKind?: acp.ToolKind;
      status?: acp.ToolCallStatus;
      contentText?: string;
    }>;

export interface FuryAcpV1PlanEntryInput {
  readonly content: string;
  readonly priority: acp.PlanEntryPriority;
  readonly status: acp.PlanEntryStatus;
}

export interface FuryAcpV1DisplayProjectionOptions {
  readonly messageId?: string;
  readonly maxPlanEntries?: number;
  readonly maxPayloadBytes?: number;
  readonly maxWireBytes?: number;
}

export interface FuryAcpV1ProjectedDisplayUpdate {
  readonly format: typeof FURY_ACP_V1_DISPLAY_UPDATE_FORMAT;
  readonly update: acp.SessionUpdate;
  readonly payloadBytes: number;
  readonly wireBytes: number;
  readonly authority: 'display-only';
  readonly executionAuthority: false;
}

export type FuryAcpV1UpdateProjectionErrorCode =
  | 'invalid-update'
  | 'limit-exceeded';

const ERROR_MESSAGES: Readonly<Record<
  FuryAcpV1UpdateProjectionErrorCode,
  string
>> = Object.freeze({
  'invalid-update': 'ACP display update is invalid or unsupported.',
  'limit-exceeded': 'ACP display update exceeds its configured bound.',
});

export class FuryAcpV1UpdateProjectionError extends Error {
  readonly retrySafe = false;

  constructor(readonly code: FuryAcpV1UpdateProjectionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'FuryAcpV1UpdateProjectionError';
  }
}

const DEFAULT_MAX_PLAN_ENTRIES = 64;
const HARD_MAX_PLAN_ENTRIES = 512;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const HARD_MAX_PAYLOAD_BYTES = 1024 * 1024;
const DEFAULT_MAX_WIRE_BYTES = 128 * 1024;
const HARD_MAX_WIRE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_TITLE_BYTES = 2 * 1024;
const MAX_ID_BYTES = 128;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TOOL_KINDS = new Set<acp.ToolKind>([
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'switch_mode',
  'other',
]);
const TOOL_STATUSES = new Set<acp.ToolCallStatus>([
  'pending',
  'in_progress',
  'completed',
  'failed',
]);
const PLAN_PRIORITIES = new Set<acp.PlanEntryPriority>([
  'high',
  'medium',
  'low',
]);
const PLAN_STATUSES = new Set<acp.PlanEntryStatus>([
  'pending',
  'in_progress',
  'completed',
]);

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new FuryAcpV1UpdateProjectionError('limit-exceeded');
  }
  return resolved;
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FuryAcpV1UpdateProjectionError('invalid-update');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FuryAcpV1UpdateProjectionError('invalid-update');
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new FuryAcpV1UpdateProjectionError('invalid-update');
  }
  const allowed = new Set(allowedKeys);
  const required = new Set(requiredKeys);
  const names = Object.getOwnPropertyNames(value);
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !allowed.has(key)
    ) {
      throw new FuryAcpV1UpdateProjectionError('invalid-update');
    }
  }
  for (const key of required) {
    if (!names.includes(key)) {
      throw new FuryAcpV1UpdateProjectionError('invalid-update');
    }
  }
  return value as Record<string, unknown>;
}

function boundedText(
  value: unknown,
  maxBytes: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string'
    || value.includes('\0')
    || (!allowEmpty && (value.length === 0 || value.trim().length === 0))
  ) {
    throw new FuryAcpV1UpdateProjectionError('invalid-update');
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new FuryAcpV1UpdateProjectionError('limit-exceeded');
  }
  return value;
}

function canonicalId(value: unknown): string {
  const id = boundedText(value, MAX_ID_BYTES);
  if (!ID_RE.test(id)) {
    throw new FuryAcpV1UpdateProjectionError('invalid-update');
  }
  return id;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    throw new FuryAcpV1UpdateProjectionError('invalid-update');
  }
  return value as T;
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T | undefined {
  return value === undefined ? undefined : enumValue(value, allowed);
}

function optionalText(
  value: unknown,
  maxBytes: number,
): string | undefined {
  return value === undefined ? undefined : boundedText(value, maxBytes);
}

function textContent(text: string): acp.ToolCallContent[] {
  const block: acp.ContentBlock = {
    type: 'text',
    text,
  };
  Object.freeze(block);
  const item: acp.ToolCallContent = {
    type: 'content',
    content: block,
  };
  Object.freeze(item);
  const content: acp.ToolCallContent[] = [item];
  Object.freeze(content);
  return content;
}

function payloadBytesOf(values: readonly (string | undefined)[]): number {
  return values.reduce(
    (total, value) => total + (value === undefined ? 0 : Buffer.byteLength(value, 'utf8')),
    0,
  );
}

function finalize(
  update: acp.SessionUpdate,
  payloadBytes: number,
  maxPayloadBytes: number,
  maxWireBytes: number,
): FuryAcpV1ProjectedDisplayUpdate {
  if (payloadBytes > maxPayloadBytes) {
    throw new FuryAcpV1UpdateProjectionError('limit-exceeded');
  }
  const wireBytes = Buffer.byteLength(JSON.stringify(update), 'utf8');
  if (wireBytes > maxWireBytes) {
    throw new FuryAcpV1UpdateProjectionError('limit-exceeded');
  }
  Object.freeze(update);
  return Object.freeze({
    format: FURY_ACP_V1_DISPLAY_UPDATE_FORMAT,
    update,
    payloadBytes,
    wireBytes,
    authority: 'display-only' as const,
    executionAuthority: false as const,
  });
}

export function projectFuryAcpV1DisplayUpdate(
  value: unknown,
  options: FuryAcpV1DisplayProjectionOptions = {},
): FuryAcpV1ProjectedDisplayUpdate {
  const maxPlanEntries = boundedInteger(
    options.maxPlanEntries,
    DEFAULT_MAX_PLAN_ENTRIES,
    0,
    HARD_MAX_PLAN_ENTRIES,
  );
  const maxPayloadBytes = boundedInteger(
    options.maxPayloadBytes,
    DEFAULT_MAX_PAYLOAD_BYTES,
    1,
    HARD_MAX_PAYLOAD_BYTES,
  );
  const maxWireBytes = boundedInteger(
    options.maxWireBytes,
    DEFAULT_MAX_WIRE_BYTES,
    1,
    HARD_MAX_WIRE_BYTES,
  );
  const messageId = options.messageId === undefined
    ? undefined
    : canonicalId(options.messageId);

  const record = exactRecord(
    value,
    [
      'type',
      'text',
      'entries',
      'toolCallId',
      'title',
      'toolKind',
      'status',
      'contentText',
    ],
    ['type'],
  );

  if (record.type === 'message') {
    exactRecord(value, ['type', 'text'], ['type', 'text']);
    const text = boundedText(record.text, MAX_TEXT_BYTES);
    const update: acp.SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      ...(messageId === undefined ? {} : { messageId }),
      content: {
        type: 'text',
        text,
      },
    };
    Object.freeze(update.content);
    return finalize(
      update,
      Buffer.byteLength(text, 'utf8'),
      maxPayloadBytes,
      maxWireBytes,
    );
  }

  if (record.type === 'plan') {
    exactRecord(value, ['type', 'entries'], ['type', 'entries']);
    if (!Array.isArray(record.entries) || record.entries.length > maxPlanEntries) {
      throw new FuryAcpV1UpdateProjectionError('limit-exceeded');
    }
    const entries: acp.PlanEntry[] = [];
    let payloadBytes = 0;
    for (const entryValue of record.entries) {
      const entry = exactRecord(
        entryValue,
        ['content', 'priority', 'status'],
        ['content', 'priority', 'status'],
      );
      const content = boundedText(entry.content, MAX_TEXT_BYTES);
      const priority = enumValue(entry.priority, PLAN_PRIORITIES);
      const status = enumValue(entry.status, PLAN_STATUSES);
      payloadBytes += Buffer.byteLength(content, 'utf8');
      const projected: acp.PlanEntry = { content, priority, status };
      Object.freeze(projected);
      entries.push(projected);
    }
    Object.freeze(entries);
    const update: acp.SessionUpdate = {
      sessionUpdate: 'plan',
      entries,
    };
    return finalize(update, payloadBytes, maxPayloadBytes, maxWireBytes);
  }

  if (record.type === 'tool_call') {
    exactRecord(
      value,
      ['type', 'toolCallId', 'title', 'toolKind', 'status', 'contentText'],
      ['type', 'toolCallId', 'title'],
    );
    const toolCallId = canonicalId(record.toolCallId);
    const title = boundedText(record.title, MAX_TITLE_BYTES);
    const toolKind = optionalEnum(record.toolKind, TOOL_KINDS);
    const status = optionalEnum(record.status, TOOL_STATUSES);
    const contentText = optionalText(record.contentText, MAX_TEXT_BYTES);
    const update: acp.SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId,
      title,
      ...(toolKind === undefined ? {} : { kind: toolKind }),
      ...(status === undefined ? {} : { status }),
      ...(contentText === undefined ? {} : { content: textContent(contentText) }),
    };
    return finalize(
      update,
      payloadBytesOf([toolCallId, title, contentText]),
      maxPayloadBytes,
      maxWireBytes,
    );
  }

  if (record.type === 'tool_call_update') {
    exactRecord(
      value,
      ['type', 'toolCallId', 'title', 'toolKind', 'status', 'contentText'],
      ['type', 'toolCallId'],
    );
    const toolCallId = canonicalId(record.toolCallId);
    const title = optionalText(record.title, MAX_TITLE_BYTES);
    const toolKind = optionalEnum(record.toolKind, TOOL_KINDS);
    const status = optionalEnum(record.status, TOOL_STATUSES);
    const contentText = optionalText(record.contentText, MAX_TEXT_BYTES);
    if (
      title === undefined
      && toolKind === undefined
      && status === undefined
      && contentText === undefined
    ) {
      throw new FuryAcpV1UpdateProjectionError('invalid-update');
    }
    const update: acp.SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      ...(title === undefined ? {} : { title }),
      ...(toolKind === undefined ? {} : { kind: toolKind }),
      ...(status === undefined ? {} : { status }),
      ...(contentText === undefined ? {} : { content: textContent(contentText) }),
    };
    return finalize(
      update,
      payloadBytesOf([toolCallId, title, contentText]),
      maxPayloadBytes,
      maxWireBytes,
    );
  }

  throw new FuryAcpV1UpdateProjectionError('invalid-update');
}
