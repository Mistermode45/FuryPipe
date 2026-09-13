import { assertKnownKeys, ownDataRecord } from '../provider-execution-internal.js';

export type ProviderCredentialSource = () => string | Promise<string>;

/** Shared native-fetch configuration. Credentials are resolved per attempt. */
export interface ProviderHttpTransportOptions {
  readonly getCredential: ProviderCredentialSource;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxOutputTokens?: number;
  /** Clock used only to interpret an HTTP-date Retry-After value. */
  readonly now?: () => number;
}

export interface ResolvedProviderHttpTransportOptions {
  readonly getCredential: ProviderCredentialSource;
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
  readonly maxOutputTokens?: number;
  readonly now: () => number;
}

export const DEFAULT_PROVIDER_HTTP_TIMEOUT_MS = 60_000;
export const MAX_PROVIDER_HTTP_TIMEOUT_MS = 300_000;
export const MAX_PROVIDER_OUTPUT_TOKENS = 1_000_000;

export function resolveProviderHttpTransportOptions(
  value: ProviderHttpTransportOptions,
  requireMaxOutputTokens = false,
): ResolvedProviderHttpTransportOptions {
  let options: Readonly<Record<string, unknown>>;
  try {
    options = ownDataRecord(value);
    assertKnownKeys(options, ['getCredential', 'fetchImpl', 'timeoutMs', 'maxOutputTokens', 'now']);
  } catch {
    throw new TypeError('provider HTTP transport options are invalid');
  }

  const getCredential = options.getCredential;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_HTTP_TIMEOUT_MS;
  const maxOutputTokens = options.maxOutputTokens;
  const now = options.now ?? Date.now;
  if (typeof getCredential !== 'function' || typeof fetchImpl !== 'function' || typeof now !== 'function') {
    throw new TypeError('provider HTTP transport requires credential, fetch, and clock functions');
  }
  if (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) <= 0
    || (timeoutMs as number) > MAX_PROVIDER_HTTP_TIMEOUT_MS) {
    throw new RangeError(`provider HTTP timeout must be an integer from 1 to ${MAX_PROVIDER_HTTP_TIMEOUT_MS} ms`);
  }
  if (maxOutputTokens === undefined) {
    if (requireMaxOutputTokens) throw new TypeError('provider HTTP transport requires maxOutputTokens');
  } else if (!Number.isSafeInteger(maxOutputTokens) || (maxOutputTokens as number) <= 0
    || (maxOutputTokens as number) > MAX_PROVIDER_OUTPUT_TOKENS) {
    throw new RangeError(`maxOutputTokens must be an integer from 1 to ${MAX_PROVIDER_OUTPUT_TOKENS}`);
  }

  return Object.freeze({
    getCredential: getCredential as ProviderCredentialSource,
    fetchImpl: fetchImpl as typeof fetch,
    timeoutMs: timeoutMs as number,
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens: maxOutputTokens as number }),
    now: now as () => number,
  });
}
