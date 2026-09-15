import { describe, expect, it } from 'vitest';

import { furyEnvValue } from '../src/core/env-compat.js';

describe('FuryPipe environment compatibility', () => {
  it('prefers the FuryPipe-native value when both names are present', () => {
    expect(furyEnvValue('furypipe', 'legacy')).toBe('furypipe');
  });

  it('treats an explicitly empty FuryPipe-native value as authoritative', () => {
    expect(furyEnvValue('', 'legacy')).toBe('');
  });

  it('falls back only when the FuryPipe-native variable is absent', () => {
    expect(furyEnvValue(undefined, 'legacy')).toBe('legacy');
    expect(furyEnvValue(undefined, undefined)).toBeUndefined();
  });
});
