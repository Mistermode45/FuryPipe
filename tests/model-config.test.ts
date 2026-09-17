import { describe, expect, it } from 'vitest';
import { resolveEffectiveModelScope, resolvePersistedModelScope } from '../src/model-config.js';

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

  it('treats modelScopeMode=explicit as authoritative over the legacy-default migration', () => {
    expect(resolvePersistedModelScope(
      ['claude-fable-5', 'gemini'],
      undefined,
      'explicit',
    )).toEqual({
      mode: 'explicit',
      envValue: 'claude-fable-5,gemini',
      migratedLegacyDefault: false,
    });
  });

  it('preserves a valid current-format explicit scope without the legacy boolean marker', () => {
    expect(resolvePersistedModelScope(
      ['claude-opus-5'],
      undefined,
      'explicit',
    )).toEqual({
      mode: 'explicit',
      envValue: 'claude-opus-5',
      migratedLegacyDefault: false,
    });
  });

  it('fails closed when current-format explicit state has no usable list', () => {
    expect(resolvePersistedModelScope(undefined, undefined, 'explicit')).toEqual({
      mode: 'off',
      envValue: 'off',
      migratedLegacyDefault: false,
    });
    expect(resolvePersistedModelScope([], undefined, 'explicit')).toEqual({
      mode: 'off',
      envValue: 'off',
      migratedLegacyDefault: false,
    });
    expect(resolvePersistedModelScope(['claude-opus-5', 7], undefined, 'explicit')).toEqual({
      mode: 'off',
      envValue: 'off',
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
      mode: 'off',
      envValue: 'off',
      migratedLegacyDefault: false,
    });
    expect(resolvePersistedModelScope(undefined, undefined)).toEqual({
      mode: 'absent',
      migratedLegacyDefault: false,
    });
  });

  it('supports the explicit off mode and preserves the state across an empty list', () => {
    expect(resolvePersistedModelScope(undefined, undefined, 'off')).toEqual({
      mode: 'off',
      envValue: 'off',
      migratedLegacyDefault: false,
    });
    expect(resolvePersistedModelScope([], true, 'explicit')).toEqual({
      mode: 'off',
      envValue: 'off',
      migratedLegacyDefault: false,
    });
  });

  it('honors the explicit persisted automatic mode without migrating or exporting a scope', () => {
    expect(resolvePersistedModelScope(['claude-fable-5'], true, 'automatic')).toEqual({
      mode: 'automatic',
      migratedLegacyDefault: false,
    });
  });

  it('uses environment over config and config over the automatic default', () => {
    expect(resolveEffectiveModelScope({
      automaticModels: ['claude-fable-5', 'gemini'],
    })).toEqual({
      mode: 'automatic',
      source: 'automatic_default',
      effectiveModels: ['claude-fable-5', 'gemini'],
    });
    expect(resolveEffectiveModelScope({
      envValue: 'off',
      persisted: { modelScopeMode: 'explicit', models: ['claude-opus-5'], modelScopeExplicit: true },
      automaticModels: ['claude-fable-5', 'gemini'],
    })).toEqual({ mode: 'off', source: 'environment', effectiveModels: [] });
    expect(resolveEffectiveModelScope({
      persisted: { modelScopeMode: 'off' },
      automaticModels: ['claude-fable-5', 'gemini'],
    })).toEqual({ mode: 'off', source: 'config', effectiveModels: [] });
    expect(resolveEffectiveModelScope({
      persisted: { modelScopeMode: 'explicit', models: ['claude-fable-5', 'gemini'] },
      automaticModels: ['claude-fable-5', 'gemini'],
    })).toEqual({
      mode: 'explicit',
      source: 'config',
      effectiveModels: ['claude-fable-5', 'gemini'],
    });
  });

  it('fails closed for malformed persisted and oversized environment scopes', () => {
    expect(resolvePersistedModelScope(['claude-opus-5', 7], true, 'explicit')).toEqual({
      mode: 'off',
      envValue: 'off',
      migratedLegacyDefault: false,
    });
    expect(resolveEffectiveModelScope({
      envValue: Array.from({ length: 65 }, (_, i) => `model-${i}`).join(','),
      automaticModels: ['claude-fable-5'],
    })).toEqual({
      mode: 'off',
      source: 'environment',
      effectiveModels: [],
    });
  });
});