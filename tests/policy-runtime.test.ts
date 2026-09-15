import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInMemoryPolicyCache,
  createRecoveryIndex,
  createRecoveryStore,
  derivePolicyCacheKey,
  executePolicyHybrid,
  executeRecoveryRetrieval,
} from '../src/core/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('policy runtime cache', () => {
  it('derives exact deterministic keys and keeps model identity in the digest', () => {
    const payload = new TextEncoder().encode('exact payload');
    const a = derivePolicyCacheKey('anthropic', 'claude-opus-5', payload);
    const b = derivePolicyCacheKey('anthropic', 'claude-opus-5', payload);
    const c = derivePolicyCacheKey('anthropic', 'claude-opus-5.1', payload);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^furypipe-policy-cache\/v1\/sha256\/[0-9a-f]{64}$/);
  });

  it('performs bounded exact-byte read/write, TTL expiry and LRU eviction', () => {
    let now = 1000;
    const cache = createInMemoryPolicyCache({
      maxEntries: 1,
      maxTotalBytes: 16,
      maxEntryBytes: 16,
      defaultTtlMs: 100,
      now: () => now,
    });
    const one = derivePolicyCacheKey('anthropic', 'm1', new Uint8Array([1]));
    const two = derivePolicyCacheKey('anthropic', 'm2', new Uint8Array([2]));
    const source = new Uint8Array([1, 2, 3]);

    cache.put(one, source);
    source[0] = 9;
    const hit = cache.get(one);
    expect(hit.status).toBe('hit');
    expect(hit.value).toEqual(new Uint8Array([1, 2, 3]));
    hit.value![0] = 7;
    expect(cache.get(one).value).toEqual(new Uint8Array([1, 2, 3]));

    cache.put(two, new Uint8Array([4]));
    expect(cache.get(one).status).toBe('miss');
    expect(cache.stats().evictions).toBe(1);

    now = 1200;
    expect(cache.get(two).status).toBe('miss');
    expect(cache.stats().entries).toBe(0);
  });

  it('rejects oversized entries and malformed cache keys', () => {
    const cache = createInMemoryPolicyCache({ maxEntryBytes: 2, maxTotalBytes: 4 });
    const key = derivePolicyCacheKey('anthropic', undefined, new Uint8Array([1]));
    expect(() => cache.put(key, new Uint8Array([1, 2, 3]))).toThrow(/maxEntryBytes/);
    expect(() => cache.get('cache/latest')).toThrow(/invalid FuryPipe policy cache key/);
  });
});

describe('policy retrieval and hybrid runtime', () => {
  it('executes Recovery retrieval while returning handles/offsets instead of matched plaintext', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-policy-retrieval-'));
    roots.push(root);
    const index = createRecoveryIndex(createRecoveryStore(root));
    await index.add(new TextEncoder().encode('alpha needle omega'), { source: 'fixture.txt' });

    const result = await executeRecoveryRetrieval(index, 'needle');
    expect(result.format).toBe('furypipe-policy-retrieval/v1');
    expect(result.hits).toHaveLength(1);
    expect(result.queryDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toContain('needle');
    expect(JSON.stringify(result)).not.toContain('alpha needle omega');
  });

  it('does not call the hybrid transform when retrieval has no evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-policy-hybrid-empty-'));
    roots.push(root);
    const index = createRecoveryIndex(createRecoveryStore(root));
    await index.add(new TextEncoder().encode('unrelated content'));
    const transform = vi.fn(async (value: Uint8Array) => value);

    const input = new TextEncoder().encode('provider request');
    const result = await executePolicyHybrid(index, 'missing', input, transform);
    expect(result.transformed).toBe(false);
    expect(result.output).toEqual(input);
    expect(transform).not.toHaveBeenCalled();
  });

  it('executes an explicit hybrid transform only after retrieval returns evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-policy-hybrid-'));
    roots.push(root);
    const index = createRecoveryIndex(createRecoveryStore(root));
    await index.add(new TextEncoder().encode('evidence marker'), { source: 'evidence.txt' });
    const input = new TextEncoder().encode('provider request');

    const result = await executePolicyHybrid(index, 'marker', input, async (value, context) => {
      expect(context.hits).toHaveLength(1);
      expect(context.queryDigest).toMatch(/^[0-9a-f]{64}$/);
      value[0] = 'P'.charCodeAt(0);
      return value;
    });

    expect(result.transformed).toBe(true);
    expect(new TextDecoder().decode(result.output)).toBe('Provider request');
    expect(new TextDecoder().decode(input)).toBe('provider request');
    expect(JSON.stringify(result.hits)).not.toContain('marker');
  });
});
