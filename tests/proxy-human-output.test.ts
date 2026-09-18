import { describe, expect, it } from 'vitest';
import { resolveFuryHumanOutputPolicy } from '../src/human-output-policy.js';
import {
  applyAnthropicHumanOutputInstruction,
  FURYPIPE_RUNTIME_INSTRUCTION_TAG,
} from '../src/proxy-human-output.js';

const dec = new TextDecoder();

describe('proxy human output augmentation', () => {
  it('adds a tagged system instruction without modifying messages or tools', () => {
    const source = {
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'Explain this.' }],
      tools: [{ name: 'Read', description: 'read', input_schema: { type: 'object' } }],
    };
    const decision = resolveFuryHumanOutputPolicy({ objective: 'Explain this.' });
    const out = JSON.parse(dec.decode(applyAnthropicHumanOutputInstruction(
      new TextEncoder().encode(JSON.stringify(source)),
      decision,
    ))) as Record<string, unknown>;

    expect(String(out.system)).toContain('<' + FURYPIPE_RUNTIME_INSTRUCTION_TAG + '>');
    expect(out.messages).toEqual(source.messages);
    expect(out.tools).toEqual(source.tools);
  });

  it('keeps exact-output decisions byte-identical', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'Respond exactly OK' }],
    }));
    const decision = resolveFuryHumanOutputPolicy({ objective: 'Respond exactly OK' });
    expect(applyAnthropicHumanOutputInstruction(bytes, decision)).toBe(bytes);
  });

  it('does not duplicate the runtime instruction across retries', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      model: 'claude-opus-5',
      system: 'Base system.',
      messages: [{ role: 'user', content: 'Explain this.' }],
    }));
    const decision = resolveFuryHumanOutputPolicy({ objective: 'Explain this.' });
    const once = applyAnthropicHumanOutputInstruction(bytes, decision);
    const twice = applyAnthropicHumanOutputInstruction(once, decision);
    expect(dec.decode(twice)).toBe(dec.decode(once));
  });

  it('appends a native text block when system is already block-shaped', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      model: 'claude-opus-5',
      system: [{ type: 'text', text: 'base', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'Explain this.' }],
    }));
    const decision = resolveFuryHumanOutputPolicy({ objective: 'Explain this.' });
    const out = JSON.parse(dec.decode(applyAnthropicHumanOutputInstruction(bytes, decision))) as {
      system: Array<Record<string, unknown>>;
    };
    expect(out.system).toHaveLength(2);
    expect(out.system[1]?.text).toContain(FURYPIPE_RUNTIME_INSTRUCTION_TAG);
    expect(out.system[1]).not.toHaveProperty('cache_control');
  });
});
