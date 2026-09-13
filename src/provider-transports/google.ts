import type { FuryProviderRequestEnvelope } from '../provider-request-envelope.js';
import { createProviderHttpTransport, genericRetryAfter } from './http-runtime.js';
import { resolveProviderHttpTransportOptions, type ProviderHttpTransportOptions } from './types.js';

/** Gemini Interactions API stable v1 transport; the legacy generateContent API is not used. */
export function createGoogleProviderTransport(options: ProviderHttpTransportOptions) {
  const runtime = resolveProviderHttpTransportOptions(options);
  return createProviderHttpTransport(
    'google',
    'google',
    runtime,
    (request: FuryProviderRequestEnvelope) => ({
      model: request.model,
      input: request.prompt,
      store: false,
      ...(runtime.maxOutputTokens === undefined ? {} : {
        generation_config: { max_output_tokens: runtime.maxOutputTokens },
      }),
    }),
    undefined,
    genericRetryAfter,
  );
}
