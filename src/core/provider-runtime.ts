import {
  COST_UNKNOWN,
  createProviderRegistry,
  resolveProviderFabric,
  type ModelCapabilityStatus,
  type ProviderAvailability,
  type ProviderEvidenceKind,
  type ProviderRegistry,
} from './provider-fabric.js';

export type ProviderHealthEvidenceKind = Extract<ProviderEvidenceKind, 'live-probe' | 'operator-config' | 'transport-result'>;

export interface ProviderHealthObservation {
  readonly providerId: string;
  readonly availability: Exclude<ProviderAvailability, 'unknown'>;
  readonly observedAt: number;
  readonly expiresAt: number;
  readonly latencyMs?: number;
  /** Bounded provenance label only; never place credentials or response bodies here. */
  readonly source: string;
  readonly evidenceKind: ProviderHealthEvidenceKind;
}

export interface ProviderModelPrice {
  readonly providerId: string;
  /** Exact provider model identifier. FuryPipe does not rewrite this value. */
  readonly model: string;
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
  readonly cacheWriteUsdPerMillionTokens?: number;
  readonly cacheReadUsdPerMillionTokens?: number;
  readonly observedAt: number;
  /** Bounded provenance label, for example an operator-approved pricing catalog version. */
  readonly source: string;
}

export interface ProviderCostUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheWriteTokens?: number;
  readonly cacheReadTokens?: number;
}

export type ProviderCostEstimate =
  | {
      readonly status: 'known';
      readonly providerId: string;
      readonly model: string;
      readonly totalUsd: number;
      readonly source: string;
      readonly observedAt: number;
    }
  | {
      readonly status: typeof COST_UNKNOWN;
      readonly providerId: string;
      readonly model: string;
      readonly reason: string;
    };

export interface ProviderRuntimeHealth {
  readonly providerId: string;
  readonly availability: ProviderAvailability;
  readonly fresh: boolean;
  readonly observedAt?: number;
  readonly expiresAt?: number;
  readonly latencyMs?: number;
  readonly source?: string;
  readonly evidenceKind?: ProviderHealthEvidenceKind;
}

export interface ProviderFallbackCandidate {
  readonly providerId: string;
  readonly model: string;
}

export type ProviderFallbackRejectionReason =
  | 'unknown_provider'
  | 'health_not_fresh'
  | 'provider_unavailable'
  | 'model_not_supported'
  | 'model_family_mismatch';

export interface ProviderFallbackAssessment {
  readonly providerId: string;
  readonly model: string;
  readonly availability: ProviderAvailability;
  readonly modelStatus: ModelCapabilityStatus | 'not_evaluated';
  readonly eligible: boolean;
  readonly reason: 'eligible' | ProviderFallbackRejectionReason;
}

export interface ProviderFallbackDecision {
  readonly format: 'furypipe-provider-fallback/v1';
  readonly selected?: {
    readonly providerId: string;
    readonly model: string;
  };
  readonly assessments: readonly ProviderFallbackAssessment[];
  readonly networkCallExecuted: false;
}

export interface ProviderRuntimeInspection {
  readonly health: readonly ProviderRuntimeHealth[];
  readonly pricedModels: readonly {
    readonly providerId: string;
    readonly model: string;
    readonly observedAt: number;
    readonly source: string;
  }[];
}

export interface ProviderRuntimeState {
  observeHealth(observation: ProviderHealthObservation): void;
  registerPrice(price: ProviderModelPrice): void;
  health(providerId: string, now?: number): ProviderRuntimeHealth;
  estimateCost(providerId: string, model: string, usage: ProviderCostUsage): ProviderCostEstimate;
  /**
   * Select the first explicitly ordered candidate that has fresh available
   * health evidence and a locally supported matching model capability.
   * This plans a fallback only; it never performs a provider request.
   */
  selectFallback(candidates: readonly ProviderFallbackCandidate[], now?: number): ProviderFallbackDecision;
  registry(now?: number): ProviderRegistry;
  inspect(now?: number): ProviderRuntimeInspection;
}

function safeMetadataSource(value: string): string {
  if (value.length < 1 || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('provider runtime evidence source must be 1-200 printable characters');
  }
  return value;
}

function finiteTimestamp(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite timestamp`);
  return value;
}

function nonNegativeRate(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite rate`);
  return value;
}

function tokenCount(value: number | undefined, name: string): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
  return value;
}

function exactModel(value: string): string {
  if (value.length < 1 || value.length > 256 || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('provider model must be an exact 1-256 character identifier without surrounding whitespace or controls');
  }
  return value;
}

