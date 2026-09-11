/**
 * Cache-bust ATTRIBUTION telemetry (#11).
 *
 * When cache_read collapses in production, these fields are the only evidence
 * available after the fact. Two contracts:
 *
 *  1. `history_image_sha8` must describe the HISTORY images. On a Claude Code
 *     request the slab anchor makes `messages[0]` the protected slab message,
 *     not the synthetic history message — hashing index 0 silently reported
 *     slab stability under the history name, so a drifting collapse boundary
 *     looked stable in telemetry.
 *  2. The pinned prefix must be digested per LAYER (tools / system / imaged
 *     head), because "the prefix changed" does not say which layer moved, and
 *     the three fail for different reasons and need different fixes.
 *
 * Run just this file:  pnpm vitest run tests/cache-bust-attribution.test.ts
 */
import { describe, expect, it } from 'vitest';
import { transformRequest } from '../src/core/transform.js';
import { HISTORY_SYNTHETIC_INTRO } from '../src/core/history.js';
import type { Message } from '../src/core/types.js';

const big = (n: number) => 'x'.repeat(n);
const enc = (obj: unknown) => new TextEncoder().encode(JSON.stringify(obj));
const dec = (b: Uint8Array): any => JSON.parse(new TextDecoder().decode(b));

/** N closed plain turns — long enough that the collapse gate accepts. */
function convo(n: number, chars = 3500): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < n; i++) {
    const body = `turn ${i}: ` + big(chars);
    out.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: body });
  }
  return out;
}

/** A Claude-Code-shaped request: big marked system slab + a long conversation. */
function ccBody(opts: { turns?: number; tools?: unknown[]; sysSuffix?: string } = {}) {
  return enc({
    model: 'claude-3-5-sonnet',
    system: [
      {
        type: 'text',
        text: big(80_000) + (opts.sysSuffix ?? ''),
        cache_control: { type: 'ephemeral' },
      },
    ],
    ...(opts.tools ? { tools: opts.tools } : {}),
    messages: convo(opts.turns ?? 15),
  });
}

/** Concatenated base64 of the image blocks on the synthetic history message. */
function historyImageData(out: Uint8Array): string {
  const body = dec(out);
  const synthetic = (body.messages ?? []).find(
    (m: any) => Array.isArray(m.content) && m.content[0]?.type === 'text' && m.content[0].text === HISTORY_SYNTHETIC_INTRO,
  );
  if (!synthetic) return '';
  return synthetic.content
    .filter((b: any) => b?.type === 'image')
    .map((b: any) => b.source.data)
    .join('');
}

/** Concatenated base64 of the image blocks on the FIRST message (the slab). */
function slabImageData(out: Uint8Array): string {
  const first = dec(out).messages?.[0];
  if (!first || !Array.isArray(first.content)) return '';
  return first.content
    .filter((b: any) => b?.type === 'image')
    .map((b: any) => b.source.data)
    .join('');
}

describe('cache-bust attribution telemetry', () => {
  it('history_image_sha8 tracks the history images, not the slab message at index 0', async () => {
    const { body: out, info } = await transformRequest(ccBody());
    // Precondition: this really is the Claude Code shape — a slab message ahead
    // of the synthetic history message, both carrying images.
    const slab = slabImageData(out);
    const history = historyImageData(out);
    expect(info.collapsedTurns).toBeGreaterThan(0);
    expect(slab.length).toBeGreaterThan(0);
    expect(history.length).toBeGreaterThan(0);
    expect(history).not.toBe(slab);

    // The reported hash must be a function of the HISTORY images. Prove it by
    // changing only the history (more collapsed turns) and requiring the hash
    // to move, while the slab bytes stay identical.
    const { body: out2, info: info2 } = await transformRequest(ccBody({ turns: 65 }));
    expect(slabImageData(out2)).toBe(slab); // slab unchanged …
    expect(historyImageData(out2)).not.toBe(history); // … history changed …
    expect(info2.historyImageSha).not.toBe(info.historyImageSha); // … so must the hash
  });

  it('digests the pinned prefix per layer (tools / system / head)', async () => {
    const { info } = await transformRequest(ccBody());
    expect(info.cachePrefixSha8).toBeDefined();
    expect(info.cachePrefixToolsSha8).toBeDefined();
    expect(info.cachePrefixSystemSha8).toBeDefined();
    expect(info.cachePrefixHeadSha8).toBeDefined();
  });

  it('moves ONLY the tools digest when the client adds a tool', async () => {
    const toolsA = [{ name: 'Read', description: 'Read a file. ' + big(400), input_schema: { type: 'object' } }];
    const toolsB = [
      ...toolsA,
      { name: 'Grep', description: 'Search. ' + big(400), input_schema: { type: 'object' } },
    ];
    const a = await transformRequest(ccBody({ tools: toolsA }));
    const b = await transformRequest(ccBody({ tools: toolsB }));
    expect(b.info.cachePrefixToolsSha8).not.toBe(a.info.cachePrefixToolsSha8);
    expect(b.info.cachePrefixSystemSha8).toBe(a.info.cachePrefixSystemSha8);
    expect(b.info.cachePrefixSha8).not.toBe(a.info.cachePrefixSha8);
  });

  it('digests the MARKED span (what Anthropic caches) and records the marker position', async () => {
    const { info } = await transformRequest(ccBody());
    expect(info.cachePrefixMarkedSha8).toBeDefined();
    expect(info.cachePrefixMarkerPos).toMatch(/^m\d+\.b\d+$/);
    // The marked span ends at the breakpoint, so it is a strict subset of the
    // boundary-scoped prefix (which runs to the end of the history message).
    expect(info.cachePrefixMarkedBytes!).toBeLessThanOrEqual(info.cachePrefixBytes!);
  });

  it('keeps the marked span byte-identical while the live tail grows', async () => {
    // The contract that decides whether cache_read happens: two consecutive
    // turns of one session must send the SAME bytes up to the breakpoint. The
    // newest freeze chunk re-renders by design, so a boundary-scoped digest may
    // legitimately move — the marked one may not.
    const a = await transformRequest(ccBody({ turns: 15 }));
    const b = await transformRequest(ccBody({ turns: 17 }));
    expect(b.info.collapsedTurns).toBe(a.info.collapsedTurns); // same collapse window
    expect(b.info.cachePrefixMarkerPos).toBe(a.info.cachePrefixMarkerPos);
    expect(b.info.cachePrefixMarkedSha8).toBe(a.info.cachePrefixMarkedSha8);
  });

  it('moves the system digest when volatile text rides inside the pinned span', async () => {
    // `# Environment` churns every turn (cwd, git status, model id). Whatever
    // survives as system TEXT is inside the pinned prefix and must show up as a
    // system-layer bust — that is the signal a live capture needs.
    const a = await transformRequest(ccBody({ sysSuffix: '\n# Environment\ngit status: clean\n' }));
    const b = await transformRequest(ccBody({ sysSuffix: '\n# Environment\ngit status: 3 files changed\n' }));
    expect(b.info.cachePrefixSystemSha8).not.toBe(a.info.cachePrefixSystemSha8);
    expect(b.info.cachePrefixToolsSha8).toBe(a.info.cachePrefixToolsSha8);
  });
});
