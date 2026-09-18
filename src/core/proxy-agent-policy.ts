/**
 * Provider-wire policy injection for normal FuryPipe proxy traffic.
 *
 * The policy is native FuryPipe text. It never rewrites user prompts, tool
 * payloads, code, or provider responses. Instead it adds a bounded system-level
 * instruction that:
 *  - asks agent hosts to use progressive disclosure for already-available
 *    Skills/tools/MCP and to keep execution claims evidence-backed; and
 *  - keeps human-facing prose compact while explicitly exempting
 *    machine-sensitive/exact output.
 *
 * Core createProxy() keeps this opt-in for embedders. The FuryPipe Node host
 * enables it by default and exposes an emergency environment kill switch.
 */

export const FURY_PROXY_AGENT_POLICY_VERSION = '1.0.0' as const;
export const FURY_PROXY_AGENT_POLICY_SENTINEL = 'FURYPIPE_PROXY_AGENT_POLICY_V1' as const;

export type FuryProxyAgentPolicyProtocol =
  | 'anthropic-messages'
  | 'openai-chat'
  | 'openai-responses'
  | 'google';

export interface FuryProxyAgentPolicyResult {
  readonly body: Uint8Array;
  readonly applied: boolean;
  readonly version: typeof FURY_PROXY_AGENT_POLICY_VERSION;
  readonly protocol: FuryProxyAgentPolicyProtocol;
  readonly instructionBytes: number;
  readonly reason?: 'already_present' | 'unsupported_shape' | 'invalid_json';
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Native policy: inspired by two independently useful 2026 ecosystem ideas
 * without importing third-party runtime code:
 *  - progressive disclosure: load only the relevant capability detail;
 *  - compact human output: shorten the mouth, not the reasoning/input.
 */
export const FURY_PROXY_AGENT_POLICY_TEXT = [
  `[${FURY_PROXY_AGENT_POLICY_SENTINEL}]`,
  'Capability use: for substantive work, inspect capabilities already available in the host and use the smallest relevant set of Skills, tools, or MCP. Start from metadata and load full Skill instructions only when relevant. Never invent an unavailable capability. Respect host permissions, approvals, and read/write boundaries. Selection or a tool-use request is not execution proof; claim execution only after a real result or execution receipt exists.',
  'Human output: apply compact, information-dense wording only to natural-language prose addressed to the human. Remove greetings, filler, repetition, and needless narration while preserving technical detail, caveats, uncertainty, and actionable facts.',
  'Machine/exact boundary: do not compact, paraphrase, reformat, or stylize code, patches/diffs, shell commands, JSON, YAML, XML, schemas, tool or MCP calls/results, structured-output contracts, URLs, paths, identifiers, hashes, citations, quoted text, or literal/exact-response requests. Exact and machine-readable contracts outrank this style policy. Never trade correctness or unambiguous meaning for brevity.',
].join('\n');

const POLICY_BYTES = encoder.encode(FURY_PROXY_AGENT_POLICY_TEXT).byteLength;

function hasSentinel(value: unknown): boolean {
  if (typeof value === 'string') return value.includes(FURY_PROXY_AGENT_POLICY_SENTINEL);
  if (Array.isArray(value)) return value.some((item) => hasSentinel(item));
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some((item) => hasSentinel(item));
}

function anthropicMessages(root: Record<string, unknown>): boolean {
  const system = root.system;
  if (system === undefined) {
    root.system = FURY_PROXY_AGENT_POLICY_TEXT;
    return true;
  }
  if (typeof system === 'string') {
    root.system = `${system}\n\n${FURY_PROXY_AGENT_POLICY_TEXT}`;
    return true;
  }
  if (Array.isArray(system)) {
    root.system = [...system, { type: 'text', text: FURY_PROXY_AGENT_POLICY_TEXT }];
    return true;
  }
  return false;
}

function openAIChat(root: Record<string, unknown>): boolean {
  if (!Array.isArray(root.messages)) return false;
  const messages = [...root.messages];
  let insertAt = 0;
  while (insertAt < messages.length) {
    const item = messages[insertAt];
    if (!item || typeof item !== 'object' || Array.isArray(item)) break;
    const role = (item as Record<string, unknown>).role;
    if (role !== 'system' && role !== 'developer') break;
    insertAt += 1;
  }
  messages.splice(insertAt, 0, {
    role: 'developer',
    content: FURY_PROXY_AGENT_POLICY_TEXT,
  });
  root.messages = messages;
  return true;
}

function openAIResponses(root: Record<string, unknown>): boolean {
  const instructions = root.instructions;
  if (instructions === undefined || instructions === null) {
    root.instructions = FURY_PROXY_AGENT_POLICY_TEXT;
    return true;
  }
  if (typeof instructions !== 'string') return false;
  root.instructions = `${instructions}\n\n${FURY_PROXY_AGENT_POLICY_TEXT}`;
  return true;
}

function google(root: Record<string, unknown>): boolean {
  const current = root.systemInstruction;
  if (current === undefined) {
    root.systemInstruction = { parts: [{ text: FURY_PROXY_AGENT_POLICY_TEXT }] };
    return true;
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) return false;
  const content = current as Record<string, unknown>;
  if (!Array.isArray(content.parts)) return false;
  content.parts = [...content.parts, { text: FURY_PROXY_AGENT_POLICY_TEXT }];
  root.systemInstruction = content;
  return true;
}

export function injectFuryProxyAgentPolicy(
  body: Uint8Array,
  protocol: FuryProxyAgentPolicyProtocol,
): FuryProxyAgentPolicyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(body)) as unknown;
  } catch {
    return Object.freeze({
      body,
      applied: false,
      version: FURY_PROXY_AGENT_POLICY_VERSION,
      protocol,
      instructionBytes: 0,
      reason: 'invalid_json',
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return Object.freeze({
      body,
      applied: false,
      version: FURY_PROXY_AGENT_POLICY_VERSION,
      protocol,
      instructionBytes: 0,
      reason: 'unsupported_shape',
    });
  }

  if (hasSentinel(parsed)) {
    return Object.freeze({
      body,
      applied: false,
      version: FURY_PROXY_AGENT_POLICY_VERSION,
      protocol,
      instructionBytes: 0,
      reason: 'already_present',
    });
  }

  const root = parsed as Record<string, unknown>;
  const applied = protocol === 'anthropic-messages'
    ? anthropicMessages(root)
    : protocol === 'openai-chat'
      ? openAIChat(root)
      : protocol === 'openai-responses'
        ? openAIResponses(root)
        : google(root);

  if (!applied) {
    return Object.freeze({
      body,
      applied: false,
      version: FURY_PROXY_AGENT_POLICY_VERSION,
      protocol,
      instructionBytes: 0,
      reason: 'unsupported_shape',
    });
  }

  return Object.freeze({
    body: encoder.encode(JSON.stringify(root)),
    applied: true,
    version: FURY_PROXY_AGENT_POLICY_VERSION,
    protocol,
    instructionBytes: POLICY_BYTES,
  });
}
