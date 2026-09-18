import type { FuryHumanOutputPolicyDecision } from './human-output-policy.js';

const RUNTIME_TAG = 'furypipe_runtime_instruction';
const MAX_INSTRUCTION_CHARS = 8_192;

function parseObject(body: Uint8Array): Record<string, unknown> {
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Anthropic request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

function systemContainsTag(system: unknown): boolean {
  if (typeof system === 'string') return system.includes('<' + RUNTIME_TAG + '>');
  if (!Array.isArray(system)) return false;
  return system.some((block) =>
    block && typeof block === 'object' && !Array.isArray(block)
    && typeof (block as Record<string, unknown>).text === 'string'
    && ((block as Record<string, unknown>).text as string).includes('<' + RUNTIME_TAG + '>'));
}

/**
 * Inject one stable FuryPipe generation instruction into Anthropic system text.
 *
 * The dedicated XML tag is classified by transform.ts as a native dynamic
 * block, so the instruction is never hidden inside a Visual Engine image.
 * User messages, tools and provider metadata are left byte-semantically intact.
 */
export function applyAnthropicHumanOutputInstruction(
  body: Uint8Array,
  decision: FuryHumanOutputPolicyDecision,
): Uint8Array {
  if (!decision.instruction) return body;
  if (decision.instruction.length > MAX_INSTRUCTION_CHARS || decision.instruction.includes('\0')) {
    throw new Error('human output instruction exceeds its bound');
  }

  const root = parseObject(body);
  if (systemContainsTag(root.system)) return body;

  const tagged = '<' + RUNTIME_TAG + '>' + decision.instruction + '</' + RUNTIME_TAG + '>';
  if (root.system === undefined) {
    root.system = tagged;
  } else if (typeof root.system === 'string') {
    root.system = root.system + '\n\n' + tagged;
  } else if (Array.isArray(root.system)) {
    root.system = [...root.system, { type: 'text', text: tagged }];
  } else {
    throw new Error('Anthropic system field has an unsupported shape');
  }

  return new TextEncoder().encode(JSON.stringify(root));
}

export const FURYPIPE_RUNTIME_INSTRUCTION_TAG = RUNTIME_TAG;
