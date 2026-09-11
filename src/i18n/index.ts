export type MessageCatalog = Readonly<Record<string, string>>;

export interface I18nConfig {
  catalogs: Readonly<Record<string, MessageCatalog>>;
  defaultLocale: string;
}

export interface TranslateOptions {
  params?: Readonly<Record<string, string | number | boolean>>;
}

export interface LocaleResolution {
  requested: string;
  canonical: string;
  resolved: string;
  fallbackChain: readonly string[];
  direction: 'ltr' | 'rtl';
  pseudo: 'none' | 'accented' | 'bidi';
}

const RTL_LANGUAGES = new Set([
  'ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'ks', 'ku', 'ps', 'sd', 'ug', 'ur', 'yi'
]);

const PSEUDO_LOCALES = new Map<string, 'accented' | 'bidi'>([
  ['en-XA', 'accented'],
  ['ar-XB', 'bidi'],
]);

const ACCENTS: Readonly<Record<string, string>> = {
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ğ', H: 'Ħ', I: 'Î',
  J: 'Ĵ', K: 'Ķ', L: 'Ŀ', M: 'M', N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Q', R: 'Ŕ',
  S: 'Š', T: 'Ţ', U: 'Û', V: 'V', W: 'Ŵ', X: 'X', Y: 'Ý', Z: 'Ž',
  a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ğ', h: 'ħ', i: 'î',
  j: 'ĵ', k: 'ķ', l: 'ŀ', m: 'm', n: 'ñ', o: 'ö', p: 'þ', q: 'q', r: 'ŕ',
  s: 'š', t: 'ţ', u: 'û', v: 'v', w: 'ŵ', x: 'x', y: 'ý', z: 'ž'
};

export function canonicalizeLocale(locale: string): string {
  if (typeof locale !== 'string' || locale.trim().length === 0) {
    throw new TypeError('locale must be a non-empty BCP-47 language tag');
  }
  try {
    const [canonical] = Intl.getCanonicalLocales(locale.trim());
    if (!canonical) throw new RangeError('locale could not be canonicalized');
    return canonical;
  } catch {
    throw new RangeError(`invalid BCP-47 locale: ${locale}`);
  }
}

function languageOf(locale: string): string {
  return new Intl.Locale(locale).language;
}

export function directionForLocale(locale: string): 'ltr' | 'rtl' {
  const canonical = canonicalizeLocale(locale);
  if (canonical === 'ar-XB') return 'rtl';
  return RTL_LANGUAGES.has(languageOf(canonical)) ? 'rtl' : 'ltr';
}

export function fallbackChain(locale: string, defaultLocale: string): readonly string[] {
  const requested = canonicalizeLocale(locale);
  const fallback = canonicalizeLocale(defaultLocale);
  const values: string[] = [];
  const add = (value: string) => {
    if (!values.includes(value)) values.push(value);
  };

  add(requested);
  const loc = new Intl.Locale(requested);
  if (loc.language !== requested) add(loc.language);
  add(fallback);
  const fallbackLanguage = languageOf(fallback);
  if (fallbackLanguage !== fallback) add(fallbackLanguage);
  return values;
}

function protectPlaceholders(message: string): { text: string; placeholders: string[] } {
  const placeholders: string[] = [];
  const text = message.replace(/\{[A-Za-z0-9_.-]+\}/g, (match) => {
    const token = `\u0000${placeholders.length}\u0000`;
    placeholders.push(match);
    return token;
  });
  return { text, placeholders };
}

function restorePlaceholders(message: string, placeholders: readonly string[]): string {
  return message.replace(/\u0000(\d+)\u0000/g, (_, index) => placeholders[Number(index)] ?? '');
}

export function pseudoLocalize(message: string, mode: 'accented' | 'bidi'): string {
  const { text, placeholders } = protectPlaceholders(message);
  if (mode === 'accented') {
    const converted = [...text].map((ch) => ACCENTS[ch] ?? ch).join('');
    return restorePlaceholders(`［${converted}］`, placeholders);
  }

  return restorePlaceholders(`\u202e⟦${text}⟧\u202c`, placeholders);
}

function interpolate(message: string, params: Readonly<Record<string, string | number | boolean>>): string {
  return message.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, key)) return match;
    return String(params[key]);
  });
}

export function createI18n(config: I18nConfig) {
  const defaultLocale = canonicalizeLocale(config.defaultLocale);
  const catalogs = new Map<string, MessageCatalog>();
  for (const [locale, catalog] of Object.entries(config.catalogs)) {
    catalogs.set(canonicalizeLocale(locale), Object.freeze({ ...catalog }));
  }
  if (!catalogs.has(defaultLocale)) {
    throw new Error(`default locale catalog is missing: ${defaultLocale}`);
  }

  const resolve = (requestedLocale: string): LocaleResolution => {
    const canonical = canonicalizeLocale(requestedLocale);
    const pseudo = PSEUDO_LOCALES.get(canonical) ?? 'none';
    const sourceLocale = pseudo === 'accented' ? 'en' : pseudo === 'bidi' ? 'en' : canonical;
    const chain = fallbackChain(sourceLocale, defaultLocale);
    const resolved = chain.find((locale) => catalogs.has(locale)) ?? defaultLocale;
    return {
      requested: requestedLocale,
      canonical,
      resolved,
      fallbackChain: Object.freeze([...chain]),
      direction: directionForLocale(canonical),
      pseudo,
    };
  };

  const translate = (locale: string, key: string, options: TranslateOptions = {}): string => {
    if (typeof key !== 'string' || key.length === 0) throw new TypeError('message key must be non-empty');
    const resolution = resolve(locale);
    const sourceChain = fallbackChain(
      resolution.pseudo === 'none' ? resolution.canonical : 'en',
      defaultLocale,
    );
    let message: string | undefined;
    for (const candidate of sourceChain) {
      message = catalogs.get(candidate)?.[key];
      if (message !== undefined) break;
    }
    if (message === undefined) return key;
    if (resolution.pseudo !== 'none') message = pseudoLocalize(message, resolution.pseudo);
    return interpolate(message, options.params ?? {});
  };

  return Object.freeze({
    defaultLocale,
    locales: Object.freeze([...catalogs.keys()].sort()),
    resolve,
    translate,
  });
}

/**
 * Exact machine values are deliberately outside the translation pipeline.
 * Callers use this helper when a UI mixes human labels and protocol/config data.
 */
export function preserveMachineValue<T extends string>(value: T): T {
  return value;
}
