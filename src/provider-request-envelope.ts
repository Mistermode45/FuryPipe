import { createHash } from 'node:crypto';
import {
  DEFAULT_PROVIDER_REGISTRY,
  type ProviderFabricProtocol,
  type ProviderRegistry,
} from './core/provider-fabric.js';
import {
  isGeneratedProviderAttemptContextResult,
  type FuryProviderAttemptContextRuntimeResult,
} from './provider-attempt-context-runtime.js';
import {
  FURY_PROMPT_SECTION_ORDER,
  compileFuryPrompt,
  type FuryPromptCompileInput,
  type FuryPromptSectionValue,
  type FuryPromptSections,
} from './fury-prompt.js';
import {
  assertKnownKeys,
  canonicalProviderId,
  exactIdentifier,
  fail,
  ownDataRecord,
} from './provider-execution-internal.js';

export interface FuryProviderRequestEnvelope {
  readonly format: 'furypipe-provider-request-envelope/v1';
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly protocol: ProviderFabricProtocol;
  /** Exact, final text compiled from the Context Runtime result's prompt. */
  readonly prompt: string;
  readonly promptDigest: string;
  readonly promptSourceDigest: string;
  readonly promptBytes: number;
  readonly requestDigest: string;
}

const GENERATED_PROVIDER_REQUEST_ENVELOPES = new WeakSet<object>();
const CONTEXT_RESULT_KEYS = [
  'format', 'providerId', 'model', 'workloadId', 'prompt', 'contextPlan', 'contextProfileState',
  'profileDisposition', 'profileApplied', 'profileId', 'profileDigest', 'profileBlockers',
  'profileQualificationEvidence', 'currentContextResultVerified', 'contextInjected',
  'injectedContextBytes', 'tokenEstimateStatus', 'secretPolicy', 'optimizerExecuted',
  'networkCallExecuted', 'providerRequestExecuted', 'executionAuthorized',
] as const;
const PROMPT_KEYS = ['sections', 'level', 'securityCritical', 'exactGuardMode'] as const;

export function isGeneratedProviderRequestEnvelope(value: unknown): value is FuryProviderRequestEnvelope {
  return value !== null
    && typeof value === 'object'
    && GENERATED_PROVIDER_REQUEST_ENVELOPES.has(value);
}

function snapshotPrompt(input: FuryPromptCompileInput): FuryPromptCompileInput {
  const prompt = ownDataRecord(input);
  assertKnownKeys(prompt, PROMPT_KEYS);
  const sourceSections = ownDataRecord(prompt.sections);
  assertKnownKeys(sourceSections, FURY_PROMPT_SECTION_ORDER);
  const sections: Record<string, FuryPromptSectionValue> = Object.create(null) as Record<string, FuryPromptSectionValue>;

  for (const section of FURY_PROMPT_SECTION_ORDER) {
    const raw = sourceSections[section];
    if (raw === undefined) continue;
    if (typeof raw === 'string') {
      sections[section] = raw;
      continue;
    }
    if (!Array.isArray(raw) || raw.length > 256) throw new TypeError('FuryPrompt section is invalid');
    const values: string[] = [];
    for (let index = 0; index < raw.length; index += 1) {
      if (!Object.hasOwn(raw, index)) throw new TypeError('FuryPrompt section contains a sparse value');
      const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
      if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') {
        throw new TypeError('FuryPrompt section values must be own strings');
      }
      values.push(descriptor.value);
    }
    sections[section] = Object.freeze(values);
  }

  return Object.freeze({
    sections: Object.freeze(sections) as FuryPromptSections,
    ...(prompt.level === undefined ? {} : { level: prompt.level as FuryPromptCompileInput['level'] }),
    ...(prompt.securityCritical === undefined ? {} : { securityCritical: prompt.securityCritical as boolean }),
    ...(prompt.exactGuardMode === undefined ? {} : { exactGuardMode: prompt.exactGuardMode as FuryPromptCompileInput['exactGuardMode'] }),
  });
}

/** Prepare an exact, immutable request snapshot; this function never invokes a transport. */
export function prepareProviderRequestEnvelope(
  contextResult: FuryProviderAttemptContextRuntimeResult,
  registry: ProviderRegistry = DEFAULT_PROVIDER_REGISTRY,
): FuryProviderRequestEnvelope {
  if (!isGeneratedProviderAttemptContextResult(contextResult)) fail('invalid-prepared-attempt');

  let result: Readonly<Record<string, unknown>>;
  try {
    result = ownDataRecord(contextResult);
    assertKnownKeys(result, CONTEXT_RESULT_KEYS);
  } catch {
    return fail('invalid-prepared-attempt');
  }

  if (
    result.format !== 'furypipe-provider-attempt-context-runtime/v1'
    || result.optimizerExecuted !== true
    || result.networkCallExecuted !== false
    || result.providerRequestExecuted !== false
    || result.executionAuthorized !== false
    || result.currentContextResultVerified !== false
    || !canonicalProviderId(result.providerId)
    || !exactIdentifier(result.model)
    || !exactIdentifier(result.workloadId)
  ) {
    return fail('invalid-prepared-attempt');
  }

  let provider;
  try {
    provider = registry.get(result.providerId);
  } catch {
    return fail('provider-not-registered');
  }
  if (!provider || provider.id !== result.providerId) fail('provider-not-registered');
  if (provider.status !== 'registered') fail('provider-not-registered');
  if (provider.protocol !== 'anthropic' && provider.protocol !== 'openai' && provider.protocol !== 'google') {
    fail('provider-not-registered');
  }

  let compiled;
  try {
    const prompt = snapshotPrompt(result.prompt as FuryPromptCompileInput);
    compiled = compileFuryPrompt(prompt);
  } catch {
    return fail('invalid-prepared-attempt');
  }

  const requestDigest = createHash('sha256')
    .update('furypipe-provider-request/v1\0', 'utf8')
    .update(JSON.stringify({
      providerId: result.providerId,
      model: result.model,
      workloadId: result.workloadId,
      protocol: provider.protocol,
      prompt: compiled.prompt,
    }), 'utf8')
    .digest('hex');

  const envelope: FuryProviderRequestEnvelope = Object.freeze({
    format: 'furypipe-provider-request-envelope/v1',
    providerId: result.providerId,
    model: result.model,
    workloadId: result.workloadId,
    protocol: provider.protocol,
    prompt: compiled.prompt,
    promptDigest: compiled.promptDigest,
    promptSourceDigest: compiled.source.contentDigest,
    promptBytes: compiled.promptBytes,
    requestDigest,
  });
  GENERATED_PROVIDER_REQUEST_ENVELOPES.add(envelope);
  return envelope;
}
