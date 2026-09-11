import type { ContextIRBlock } from './context-ir.js';

export interface CacheProviderContract {
  readonly provider: string;
  readonly protocol: string;
  readonly minTokens: number;
  readonly granularity: 'prefix' | 'block' | 'automatic';
  readonly strictOrdering: boolean;
  readonly explicitMarkers: boolean;
}

export interface CachePlanSegment {
  readonly blockIds: readonly string[];
  readonly cacheClass: ContextIRBlock['cacheClass'];
  readonly cacheable: boolean;
  readonly transformAllowed: boolean;
  readonly reason: string;
}

export interface CachePlan {
  readonly format: 'furypipe-cache-plan/v1';
  readonly provider: string;
  readonly protocol: string;
  readonly mode: 'native_first' | 'raw_passthrough';
  readonly orderedBlockIds: readonly string[];
  readonly segments: readonly CachePlanSegment[];
  readonly requiresProviderContractTest: boolean;
  readonly reason: string;
}

const ORDER: Record<ContextIRBlock['cacheClass'], number> = {
  stable: 0,
  semi_stable: 1,
  dynamic: 2,
  not_cacheable: 3,
};

/**
 * Produce a recommendation only. This planner never changes a request body or
 * cache marker; strict provider ordering always wins over the recommendation.
 */
export function planCache(blocks: readonly ContextIRBlock[], contract: CacheProviderContract): CachePlan {
  const protectedBlock = blocks.find((block) =>
    block.exactnessClass === 'BYTE_EXACT_REQUIRED' ||
    block.exactnessClass === 'TOKEN_EXACT_REQUIRED' ||
    block.exactnessClass === 'OPAQUE_PRESERVE_ONLY' ||
    block.compressionEligibility === 'deny',
  );
  const ordered = contract.strictOrdering
    ? [...blocks]
    : [...blocks].sort((a, b) => ORDER[a.cacheClass] - ORDER[b.cacheClass]);
  const groups = new Map<ContextIRBlock['cacheClass'], ContextIRBlock[]>();
  for (const block of ordered) {
    const group = groups.get(block.cacheClass) ?? [];
    group.push(block);
    groups.set(block.cacheClass, group);
  }
  const segments = [...groups.entries()].map(([cacheClass, group]) => ({
    blockIds: group.map((block) => block.id),
    cacheClass,
    cacheable: cacheClass !== 'dynamic' && cacheClass !== 'not_cacheable',
    transformAllowed: group.every((block) => block.compressionEligibility === 'allow'),
    reason: cacheClass === 'dynamic' ? 'dynamic content is not a stable prefix' :
      cacheClass === 'not_cacheable' ? 'block is outside native cache scope' :
        'native cache is preferred before lossy transformation',
  }));
  return {
    format: 'furypipe-cache-plan/v1',
    provider: contract.provider,
    protocol: contract.protocol,
    mode: protectedBlock ? 'raw_passthrough' : 'native_first',
    orderedBlockIds: ordered.map((block) => block.id),
    segments,
    requiresProviderContractTest: contract.explicitMarkers || !contract.strictOrdering,
    reason: protectedBlock
      ? `protected block ${protectedBlock.id} forces raw pass-through`
      : contract.strictOrdering
        ? 'provider ordering is strict; recommendation preserves wire order'
        : 'stable prefix recommendation; caller must run provider contract tests',
  };
}

