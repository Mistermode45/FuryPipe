/**
 * Billing-line placement vs the cached prefix (#180/#161 regression, #206 fix).
 *
 * `x-anthropic-billing-header:` changes every turn (`cc_prev_req` on CLI >=
 * 2.1.222). Anthropic's cache prefix covers everything up to the LAST
 * cache_control marker, in order: tools, system[], then messages[]. Any system
 * block therefore sits INSIDE the cached span — re-emitting the line there
 * voided the whole prefix (telemetry: 0 cache reads, 509/509 distinct
 * cachePrefixSha8 per day).
 *
 * The #206 fix re-emitted the line after the final user message's markers —
 * cache-safe, but it rendered as user-attributed conversation text (the
 * transcript leak). There is no body position that is both cache-safe and
 * invisible, so the contract is now: the line appears NOWHERE in the outgoing
 * body, is exported via info.billingLine (the proxy forwards it as a real
 * HTTP header), and the bytes at or before the last marker are identical
 * across two requests that differ only in the billing line.
 *
 * Run just this file:  pnpm vitest run tests/billing-line-cache.test.ts
 */
import { describe, expect, it } from 'vitest';
import { transformRequest } from '../src/core/transform.js';
import type { Message } from '../src/core/types.js';

const BILLING = (turn: number) =>
  `x-anthropic-billing-header: cc_version=2.1.226; cc_prev_req=req_${String(turn).padStart(8, '0')}; cch=07295`;

const big = (n: number) => 'x'.repeat(n);
const enc = (obj: unknown) => new TextEncoder().encode(JSON.stringify(obj));
const dec = (b: Uint8Array): any => JSON.parse(new TextDecoder().decode(b));

function convo(n: number, chars = 3500): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `turn ${i}: ` + big(chars) });
  }
  return out;
}

/** Claude-Code-shaped request: billing line rides its own system block. */
function ccBody(opts: { turn?: number; messages?: Message[] } = {}) {
  return enc({
    model: 'claude-3-5-sonnet',
    system: [
      { type: 'text', text: big(80_000), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: BILLING(opts.turn ?? 1) },
    ],
    messages: opts.messages ?? convo(15),
  });
}

/** Flatten the outgoing request into Anthropic cache-prefix order. */
function flatten(out: Uint8Array): any[] {
  const body = dec(out);
  const blocks: any[] = [];
  for (const t of body.tools ?? []) blocks.push(t);
  const sys = typeof body.system === 'string' ? [{ type: 'text', text: body.system }] : (body.system ?? []);
  for (const b of sys) blocks.push({ ...b, __sys: true });
  for (const m of body.messages ?? []) {
    const content = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }];
    for (const b of content) blocks.push(b);
  }
  return blocks;
}

const isBilling = (b: any) => typeof b?.text === 'string' && b.text.includes('x-anthropic-billing-header:');

describe('billing line vs cached prefix', () => {
  it('never appears in the outgoing body; exported via info.billingLine', async () => {
    const { body: out, info } = await transformRequest(ccBody({ turn: 1 }));
    const blocks = flatten(out);

    expect(blocks.some(isBilling)).toBe(false); // nowhere in the body

    const lastMarker = blocks.reduce((acc, b, i) => (b?.cache_control ? i : acc), -1);
    expect(lastMarker).toBeGreaterThanOrEqual(0); // markers survived the transform

    expect(info.billingLine).toBe(BILLING(1)); // handed to the proxy for the HTTP envelope
  });

  it('bytes at or before the last marker are invariant under billing churn', async () => {
    const a = await transformRequest(ccBody({ turn: 1 }));
    const b = await transformRequest(ccBody({ turn: 2 }));

    const cut = (out: Uint8Array) => {
      const blocks = flatten(out);
      const last = blocks.reduce((acc, blk, i) => (blk?.cache_control ? i : acc), -1);
      return JSON.stringify(blocks.slice(0, last + 1));
    };
    expect(cut(b.body)).toBe(cut(a.body)); // cached span byte-identical …
    expect(b.info.cachePrefixSha8).toBe(a.info.cachePrefixSha8); // … and the digest agrees
  });

  it('stays out of the body even when no user message exists', async () => {
    const { body: out, info } = await transformRequest(
      ccBody({ messages: [{ role: 'assistant', content: 'prefill only: ' + big(3500) }] }),
    );
    expect(flatten(out).some(isBilling)).toBe(false);
    expect(info.billingLine).toBe(BILLING(1)); // still forwarded as a header
  });
});
