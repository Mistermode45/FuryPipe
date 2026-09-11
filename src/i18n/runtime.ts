import { canonicalizeLocale, directionForLocale } from './index.js';

export interface RuntimeTranslator {
  translate(locale: string, key: string, options?: { params?: Readonly<Record<string, string | number | boolean>> }): string;
}

export interface LocaleRuntimeSnapshot {
  locale: string;
  direction: 'ltr' | 'rtl';
}

export interface LocaleRuntimeOptions {
  translator: RuntimeTranslator;
  supportedLocales: readonly string[];
  defaultLocale: string;
  initialPreferences?: readonly string[];
}

export type LocaleListener = (snapshot: LocaleRuntimeSnapshot) => void;

function uniqueCanonical(locales: readonly string[]): string[] {
  const result: string[] = [];
  for (const locale of locales) {
    const canonical = canonicalizeLocale(locale);
    if (!result.includes(canonical)) result.push(canonical);
  }
  return result;
}

export function resolveSupportedLocale(
  preferences: readonly string[],
  supportedLocales: readonly string[],
  defaultLocale: string,
): string {
  const supported = uniqueCanonical(supportedLocales);
  if (supported.length === 0) throw new Error('supportedLocales must not be empty');

  const fallback = canonicalizeLocale(defaultLocale);
  if (!supported.includes(fallback)) {
    throw new Error('defaultLocale must be present in supportedLocales');
  }

  const byLanguage = new Map<string, string>();
  for (const locale of supported) {
    const language = new Intl.Locale(locale).language;
    if (!byLanguage.has(language)) byLanguage.set(language, locale);
  }

  for (const preference of preferences) {
    let canonical: string;
    try {
      canonical = canonicalizeLocale(preference);
    } catch {
      continue;
    }

    if (supported.includes(canonical)) return canonical;

    const language = new Intl.Locale(canonical).language;
    const languageMatch = byLanguage.get(language);
    if (languageMatch) return languageMatch;
  }

  return fallback;
}

export function createLocaleRuntime(options: LocaleRuntimeOptions) {
  const supportedLocales = Object.freeze(uniqueCanonical(options.supportedLocales));
  const defaultLocale = canonicalizeLocale(options.defaultLocale);
  let locale = resolveSupportedLocale(options.initialPreferences ?? [], supportedLocales, defaultLocale);
  const listeners = new Set<LocaleListener>();

  const snapshot = (): LocaleRuntimeSnapshot => Object.freeze({
    locale,
    direction: directionForLocale(locale),
  });

  const notify = () => {
    const value = snapshot();
    for (const listener of [...listeners]) listener(value);
  };

  const setLocale = (requested: string): LocaleRuntimeSnapshot => {
    const next = resolveSupportedLocale([requested], supportedLocales, defaultLocale);
    if (next !== locale) {
      locale = next;
      notify();
    }
    return snapshot();
  };

  const setPreferences = (preferences: readonly string[]): LocaleRuntimeSnapshot => {
    const next = resolveSupportedLocale(preferences, supportedLocales, defaultLocale);
    if (next !== locale) {
      locale = next;
      notify();
    }
    return snapshot();
  };

  const subscribe = (listener: LocaleListener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const t = (
    key: string,
    params?: Readonly<Record<string, string | number | boolean>>,
  ): string => options.translator.translate(locale, key, params ? { params } : undefined);

  return Object.freeze({
    defaultLocale,
    supportedLocales,
    snapshot,
    setLocale,
    setPreferences,
    subscribe,
    t,
  });
}

export function assertCatalogParity(
  catalogs: Readonly<Record<string, Readonly<Record<string, string>>>>,
  referenceLocale: string,
): void {
  const reference = canonicalizeLocale(referenceLocale);
  const canonicalCatalogs = new Map<string, Readonly<Record<string, string>>>();
  for (const [locale, catalog] of Object.entries(catalogs)) {
    canonicalCatalogs.set(canonicalizeLocale(locale), catalog);
  }

  const referenceCatalog = canonicalCatalogs.get(reference);
  if (!referenceCatalog) throw new Error(`reference catalog missing: ${reference}`);

  const referenceKeys = Object.keys(referenceCatalog).sort();
  for (const [locale, catalog] of canonicalCatalogs) {
    const keys = Object.keys(catalog).sort();
    const missing = referenceKeys.filter((key) => !(key in catalog));
    const extra = keys.filter((key) => !(key in referenceCatalog));
    if (missing.length || extra.length) {
      throw new Error(
        `catalog parity failure for ${locale}: missing=[${missing.join(',')}] extra=[${extra.join(',')}]`,
      );
    }
  }
}
