export const FURY_PROVIDER_RESPONSE_TEXT_FORMAT =
  'furypipe-provider-response-text/v1' as const;

export type FuryProviderResponseTextProvider = 'openai' | 'anthropic' | 'google';

export interface FuryProviderResponseText {
  readonly format: typeof FURY_PROVIDER_RESPONSE_TEXT_FORMAT;
  readonly providerId: FuryProviderResponseTextProvider;
  readonly text: string;
  readonly textBytes: number;
  readonly sourceShape:
    | 'openai.responses.output_text'
    | 'anthropic.messages.content_text'
    | 'google.interactions.model_output_text';
  /** Provider output is application data, not verified external evidence. */
  readonly verification: 'unverified';
  readonly executionAuthority: false;
}

export type FuryProviderResponseTextErrorCode =
  | 'invalid-provider'
  | 'invalid-response-encoding'
  | 'invalid-response-json'
  | 'unsupported-response-shape'
  | 'unsupported-response-content'
  | 'empty-response-text'
  | 'response-text-too-large';

export class FuryProviderResponseTextError extends Error {
  readonly code: FuryProviderResponseTextErrorCode;

  constructor(code: FuryProviderResponseTextErrorCode) {
    super(code);
    this.name = 'FuryProviderResponseTextError';
    this.code = code;
  }
}

const DEFAULT_MAX_TEXT_BYTES = 64 * 1024;
const HARD_MAX_TEXT_BYTES = 256 * 1024;

function object(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : undefined;
}

function maxBytes(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_TEXT_BYTES;
  if (
    !Number.isSafeInteger(resolved)
    || resolved < 1
    || resolved > HARD_MAX_TEXT_BYTES
  ) {
    throw new RangeError(
      `provider response text maxBytes must be an integer from 1 to ${HARD_MAX_TEXT_BYTES}`,
    );
  }
  return resolved;
}

function decodeJson(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array) || !ArrayBuffer.isView(bytes)) {
    throw new FuryProviderResponseTextError('invalid-response-encoding');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new FuryProviderResponseTextError('invalid-response-encoding');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FuryProviderResponseTextError('invalid-response-json');
  }
}

function finalize(
  providerId: FuryProviderResponseTextProvider,
  sourceShape: FuryProviderResponseText['sourceShape'],
  fragments: readonly string[],
  limit: number,
): FuryProviderResponseText {
  const text = fragments.join('');
  if (text.length === 0 || text.trim().length === 0 || text.includes('\0')) {
    throw new FuryProviderResponseTextError('empty-response-text');
  }
  const textBytes = Buffer.byteLength(text, 'utf8');
  if (textBytes > limit) {
    throw new FuryProviderResponseTextError('response-text-too-large');
  }
  return Object.freeze({
    format: FURY_PROVIDER_RESPONSE_TEXT_FORMAT,
    providerId,
    text,
    textBytes,
    sourceShape,
    verification: 'unverified' as const,
    executionAuthority: false as const,
  });
}

function boundedText(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new FuryProviderResponseTextError('unsupported-response-content');
  }
  return value;
}

function decodeOpenAi(root: Record<string, unknown>, limit: number): FuryProviderResponseText {
  if (!Array.isArray(root.output)) {
    throw new FuryProviderResponseTextError('unsupported-response-shape');
  }
  const fragments: string[] = [];
  for (const rawItem of root.output) {
    const item = object(rawItem);
    if (!item || typeof item.type !== 'string') {
      throw new FuryProviderResponseTextError('unsupported-response-content');
    }
    if (item.type === 'reasoning') continue;
    if (item.type !== 'message') {
      throw new FuryProviderResponseTextError('unsupported-response-content');
    }
    if (item.role !== undefined && item.role !== 'assistant') {
      throw new FuryProviderResponseTextError('unsupported-response-content');
    }
    if (!Array.isArray(item.content)) {
      throw new FuryProviderResponseTextError('unsupported-response-content');
    }
    for (const rawContent of item.content) {
      const content = object(rawContent);
      if (!content || content.type !== 'output_text') {
        throw new FuryProviderResponseTextError('unsupported-response-content');
      }
      fragments.push(boundedText(content.text));
    }
  }
  return finalize('openai', 'openai.responses.output_text', fragments, limit);
}

function decodeAnthropic(root: Record<string, unknown>, limit: number): FuryProviderResponseText {
  if (root.role !== undefined && root.role !== 'assistant') {
    throw new FuryProviderResponseTextError('unsupported-response-content');
  }
  if (!Array.isArray(root.content)) {
    throw new FuryProviderResponseTextError('unsupported-response-shape');
  }
  const fragments: string[] = [];
  for (const rawBlock of root.content) {
    const block = object(rawBlock);
    if (!block || typeof block.type !== 'string') {
      throw new FuryProviderResponseTextError('unsupported-response-content');
    }
    if (block.type === 'thinking' || block.type === 'redacted_thinking') continue;
    if (block.type !== 'text') {
      throw new FuryProviderResponseTextError('unsupported-response-content');
    }
    fragments.push(boundedText(block.text));
  }
  return finalize('anthropic', 'anthropic.messages.content_text', fragments, limit);
}

function decodeGoogle(root: Record<string, unknown>, limit: number): FuryProviderResponseText {
  if (root.status !== undefined && root.status !== 'completed') {
    throw new FuryProviderResponseTextError('unsupported-response-content');
  }
  if (!Array.isArray(root.steps)) {
    throw new FuryProviderResponseTextError('unsupported-response-shape');
  }
  const fragments: string[] = [];
  for (const rawStep of root.steps) {
    const step = object(rawStep);
    if (!step || typeof step.type !== 'string') {
      throw new FuryProviderResponseTextError('unsupported-response-content');
    }
    if (step.type !== 'model_output') {
      throw new FuryProviderResponseTextError('unsupported-response-content');
    }
    if (!Array.isArray(step.content)) {
      throw new FuryProviderResponseTextError('unsupported-response-content');
    }
    for (const rawContent of step.content) {
      const content = object(rawContent);
      if (!content || content.type !== 'text') {
        throw new FuryProviderResponseTextError('unsupported-response-content');
      }
      fragments.push(boundedText(content.text));
    }
  }
  return finalize('google', 'google.interactions.model_output_text', fragments, limit);
}

export function decodeFuryProviderResponseText(
  providerId: FuryProviderResponseTextProvider,
  responseBytes: Uint8Array,
  options: { readonly maxBytes?: number } = {},
): FuryProviderResponseText {
  if (
    providerId !== 'openai'
    && providerId !== 'anthropic'
    && providerId !== 'google'
  ) {
    throw new FuryProviderResponseTextError('invalid-provider');
  }
  const root = object(decodeJson(responseBytes));
  if (!root) {
    throw new FuryProviderResponseTextError('unsupported-response-shape');
  }
  const limit = maxBytes(options.maxBytes);
  if (providerId === 'openai') return decodeOpenAi(root, limit);
  if (providerId === 'anthropic') return decodeAnthropic(root, limit);
  return decodeGoogle(root, limit);
}
