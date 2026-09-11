import type { ContextIRBlock } from './context-ir.js';

export type PolicyMode = 'safe' | 'balanced' | 'aggressive' | 'coding-safe' | 'logs' | 'research' | 'max-cache' | 'offline-local';
export type PolicyStrategy = 'raw' | 'native-cache' | 'guarded-lossy';

export interface PolicyCostInputs {
  readonly regularInput: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
  readonly visualInput: number;
  readonly retrieval: number;
  readonly localCompute: number;
  readonly retry: number;
  readonly output: number;
}

export interface PolicyConstraints {
  readonly maxLatencyMs?: number;
  readonly maxSpendUsd?: number;
  readonly qualitySla?: 'normal' | 'high' | 'critical';
}

export interface PolicyRequest {
  readonly mode: PolicyMode;
  readonly blocks: readonly ContextIRBlock[];
  readonly costs: PolicyCostInputs;
  readonly constraints?: PolicyConstraints;
  readonly providerAvailable?: boolean;
  readonly measured?: boolean;
}

export interface PolicyDecision {
  readonly format: 'furypipe-policy-decision/v1';
  readonly mode: PolicyMode;
  readonly strategy: PolicyStrategy;
  readonly expectedTotalCostUsd: number;
  readonly evidence: 'estimated' | 'verified';
  readonly hardConstraints: readonly string[];
  readonly reason: string;
  readonly canaryEligible: boolean;
}

function total(costs: PolicyCostInputs): number {
  return Object.values(costs).reduce((sum, value) => sum + (Number.isFinite(value) && value >= 0 ? value : Number.POSITIVE_INFINITY), 0);
}

function hasHardProtection(blocks: readonly ContextIRBlock[]): string | undefined {
  const protectedBlock = blocks.find((block) =>
    block.exactnessClass === 'BYTE_EXACT_REQUIRED' ||
    block.exactnessClass === 'TOKEN_EXACT_REQUIRED' ||
    block.exactnessClass === 'OPAQUE_PRESERVE_ONLY' ||
    block.sensitivityClass === 'secret' ||
    block.sideEffectClass === 'non_idempotent',
  );
  return protectedBlock ? `block ${protectedBlock.id} is protected from lossy policy` : undefined;
}

/** Choose a strategy without applying it to a provider request. */
export function evaluatePolicy(input: PolicyRequest): PolicyDecision {
  const expectedTotalCostUsd = total(input.costs);
  const hardConstraints: string[] = [];
  const protection = hasHardProtection(input.blocks);
  if (protection) hardConstraints.push(protection);
  if (input.providerAvailable === false) hardConstraints.push('provider unavailable');
  if (input.constraints?.qualitySla === 'critical') hardConstraints.push('critical quality SLA');
  if (input.constraints?.maxSpendUsd !== undefined && expectedTotalCostUsd > input.constraints.maxSpendUsd) {
    hardConstraints.push('max spend constraint exceeded');
  }
  const forceRaw = hardConstraints.length > 0 || input.mode === 'offline-local';
  const lossyEconomical = input.costs.regularInput > input.costs.visualInput + input.costs.localCompute + input.costs.retry;
  const strategy: PolicyStrategy = forceRaw
    ? 'raw'
    : input.mode === 'max-cache' || input.mode === 'safe' || input.mode === 'coding-safe'
      ? 'native-cache'
      : lossyEconomical && input.mode !== 'logs'
        ? 'guarded-lossy'
        : 'native-cache';
  const reason = forceRaw
    ? hardConstraints.join('; ')
    : strategy === 'guarded-lossy'
      ? 'lossy path is estimated cheaper and all blocks are eligible; provider contract still required'
      : 'native cache or raw text is preferred under the selected safety mode';
  return {
    format: 'furypipe-policy-decision/v1',
    mode: input.mode,
    strategy,
    expectedTotalCostUsd,
    evidence: input.measured === true ? 'verified' : 'estimated',
    hardConstraints,
    reason,
    canaryEligible: strategy === 'guarded-lossy' && hardConstraints.length === 0 && input.mode !== 'aggressive',
  };
}

