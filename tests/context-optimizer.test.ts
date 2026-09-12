import { describe, expect, it } from 'vitest';
import {
  FURY_CONTEXT_KINDS,
  FURY_CONTEXT_LEVELS,
  optimizeContext,
} from '../src/context-optimizer.js';

describe('FuryPipe Context Optimizer', () => {
  it('loads only metadata for unselected discovery candidates', () => {
    const plan = optimizeContext({
      items: [{
        id: 'playwright',
        kind: 'tool',
        discoverable: true,
        relevance: 0.9,
        cacheClass: 'stable',
        representations: [
          { level: 'metadata', content: 'Playwright browser QA tool.' },
          { level: 'full', content: 'Full Playwright instructions and schemas.'.repeat(100) },
        ],
      }],
      maxBytes: 4096,
    });

    expect(plan.included).toHaveLength(1);
    expect(plan.included[0]).toMatchObject({
      id: 'playwright',
      level: 'metadata',
      reason: 'discovery',
    });
    expect(plan.included[0]!.content).toBe('Playwright browser QA tool.');
  });

  it('downgrades selected context from full to summary when the full representation exceeds budget', () => {
    const full = 'x'.repeat(4000);
    const summary = 'Short verified summary.';
    const plan = optimizeContext({
      items: [{
        id: 'web-skill',
        kind: 'skill',
        selected: true,
        relevance: 1,
        importance: 1,
        cacheClass: 'stable',
        representations: [
          { level: 'metadata', content: 'web skill' },
          { level: 'summary', content: summary },
          { level: 'full', content: full },
        ],
      }],
      maxBytes: 512,
    });

    expect(plan.included[0]?.level).toBe('summary');
    expect(plan.included[0]?.content).toBe(summary);
    expect(plan.savedBytesVsPreferred).toBeGreaterThan(3000);
  });

  it('never silently downgrades an exact selected item', () => {
    expect(() => optimizeContext({
      items: [{
        id: 'exact-config',
        kind: 'task-state',
        selected: true,
        exactness: 'exact',
        preferredLevel: 'full',
        representations: [
          { level: 'summary', content: 'short' },
          { level: 'full', content: 'x'.repeat(2048) },
        ],
      }],
      maxBytes: 512,
    })).not.toThrow();

    const plan = optimizeContext({
      items: [{
        id: 'exact-config',
        kind: 'task-state',
        required: false,
        selected: true,
        exactness: 'exact',
        preferredLevel: 'full',
        representations: [
          { level: 'summary', content: 'short' },
          { level: 'full', content: 'x'.repeat(2048) },
        ],
      }],
      maxBytes: 512,
    });

    expect(plan.included).toEqual([]);
    expect(plan.deferred).toContainEqual({
      id: 'exact-config',
      kind: 'task-state',
      reason: 'byte-budget',
    });
  });

  it('fails closed when a required exact item cannot fit', () => {
    expect(() => optimizeContext({
      items: [{
        id: 'required-exact',
        kind: 'task-state',
        required: true,
        exactness: 'exact',
        preferredLevel: 'full',
        representations: [
          { level: 'metadata', content: 'state metadata' },
          { level: 'full', content: 'y'.repeat(4096) },
        ],
      }],
      maxBytes: 1024,
    })).toThrow(/required context item does not fit/);
  });

  it('blocks secret context by default and requires an explicit allowSecret policy', () => {
    const blocked = optimizeContext({
      items: [{
        id: 'secret-token',
        kind: 'other',
        selected: true,
        exactness: 'secret',
        representations: [{ level: 'full', content: 'opaque-secret-value' }],
      }],
    });
    expect(blocked.included).toEqual([]);
    expect(blocked.deferred[0]?.reason).toBe('secret-policy');

    const allowed = optimizeContext({
      allowSecret: true,
      items: [{
        id: 'secret-token',
        kind: 'other',
        selected: true,
        exactness: 'secret',
        representations: [{ level: 'full', content: 'opaque-secret-value' }],
      }],
    });
    expect(allowed.included[0]?.id).toBe('secret-token');
  });

  it('reorders stable context before dynamic context when provider ordering allows it', () => {
    const plan = optimizeContext({
      items: [
        {
          id: 'dynamic-turn',
          kind: 'transcript',
          selected: true,
          cacheClass: 'dynamic',
          representations: [{ level: 'full', content: 'latest turn' }],
        },
        {
          id: 'stable-rules',
          kind: 'instruction',
          selected: true,
          cacheClass: 'stable',
          representations: [{ level: 'full', content: 'stable rules' }],
        },
        {
          id: 'semi-project',
          kind: 'knowledge',
          selected: true,
          cacheClass: 'semi-stable',
          representations: [{ level: 'full', content: 'project knowledge' }],
        },
      ],
      strictOrdering: false,
    });

    expect(plan.included.map((item) => item.id)).toEqual([
      'stable-rules',
      'semi-project',
      'dynamic-turn',
    ]);
    expect(plan.stablePrefixBytes).toBe(
      new TextEncoder().encode('stable rules').byteLength
      + new TextEncoder().encode('project knowledge').byteLength,
    );
    expect(plan.cacheFriendlyOrderingApplied).toBe(true);
  });

  it('preserves source order when strict ordering is required', () => {
    const plan = optimizeContext({
      strictOrdering: true,
      items: [
        {
          id: 'dynamic-first',
          kind: 'transcript',
          selected: true,
          cacheClass: 'dynamic',
          representations: [{ level: 'full', content: 'dynamic' }],
        },
        {
          id: 'stable-second',
          kind: 'instruction',
          selected: true,
          cacheClass: 'stable',
          representations: [{ level: 'full', content: 'stable' }],
        },
      ],
    });

    expect(plan.included.map((item) => item.id)).toEqual(['dynamic-first', 'stable-second']);
    expect(plan.stablePrefixBytes).toBe(0);
    expect(plan.cacheFriendlyOrderingApplied).toBe(false);
  });

  it('enforces per-kind byte budgets independently of the global budget', () => {
    const plan = optimizeContext({
      maxBytes: 2048,
      maxBytesByKind: { skill: 20 },
      items: [
        {
          id: 'skill-a',
          kind: 'skill',
          selected: true,
          relevance: 1,
          representations: [{ level: 'full', content: '123456789012345' }],
        },
        {
          id: 'skill-b',
          kind: 'skill',
          selected: true,
          relevance: 0.9,
          representations: [{ level: 'full', content: 'abcdefghijklmno' }],
        },
      ],
    });

    expect(plan.included).toHaveLength(1);
    expect(plan.deferred).toContainEqual({
      id: 'skill-b',
      kind: 'skill',
      reason: 'kind-byte-budget',
    });
  });

  it('reports an optional token estimate without claiming exact provider tokenization', () => {
    const plan = optimizeContext({
      charsPerTokenEstimate: 4,
      maxBytes: 128,
      items: [{
        id: 'result',
        kind: 'tool-output',
        selected: true,
        representations: [
          { level: 'summary', content: 'PASS: 1516 tests, 0 failures.' },
          { level: 'full', content: 'x'.repeat(1000) },
        ],
      }],
    });

    expect(plan.included[0]?.level).toBe('summary');
    expect(plan.estimatedTokens?.before).toBe(250);
    expect(plan.estimatedTokens?.after).toBeLessThan(20);
    expect(plan.estimatedTokens?.saved).toBeGreaterThan(200);
  });

  it('is deterministic and rejects duplicate or malformed inventory', () => {
    const input = {
      items: [{
        id: 'knowledge',
        kind: 'knowledge' as const,
        selected: true,
        relevance: 0.8,
        representations: [{ level: 'summary' as const, content: 'bounded knowledge' }],
      }],
    };

    expect(optimizeContext(input)).toEqual(optimizeContext(input));

    expect(() => optimizeContext({
      items: [
        {
          id: 'dup',
          kind: 'tool',
          selected: true,
          representations: [{ level: 'metadata', content: 'a' }],
        },
        {
          id: 'dup',
          kind: 'skill',
          selected: true,
          representations: [{ level: 'metadata', content: 'b' }],
        },
      ],
    })).toThrow(/duplicate context item id/);

    expect(() => optimizeContext({
      items: [{
        id: 'bad-level',
        kind: 'tool',
        selected: true,
        representations: [
          { level: 'metadata', content: 'a' },
          { level: 'metadata', content: 'b' },
        ],
      }],
    })).toThrow(/duplicate representation level/);
  });

  it('keeps stable public level and kind enumerations', () => {
    expect(FURY_CONTEXT_LEVELS).toEqual(['metadata', 'summary', 'full', 'executable']);
    expect(FURY_CONTEXT_KINDS).toContain('tool-output');
    expect(FURY_CONTEXT_KINDS).toContain('task-state');
  });
});
