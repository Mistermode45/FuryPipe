import { describe, expect, it } from 'vitest';
import { resolvePersistedModelScope } from '../src/model-config.js';

describe('persisted model scope migration', () => {
  it('migrates the unmarked <=0.15 default scope to automatic discovery', () => {
    expect(resolvePersistedModelScope(['claude-fable-5', 'gemini'], undefined)).toEqual({
      mode: 'automatic',
      migratedLegacyDefault: true,
    });
    expect(resolvePersistedModelScope('gemini, claude-fable-5', undefined)).toEqual({
      mode: 'automatic',
      migratedLegacyDefault: true,
    });
  });

  it('preserves the same values when current FuryPipe marked them explicit', () => {
    expect(resolvePersistedModelScope(['claude-fable-5', 'gemini'], true)).toEqual({
      mode: 'explicit',
      envValue: 'claude-fable-5,gemini',
      migratedLegacyDefault: false,
    });
  });

  it('preserves custom legacy scopes rather than broadening them', () => {
    expect(resolvePersistedModelScope(['claude-fable-5', 'claude-opus-5'], undefined)).toEqual({
      mode: 'explicit',
      envValue: 'claude-fable-5,claude-opus-5',
      migratedLegacyDefault: false,
    });
  });

  it('keeps explicit off and distinguishes an absent key', () => {
    expect(resolvePersistedModelScope('off', true)).toEqual({
      mode: 'explicit',
      envValue: 'off',
      migratedLegacyDefault: false,
    });
    expect(resolvePersistedModelScope(undefined, undefined)).toEqual({
      mode: 'absent',
      migratedLegacyDefault: false,
    });
  });
});
