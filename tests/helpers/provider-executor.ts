import {
  DEFAULT_PROVIDER_REGISTRY,
  createProviderRuntimeState,
  type ProviderAvailability,
  type ProviderRuntimeState,
} from '../../src/core/index.js';
import type { FuryContextItem } from '../../src/context-optimizer.js';
import {
  prepareProviderAttemptContext,
  type FuryProviderAttemptContextRuntimeResult,
} from '../../src/provider-attempt-context-runtime.js';
import { createContextOptimizerProfileRegistry } from '../../src/context-optimizer-profile.js';
import {
  createModelAdapterRegistry,
  digestModelAdapter,
  type FuryModelAdapterDefinition,
  type FuryModelAdapterQualification,
} from '../../src/model-adapter-registry.js';
import { createProviderAttemptPlanner } from '../../src/provider-attempt-planner.js';
import {
  prepareProviderRequestEnvelope,
  type FuryProviderRequestEnvelope,
} from '../../src/provider-request-envelope.js';
import type { FuryProviderExecutionPolicy } from '../../src/provider-execution-gate.js';

export function makeContextResult(options: {
  readonly providerId?: string;
  readonly model?: string;
  readonly workloadId?: string;
  readonly task?: string;
  readonly adapterMarker?: string;
  readonly contextText?: string;
} = {}): FuryProviderAttemptContextRuntimeResult {
  const providerId = options.providerId ?? 'openai';
  const model = options.model ?? 'gpt-5.6-sol';
  const workloadId = options.workloadId ?? 'coding';
  let adapterQualifications: readonly FuryModelAdapterQualification[] = [];
  let adapters: readonly FuryModelAdapterDefinition[] = [];
  if (options.adapterMarker !== undefined) {
    const definition: FuryModelAdapterDefinition = {
      id: `${providerId}-test-adapter`,
      provider: providerId,
      model,
      workloadId,
      additions: { constraints: [options.adapterMarker] },
    };
    adapters = [definition];
    adapterQualifications = [{
      format: 'furypipe-model-adapter-qualification/v1',
      adapterId: definition.id,
      adapterDigest: digestModelAdapter(definition),
      benchmarkSuiteSha256: 'a'.repeat(64),
      provider: providerId,
      model,
      workloadId,
      comparability: 'VERIFIED',
      claimStatus: 'CLAIM_ELIGIBLE',
      repetitions: 5,
      baselineQualityMedian: 0.9,
      candidateQualityMedian: 0.95,
      exactnessCheckedRuns: 5,
      exactnessPassingRuns: 5,
      exactnessMismatches: 0,
      errors: 0,
    }];
  }
  const planner = createProviderAttemptPlanner({
    basePrompt: {
      level: 'ENGINEERING',
      sections: { task: options.task ?? 'Run the exact provider attempt.' },
    },
    modelAdapters: {
      registry: createModelAdapterRegistry(adapters),
      qualifications: adapterQualifications,
    },
    contextProfiles: { registry: createContextOptimizerProfileRegistry([]) },
  });
  return prepareProviderAttemptContext({
    attemptPlan: planner.plan({ providerId, model, workloadId }),
    items: options.contextText === undefined ? [] : [{
      id: `${providerId}-test-context`,
      kind: 'knowledge',
      representations: [{ level: 'full', content: options.contextText }],
      selected: true,
      cacheClass: 'dynamic',
      exactness: 'normal',
    } satisfies FuryContextItem],
  });
}

export function makeRequest(options: Parameters<typeof makeContextResult>[0] = {}): FuryProviderRequestEnvelope {
  return prepareProviderRequestEnvelope(makeContextResult(options));
}

export function makeRuntime(options: {
  readonly providerId?: string;
  readonly availability?: Exclude<ProviderAvailability, 'unknown'>;
  readonly expiresAt?: number;
} = {}): ProviderRuntimeState {
  const providerRuntime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
  providerRuntime.observeHealth({
    providerId: options.providerId ?? 'openai',
    availability: options.availability ?? 'available',
    observedAt: 0,
    expiresAt: options.expiresAt ?? 10_000,
    source: 'local-test-fixture',
    evidenceKind: 'operator-config',
  });
  return providerRuntime;
}

export function makePolicy(
  request: FuryProviderRequestEnvelope,
  overrides: Partial<FuryProviderExecutionPolicy> = {},
): FuryProviderExecutionPolicy {
  return {
    format: 'furypipe-provider-execution-policy/v1',
    policyId: 'host-test-policy',
    allowProviderRequest: true,
    providerId: request.providerId,
    model: request.model,
    workloadId: request.workloadId,
    expiresInMs: 1_000,
    ...overrides,
  };
}
