import type { PolicyCostInputs, PolicyDecision, PolicyMode, PolicyStrategy } from './policy-engine.js';
import { evaluatePolicy } from './policy-engine.js';
import type { ContextIRBlock } from './context-ir.js';

export type PolicyFabricStrategy = PolicyStrategy | 'retrieval' | 'hybrid';
export type ProviderHealthStatus = 'unknown' | 'healthy' | 'degraded' | 'unavailable';
export type CircuitState = 'closed' | 'open' | 'half_open';

export interface PolicyProviderState {
  readonly provider: string;
  readonly status: ProviderHealthStatus;
  readonly circuit: CircuitState;
  readonly fallbackProvider?: string;
  readonly fallbackAvailable?: boolean;
  readonly canaryAllowed?: boolean;
  readonly qualityRegressionDetected?: boolean;
}
export interface PolicyStrategyAssessment {
  readonly strategy: PolicyFabricStrategy;
  readonly estimatedCostUsd: number;
  readonly eligible: boolean;
  readonly reason: string;
}

export interface PolicyFabricDecision {
  readonly format: 'furypipe-policy-fabric-decision/v1';
  readonly provider: string;
  readonly selected: PolicyDecision;
  readonly alternatives: readonly PolicyStrategyAssessment[];
  readonly providerState: PolicyProviderState;
  readonly fallback: {
    readonly eligible: boolean;
    readonly provider?: string;
    readonly reason: string;
  };
  readonly safeguards: {
    readonly circuitBreaker: CircuitState;
    readonly canary: 'eligible' | 'disabled' | 'unknown';
    readonly safeRollback: 'available' | 'blocked' | 'unknown';
    readonly qualityRegression: 'detected' | 'not_detected' | 'unknown';
  };
}

export interface PolicyRuntimeCapabilities {
  readonly retrieval?: boolean;
  readonly hybrid?: boolean;
}

export interface PolicyFabricRequest {
  readonly provider: string;
  readonly mode: PolicyMode;
  readonly blocks: readonly ContextIRBlock[];
  readonly costs: PolicyCostInputs;
  readonly providerState?: Partial<PolicyProviderState>;
  readonly runtimeCapabilities?: PolicyRuntimeCapabilities;
}

function finiteCost(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : Number.POSITIVE_INFINITY;
}

/**
 * Estimate each mutually exclusive strategy independently. These are cost
 * units supplied by the caller, not a claim of provider billing accuracy.
 */
function strategyCost(costs: PolicyCostInputs, strategy: PolicyFabricStrategy): number {
  switch (strategy) {
    case 'raw': return finiteCost(costs.regularInput + costs.output);
    case 'native-cache': return finiteCost(costs.cacheWrite + costs.cacheRead + costs.output);
    case 'guarded-lossy': return finiteCost(costs.visualInput + costs.localCompute + costs.retry + costs.output);
    case 'retrieval': return finiteCost(costs.retrieval + costs.output);
    case 'hybrid': return finiteCost(Math.min(
      costs.cacheWrite + costs.cacheRead,
      costs.visualInput + costs.localCompute + costs.retry,
    ) + costs.retrieval + costs.output);
  }
}

function strategyEligible(
  blocks: readonly ContextIRBlock[],
  strategy: PolicyFabricStrategy,
  capabilities: PolicyRuntimeCapabilities | undefined,
): boolean {
  if (strategy === 'raw' || strategy === 'native-cache') return true;
  if (strategy === 'retrieval') return capabilities?.retrieval === true;
  const lossyEligible = blocks.length > 0 && blocks.every((block) => block.compressionEligibility === 'allow');
  if (strategy === 'hybrid') return lossyEligible && capabilities?.hybrid === true;
  return lossyEligible;
}

function reasonFor(
  strategy: PolicyFabricStrategy,
  eligible: boolean,
  capabilities: PolicyRuntimeCapabilities | undefined,
): string {
  if (strategy === 'retrieval') {
    return eligible ? 'retrieval executor is explicitly available' : 'retrieval executor is not wired in this runtime';
  }
  if (strategy === 'hybrid') {
    if (capabilities?.hybrid !== true) return 'hybrid executor is not wired in this runtime';
    return eligible ? 'hybrid executor is available and blocks are lossy-eligible' : 'protected blocks prevent a fully lossy hybrid';
  }
  return eligible ? 'strategy has a typed local estimate' : 'strategy is blocked by a hard local constraint';
}

/** Build a safe multi-strategy policy result without mutating the request. */
export function evaluatePolicyFabric(input: PolicyFabricRequest): PolicyFabricDecision {
  const providerState: PolicyProviderState = {
    provider: input.provider,
    status: input.providerState?.status ?? 'unknown',
    circuit: input.providerState?.circuit ?? 'closed',
    ...(input.providerState?.fallbackProvider === undefined ? {} : { fallbackProvider: input.providerState.fallbackProvider }),
    ...(input.providerState?.fallbackAvailable === undefined ? {} : { fallbackAvailable: input.providerState.fallbackAvailable }),
    ...(input.providerState?.canaryAllowed === undefined ? {} : { canaryAllowed: input.providerState.canaryAllowed }),
    ...(input.providerState?.qualityRegressionDetected === undefined ? {} : { qualityRegressionDetected: input.providerState.qualityRegressionDetected }),
  };
  const providerBlocked = providerState.status === 'unavailable' || providerState.circuit === 'open';
  const selected = evaluatePolicy({
    mode: input.mode,
    blocks: input.blocks,
    costs: input.costs,
    providerAvailable: providerBlocked ? false : undefined,
  });
  const strategies: readonly PolicyFabricStrategy[] = ['raw', 'native-cache', 'guarded-lossy', 'retrieval', 'hybrid'];
  const alternatives = strategies.map((strategy) => {
    const eligible = strategyEligible(input.blocks, strategy, input.runtimeCapabilities) && !(providerBlocked && strategy !== 'raw');
    return {
      strategy,
      estimatedCostUsd: strategyCost(input.costs, strategy),
      eligible,
      reason: providerBlocked && strategy !== 'raw'
        ? 'provider circuit is open or unavailable'
        : reasonFor(strategy, eligible, input.runtimeCapabilities),
    };
  });
  const fallbackEligible = providerState.fallbackAvailable === true && providerState.fallbackProvider !== undefined;
  return {
    format: 'furypipe-policy-fabric-decision/v1',
    provider: input.provider,
    selected,
    alternatives,
    providerState,
    fallback: {
      eligible: fallbackEligible,
      ...(fallbackEligible ? { provider: providerState.fallbackProvider } : {}),
      reason: fallbackEligible ? 'explicit fallback provider is available' : 'fallback health is not proven',
    },
    safeguards: {
      circuitBreaker: providerState.circuit,
      canary: providerState.canaryAllowed === true ? 'eligible' : providerState.canaryAllowed === false ? 'disabled' : 'unknown',
      safeRollback: providerState.status === 'unavailable' || providerState.circuit === 'open' ? 'blocked' : 'unknown',
      qualityRegression: providerState.qualityRegressionDetected === true ? 'detected' : providerState.qualityRegressionDetected === false ? 'not_detected' : 'unknown',
    },
  };
}
