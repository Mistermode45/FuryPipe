import { describe, expect, it } from 'vitest';
import { transformRequest } from '../src/core/transform.js';

function body(overrides: Record<string, unknown> = {}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    model: 'claude-sonnet-4-6',
    system: 'Follow the task constraints. Keep provider protocol semantics intact.',
    tools: [{ name: 'read_file', description: 'Read a file from the workspace.' }],
    messages: [
      { role: 'user', content: 'Please inspect the current request and report the result.' },
      { role: 'assistant', content: [{ type: 'text', text: 'I will inspect it.' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'line one\nline two' }] },
    ],
    ...overrides,
  }));
}

describe('Context Fabric runtime integration', () => {
  it('attaches one safe analysis to the real transform path without changing short requests', async () => {
    const source = body();
    const result = await transformRequest(source, { safetyMode: false });
    const analysis = result.info.contextFabric;

    expect(new TextDecoder().decode(result.body)).toBe(new TextDecoder().decode(source));
    expect(analysis).toMatchObject({
      format: 'furypipe-context-fabric-analysis/v1',
      protocol: 'anthropic.messages',
      parsed: { messageCount: 3, toolCount: 1, systemBlocks: 1 },
      ir: { verification: 'ok' },
      ledger: { verification: 'ok', latestUserRequest: true },
      verification: { phase: 'post_transform', ir: 'ok', ledger: 'ok' },
      providerFabric: {
        provider: { id: 'anthropic', availability: 'unknown' },
        model: { family: 'anthropic', safeFallback: 'native' },
      },
    });
    expect(analysis?.ir.blockCount).toBeGreaterThan(0);
    expect(analysis?.strategy.observed).toBe('raw');
    expect(JSON.stringify(analysis)).not.toContain('line one');
    expect(JSON.stringify(analysis)).not.toContain('Follow the task constraints');
  });

  it('records an exact-guard raw decision for protected content', async () => {
    const source = body({
      system: 'Authorization: Bearer abc.def.ghi\n' + 'x'.repeat(3000),
    });
    const result = await transformRequest(source);
    const analysis = result.info.contextFabric;

    expect(result.info.exactGuard?.action).toBe('preserve_native');
    expect(analysis?.strategy.observed).toBe('raw');
    expect(analysis?.verification.phase).toBe('post_transform');
    expect(JSON.stringify(analysis)).not.toContain('abc.def.ghi');
  });
});
