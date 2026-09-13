import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PROVIDER_REGISTRY,
  createProviderRuntimeState,
} from '../src/core/index.js';
import { createContextOptimizerProfileRegistry } from '../src/context-optimizer-profile.js';
import type { FuryContextItem } from '../src/context-optimizer.js';
import {
  createModelAdapterRegistry,
  digestModelAdapter,
  type FuryModelAdapterDefinition,
  type FuryModelAdapterQualification,
} from '../src/model-adapter-registry.js';
import type { FuryProviderExecutionPolicy } from '../src/provider-execution-gate.js';
import {
  createProviderRetryFallbackOrchestrator,
  FuryProviderRetryFallbackOrchestratorError,
  isGeneratedProviderRetryFallbackResult,
  type FuryProviderRetryFallbackContinuationPolicy,
} from '../src/provider-retry-fallback-orchestrator.js';
import {
  createProviderTransportRegistry,
  type ProviderTransport,
} from '../src/provider-transport.js';

const at = 1_000;
const workloadId = 'coding';
const openAiModel = 'gpt-5.6-sol';
const openAiFallbackModel = 'gpt-5.6-luna';
const anthropicModel = 'claude-opus-5';
const googleModel = 'gemini-3.8-flash';

const openAiAdapter: FuryModelAdapterDefinition = {
  id: 'retry-openai-v1',
  provider: 'openai',
  model: openAiModel,
  workloadId,
  additions: { constraints: ['OPENAI_ATTEMPT_ONLY'] },
};

const anthropicAdapter: FuryModelAdapterDefinition = {
  id: 'retry-anthropic-v1',
  provider: 'anthropic',
  model: anthropicModel,
  workloadId,
  additions: { constraints: ['ANTHROPIC_ATTEMPT_ONLY'] },
};

function qualification(adapter: FuryModelAdapterDefinition): FuryModelAdapterQualification {
  return {
    format: 'furypipe-model-adapter-qualification/v1',
    adapterId: adapter.id,
    adapterDigest: digestModelAdapter(adapter),
    benchmarkSuiteSha256: 'f'.repeat(64),
    provider: adapter.provider,
    model: adapter.model,
    workloadId: adapter.workloadId,
    comparability: 'VERIFIED',
    claimStatus: 'CLAIM_ELIGIBLE',
    repetitions: 5,
    baselineQualityMedian: 0.9,
    candidateQualityMedian: 0.95,
    exactnessCheckedRuns: 5,
    exactnessPassingRuns: 5,
    exactnessMismatches: 0,
    errors: 0,
  };
}

function runtime(providerIds: readonly string[] = ['openai', 'anthropic', 'google']) {
  const state = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
  for (const providerId of providerIds) {
    state.observeHealth({
      providerId,
      availability: 'available',
      observedAt: 0,
      expiresAt: 10_000,
      source: 'retry-fallback-test',
      evidenceKind: 'operator-config',
    });
  }
  return state;
}

function executionPolicy(
  providerId: string,
  model: string,
  policyId: string,
  allowProviderRequest = true,
): FuryProviderExecutionPolicy {
  return {
    format: 'furypipe-provider-execution-policy/v1',
    policyId,
    allowProviderRequest,
    providerId,
    model,
    workloadId,
    expiresInMs: 5_000,
  };
}

function continuation(
  overrides: Partial<FuryProviderRetryFallbackContinuationPolicy> = {},
): FuryProviderRetryFallbackContinuationPolicy {
  return {
    format: 'furypipe-provider-retry-fallback-continuation-policy/v1',
    retryOn: [],
    fallbackOn: [],
    retryHttpStatuses: [],
    fallbackHttpStatuses: [],
    allowCrossProviderFallback: false,
    ...overrides,
  };
}

function transport(
  providerId: 'openai' | 'anthropic' | 'google',
  protocol: 'openai' | 'anthropic' | 'google',
  execute: ProviderTransport['execute'],
): ProviderTransport {
  return { providerId, protocol, execute };
}

