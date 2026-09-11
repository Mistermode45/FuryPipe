import { describe, expect, it } from 'vitest';
import {
  buildPrecisionManifest,
  detectProtectedSpans,
  exactGuardOptionsForMode,
  verifyPrecisionManifest,
} from '../src/core/exact-guard.js';

describe('ExactGuard', () => {
  it('provides conservative automatic modes without weakening custom rules', () => {
    const url = 'see https://api.example.test/v1/messages';
    expect(detectProtectedSpans(url, exactGuardOptionsForMode('balanced'))).toHaveLength(0);
    expect(detectProtectedSpans(url, exactGuardOptionsForMode('coding-safe'))[0]?.class).toBe('url');
    expect(detectProtectedSpans(url, exactGuardOptionsForMode('safe'))[0]?.class).toBe('url');
    expect(detectProtectedSpans('tenant=alpha', {
      ...exactGuardOptionsForMode('balanced'),
      rules: [{ id: 'tenant', class: 'identifier', pattern: /alpha/g, priority: 200 }],
    })[0]?.class).toBe('identifier');
  });

  it('detects sensitive exact values without storing plaintext', () => {
    const text = [
      'Authorization: Bearer sk-ant-api03-example-secret',
      'request_id=req_123456',
      'commit 0123456789abcdef0123456789abcdef01234567',
      'server https://api.example.test:443/v1/messages',
      'player 550e8400-e29b-41d4-a716-446655440000',
    ].join('\n');

    const spans = detectProtectedSpans(text);
    expect(spans.length).toBeGreaterThanOrEqual(5);
    expect(spans.every((span) => !('value' in span))).toBe(true);
    expect(spans.some((span) => span.class === 'auth_header')).toBe(true);
    expect(spans.some((span) => span.class === 'message_id')).toBe(true);
    expect(spans.some((span) => span.class === 'sha1')).toBe(true);
    expect(spans.some((span) => span.class === 'url')).toBe(true);
    expect(spans.some((span) => span.class === 'minecraft_uuid' || span.class === 'uuid')).toBe(true);
  });

  it('is deterministic and verifies an unchanged source', () => {
    const text = 'git checkout 0123456789abcdef0123456789abcdef01234567';
    const first = buildPrecisionManifest(text);
    const second = buildPrecisionManifest(text);
    expect(second).toEqual(first);
    expect(verifyPrecisionManifest(text, first)).toEqual({
      ok: true,
      sourceHashMatches: true,
      checkedSpans: first.spans.length,
      invalidSpans: [],
    });
  });

  it('fails closed when a protected value changes', () => {
    const manifest = buildPrecisionManifest('request_id=req_123456');
    const result = verifyPrecisionManifest('request_id=req_654321', manifest);
    expect(result.ok).toBe(false);
    expect(result.sourceHashMatches).toBe(false);
    expect(result.reason).toBe('source hash mismatch');
  });

  it('supports user rules and low-confidence literals explicitly', () => {
    const text = 'tenant=alpha value="must remain exact"';
    const spans = detectProtectedSpans(text, {
      includeLowConfidenceLiterals: true,
      rules: [{ id: 'tenant', class: 'identifier', pattern: /alpha/g, priority: 200 }],
    });
    expect(spans.some((span) => span.class === 'identifier')).toBe(true);
    expect(spans.some((span) => span.class === 'string_literal')).toBe(true);
  });
});
