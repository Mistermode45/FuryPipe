/**
 * Plaintext-free observation of capability executions completed by an external
 * agent host (Claude Code, Codex, Gemini CLI, etc.).
 *
 * FuryPipe does not turn a model's tool-use request into an execution claim.
 * A record is emitted only when the next provider request contains the host's
 * corresponding tool/function result. Even then this is an OBSERVATION, not
 * cryptographic verification: a client could fabricate a result block.
 */

export const FURY_CLIENT_CAPABILITY_EXECUTION_FORMAT =
  'furypipe-client-capability-execution/v1' as const;

export type FuryClientCapabilityKind = 'mcp' | 'skill' | 'tool';
export type FuryClientCapabilityProtocol =
  | 'anthropic-messages'
  | 'openai-chat'
  | 'openai-responses'
  | 'google';

export interface FuryClientCapabilityExecutionObservation {
  readonly format: typeof FURY_CLIENT_CAPABILITY_EXECUTION_FORMAT;
  readonly kind: FuryClientCapabilityKind;
  /** Bounded host-visible capability identity; never a result/prompt value. */
  readonly capabilityId: string;
  /** SHA-256 over protocol + call identity + capability identity. */
  readonly callDigest: string;
  /** SHA-256 over the returned result payload. */
  readonly resultDigest: string;
  readonly outcome: 'success' | 'error';
  readonly source: 'client_tool_result';
  readonly executionState: 'OBSERVED_EXECUTED';
  /** Observation is evidence, but not independent verification. */
  readonly verified: false;
  readonly mcpServerId?: string;
  readonly mcpMethod?: string;
}

interface RawCall {
  readonly callId: string;
  readonly name: string;
  readonly input?: unknown;
}

interface RawResult {
  readonly callId: string;
  readonly value: unknown;
  readonly isError: boolean;
  readonly explicitName?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_ID = 256;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedName(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID) return null;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return null;
  return value;
}

function contentBlocks(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  return [];
}

function collectAnthropic(root: Record<string, unknown>): { calls: RawCall[]; results: RawResult[] } {
  const calls: RawCall[] = [];
  const results: RawResult[] = [];
  if (!Array.isArray(root.messages)) return { calls, results };

  for (const rawMessage of root.messages) {
    const message = record(rawMessage);
    if (!message) continue;
    for (const rawBlock of contentBlocks(message.content)) {
      const block = record(rawBlock);
      if (!block) continue;
      if (block.type === 'tool_use') {
        const callId = boundedName(block.id);
        const name = boundedName(block.name);
        if (callId && name) calls.push({ callId, name, input: block.input });
      } else if (block.type === 'tool_result') {
        const callId = boundedName(block.tool_use_id);
        if (!callId) continue;
        results.push({
          callId,
          value: block.content ?? null,
          isError: block.is_error === true,
        });
      }
    }
  }
  return { calls, results };
}

function collectOpenAIChat(root: Record<string, unknown>): { calls: RawCall[]; results: RawResult[] } {
  const calls: RawCall[] = [];
  const results: RawResult[] = [];
  if (!Array.isArray(root.messages)) return { calls, results };

  for (const rawMessage of root.messages) {
    const message = record(rawMessage);
    if (!message) continue;
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const rawCall of message.tool_calls) {
        const call = record(rawCall);
        const fn = record(call?.function);
        const callId = boundedName(call?.id);
        const name = boundedName(fn?.name);
        if (callId && name) calls.push({ callId, name, input: fn?.arguments });
      }
    }
    if (message.role === 'tool') {
      const callId = boundedName(message.tool_call_id);
      if (!callId) continue;
      results.push({
        callId,
        value: message.content ?? null,
        isError: message.error !== undefined,
      });
    }
  }
  return { calls, results };
}

function collectOpenAIResponses(root: Record<string, unknown>): { calls: RawCall[]; results: RawResult[] } {
  const calls: RawCall[] = [];
  const results: RawResult[] = [];
  if (!Array.isArray(root.input)) return { calls, results };

  for (const rawItem of root.input) {
    const item = record(rawItem);
    if (!item) continue;
    if (item.type === 'function_call') {
      const callId = boundedName(item.call_id ?? item.id);
      const name = boundedName(item.name);
      if (callId && name) calls.push({ callId, name, input: item.arguments });
    } else if (item.type === 'function_call_output') {
      const callId = boundedName(item.call_id);
      if (!callId) continue;
      results.push({
        callId,
        value: item.output ?? null,
        isError: item.error !== undefined,
      });
    }
  }
  return { calls, results };
}