function accepted(providerId: string, model: string, status = 200) {
  return {
    providerId,
    model,
    networkStatus: 'executed' as const,
    providerRequestStatus: 'accepted' as const,
    httpStatus: status,
  };
}

function rejected(
  providerId: string,
  model: string,
  status: number,
  retryAfterMs?: number,
) {
  return {
    providerId,
    model,
    networkStatus: 'executed' as const,
    providerRequestStatus: 'rejected' as const,
    httpStatus: status,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

function makeOrchestrator(options: {
  readonly transports: readonly ProviderTransport[];
  readonly providerRuntime?: ReturnType<typeof runtime>;
} ) {
  return createProviderRetryFallbackOrchestrator({
    planner: {
      basePrompt: {
        level: 'ENGINEERING',
        sections: {
          task: 'BASE_TASK_ONLY',
          constraints: 'BASE_CONSTRAINT_ONLY',
        },
      },
      modelAdapters: {
        registry: createModelAdapterRegistry([openAiAdapter, anthropicAdapter]),
        qualifications: [qualification(openAiAdapter), qualification(anthropicAdapter)],
      },
      contextProfiles: {
        registry: createContextOptimizerProfileRegistry([]),
        qualifications: [],
      },
    },
    providerRuntime: options.providerRuntime ?? runtime(),
    transports: createProviderTransportRegistry(options.transports),
    now: () => at,
  });
}

function attempt(providerId: string, model: string, id: string) {
  return {
    providerId,
    model,
    policy: executionPolicy(providerId, model, id),
  };
}

const sharedItems = Object.freeze([
  Object.freeze({
    id: 'shared-context',
    kind: 'knowledge' as const,
    representations: Object.freeze([
      Object.freeze({ level: 'full' as const, content: 'SHARED_CONTEXT_ONCE' }),
    ]),
    selected: true,
  }),
]);

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

describe('provider retry/fallback orchestrator', () => {
  it('rebuilds a cross-provider fallback from BASE without provider-adapter crossover', async () => {
    const prompts: string[] = [];
    const openAiExecute = vi.fn<ProviderTransport['execute']>(async (request) => {
      prompts.push(request.prompt);
      return rejected('openai', request.model, 503);
    });
    const anthropicExecute = vi.fn<ProviderTransport['execute']>(async (request) => {
      prompts.push(request.prompt);
      return accepted('anthropic', request.model);
    });
    const orchestrator = makeOrchestrator({
      transports: [
        transport('openai', 'openai', openAiExecute),
        transport('anthropic', 'anthropic', anthropicExecute),
      ],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'openai-1'),
        attempt('anthropic', anthropicModel, 'anthropic-1'),
      ],
      continuationPolicy: continuation({
        fallbackHttpStatuses: [503],
        allowCrossProviderFallback: true,
      }),
      items: sharedItems,
    });

    expect(result.outcome).toBe('SUCCEEDED');
    expect(result.transportInvocations).toBe(2);
    expect(result.attempts.map((entry) => entry.decision)).toEqual([
      'CONTINUE_PROVIDER_REJECTED',
      'STOP_SUCCEEDED',
    ]);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('BASE_TASK_ONLY');
    expect(prompts[0]).toContain('OPENAI_ATTEMPT_ONLY');
    expect(prompts[0]).not.toContain('ANTHROPIC_ATTEMPT_ONLY');
    expect(count(prompts[0]!, 'SHARED_CONTEXT_ONCE')).toBe(1);
    expect(prompts[1]).toContain('BASE_TASK_ONLY');
    expect(prompts[1]).toContain('ANTHROPIC_ATTEMPT_ONLY');
    expect(prompts[1]).not.toContain('OPENAI_ATTEMPT_ONLY');
    expect(count(prompts[1]!, 'SHARED_CONTEXT_ONCE')).toBe(1);
  });

  it('does not move a 401 to another provider when only 503 is allowlisted', async () => {
    const primary = vi.fn<ProviderTransport['execute']>(async (request) => rejected('openai', request.model, 401));
    const fallback = vi.fn<ProviderTransport['execute']>(async (request) => accepted('anthropic', request.model));
    const orchestrator = makeOrchestrator({
      transports: [
        transport('openai', 'openai', primary),
        transport('anthropic', 'anthropic', fallback),
      ],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, '401-primary'),
        attempt('anthropic', anthropicModel, '401-fallback'),
      ],
      continuationPolicy: continuation({
        fallbackHttpStatuses: [503],
        allowCrossProviderFallback: true,
      }),
      items: [],
    });

    expect(result.outcome).toBe('STOPPED');
    expect(result.attempts[0]).toMatchObject({
      decision: 'STOP_POLICY',
      httpStatus: 401,
      providerRequest: { status: 'rejected', evidence: 'transport-reported' },
    });
    expect(primary).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('retries the same exact provider/model only when the HTTP status is explicitly allowlisted', async () => {
    let calls = 0;
    const execute = vi.fn<ProviderTransport['execute']>(async (request) => {
      calls += 1;
      return calls === 1
        ? rejected('openai', request.model, 503)
        : accepted('openai', request.model);
    });
    const orchestrator = makeOrchestrator({
      transports: [transport('openai', 'openai', execute)],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'retry-1'),
        attempt('openai', openAiModel, 'retry-2'),
      ],
      continuationPolicy: continuation({ retryHttpStatuses: [503] }),
      items: [],
    });

    expect(result.outcome).toBe('SUCCEEDED');
    expect(result.attempts.map((entry) => entry.decision)).toEqual([
      'CONTINUE_PROVIDER_REJECTED',
      'STOP_SUCCEEDED',
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After by refusing an immediate same-provider retry', async () => {
    const execute = vi.fn<ProviderTransport['execute']>(async (request) =>
      rejected('openai', request.model, 429, 7_500));
    const orchestrator = makeOrchestrator({
      transports: [transport('openai', 'openai', execute)],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'delay-1'),
        attempt('openai', openAiModel, 'delay-2'),
      ],
      continuationPolicy: continuation({ retryHttpStatuses: [429] }),
      items: [],
    });

    expect(result).toMatchObject({
      outcome: 'RETRY_DELAY_REQUIRED',
      retryAfterMs: 7_500,
      attemptsProcessed: 1,
      transportInvocations: 1,
    });
    expect(result.attempts[0]?.decision).toBe('STOP_RETRY_DELAY');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('also respects provider Retry-After before a same-provider model fallback', async () => {
    const execute = vi.fn<ProviderTransport['execute']>(async (request) =>
      rejected('openai', request.model, 429, 4_000));
    const orchestrator = makeOrchestrator({
      transports: [transport('openai', 'openai', execute)],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'model-delay-1'),
        attempt('openai', openAiFallbackModel, 'model-delay-2'),
      ],
      continuationPolicy: continuation({ fallbackHttpStatuses: [429] }),
      items: [],
    });

    expect(result.outcome).toBe('RETRY_DELAY_REQUIRED');
    expect(result.retryAfterMs).toBe(4_000);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('allows a different explicitly-authorized provider after 429 when cross-provider fallback is allowlisted', async () => {
    const primary = vi.fn<ProviderTransport['execute']>(async (request) =>
      rejected('openai', request.model, 429, 9_000));
    const fallback = vi.fn<ProviderTransport['execute']>(async (request) =>
      accepted('anthropic', request.model));
    const orchestrator = makeOrchestrator({
      transports: [
        transport('openai', 'openai', primary),
        transport('anthropic', 'anthropic', fallback),
      ],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'rate-primary'),
        attempt('anthropic', anthropicModel, 'rate-fallback'),
      ],
      continuationPolicy: continuation({
        fallbackHttpStatuses: [429],
        allowCrossProviderFallback: true,
      }),
      items: [],
    });

    expect(result.outcome).toBe('SUCCEEDED');
    expect(primary).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('never retries a transport error after invocation even if a caller tries to smuggle it into policy data', async () => {
    const first = vi.fn<ProviderTransport['execute']>(async () => {
      throw new Error('credential=RAW_SECRET_SENTINEL');
    });
    const second = vi.fn<ProviderTransport['execute']>(async (request) =>
      accepted('anthropic', request.model));
    const orchestrator = makeOrchestrator({
      transports: [
        transport('openai', 'openai', first),
        transport('anthropic', 'anthropic', second),
      ],
    });

    await expect(orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'ambiguous-1'),
        attempt('anthropic', anthropicModel, 'ambiguous-2'),
      ],
      continuationPolicy: {
        ...continuation({ allowCrossProviderFallback: true }),
        fallbackOn: ['transport-error'],
      } as never,
      items: [],
    })).rejects.toMatchObject({ code: 'invalid-continuation-policy' });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    const validResult = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'ambiguous-valid-1'),
        attempt('anthropic', anthropicModel, 'ambiguous-valid-2'),
      ],
      continuationPolicy: continuation({ allowCrossProviderFallback: true }),
      items: [],
    });
    expect(validResult.outcome).toBe('AMBIGUOUS_STOP');
    expect(validResult.attempts[0]).toMatchObject({
      decision: 'STOP_AMBIGUOUS',
      errorCode: 'transport-error',
      transportInvoked: true,
    });
    expect(second).not.toHaveBeenCalled();
    expect(JSON.stringify(validResult)).not.toContain('RAW_SECRET_SENTINEL');
  });

  it('treats response-too-large as ambiguous and never falls back', async () => {
    const primary = vi.fn<ProviderTransport['execute']>(async (request) => ({
      ...accepted('openai', request.model),
      responseBytes: new Uint8Array(1_048_577),
    }));
    const fallback = vi.fn<ProviderTransport['execute']>(async (request) =>
      accepted('anthropic', request.model));
    const orchestrator = makeOrchestrator({
      transports: [
        transport('openai', 'openai', primary),
        transport('anthropic', 'anthropic', fallback),
      ],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'large-1'),
        attempt('anthropic', anthropicModel, 'large-2'),
      ],
      continuationPolicy: continuation({
        fallbackHttpStatuses: [503],
        allowCrossProviderFallback: true,
      }),
      items: [],
    });

    expect(result.outcome).toBe('AMBIGUOUS_STOP');
    expect(result.attempts[0]).toMatchObject({
      errorCode: 'response-too-large',
      transportInvoked: true,
      decision: 'STOP_AMBIGUOUS',
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('treats unknown provider status after an executed transport as ambiguous', async () => {
    const first = vi.fn<ProviderTransport['execute']>(async (request) => ({
      providerId: 'openai',
      model: request.model,
      networkStatus: 'executed' as const,
    }));
    const second = vi.fn<ProviderTransport['execute']>(async (request) =>
      accepted('anthropic', request.model));
    const orchestrator = makeOrchestrator({
      transports: [
        transport('openai', 'openai', first),
        transport('anthropic', 'anthropic', second),
      ],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'unknown-1'),
        attempt('anthropic', anthropicModel, 'unknown-2'),
      ],
      continuationPolicy: continuation({
        allowCrossProviderFallback: true,
        fallbackOn: ['network-not-executed'],
      }),
      items: [],
    });

    expect(result.outcome).toBe('AMBIGUOUS_STOP');
    expect(result.attempts[0]?.decision).toBe('STOP_AMBIGUOUS');
    expect(second).not.toHaveBeenCalled();
  });

  it('fails closed on contradictory transport evidence', async () => {
    const second = vi.fn<ProviderTransport['execute']>(async (request) =>
      accepted('anthropic', request.model));
    const orchestrator = makeOrchestrator({
      transports: [
        transport('openai', 'openai', async (request) => ({
          providerId: 'openai',
          model: request.model,
          networkStatus: 'not-executed',
          providerRequestStatus: 'accepted',
          httpStatus: 200,
        })),
        transport('anthropic', 'anthropic', second),
      ],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'contradictory-1'),
        attempt('anthropic', anthropicModel, 'contradictory-2'),
      ],
      continuationPolicy: continuation({
        allowCrossProviderFallback: true,
        fallbackOn: ['network-not-executed'],
      }),
      items: [],
    });

    expect(result.outcome).toBe('AMBIGUOUS_STOP');
    expect(result.attempts[0]?.decision).toBe('STOP_AMBIGUOUS');
    expect(second).not.toHaveBeenCalled();
  });

  it('can continue from explicit network-not-executed evidence only when allowlisted', async () => {
    const first = vi.fn<ProviderTransport['execute']>(async (request) => ({
      providerId: 'openai',
      model: request.model,
      networkStatus: 'not-executed' as const,
      providerRequestStatus: 'unknown' as const,
    }));
    const second = vi.fn<ProviderTransport['execute']>(async (request) =>
      accepted('anthropic', request.model));
    const orchestrator = makeOrchestrator({
      transports: [
        transport('openai', 'openai', first),
        transport('anthropic', 'anthropic', second),
      ],
    });

    const stopped = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'no-net-stop-1'),
        attempt('anthropic', anthropicModel, 'no-net-stop-2'),
      ],
      continuationPolicy: continuation({ allowCrossProviderFallback: true }),
      items: [],
    });
    expect(stopped.outcome).toBe('STOPPED');
    expect(second).not.toHaveBeenCalled();

    const continued = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'no-net-go-1'),
        attempt('anthropic', anthropicModel, 'no-net-go-2'),
      ],
      continuationPolicy: continuation({
        fallbackOn: ['network-not-executed'],
        allowCrossProviderFallback: true,
      }),
      items: [],
    });
    expect(continued.outcome).toBe('SUCCEEDED');
    expect(second).toHaveBeenCalledOnce();
  });

  it('continues past a missing exact transport only when that safe pre-execution reason is allowlisted', async () => {
    const openAiExecute = vi.fn<ProviderTransport['execute']>(async (request) =>
      accepted('openai', request.model));
    const orchestrator = makeOrchestrator({
      transports: [transport('openai', 'openai', openAiExecute)],
    });

    const stopped = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('google', googleModel, 'missing-stop-1'),
        attempt('openai', openAiModel, 'missing-stop-2'),
      ],
      continuationPolicy: continuation({ allowCrossProviderFallback: true }),
      items: [],
    });
    expect(stopped.outcome).toBe('STOPPED');
    expect(stopped.attempts[0]).toMatchObject({
      errorCode: 'transport-not-registered',
      transportInvoked: false,
      decision: 'STOP_POLICY',
    });
    expect(openAiExecute).not.toHaveBeenCalled();

    const continued = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('google', googleModel, 'missing-go-1'),
        attempt('openai', openAiModel, 'missing-go-2'),
      ],
      continuationPolicy: continuation({
        fallbackOn: ['transport-not-registered'],
        allowCrossProviderFallback: true,
      }),
      items: [],
    });
    expect(continued.outcome).toBe('SUCCEEDED');
    expect(continued.transportInvocations).toBe(1);
    expect(openAiExecute).toHaveBeenCalledOnce();
  });

  it('does not bypass an explicit execution-policy denial', async () => {
    const first = vi.fn<ProviderTransport['execute']>(async (request) =>
      accepted('openai', request.model));
    const second = vi.fn<ProviderTransport['execute']>(async (request) =>
      accepted('anthropic', request.model));
    const orchestrator = makeOrchestrator({
      transports: [
        transport('openai', 'openai', first),
        transport('anthropic', 'anthropic', second),
      ],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [
        {
          providerId: 'openai',
          model: openAiModel,
          policy: executionPolicy('openai', openAiModel, 'deny-1', false),
        },
        attempt('anthropic', anthropicModel, 'deny-2'),
      ],
      continuationPolicy: continuation({
        fallbackHttpStatuses: [503],
        allowCrossProviderFallback: true,
      }),
      items: [],
    });

    expect(result.outcome).toBe('BLOCKED');
    expect(result.attempts[0]).toMatchObject({
      stage: 'authorize',
      decision: 'STOP_BLOCKED',
      errorCode: 'execution-not-authorized',
      transportInvoked: false,
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it('blocks cross-provider fallback unless explicitly enabled even when status is allowlisted', async () => {
    const first = vi.fn<ProviderTransport['execute']>(async (request) =>
      rejected('openai', request.model, 503));
    const second = vi.fn<ProviderTransport['execute']>(async (request) =>
      accepted('anthropic', request.model));
    const orchestrator = makeOrchestrator({
      transports: [
        transport('openai', 'openai', first),
        transport('anthropic', 'anthropic', second),
      ],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'cross-1'),
        attempt('anthropic', anthropicModel, 'cross-2'),
      ],
      continuationPolicy: continuation({ fallbackHttpStatuses: [503] }),
      items: [],
    });

    expect(result.outcome).toBe('STOPPED');
    expect(second).not.toHaveBeenCalled();
  });

  it('snapshots context so transport-side mutation cannot contaminate fallback', async () => {
    const mutableItem: FuryContextItem = {
      id: 'mutable',
      kind: 'knowledge',
      selected: true,
      representations: [{ level: 'summary', content: 'ORIGINAL_CONTEXT' }],
    };
    const prompts: string[] = [];
    const first = vi.fn<ProviderTransport['execute']>(async (request) => {
      prompts.push(request.prompt);
      (mutableItem.representations as Array<{ level: 'summary'; content: string }>)[0]!.content = 'MUTATED_CONTEXT';
      return rejected('openai', request.model, 503);
    });
    const second = vi.fn<ProviderTransport['execute']>(async (request) => {
      prompts.push(request.prompt);
      return accepted('anthropic', request.model);
    });
    const orchestrator = makeOrchestrator({
      transports: [
        transport('openai', 'openai', first),
        transport('anthropic', 'anthropic', second),
      ],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'snapshot-1'),
        attempt('anthropic', anthropicModel, 'snapshot-2'),
      ],
      continuationPolicy: continuation({
        fallbackHttpStatuses: [503],
        allowCrossProviderFallback: true,
      }),
      items: [mutableItem],
    });

    expect(result.outcome).toBe('SUCCEEDED');
    expect(prompts[0]).toContain('ORIGINAL_CONTEXT');
    expect(prompts[1]).toContain('ORIGINAL_CONTEXT');
    expect(prompts[1]).not.toContain('MUTATED_CONTEXT');
  });

  it('does not serialize BASE/context plaintext or execution policy identifiers in orchestration metadata', async () => {
    const execute = vi.fn<ProviderTransport['execute']>(async (request) =>
      accepted('openai', request.model));
    const orchestrator = makeOrchestrator({
      transports: [transport('openai', 'openai', execute)],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [
        attempt('openai', openAiModel, 'PRIVATE_POLICY_SENTINEL'),
      ],
      continuationPolicy: continuation(),
      items: [{
        id: 'private-context',
        kind: 'knowledge',
        selected: true,
        representations: [{ level: 'summary', content: 'PRIVATE_CONTEXT_SENTINEL' }],
      }],
    });
    const metadata = JSON.stringify(result.attempts);

    expect(metadata).not.toContain('BASE_TASK_ONLY');
    expect(metadata).not.toContain('OPENAI_ATTEMPT_ONLY');
    expect(metadata).not.toContain('PRIVATE_CONTEXT_SENTINEL');
    expect(metadata).not.toContain('PRIVATE_POLICY_SENTINEL');
    expect(metadata).not.toContain('"prompt":');
    expect(metadata).toContain('promptDigest');
  });

  it('rejects duplicate policy identities before any transport activity', async () => {
    const execute = vi.fn<ProviderTransport['execute']>(async (request) =>
      accepted('openai', request.model));
    const orchestrator = makeOrchestrator({
      transports: [transport('openai', 'openai', execute)],
    });
    const samePolicy = executionPolicy('openai', openAiModel, 'duplicate-policy');

    await expect(orchestrator.run({
      workloadId,
      attempts: [
        { providerId: 'openai', model: openAiModel, policy: samePolicy },
        { providerId: 'openai', model: openAiModel, policy: samePolicy },
      ],
      continuationPolicy: continuation({ retryHttpStatuses: [503] }),
      items: [],
    })).rejects.toMatchObject({ code: 'invalid-attempt-sequence' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('cancels before planning/authorization/transport and keeps provenance process-local', async () => {
    const execute = vi.fn<ProviderTransport['execute']>(async (request) =>
      accepted('openai', request.model));
    const orchestrator = makeOrchestrator({
      transports: [transport('openai', 'openai', execute)],
    });
    const controller = new AbortController();
    controller.abort();

    const result = await orchestrator.run({
      workloadId,
      attempts: [attempt('openai', openAiModel, 'cancelled')],
      continuationPolicy: continuation(),
      items: [],
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      outcome: 'CANCELLED',
      attemptsProcessed: 0,
      transportInvocations: 0,
    });
    expect(isGeneratedProviderRetryFallbackResult(result)).toBe(true);
    expect(isGeneratedProviderRetryFallbackResult(structuredClone(result))).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('preserves explicit successful execution while keeping attempt metadata body-free', async () => {
    const responseBytes = new TextEncoder().encode('application payload');
    const execute = vi.fn<ProviderTransport['execute']>(async (request) => ({
      ...accepted('openai', request.model),
      responseBytes,
    }));
    const orchestrator = makeOrchestrator({
      transports: [transport('openai', 'openai', execute)],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [attempt('openai', openAiModel, 'success')],
      continuationPolicy: continuation(),
      items: [],
    });

    expect(result.outcome).toBe('SUCCEEDED');
    expect(result.execution?.responseBytes).toEqual(responseBytes);
    expect(JSON.stringify(result.attempts)).not.toContain('application payload');
  });

  it('classifies a post-transport cancellation without provider outcome as ambiguous, not no-network cancellation', async () => {
    const controller = new AbortController();
    const execute = vi.fn<ProviderTransport['execute']>(async () => {
      controller.abort();
      throw new Error('cancelled downstream');
    });
    const orchestrator = makeOrchestrator({
      transports: [transport('openai', 'openai', execute)],
    });

    const result = await orchestrator.run({
      workloadId,
      attempts: [attempt('openai', openAiModel, 'cancel-in-flight')],
      continuationPolicy: continuation(),
      items: [],
      signal: controller.signal,
    });

    expect(result.outcome).toBe('AMBIGUOUS_STOP');
    expect(result.attempts[0]).toMatchObject({
      transportInvoked: true,
      decision: 'STOP_AMBIGUOUS',
      errorCode: 'transport-error',
    });
  });

  it('validates continuation policy before any provider request', async () => {
    const execute = vi.fn<ProviderTransport['execute']>(async (request) =>
      accepted('openai', request.model));
    const orchestrator = makeOrchestrator({
      transports: [transport('openai', 'openai', execute)],
    });

    await expect(orchestrator.run({
      workloadId,
      attempts: [attempt('openai', openAiModel, 'invalid-policy')],
      continuationPolicy: {
        ...continuation(),
        retryHttpStatuses: [200],
      },
      items: [],
    })).rejects.toBeInstanceOf(FuryProviderRetryFallbackOrchestratorError);
    expect(execute).not.toHaveBeenCalled();
  });
});
