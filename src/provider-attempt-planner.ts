import {
  createProviderAttemptAdapterPlanner,
  type FuryProviderAttemptAdapterPlan,
  type FuryProviderAttemptAdapterPlanner,
  type FuryProviderAttemptBasePrompt,
  type FuryProviderAttemptIdentity,
  type FuryProviderAttemptPrompt,
} from './provider-attempt-adapter.js';
import type {
  FuryModelAdapterQualification,
  FuryModelAdapterRegistry,
} from './model-adapter-registry.js';
import {
  createContextOptimizerProfileRegistry,
  type FuryContextOptimizerProfilePlan,
  type FuryContextOptimizerProfileQualification,
  type FuryContextOptimizerProfileRegistry,
} from './context-optimizer-profile.js';

export interface FuryProviderAttemptPlannerInput {
  readonly basePrompt: FuryProviderAttemptBasePrompt;
  readonly modelAdapters: {
    readonly registry: FuryModelAdapterRegistry;
    readonly qualifications?: readonly FuryModelAdapterQualification[];
  };
  readonly contextProfiles: {
    readonly registry: FuryContextOptimizerProfileRegistry;
    readonly qualifications?: readonly FuryContextOptimizerProfileQualification[];
  };
}

export interface FuryProviderAttemptPlan {
  readonly format: 'furypipe-provider-attempt-plan/v1';
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly prompt: FuryProviderAttemptPrompt;
  readonly adapter: FuryProviderAttemptAdapterPlan;
  readonly contextProfile: FuryContextOptimizerProfilePlan;
  readonly contextProfileState: 'IDENTITY' | 'QUALIFIED' | 'BLOCKED';
  readonly networkCallExecuted: false;
  readonly providerRequestExecuted: false;
  readonly optimizerExecuted: false;
  readonly executionAuthorized: false;
}

export interface FuryProviderAttemptPlanner {
  plan(attempt: FuryProviderAttemptIdentity): FuryProviderAttemptPlan;
}

const MAX_CONTEXT_PROFILES = 256;
const MAX_CONTEXT_QUALIFICATIONS = 1024;
const GENERATED_PROVIDER_ATTEMPT_PLANS = new WeakSet<object>();

/** True only for immutable plans emitted by this planner in the current process. */
export function isGeneratedProviderAttemptPlan(value: unknown): value is FuryProviderAttemptPlan {
  return value !== null && typeof value === 'object' && GENERATED_PROVIDER_ATTEMPT_PLANS.has(value);
}

function snapshotContextRegistry(
  registry: FuryContextOptimizerProfileRegistry,
): FuryContextOptimizerProfileRegistry {
  if (!registry || typeof registry !== 'object' || typeof registry.inspect !== 'function') {
    throw new TypeError('provider attempt planner requires a context optimizer profile registry');
  }
  const profiles = registry.inspect();
  if (!Array.isArray(profiles) || profiles.length > MAX_CONTEXT_PROFILES) {
    throw new Error(`provider attempt context profile registry must contain at most ${MAX_CONTEXT_PROFILES} profiles`);
  }

  return createContextOptimizerProfileRegistry(
    profiles.map((profile) => Object.freeze({
      id: profile.id,
      priority: profile.priority,
      options: profile.options,
    })),
  );
}

function snapshotContextQualifications(
  qualifications: readonly FuryContextOptimizerProfileQualification[] | undefined,
): readonly FuryContextOptimizerProfileQualification[] {
  const source = qualifications ?? [];
  if (!Array.isArray(source) || source.length > MAX_CONTEXT_QUALIFICATIONS) {
    throw new Error(
      `provider attempt context profile qualifications must be an array of at most ${MAX_CONTEXT_QUALIFICATIONS} entries`,
    );
  }

  // Preserve each qualification object by identity. Context profile
  // qualifications carry in-process provenance and are already immutable.
  return Object.freeze([...source]);
}

function contextProfileState(
  plan: FuryContextOptimizerProfilePlan,
): FuryProviderAttemptPlan['contextProfileState'] {
  if (plan.profileId !== undefined) return 'QUALIFIED';
  if (plan.blocked.some((entry) => entry.reason !== 'missing-qualification')) return 'BLOCKED';
  return 'IDENTITY';
}

export function createProviderAttemptPlanner(
  input: FuryProviderAttemptPlannerInput,
): FuryProviderAttemptPlanner {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('provider attempt planner input is required');
  }
  if (!input.modelAdapters || typeof input.modelAdapters !== 'object' || Array.isArray(input.modelAdapters)) {
    throw new TypeError('provider attempt planner requires model adapter configuration');
  }
  if (!input.contextProfiles || typeof input.contextProfiles !== 'object' || Array.isArray(input.contextProfiles)) {
    throw new TypeError('provider attempt planner requires context profile configuration');
  }

  const adapterPlanner: FuryProviderAttemptAdapterPlanner = createProviderAttemptAdapterPlanner({
    basePrompt: input.basePrompt,
    registry: input.modelAdapters.registry,
    qualifications: input.modelAdapters.qualifications,
  });
  const contextRegistry = snapshotContextRegistry(input.contextProfiles.registry);
  const contextQualifications = snapshotContextQualifications(input.contextProfiles.qualifications);

  return Object.freeze({
    plan(attempt: FuryProviderAttemptIdentity): FuryProviderAttemptPlan {
      const adapter = adapterPlanner.plan(attempt);
      const contextProfile = contextRegistry.resolve({
        provider: adapter.providerId,
        model: adapter.model,
        workloadId: adapter.workloadId,
        qualifications: contextQualifications,
      });

      if (
        contextProfile.provider !== adapter.providerId
        || contextProfile.model !== adapter.model
        || contextProfile.workloadId !== adapter.workloadId
      ) {
        throw new Error('provider attempt planner detected inconsistent subsystem scope');
      }

      const plan: FuryProviderAttemptPlan = Object.freeze({
        format: 'furypipe-provider-attempt-plan/v1',
        providerId: adapter.providerId,
        model: adapter.model,
        workloadId: adapter.workloadId,
        prompt: adapter.prompt,
        adapter,
        contextProfile,
        contextProfileState: contextProfileState(contextProfile),
        networkCallExecuted: false,
        providerRequestExecuted: false,
        optimizerExecuted: false,
        executionAuthorized: false,
      });
      GENERATED_PROVIDER_ATTEMPT_PLANS.add(plan);
      return plan;
    },
  });
}