function collectGoogle(root: Record<string, unknown>): { calls: RawCall[]; results: RawResult[] } {
  const calls: RawCall[] = [];
  const results: RawResult[] = [];
  if (!Array.isArray(root.contents)) return { calls, results };

  // Gemini functionCall/functionResponse may not always carry an explicit call
  // id. We only claim an observed execution when an id exists, or when a
  // functionResponse names a function whose call name is unique in this body.
  for (const rawContent of root.contents) {
    const content = record(rawContent);
    if (!content || !Array.isArray(content.parts)) continue;
    for (const rawPart of content.parts) {
      const part = record(rawPart);
      if (!part) continue;
      const fc = record(part.functionCall);
      if (fc) {
        const name = boundedName(fc.name);
        const callId = boundedName(fc.id ?? part.id);
        if (name) calls.push({
          callId: callId ?? `google-name:${name}`,
          name,
          input: fc.args,
        });
      }
      const fr = record(part.functionResponse);
      if (fr) {
        const name = boundedName(fr.name);
        const callId = boundedName(fr.id ?? part.id);
        if (name) {
          results.push({
            callId: callId ?? `google-name:${name}`,
            explicitName: name,
            value: fr.response ?? fr.parts ?? null,
            isError: fr.error !== undefined,
          });
        }
      }
    }
  }
  return { calls, results };
}

async function sha256(value: string): Promise<string> {
  const bytes = encoder.encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return '"[unserializable]"';
  }
}

function classifyCapability(call: RawCall): {
  kind: FuryClientCapabilityKind;
  capabilityId: string;
  mcpServerId?: string;
  mcpMethod?: string;
} {
  if (call.name.startsWith('mcp__')) {
    const segments = call.name.split('__');
    if (segments.length >= 3) {
      const server = boundedName(segments[1]);
      const method = boundedName(segments.slice(2).join('__'));
      if (server && method) {
        return {
          kind: 'mcp',
          capabilityId: `${server}/${method}`,
          mcpServerId: server,
          mcpMethod: method,
        };
      }
    }
    return { kind: 'mcp', capabilityId: call.name };
  }

  if (/^(?:skill|skills)$/iu.test(call.name)) {
    const input = record(call.input);
    const skillId = boundedName(input?.skill ?? input?.name ?? input?.id);
    if (skillId) return { kind: 'skill', capabilityId: skillId };
  }

  return { kind: 'tool', capabilityId: call.name };
}

export async function observeClientCapabilityExecutions(
  body: Uint8Array,
  protocol: FuryClientCapabilityProtocol,
): Promise<readonly FuryClientCapabilityExecutionObservation[]> {
  let root: Record<string, unknown>;
  try {
    const parsed = JSON.parse(decoder.decode(body)) as unknown;
    const parsedRecord = record(parsed);
    if (!parsedRecord) return Object.freeze([]);
    root = parsedRecord;
  } catch {
    return Object.freeze([]);
  }

  const collected = protocol === 'anthropic-messages'
    ? collectAnthropic(root)
    : protocol === 'openai-chat'
      ? collectOpenAIChat(root)
      : protocol === 'openai-responses'
        ? collectOpenAIResponses(root)
        : collectGoogle(root);

  const byId = new Map<string, RawCall>();
  const byName = new Map<string, RawCall[]>();
  for (const call of collected.calls) {
    byId.set(call.callId, call);
    const existing = byName.get(call.name) ?? [];
    existing.push(call);
    byName.set(call.name, existing);
  }

  const observations: FuryClientCapabilityExecutionObservation[] = [];
  const seen = new Set<string>();
  for (const result of collected.results) {
    let call = byId.get(result.callId);
    if (!call && result.explicitName) {
      const candidates = byName.get(result.explicitName) ?? [];
      if (candidates.length === 1) call = candidates[0];
    }
    if (!call) continue;

    const identity = classifyCapability(call);
    const callDigest = await sha256(
      `${protocol}\0${call.callId}\0${call.name}\0${identity.capabilityId}`,
    );
    if (seen.has(callDigest)) continue;
    seen.add(callDigest);
    const resultDigest = await sha256(stableJson(result.value));

    observations.push(Object.freeze({
      format: FURY_CLIENT_CAPABILITY_EXECUTION_FORMAT,
      kind: identity.kind,
      capabilityId: identity.capabilityId,
      callDigest,
      resultDigest,
      outcome: result.isError ? 'error' : 'success',
      source: 'client_tool_result',
      executionState: 'OBSERVED_EXECUTED',
      verified: false,
      ...(identity.mcpServerId === undefined ? {} : { mcpServerId: identity.mcpServerId }),
      ...(identity.mcpMethod === undefined ? {} : { mcpMethod: identity.mcpMethod }),
    }));
  }

  return Object.freeze(observations);
}
