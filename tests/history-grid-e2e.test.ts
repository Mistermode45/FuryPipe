/**
 * End-to-end contract for the adaptive history grid, as wired into
 * `transformRequest` (not the unit level — `history.test.ts` covers the packer
 * itself). These pin the three properties the session-500s taught us:
 *
 *   1. a request can never exceed the provider's hard image cap, no matter how
 *      large the conversation grows,
 *   2. the freeze grid never gets FINER within a session (a re-cut re-keys every
 *      chunk and burns the whole prefix as cache_create), and
 *   3. dense repacking only happens once the upstream cache is provably dead.
 *
 * Run just this file:  pnpm vitest run tests/history-grid-e2e.test.ts
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { transformRequest } from '../src/core/transform.js';
import { ANTHROPIC_MAX_IMAGES } from '../src/core/history.js';
import { markCacheDead, resetSessionState } from '../src/core/session-state.js';
import type { Message } from '../src/core/types.js';

const big = (n: number) => 'x'.repeat(n);

function enc(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}
function dec(b: Uint8Array): any {
  return JSON.parse(new TextDecoder().decode(b));
}
function countImages(msgs: Message[]): number {
  let n = 0;
  for (const m of msgs) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content as any[]) if (b?.type === 'image') n++;
  }
  return n;
}

/**
 * `n` closed turns. The first user message is held constant across calls so the
 * session key (sha8 of the first user text) is stable — that is exactly how the
 * proxy identifies a conversation.
 */
function convo(n: number, chars = 3500): Message[] {
  const out: Message[] = [{ role: 'user', content: 'SESSION ANCHOR: ' + big(200) }];
  for (let i = 0; i < n; i++) {
    const body = `turn ${i}: ` + big(chars);
    out.push({ role: i % 2 === 0 ? 'assistant' : 'user', content: body });
  }
  return out;
}

function request(messages: Message[]): Uint8Array {
  return enc({ model: 'claude-3-5-sonnet', messages });
}

describe('history grid wiring — image budget', () => {
  beforeEach(() => resetSessionState());

  it('stays under the provider image cap for a conversation far past the budget', async () => {
    // ~1.4M chars of history. At one page per ~2k chars an unbounded grid would
    // want hundreds of images; the packer must merge chunks until it fits.
    const { body: out, info } = await transformRequest(request(convo(400, 3500)));
    const images = countImages(dec(out).messages);

    expect(images).toBeLessThanOrEqual(ANTHROPIC_MAX_IMAGES);
    expect(info.collapsedTurns).toBeGreaterThan(0);
    // It fit by coarsening the grid and/or leaving the tail live — either way it
    // must have reported which lever it pulled.
    expect(
      (info.historyFreezeStep ?? 0) > 1 || info.historyBudgetTrimmed === true,
    ).toBe(true);
  });

  // The regression behind the two unresumable sessions: the budget priced a page
  // at the 312-col constant while the pages were actually rendered at the
  // request's `cols`. At COLS=100 a page holds ~3.1× less text, so a plan that
  // "fit" 100 images emitted ~300 and the provider 500'd. The cap has to hold at
  // every geometry we can be driven at, not just the default one.
  it.each([80, 100, 200, 312])('stays under the cap at cols=%i', async (cols) => {
    const { body: out, info } = await transformRequest(request(convo(400, 3500)), { cols });
    expect(countImages(dec(out).messages)).toBeLessThanOrEqual(ANTHROPIC_MAX_IMAGES);
    expect(info.collapsedTurns).toBeGreaterThan(0);
  });

  it('keeps total images (slab + tool docs + history) under the cap', async () => {
    const body = enc({
      model: 'claude-3-5-sonnet',
      system: [{ type: 'text', text: big(120_000) }],
      messages: convo(300, 3500),
    });
    const { body: out } = await transformRequest(body);
    expect(countImages(dec(out).messages)).toBeLessThanOrEqual(ANTHROPIC_MAX_IMAGES);
  });
});

describe('history grid wiring — freeze step is monotonic per session', () => {
  beforeEach(() => resetSessionState());

  it('never re-cuts to a finer grid as the conversation grows', async () => {
    const steps: number[] = [];
    for (const turns of [40, 120, 260, 400]) {
      const { info } = await transformRequest(request(convo(turns, 3500)));
      if (info.historyFreezeStep !== undefined) steps.push(info.historyFreezeStep);
    }
    expect(steps.length).toBeGreaterThan(1);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]!);
    }
  });

  it('shrinking back to a short history does not re-cut finer either', async () => {
    const grown = await transformRequest(request(convo(400, 3500)));
    const coarse = grown.info.historyFreezeStep ?? 0;
    expect(coarse).toBeGreaterThan(1);

    // Same session, but the caller replays a much shorter prefix (e.g. after an
    // edit). A finer grid here would re-key every surviving chunk.
    const again = await transformRequest(request(convo(60, 3500)));
    expect(again.info.historyFreezeStep ?? coarse).toBeGreaterThanOrEqual(coarse);
  });

  it('a different session gets its own grid', async () => {
    await transformRequest(request(convo(400, 3500)));
    const other: Message[] = [
      { role: 'user', content: 'A COMPLETELY DIFFERENT ANCHOR: ' + big(200) },
      ...convo(40, 3500).slice(1),
    ];
    const { info } = await transformRequest(request(other));
    // Fresh key ⇒ no inherited floor; the small history collapses on a fine grid.
    expect(info.historyPackFill).toBeUndefined();
  });
});

describe('history grid wiring — packFill only on a dead cache', () => {
  beforeEach(() => resetSessionState());

  it('does not repack while the upstream cache may still be warm', async () => {
    const { info } = await transformRequest(request(convo(120, 3500)));
    expect(info.historyPackFill).toBeUndefined();
  });

  it('repacks after the cache was marked dead (e.g. an upstream reject)', async () => {
    const first = await transformRequest(request(convo(120, 3500)));
    const key = first.info.firstUserSha8;
    expect(key).toBeTruthy();

    markCacheDead(key);

    const second = await transformRequest(request(convo(120, 3500)));
    expect(second.info.historyPackFill).toBe(true);
    // Denser pages ⇒ never more images than the cache-friendly cut.
    expect(second.info.imageCount).toBeLessThanOrEqual(first.info.imageCount);
  });

  it('the dead-cache flag is consumed — the next turn is append-only again', async () => {
    const first = await transformRequest(request(convo(120, 3500)));
    markCacheDead(first.info.firstUserSha8);
    await transformRequest(request(convo(120, 3500)));
    const third = await transformRequest(request(convo(130, 3500)));
    expect(third.info.historyPackFill).toBeUndefined();
  });
});