function costKey(providerId: string, model: string): string {
  return `${providerId}\u0000${model}`;
}

export function createProviderRuntimeState(baseRegistry: ProviderRegistry): ProviderRuntimeState {
  const healthByProvider = new Map<string, ProviderHealthObservation>();
  const prices = new Map<string, ProviderModelPrice>();

  function resolveProvider(providerId: string): string {
    const provider = baseRegistry.get(providerId);
    if (!provider) throw new Error(`provider runtime references an unregistered provider: ${providerId}`);
    return provider.id;
  }

  function getHealth(providerId: string, now = Date.now()): ProviderRuntimeHealth {
    const id = resolveProvider(providerId);
    finiteTimestamp(now, 'provider runtime now');
    const observation = healthByProvider.get(id);
    if (!observation) return { providerId: id, availability: 'unknown', fresh: false };
    if (now > observation.expiresAt) {
      return {
        providerId: id,
        availability: 'unknown',
        fresh: false,
        observedAt: observation.observedAt,
        expiresAt: observation.expiresAt,
      };
    }
    return {
      providerId: id,
      availability: observation.availability,
      fresh: true,
      observedAt: observation.observedAt,
      expiresAt: observation.expiresAt,
      ...(observation.latencyMs === undefined ? {} : { latencyMs: observation.latencyMs }),
      source: observation.source,
      evidenceKind: observation.evidenceKind,
    };
  }

  return {
    observeHealth(observation) {
      const id = resolveProvider(observation.providerId);
      const observedAt = finiteTimestamp(observation.observedAt, 'provider health observedAt');
      const expiresAt = finiteTimestamp(observation.expiresAt, 'provider health expiresAt');
      if (expiresAt <= observedAt) throw new RangeError('provider health expiresAt must be later than observedAt');
      if (observation.latencyMs !== undefined && (!Number.isFinite(observation.latencyMs) || observation.latencyMs < 0)) {
        throw new RangeError('provider health latencyMs must be non-negative and finite');
      }
      healthByProvider.set(id, {
        ...observation,
        providerId: id,
        observedAt,
        expiresAt,
        source: safeMetadataSource(observation.source),
      });
    },

    registerPrice(price) {
      const id = resolveProvider(price.providerId);
      const model = exactModel(price.model);
      const normalized: ProviderModelPrice = {
        ...price,
        providerId: id,
        model,
        inputUsdPerMillionTokens: nonNegativeRate(price.inputUsdPerMillionTokens, 'input price')!,
        outputUsdPerMillionTokens: nonNegativeRate(price.outputUsdPerMillionTokens, 'output price')!,
        ...(price.cacheWriteUsdPerMillionTokens === undefined ? {} : {
          cacheWriteUsdPerMillionTokens: nonNegativeRate(price.cacheWriteUsdPerMillionTokens, 'cache write price'),
        }),
        ...(price.cacheReadUsdPerMillionTokens === undefined ? {} : {
          cacheReadUsdPerMillionTokens: nonNegativeRate(price.cacheReadUsdPerMillionTokens, 'cache read price'),
        }),
        observedAt: finiteTimestamp(price.observedAt, 'provider price observedAt'),
        source: safeMetadataSource(price.source),
      };
      prices.set(costKey(id, model), normalized);
    },

    health: getHealth,

    estimateCost(providerId, model, usage) {
      const id = resolveProvider(providerId);
      const exact = exactModel(model);
      const price = prices.get(costKey(id, exact));
      if (!price) {
        return { status: COST_UNKNOWN, providerId: id, model: exact, reason: 'no explicit price is registered for this exact provider/model' };
      }
      const inputTokens = tokenCount(usage.inputTokens, 'inputTokens');
      const outputTokens = tokenCount(usage.outputTokens, 'outputTokens');
      const cacheWriteTokens = tokenCount(usage.cacheWriteTokens, 'cacheWriteTokens');
      const cacheReadTokens = tokenCount(usage.cacheReadTokens, 'cacheReadTokens');
      if (cacheWriteTokens > 0 && price.cacheWriteUsdPerMillionTokens === undefined) {
        return { status: COST_UNKNOWN, providerId: id, model: exact, reason: 'cache write tokens were reported but no cache write price is registered' };
      }
      if (cacheReadTokens > 0 && price.cacheReadUsdPerMillionTokens === undefined) {
        return { status: COST_UNKNOWN, providerId: id, model: exact, reason: 'cache read tokens were reported but no cache read price is registered' };
      }
      const totalUsd = (
        inputTokens * price.inputUsdPerMillionTokens +
        outputTokens * price.outputUsdPerMillionTokens +
        cacheWriteTokens * (price.cacheWriteUsdPerMillionTokens ?? 0) +
        cacheReadTokens * (price.cacheReadUsdPerMillionTokens ?? 0)
      ) / 1_000_000;
      return {
        status: 'known',
        providerId: id,
        model: exact,
        totalUsd,
        source: price.source,
        observedAt: price.observedAt,
      };
    },

    selectFallback(candidates, now = Date.now()) {
      finiteTimestamp(now, 'provider fallback now');
      if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 32) {
        throw new Error('provider fallback candidates must contain between 1 and 32 entries');
      }

      const seen = new Set<string>();
      const derivedRegistry = this.registry(now);
      const assessments: ProviderFallbackAssessment[] = [];
      let selected: ProviderFallbackDecision['selected'];

      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'object') {
          throw new Error('provider fallback candidate must be an object');
        }
        const rawProvider = typeof candidate.providerId === 'string' ? candidate.providerId.trim() : '';
        if (!rawProvider || rawProvider.length > 128 || /[\u0000-\u001f\u007f]/u.test(rawProvider)) {
          throw new Error('provider fallback providerId must be a bounded printable identifier');
        }
        const model = exactModel(candidate.model);
        const baseProvider = baseRegistry.get(rawProvider);
        const canonicalProviderId = baseProvider?.id ?? rawProvider;
        const key = `${canonicalProviderId}\u0000${model}`;
        if (seen.has(key)) throw new Error('provider fallback candidates must be unique');
        seen.add(key);

        if (!baseProvider) {
          assessments.push(Object.freeze({
            providerId: rawProvider,
            model,
            availability: 'unknown',
            modelStatus: 'not_evaluated',
            eligible: false,
            reason: 'unknown_provider',
          }));
          continue;
        }

        const health = getHealth(baseProvider.id, now);
        if (!health.fresh) {
          assessments.push(Object.freeze({
            providerId: baseProvider.id,
            model,
            availability: 'unknown',
            modelStatus: 'not_evaluated',
            eligible: false,
            reason: 'health_not_fresh',
          }));
          continue;
        }
        if (health.availability !== 'available') {
          assessments.push(Object.freeze({
            providerId: baseProvider.id,
            model,
            availability: health.availability,
            modelStatus: 'not_evaluated',
            eligible: false,
            reason: 'provider_unavailable',
          }));
          continue;
        }

        const decision = resolveProviderFabric({
          providerId: baseProvider.id,
          model,
          registry: derivedRegistry,
        });
        if (!decision.routing.providerMatchesModelFamily) {
          assessments.push(Object.freeze({
            providerId: baseProvider.id,
            model,
            availability: health.availability,
            modelStatus: decision.model.status,
            eligible: false,
            reason: 'model_family_mismatch',
          }));
          continue;
        }
        if (decision.model.status !== 'supported' || decision.model.transform !== 'supported') {
          assessments.push(Object.freeze({
            providerId: baseProvider.id,
            model,
            availability: health.availability,
            modelStatus: decision.model.status,
            eligible: false,
            reason: 'model_not_supported',
          }));
          continue;
        }

        assessments.push(Object.freeze({
          providerId: baseProvider.id,
          model,
          availability: health.availability,
          modelStatus: decision.model.status,
          eligible: true,
          reason: 'eligible',
        }));
        if (selected === undefined) {
          selected = Object.freeze({ providerId: baseProvider.id, model });
        }
      }

      return Object.freeze({
        format: 'furypipe-provider-fallback/v1',
        ...(selected === undefined ? {} : { selected }),
        assessments: Object.freeze(assessments),
        networkCallExecuted: false,
      });
    },

    registry(now = Date.now()) {
      const definitions = baseRegistry.list().map((provider) => {
        const observed = getHealth(provider.id, now);
        if (!observed.fresh || observed.source === undefined || observed.evidenceKind === undefined) return provider;
        return {
          ...provider,
          availability: observed.availability,
          evidence: [...provider.evidence, { kind: observed.evidenceKind, source: observed.source }],
        };
      });
      return createProviderRegistry(definitions);
    },

    inspect(now = Date.now()) {
      return {
        health: baseRegistry.list().map((provider) => getHealth(provider.id, now)),
        pricedModels: [...prices.values()]
          .map((price) => ({
            providerId: price.providerId,
            model: price.model,
            observedAt: price.observedAt,
            source: price.source,
          }))
          .sort((a, b) => a.providerId.localeCompare(b.providerId) || a.model.localeCompare(b.model)),
      };
    },
  };
}
