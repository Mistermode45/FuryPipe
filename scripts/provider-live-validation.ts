import {
  createAnthropicProviderTransport,
  createGoogleProviderTransport,
  createOpenAIProviderTransport,
} from '../src/provider-transports/index.js';
import { MAX_PROVIDER_RESPONSE_BYTES } from '../src/provider-execution-internal.js';
import type { FuryProviderRequestEnvelope } from '../src/provider-request-envelope.js';
import type { ProviderTransportExecutionContext } from '../src/provider-transport.js';
import {
  boundedText,
  hasExplicitOptIn,
  presence,
  sourceCommit,
  writeEvidence,
} from './external-validation-common.mjs';

const CREDENTIALS = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
} as const;

const provider = process.env.FURYPIPE_PROVIDER?.trim().toLowerCase();
const model = boundedText(process.env.FURYPIPE_PROVIDER_MODEL, 256);
const credentialVariable = provider && provider in CREDENTIALS
  ? CREDENTIALS[provider as keyof typeof CREDENTIALS]
  : undefined;
const credential = credentialVariable ? process.env[credentialVariable]?.trim() : undefined;
const credentialPresence = presence(Object.values(CREDENTIALS));
const baseEvidence = {
  format: 'furypipe-provider-live-validation/v1',
  sourceCommit: sourceCommit(),
  provider: provider ?? 'not-selected',
  model: model ?? 'not-selected',
  credentialPresence,
  requestExecuted: false,
  externalMutation: false,
  maxRequests: 1,
  scope: 'one bounded non-streaming transport request; no automatic retry',
};

if (!hasExplicitOptIn('FURYPIPE_PROVIDER_LIVE_AUTHORIZED')) {
  await writeEvidence('provider-live.json', {
    ...baseEvidence,
    status: 'AUTHORIZATION_REQUIRED',
    reason: 'Set FURYPIPE_LIVE_VALIDATION=1 and FURYPIPE_PROVIDER_LIVE_AUTHORIZED=YES to authorize one external request.',
  });
} else if (
  (provider !== 'openai' && provider !== 'anthropic' && provider !== 'google')
  || !model
  || !credential
  || process.env.FURYPIPE_PROVIDER_MAX_REQUESTS !== '1'
) {
  await writeEvidence('provider-live.json', {
    ...baseEvidence,
    status: 'BLOCKED_EXTERNAL_ENV',
    reason: 'A supported provider, exact model, provider credential and FURYPIPE_PROVIDER_MAX_REQUESTS=1 are required.',
  });
  process.exitCode = 2;
} else {
  const maxOutputTokens = Number(process.env.FURYPIPE_PROVIDER_MAX_OUTPUT_TOKENS ?? '256');
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 1_000_000) {
    await writeEvidence('provider-live.json', {
      ...baseEvidence,
      status: 'BLOCKED_EXTERNAL_ENV',
      reason: 'FURYPIPE_PROVIDER_MAX_OUTPUT_TOKENS must be an integer from 1 through 1000000.',
    });
    process.exitCode = 2;
  } else {
    const transport = provider === 'openai'
      ? createOpenAIProviderTransport({ getCredential: () => credential, maxOutputTokens, timeoutMs: 30_000 })
      : provider === 'anthropic'
        ? createAnthropicProviderTransport({ getCredential: () => credential, maxOutputTokens, timeoutMs: 30_000 })
        : createGoogleProviderTransport({ getCredential: () => credential, maxOutputTokens, timeoutMs: 30_000 });
    const request = {
      format: 'furypipe-provider-request-envelope/v1',
      providerId: provider,
      model,
      workloadId: 'furypipe-0.16.0-provider-live',
      protocol: provider,
      prompt: 'FuryPipe 0.16.0 live validation. Reply with a short bounded response.',
      promptDigest: 'live-validation',
      promptSourceDigest: 'live-validation',
      promptBytes: 72,
      requestDigest: 'live-validation',
    } as FuryProviderRequestEnvelope;
    const context = {
      requestDigest: request.requestDigest,
      providerId: provider,
      model,
      workloadId: request.workloadId,
      maxResponseBytes: MAX_PROVIDER_RESPONSE_BYTES,
    } satisfies ProviderTransportExecutionContext;
    try {
      const result = await transport.execute(request, context) as {
        networkStatus?: string;
        providerRequestStatus?: string;
        httpStatus?: number;
        usage?: unknown;
      };
      const accepted = result.providerRequestStatus === 'accepted';
      await writeEvidence('provider-live.json', {
        ...baseEvidence,
        status: accepted ? 'PARTIAL' : 'BLOCKED_EXTERNAL_ENV',
        requestExecuted: true,
        networkStatus: result.networkStatus ?? 'unknown',
        providerRequestStatus: result.providerRequestStatus ?? 'unknown',
        httpStatus: result.httpStatus,
        usageReported: result.usage !== undefined,
        limitation: 'A single transport-reported HTTP result is not provider certification, streaming proof, billing proof or production telemetry.',
      });
      if (!accepted) process.exitCode = 1;
    } catch {
      await writeEvidence('provider-live.json', {
        ...baseEvidence,
        status: 'BLOCKED_EXTERNAL_ENV',
        requestExecuted: true,
        reason: 'Provider transport failed; response body, request identifiers and credentials were not recorded.',
      });
      process.exitCode = 1;
    }
  }
}
