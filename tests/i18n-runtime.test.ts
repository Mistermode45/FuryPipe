import { describe, expect, it, vi } from 'vitest';
import { CORE_CATALOGS } from '../src/i18n/catalogs.js';
import { createI18n } from '../src/i18n/index.js';
import {
  assertCatalogParity,
  createLocaleRuntime,
  resolveSupportedLocale,
} from '../src/i18n/runtime.js';

describe('i18n runtime', () => {
  const translator = createI18n({ catalogs: CORE_CATALOGS, defaultLocale: 'en' });

  it('resolves exact locale, then language, then explicit default', () => {
    expect(resolveSupportedLocale(['fr-FR'], ['en', 'fr'], 'en')).toBe('fr');
    expect(resolveSupportedLocale(['en-US'], ['en', 'fr'], 'en')).toBe('en');
    expect(resolveSupportedLocale(['de-DE'], ['en', 'fr'], 'en')).toBe('en');
  });

  it('ignores invalid preference tags instead of corrupting runtime state', () => {
    expect(resolveSupportedLocale(['not_a_locale', 'fr-FR'], ['en', 'fr'], 'en')).toBe('fr');
  });

  it('requires the default locale to be supported', () => {
    expect(() => resolveSupportedLocale([], ['fr'], 'en')).toThrow(/defaultLocale/);
  });

  it('exposes locale, direction and translation as one runtime snapshot', () => {
    const runtime = createLocaleRuntime({
      translator,
      supportedLocales: ['en', 'fr', 'ar-XB'],
      defaultLocale: 'en',
      initialPreferences: ['fr-CA'],
    });

    expect(runtime.snapshot()).toEqual({ locale: 'fr', direction: 'ltr' });
    expect(runtime.t('status.ready')).toBe('Prêt');

    expect(runtime.setLocale('ar-XB')).toEqual({ locale: 'ar-XB', direction: 'rtl' });
    expect(runtime.t('status.ready')).not.toBe('Ready');
  });

  it('notifies subscribers only when the resolved locale changes', () => {
    const runtime = createLocaleRuntime({
      translator,
      supportedLocales: ['en', 'fr'],
      defaultLocale: 'en',
    });
    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);

    runtime.setLocale('en-US');
    expect(listener).not.toHaveBeenCalled();

    runtime.setLocale('fr-FR');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({ locale: 'fr', direction: 'ltr' });

    unsubscribe();
    runtime.setLocale('en');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps FR and EN catalog keys in strict parity', () => {
    expect(() => assertCatalogParity(CORE_CATALOGS, 'en')).not.toThrow();
  });

  it('fails visible when a translated catalog loses or invents a key', () => {
    expect(() => assertCatalogParity({
      en: { a: 'A', b: 'B' },
      fr: { a: 'A', c: 'C' },
    }, 'en')).toThrow(/missing=\[b\].*extra=\[c\]/);
  });
});
