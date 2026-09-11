import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRecoveryStore, transformAnthropicMessages, verifyCompressionReceipt } from '../src/core/index.js';

describe('ExactGuard externalize E2E', () => {
  it('externalizes a semantic protected span, verifies Recovery and emits a receipt', async () => {
    const root = mkdtempSync(join(tmpdir(), 'furypipe-externalize-'));
    try {
      const original = new TextEncoder().encode(JSON.stringify({
        model: 'claude-fable-5',
        system: 'Authorization: Bearer abc.def.ghi\nKeep this request readable.',
        messages: [{ role: 'user', content: 'Continue with the requested task.' }],
      }));
      const result = await transformAnthropicMessages({
        body: original,
        model: 'claude-fable-5',
        requestId: 'externalize-test',
        options: {
          exactGuard: { representationPolicy: 'externalize' },
          recoveryStore: createRecoveryStore(root, { namespace: 'e2e' }),
          emitReceipt: true,
        },
      });

      expect(result.applied).toBe(true);
      expect(result.reason).toBe('externalized');
      expect(result.receipt?.strategy).toBe('externalize');
      expect(result.receipt?.recoveryHandles).toHaveLength(1);
      expect(result.body).not.toEqual(original);
      expect(new TextDecoder().decode(result.body)).not.toContain('abc.def.ghi');
      expect(verifyCompressionReceipt(result.receipt!, original, result.body)).toBe(true);

      const handle = result.receipt!.recoveryHandles[0]!;
      const store = createRecoveryStore(root, { namespace: 'e2e' });
      expect(await store.verify(handle)).toMatchObject({ ok: true, digestMatches: true });
      expect(new TextDecoder().decode(await store.get(handle))).toBe('Authorization: Bearer abc.def.ghi');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when a protected protocol identity cannot be externalized', async () => {
    const root = mkdtempSync(join(tmpdir(), 'furypipe-externalize-'));
    try {
      const original = new TextEncoder().encode(JSON.stringify({
        model: 'claude-fable-5',
        messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_abcdefghi', content: 'safe text' }] }],
      }));
      const result = await transformAnthropicMessages({
        body: original,
        model: 'claude-fable-5',
        options: {
          exactGuard: { representationPolicy: 'externalize' },
          recoveryStore: createRecoveryStore(root, { namespace: 'e2e' }),
        },
      });

      expect(result.body).toEqual(original);
      expect(result.info.exactGuard?.action).toBe('preserve_native');
      expect(result.info.exactGuard?.recoveryHandles).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
