/**
 * Which upstream outcomes end a session's prefix cache.
 *
 * Getting this wrong is expensive in both directions:
 *
 *   - miss a real rejection and the grid stays frozen at a shape nothing is
 *     cached against, so we keep paying for a freeze that buys nothing;
 *   - call a LIVE cache dead and the next turn re-cuts the grid, changing every
 *     chunk's bytes and burning the whole prefix as cache_create.
 *
 * The second is the worse one, so anything ambiguous must stay warm.
 *
 * Run just this file:  pnpm vitest run tests/cache-liveness.test.ts
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  markCacheDead,
  noteCacheOutcome,
  noteHistoryRequest,
  peekSessionState,
  resetSessionState,
  responseLeftNoCache,
} from '../src/core/session-state.js';

describe('responseLeftNoCache — outcomes that leave no cache entry', () => {
  it('treats an outright size rejection as cache-ending', () => {
    expect(responseLeftNoCache(413)).toBe(true);
  });

  it('does NOT treat a transient 5xx as cache-ending', () => {
    // Production settled this. Of 20871 requests on one host the 5xx population
    // was 177x 529 overloaded, 2x 500, 1x 503 — and 129 of 250 repacks fired
    // directly after one of them. A 529 means the provider declined to process
    // the request; the prefix cache it never touched is still there, and the
    // repack threw it away for nothing.
    for (const s of [500, 502, 503, 504, 529]) expect(responseLeftNoCache(s), String(s)).toBe(false);
  });

  it('needs no error signal for a cache that really died', () => {
    // noteCacheOutcome sees the next response report neither a read nor a write.
    // That is accurate and free, which is why the blanket 5xx rule could go.
    expect(responseLeftNoCache(529)).toBe(false);
    expect(responseLeftNoCache(413)).toBe(true);
  });

  it('reads a 400 body for the provider’s several spellings of "too long"', () => {
    const bodies = [
      '{"error":{"message":"prompt is too long: 245000 tokens > 200000 maximum"}}',
      '{"error":{"type":"prompt_too_long"}}',
      '{"error":{"type":"request_too_large","message":"request too large"}}',
      '{"error":{"message":"too many images in request"}}',
    ];
    for (const b of bodies) expect(responseLeftNoCache(400, b)).toBe(true);
  });

  it('leaves the session warm on a 200', () => {
    expect(responseLeftNoCache(200)).toBe(false);
  });

  // These are the dangerous ones: all say nothing about the prefix cache, which
  // may well still be live. Re-cutting on them would burn it.
  it('leaves the session warm on 4xx that carry no size signal', () => {
    expect(responseLeftNoCache(401)).toBe(false); // bad key
    expect(responseLeftNoCache(403)).toBe(false); // forbidden
    expect(responseLeftNoCache(404)).toBe(false); // wrong path
    expect(responseLeftNoCache(429)).toBe(false); // rate limited — cache intact
    expect(responseLeftNoCache(400)).toBe(false); // 400 with no body to read
    expect(responseLeftNoCache(400, '{"error":{"message":"invalid model"}}')).toBe(false);
  });
});

describe('markCacheDead — session bookkeeping', () => {
  beforeEach(() => resetSessionState());

  it('flags the session so the next collapse may repack', () => {
    markCacheDead('abcd1234');
    expect(peekSessionState('abcd1234')?.cacheDead).toBe(true);
  });

  it('is a no-op without a session key rather than throwing', () => {
    expect(() => markCacheDead(undefined)).not.toThrow();
  });

  it('does not invent state for sessions that never failed', () => {
    markCacheDead('aaaa1111');
    expect(peekSessionState('bbbb2222')).toBeUndefined();
  });
});

describe('cold detection uses the provider\'s accounting, not the wall clock', () => {
  beforeEach(() => resetSessionState());

  const MIN = 60_000;
  const KEY = 'sess1234';
  // Never 0: lastSeenMs=0 is the store's "never seen" sentinel, so a turn at
  // epoch 0 would read back as unknown and the horizon could not fire.
  const T0 = 1_700_000_000_000;

  /** One turn: transform (advances the clock), then the response's cache numbers. */
  function turn(atMs: number, read: number, create: number) {
    const state = noteHistoryRequest(KEY, atMs);
    noteCacheOutcome(KEY, read, create);
    return state;
  }

  it('keeps a session warm across a gap the provider proved it survives', () => {
    // Measured: 66% of gaps past 5.5 minutes still cache-read, so the old
    // 5-minute threshold called live caches dead most of the time it fired.
    turn(T0, 100_000, 0);
    expect(noteHistoryRequest(KEY, T0 + 10 * MIN).cold).toBe(false);
  });

  it('does not repack on top of a cache the previous turn just paid to write', () => {
    // The production chain this fixes: three repacks in one hour on ~10-minute
    // gaps, each preceded by a turn with read=0 and create=60-98k. The clock saw
    // "no read, long gap" and re-cut; the create said a cache existed.
    turn(T0, 0, 66_119);
    expect(noteHistoryRequest(KEY, T0 + 10 * MIN).cold).toBe(false);
  });

  it('stays warm when the counters were ALWAYS zero — that is no cache, not a dead one', () => {
    // A request carrying no cache_control marker reports both counters zero for
    // its whole life. Reading that as "the cache died" would repack the grid on
    // every single turn, forever, to reclaim a cache that never existed. The
    // append-only e2e tests caught exactly this.
    turn(T0, 0, 0);
    turn(T0 + MIN, 0, 0);
    expect(noteHistoryRequest(KEY, T0 + 2 * MIN).cold).toBe(false);
  });

  it('goes cold once a cache existed and then stopped appearing', () => {
    // This is the real "dead cache": something was there, now nothing is, so
    // re-cutting the grid costs nothing and reclaims image tokens.
    turn(T0, 120_000, 0);   // a cache existed
    turn(T0 + MIN, 0, 0);   // and is gone
    expect(noteHistoryRequest(KEY, T0 + 2 * MIN).cold).toBe(true);
  });

  it('goes cold after a rejection regardless of the clock', () => {
    turn(T0, 100_000, 0);
    markCacheDead(KEY);
    expect(noteHistoryRequest(KEY, T0 + 1_000).cold).toBe(true);
  });

  it('consumes the rejection: the turn after the repack is warm again', () => {
    turn(T0, 100_000, 0);
    markCacheDead(KEY);
    expect(noteHistoryRequest(KEY, T0 + 1_000).cold).toBe(true);
    noteCacheOutcome(KEY, 0, 50_000); // the repack wrote a fresh cache
    expect(noteHistoryRequest(KEY, T0 + 2_000).cold).toBe(false);
  });

  it('falls back to an hour horizon only when the server never answered', () => {
    // No noteCacheOutcome at all — e.g. a response whose usage never arrived.
    noteHistoryRequest(KEY, T0);
    expect(noteHistoryRequest(KEY, T0 + 30 * MIN).cold).toBe(false); // inside the horizon
    resetSessionState();
    noteHistoryRequest(KEY, T0);
    expect(noteHistoryRequest(KEY, T0 + 90 * MIN).cold).toBe(true); // past it
  });

  it('treats a never-seen session as warm', () => {
    // Unknown must never authorize a repack: at worst we keep paying the old
    // image count, we never nuke a live cache on a guess.
    expect(noteHistoryRequest('brandnew1', 0).cold).toBe(false);
  });

  it('ignores outcomes for sessions it never transformed', () => {
    noteCacheOutcome('ghost123', 0, 0);
    expect(peekSessionState('ghost123')).toBeUndefined();
  });

  it('lets a proven-dead cache go cold even inside the horizon', () => {
    turn(T0, 100_000, 0);      // warm
    turn(T0 + MIN, 0, 0);      // provider says: nothing cached anymore
    expect(noteHistoryRequest(KEY, T0 + 2 * MIN).cold).toBe(true);
  });
});

