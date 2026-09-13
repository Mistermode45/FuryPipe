import type { FuryProviderRequestEnvelope } from '../provider-request-envelope.js';
import { createProviderHttpTransport, genericRetryAfter, parseProviderReset } from './http-runtime.js';
import { resolveProviderHttpTransportOptions, type ProviderHttpTransportOptions } from './types.js';

/** OpenAI Responses API transport. No SDK, model rewrite, tools, or automatic retry. */
export function createOpenAIProviderTransport(options: ProviderHttpTransportOptions) {
  const runtime = resolveProviderHttpTransportOptions(options);
  return createProviderHttpTransport(
    'openai',
    'openai',
    runtime,
    (request: FuryProviderRequestEnvelope) => ({
      model: request.model,
      input: request.prompt,
      store: false,
      ...(runtime.maxOutputTokens === undefined ? {} : { max_output_tokens: runtime.maxOutputTokens }),
    }),
    'x-request-id',
    (headers, status, now) => {
      const standard = genericRetryAfter(headers, status, now);
      if (standard !== undefined || status !== 429) return standard;
      const resets = [
        parseProviderReset(headers.get('x-ratelimit-reset-requests')),
        parseProviderReset(headers.get('x-ratelimit-reset-tokens')),
        parseProviderReset(headers.get('x-ratelimit-reset-project-tokens')),
      ].filter((value): value is number => value !== undefined);
      return resets.length === 0 ? undefined : Math.max(...resets);
    },
  );
}
