import type { FuryProviderRequestEnvelope } from '../provider-request-envelope.js';
import { createProviderHttpTransport, genericRetryAfter } from './http-runtime.js';
import { resolveProviderHttpTransportOptions, type ProviderHttpTransportOptions } from './types.js';

// Pinned to the official currently documented Messages API version.
export const ANTHROPIC_API_VERSION = '2023-06-01';

export interface AnthropicProviderTransportOptions extends ProviderHttpTransportOptions {
  /** Messages API requires this; model-specific maxima remain provider-validated. */
  readonly maxOutputTokens: number;
}

/** Anthropic Messages transport with the required version header and no SDK retries. */
export function createAnthropicProviderTransport(options: AnthropicProviderTransportOptions) {
  const runtime = resolveProviderHttpTransportOptions(options, true);
  return createProviderHttpTransport(
    'anthropic',
    'anthropic',
    runtime,
    (request: FuryProviderRequestEnvelope) => ({
      model: request.model,
      max_tokens: runtime.maxOutputTokens,
      messages: [{ role: 'user', content: request.prompt }],
    }),
    'request-id',
    genericRetryAfter,
    { 'anthropic-version': ANTHROPIC_API_VERSION },
  );
}
