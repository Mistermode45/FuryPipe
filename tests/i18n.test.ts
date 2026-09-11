import { describe, expect, it } from 'vitest';
import { CORE_CATALOGS } from '../src/i18n/catalogs.js';
import {
  canonicalizeLocale,
  createI18n,
  directionForLocale,
  fallbackChain,
  preserveMachineValue,
  pseudoLocalize,
} from '../src/i18n/index.js';

describe('FuryPipe i18n core', () => {
  const i18n = createI18n({ catalogs: CORE_CATALOGS, defaultLocale: 'en' });

  it('canonicalizes BCP-47 tags and rejects invalid tags', () => {
    expect(canonicalizeLocale('fr-fr')).toBe('fr-FR');
    expect(canonicalizeLocale('EN-us')).toBe('en-US');
    expect(() => canonicalizeLocale('not_a_locale')).toThrow(/invalid BCP-47/);
  });

  it('uses deterministic locale fallback without inventing translations', () => {
    expect(fallbackChain('fr-CA', 'en')).toEqual(['fr-CA', 'fr', 'en']);
    expect(i18n.resolve('fr-CA')).toMatchObject({ canonical: 'fr-CA', resolved: 'fr', direction: 'ltr' });
    expect(i18n.translate('fr-CA', 'status.ready')).toBe('Prêt');
    expect(i18n.translate('de-DE', 'status.ready')).toBe('Ready');
    expect(i18n.translate('fr', 'missing.key')).toBe('missing.key');
  });

  it('interpolates named parameters only after locale selection', () => {
    expect(i18n.translate('fr', 'common.items', { params: { count: 3 } })).toBe('3 éléments');
    expect(i18n.translate('en', 'common.items', { params: { count: 3 } })).toBe('3 items');
  });

  it('identifies RTL locales and pseudo bidi locale', () => {
    expect(directionForLocale('ar')).toBe('rtl');
    expect(directionForLocale('he-IL')).toBe('rtl');
    expect(directionForLocale('fr-FR')).toBe('ltr');
    expect(i18n.resolve('ar-XB')).toMatchObject({ direction: 'rtl', pseudo: 'bidi' });
  });

  it('pseudo-localizes human messages while preserving placeholders', () => {
    const accented = pseudoLocalize('Hello {name}', 'accented');
    expect(accented).toContain('{name}');
    expect(accented).not.toBe('Hello {name}');
    const bidi = pseudoLocalize('Hello {name}', 'bidi');
    expect(bidi).toContain('{name}');
  });

  it('never changes exact machine values', () => {
    const exact = 'sha256:0123456789abcdef/path?x=1';
    expect(preserveMachineValue(exact)).toBe(exact);
  });
});
