import type { ProxyCapabilityInstructionPlan } from './proxy-capability-runtime.js';
import { validateProxyCapabilityInstructionPlan } from './proxy-capability-runtime.js';

const ACTIVE_SKILL_TAG = 'furypipe_active_skill';

function parseObject(body: Uint8Array<ArrayBuffer>): Record<string, unknown> {
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Anthropic request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

function textBlocks(system: unknown): readonly string[] {
  if (typeof system === 'string') return [system];
  if (!Array.isArray(system)) return [];
  return system.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const text = (raw as Record<string, unknown>).text;
    return typeof text === 'string' ? [text] : [];
  });
}

function alreadyContainsSkill(system: unknown, skillId: string): boolean {
  const marker = `<${ACTIVE_SKILL_TAG} name="${skillId}">`;
  return textBlocks(system).some((text) => text.includes(marker));
}

function ownedEncode(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return new Uint8Array(buffer);
}

/**
 * Add validated FuryPipe capability instruction blocks to Anthropic system text.
 *
 * Activated skills remain native text and are never confused with executable
 * skill/MCP receipts. Repeated retries skip blocks already present in system.
 */
export function applyAnthropicCapabilityInstructions(
  body: Uint8Array<ArrayBuffer>,
  rawPlan: ProxyCapabilityInstructionPlan,
): Uint8Array<ArrayBuffer> {
  const plan = validateProxyCapabilityInstructionPlan(rawPlan);
  if (plan.blocks.length === 0) return body;

  const root = parseObject(body);
  const additions = plan.blocks.filter((block) =>
    block.kind !== 'agent-skill' || !alreadyContainsSkill(root.system, block.id));

  if (additions.length === 0) return body;
  const blocks = additions.map((block) => ({ type: 'text', text: block.text }));

  if (root.system === undefined) {
    root.system = blocks;
  } else if (typeof root.system === 'string') {
    root.system = [{ type: 'text', text: root.system }, ...blocks];
  } else if (Array.isArray(root.system)) {
    root.system = [...root.system, ...blocks];
  } else {
    throw new Error('Anthropic system field has an unsupported shape');
  }

  return ownedEncode(JSON.stringify(root));
}

export const FURYPIPE_ACTIVE_SKILL_TAG = ACTIVE_SKILL_TAG;
