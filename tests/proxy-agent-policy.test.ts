import { describe, expect, it } from 'vitest';

import {
  FURY_PROXY_AGENT_POLICY_SENTINEL,
  FURY_PROXY_AGENT_POLICY_TEXT,
  injectFuryProxyAgentPolicy,
} from '../src/core/proxy-agent-policy.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function encode(value: unknown): Uint8Array {
  return enc.encode(JSON.stringify(value));
}

function decode(body: Uint8Array): Record<string, unknown> {
  return JSON.parse(dec.decode(body)) as Record<string, unknown>;
}

describe('FuryPipe proxy agent policy', () => {
  it('appends the policy to Anthropic system text without rewriting messages', () => {
    const source = {
      model: 'claude-opus-5',
      system: 'existing system',
      messages: [{ role: 'user', content: 'keep this user text byte-for-byte' }],
    };
    const result = injectFuryProxyAgentPolicy(encode(source), 'anthropic-messages');
    const parsed = decode(result.body);

    expect(result.applied).toBe(true);
    expect(result.instructionBytes).toBeGreaterThan(0);
    expect(parsed.system).toContain('existing system');
    expect(parsed.system).toContain(FURY_PROXY_AGENT_POLICY_SENTINEL);
    expect(parsed.messages).toEqual(source.messages);
  });

  it('keeps the policy inside an existing Anthropic cache prefix', () => {
    const marked = { type: 'text', text: 'cached tail', cache_control: { type: 'ephemeral' } };
    const result = injectFuryProxyAgentPolicy(encode({
      model: 'claude-opus-5',
      system: [
        { type: 'text', text: 'existing authority' },
        marked,
        { type: 'text', text: 'dynamic after marker' },
      ],
      messages: [{ role: 'user', content: 'hello' }],
    }), 'anthropic-messages');
    const parsed = decode(result.body);
    const system = parsed.system as Array<Record<string, unknown>>;

    expect(system[0]?.text).toBe('existing authority');
    expect(system[1]).toEqual({
      type: 'text',
      text: FURY_PROXY_AGENT_POLICY_TEXT,
    });
    expect(system[2]).toEqual(marked);
    expect(system[3]?.text).toBe('dynamic after marker');
  });

  it('inserts an OpenAI developer message after leading authority messages', () => {
    const source = {
      model: 'gpt-5.6-sol',
      messages: [
        { role: 'system', content: 'system authority' },
        { role: 'developer', content: 'developer authority' },
        { role: 'user', content: 'do the task' },
      ],
    };
    const result = injectFuryProxyAgentPolicy(encode(source), 'openai-chat');
    const messages = decode(result.body).messages as Array<Record<string, unknown>>;

    expect(messages[0]).toEqual(source.messages[0]);
    expect(messages[1]).toEqual(source.messages[1]);
    expect(messages[2]?.role).toBe('system');
    expect(messages[2]?.content).toContain(FURY_PROXY_AGENT_POLICY_SENTINEL);
    expect(messages[3]).toEqual(source.messages[2]);
  });

  it('appends to OpenAI Responses instructions', () => {
    const source = {
      model: 'gpt-5.6-sol',
      instructions: 'existing instructions',
      input: 'hello',
    };
    const result = injectFuryProxyAgentPolicy(encode(source), 'openai-responses');
    const parsed = decode(result.body);

    expect(parsed.instructions).toContain('existing instructions');
    expect(parsed.instructions).toContain(FURY_PROXY_AGENT_POLICY_SENTINEL);
    expect(parsed.input).toBe('hello');
  });

  it('adds a Gemini systemInstruction without rewriting contents', () => {
    const contents = [{ role: 'user', parts: [{ text: 'hello' }] }];
    const result = injectFuryProxyAgentPolicy(encode({
      contents,
    }), 'google');
    const parsed = decode(result.body);
    const system = parsed.systemInstruction as { parts: Array<{ text: string }> };

    expect(system.parts.at(-1)?.text).toContain(FURY_PROXY_AGENT_POLICY_SENTINEL);
    expect(parsed.contents).toEqual(contents);
  });

  it('is idempotent when the sentinel is already present', () => {
    const once = injectFuryProxyAgentPolicy(encode({
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'hello' }],
    }), 'anthropic-messages');
    const twice = injectFuryProxyAgentPolicy(once.body, 'anthropic-messages');

    expect(once.applied).toBe(true);
    expect(twice.applied).toBe(false);
    expect(twice.reason).toBe('already_present');
    expect(dec.decode(twice.body)).toBe(dec.decode(once.body));
  });

  it('declares machine-sensitive and exact-output exclusions in the policy itself', () => {
    expect(FURY_PROXY_AGENT_POLICY_TEXT).toContain('tool or MCP calls/results');
    expect(FURY_PROXY_AGENT_POLICY_TEXT).toContain('literal/exact-response requests');
    expect(FURY_PROXY_AGENT_POLICY_TEXT).toContain('code, patches/diffs, shell commands');
    expect(FURY_PROXY_AGENT_POLICY_TEXT).toContain('Exact and machine-readable contracts outrank this style policy');
  });

  it('fails closed on invalid JSON and unsupported shapes', () => {
    const invalid = enc.encode('{');
    const invalidResult = injectFuryProxyAgentPolicy(invalid, 'anthropic-messages');
    expect(invalidResult.applied).toBe(false);
    expect(invalidResult.reason).toBe('invalid_json');
    expect(invalidResult.body).toBe(invalid);

    const scalar = encode('hello');
    const scalarResult = injectFuryProxyAgentPolicy(scalar, 'openai-responses');
    expect(scalarResult.applied).toBe(false);
    expect(scalarResult.reason).toBe('unsupported_shape');
    expect(scalarResult.body).toBe(scalar);
  });
});
