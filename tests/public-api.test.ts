import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCountTokensBodies,
  getAllowedModelBases,
  isFuryPipeSupportedGptModel,
  isFuryPipeSupportedModel,
  setAllowedModelBases,
  shouldTransformAnthropicMessages,
  transformAnthropicMessages,
  transformOpenAIChatCompletions,
} from '../src/core/index.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

// Tests below assert DEFAULT model-scope behavior, which assumes FURYPIPE_MODELS is unset.
// Snapshot and clear any ambient value (e.g. a dev shell that still exports FURYPIPE_MODELS)
// before each test so the suite is deterministic regardless of the environment it runs in,
// then restore the original afterward. The per-test override cases still work: they see an
// unset var, set their own value, and clean up.
let ambientFuryPipeModels: string | undefined;
beforeEach(() => {
  ambientFuryPipeModels = process.env.FURYPIPE_MODELS;
  delete process.env.FURYPIPE_MODELS;
});
afterEach(() => {
  if (ambientFuryPipeModels === undefined) delete process.env.FURYPIPE_MODELS;
  else process.env.FURYPIPE_MODELS = ambientFuryPipeModels;
});

describe('public library API', () => {
  it('AUTO recognizes verified/calibrated readers without treating arbitrary names as proof', () => {
    expect(isFuryPipeSupportedModel('claude-fable-5')).toBe(true);
    expect(isFuryPipeSupportedModel('claude-fable-5-high')).toBe(true);
    expect(isFuryPipeSupportedModel('google/gemini-3.6-flash')).toBe(true);
    expect(isFuryPipeSupportedModel('google/gemini-3.7-flash')).toBe(true);
    expect(isFuryPipeSupportedModel('gemini-3.6-flash-preview')).toBe(false);
    expect(isFuryPipeSupportedModel('gemini-3.7-flash-preview')).toBe(false);
    // Gateway prefixes do not change the measured reader identity.
    expect(isFuryPipeSupportedModel('untrusted/google/gemini-3.6-flash')).toBe(true);
    expect(isFuryPipeSupportedModel('untrusted/google/gemini-3.7-flash')).toBe(true);

    // Measured Claude reader profiles are calibrated and therefore participate
    // in AUTO. SAFE_EXACT remains available when only quality-verified readers
    // are acceptable.
    expect(isFuryPipeSupportedModel('claude-opus-5')).toBe(true);
    expect(isFuryPipeSupportedModel('claude-opus-4-8')).toBe(true);
    expect(isFuryPipeSupportedModel('claude-opus-4-7')).toBe(true);
    expect(isFuryPipeSupportedModel('claude-opus-4-6')).toBe(true);
    expect(isFuryPipeSupportedModel('claude-sonnet-4-7')).toBe(true);

    // A Claude-looking but unknown product family is not capability evidence.
    expect(isFuryPipeSupportedModel('claude-mythos-5')).toBe(false);
    expect(isFuryPipeSupportedModel('claude-fable-50')).toBe(false);
    expect(isFuryPipeSupportedModel(null)).toBe(false);
  });

  it('strips bracketed variant tags like [1m] before matching', () => {
    expect(isFuryPipeSupportedModel('claude-fable-5[1m]')).toBe(true);
    expect(isFuryPipeSupportedModel('claude-fable-5-high[1m]')).toBe(true);
    expect(isFuryPipeSupportedModel('claude-opus-5[1m]')).toBe(true);
    expect(isFuryPipeSupportedModel('claude-opus-4-8[1m]')).toBe(true);
    expect(isFuryPipeSupportedModel('claude-opus-4-7[1m]')).toBe(true);
    // Bracket stripping cannot turn an invented family into proven capability.
    expect(isFuryPipeSupportedModel('claude-mythos-5[1m]')).toBe(false);
  });

  it('honors FURYPIPE_MODELS to override the default scope', () => {
    const prev = process.env.FURYPIPE_MODELS;
    try {
      // narrow to Fable only
      process.env.FURYPIPE_MODELS = 'claude-fable-5';
      expect(isFuryPipeSupportedModel('claude-fable-5')).toBe(true);
      expect(isFuryPipeSupportedModel('claude-opus-4-8')).toBe(false);
      // re-point to a different set
      process.env.FURYPIPE_MODELS = 'claude-fable-5,claude-opus-4-7';
      expect(isFuryPipeSupportedModel('claude-opus-4-7')).toBe(true);
      expect(isFuryPipeSupportedModel('claude-opus-4-8')).toBe(false); // not in this set
    } finally {
      if (prev === undefined) delete process.env.FURYPIPE_MODELS;
      else process.env.FURYPIPE_MODELS = prev;
    }
  });

  it('honors the dashboard runtime override (setAllowedModelBases) over env/default', () => {
    try {
      // override takes precedence over the env/default scope
      setAllowedModelBases(['claude-fable-5', 'claude-opus-4-8']);
      expect(getAllowedModelBases()).toEqual(['claude-fable-5', 'claude-opus-4-8']);
      expect(isFuryPipeSupportedModel('claude-opus-4-8')).toBe(true); // opted in at runtime
      // empty list = compress nothing
      setAllowedModelBases([]);
      expect(isFuryPipeSupportedModel('claude-fable-5')).toBe(false);
      // null clears the explicit override → back to automatic Model Fabric policy.
      setAllowedModelBases(null);
      expect(isFuryPipeSupportedModel('claude-fable-5')).toBe(true);
      expect(isFuryPipeSupportedGptModel('gpt-5.6-sol')).toBe(true);
      expect(isFuryPipeSupportedGptModel('grok-4.5')).toBe(false);
      expect(isFuryPipeSupportedModel('claude-opus-4-8')).toBe(true);
    } finally {
      setAllowedModelBases(null); // never leak the override into other tests
    }
  });

  it('AUTO admits calibrated GPT 5.6 Sol aliases while unprofiled siblings remain native', () => {
    expect(isFuryPipeSupportedGptModel('gpt-5')).toBe(false);
    expect(isFuryPipeSupportedGptModel('gpt-5.5')).toBe(false);
    expect(isFuryPipeSupportedGptModel('gpt-5.5-codex')).toBe(false);
    expect(isFuryPipeSupportedGptModel('gpt-5.6')).toBe(false);
    expect(isFuryPipeSupportedGptModel('gpt-5.6-sol')).toBe(true);
    expect(isFuryPipeSupportedGptModel('gpt-5.6-sol-codex')).toBe(true);
    expect(isFuryPipeSupportedGptModel('gpt-5.6-terra')).toBe(false);
    expect(isFuryPipeSupportedGptModel('gpt-5-mini')).toBe(false);
    expect(isFuryPipeSupportedGptModel('gpt-4o')).toBe(false);

    process.env.FURYPIPE_MODELS = 'gpt-5.6-sol';
    expect(isFuryPipeSupportedGptModel('gpt-5.6-sol')).toBe(true);
    expect(isFuryPipeSupportedGptModel('gpt-5.6-sol-codex')).toBe(true);
    expect(isFuryPipeSupportedGptModel('gpt-5.6-sol[1m]')).toBe(true);
    expect(isFuryPipeSupportedGptModel('gpt-5.6-sol-codex[1m]')).toBe(true);
    expect(isFuryPipeSupportedGptModel('gpt-5.6')).toBe(false);
    expect(isFuryPipeSupportedGptModel('gpt-5.6-terra')).toBe(false);
  });

  it('AUTO admits Grok 4.6 only where both vision capability and calibrated pricing are known', () => {
    const prev = process.env.FURYPIPE_MODELS;
    try {
      delete process.env.FURYPIPE_MODELS;
      expect(isFuryPipeSupportedGptModel('grok-4.5')).toBe(false);
      expect(isFuryPipeSupportedGptModel('grok-4.6')).toBe(true);
      expect(isFuryPipeSupportedGptModel('grok-4')).toBe(false);
      expect(isFuryPipeSupportedGptModel('grok-4.20')).toBe(false);
      // The compatibility seed is not the dynamic model catalog.
      expect(getAllowedModelBases()).toEqual(['claude-fable-5', 'gemini']);

      process.env.FURYPIPE_MODELS = 'claude-fable-5,gpt-5.6-sol,grok-4.6';
      expect(isFuryPipeSupportedGptModel('grok-4.6')).toBe(true);
      expect(isFuryPipeSupportedGptModel('grok-4.6-fast')).toBe(true); // -suffix alias
      expect(isFuryPipeSupportedGptModel('grok-4.5')).toBe(false);
      expect(isFuryPipeSupportedGptModel('gpt-5.6-sol')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.FURYPIPE_MODELS;
      else process.env.FURYPIPE_MODELS = prev;
    }
  });

  it('honors the single FURYPIPE_MODELS scope for GPT families', () => {
    const prev = process.env.FURYPIPE_MODELS;
    try {
      // Explicit Claude-only scope disables GPT imaging.
      process.env.FURYPIPE_MODELS = 'claude-fable-5';
      expect(isFuryPipeSupportedGptModel('gpt-5.5')).toBe(false);
      expect(isFuryPipeSupportedGptModel('gpt-5.6-sol')).toBe(false);

      // Mixed CSV selects exactly those bases across families.
      process.env.FURYPIPE_MODELS = 'claude-fable-5,gpt-5.6-sol';
      expect(isFuryPipeSupportedGptModel('gpt-5.5')).toBe(false);
      expect(isFuryPipeSupportedGptModel('gpt-5.6-sol')).toBe(true);
      expect(isFuryPipeSupportedModel('claude-fable-5')).toBe(true);

      // `off` disables everything.
      process.env.FURYPIPE_MODELS = 'off';
      expect(isFuryPipeSupportedGptModel('gpt-5.6-sol')).toBe(false);
      expect(isFuryPipeSupportedModel('claude-fable-5')).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.FURYPIPE_MODELS;
      else process.env.FURYPIPE_MODELS = prev;
    }
  });

  it('reports applicability with route/method/body gates', () => {
    expect(shouldTransformAnthropicMessages({
      model: 'claude-fable-5',
      method: 'POST',
      path: '/v1/messages',
      bodyBytes: 10,
    })).toEqual({ eligible: true, reason: 'eligible' });
    expect(shouldTransformAnthropicMessages({
      model: 'claude-fable-5',
      method: 'GET',
      path: '/v1/messages',
      bodyBytes: 10,
    }).reason).toBe('unsupported_method');
    // Provider-prefixed routes createProxy() also transforms must be eligible
    // here too — the old endsWith('/v1/messages') check rejected /anthropic/messages.
    for (const path of ['/anthropic/v1/messages', '/anthropic/messages']) {
      expect(shouldTransformAnthropicMessages({
        model: 'claude-fable-5',
        method: 'POST',
        path,
        bodyBytes: 10,
      })).toEqual({ eligible: true, reason: 'eligible' });
    }
    expect(shouldTransformAnthropicMessages({
      model: 'claude-fable-5',
      method: 'POST',
      path: '/v1/messages/count_tokens',
      bodyBytes: 10,
    }).reason).toBe('unsupported_path');
  });

  it('builds count_tokens probe bodies from a messages body', () => {
    const body = enc.encode(JSON.stringify({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      stream: true,
      system: [{ type: 'text', text: 'sys' }],
      tools: [{ name: 't', description: 'd', input_schema: { type: 'object' } }],
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'cached', cache_control: { type: 'ephemeral', ttl: '1h' } },
            { type: 'text', text: 'tail' },
          ],
        },
      ],
    }));

    const probes = buildCountTokensBodies(body);
    expect(probes.fullBody).toBeInstanceOf(Uint8Array);
    const full = JSON.parse(dec.decode(probes.fullBody!)) as Record<string, unknown>;
    expect(full.model).toBe('claude-opus-4-7');
    expect(full.max_tokens).toBeUndefined();
    expect(full.stream).toBeUndefined();
    expect(Array.isArray(full.messages)).toBe(true);

    expect(probes.cacheablePrefixBody).toBeInstanceOf(Uint8Array);
    const prefix = JSON.parse(dec.decode(probes.cacheablePrefixBody!)) as { messages: Array<{ content: unknown }> };
    const last = prefix.messages.at(-1)!;
    expect(Array.isArray(last.content)).toBe(true);
    expect((last.content as unknown[])).toHaveLength(1);
  });

  it('cacheable-prefix probe body pairs orphan tool_use blocks with synthetic tool_result', () => {
    const body = enc.encode(JSON.stringify({
      model: 'claude-opus-4-7',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'thinking' },
            { type: 'tool_use', id: 'toolu_orphan_a', name: 'read', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_orphan_a', content: 'result' },
            { type: 'text', text: 'next turn please', cache_control: { type: 'ephemeral' } },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_orphan_b', name: 'read', input: {} },
          ],
        },
        // tool_result for toolu_orphan_b would be in the dropped tail
      ],
    }));

    const probes = buildCountTokensBodies(body);
    expect(probes.cacheablePrefixBody).toBeInstanceOf(Uint8Array);
    const prefix = JSON.parse(dec.decode(probes.cacheablePrefixBody!)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    // Truncation kept up to and including the cache_control-bearing block,
    // which sits in messages[2]. The cached-prefix should NOT include msg[3]
    // (the orphan tool_use), but if it did, the synthetic tool_result must
    // pair it. Either way: no orphan tool_use ids may remain unpaired.
    const allBlocks = prefix.messages.flatMap((m) =>
      Array.isArray(m.content) ? (m.content as Array<{ type?: string }>) : [],
    );
    const orphanUses = allBlocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => (b as { id?: string }).id);
    const results = new Set(
      allBlocks
        .filter((b) => b.type === 'tool_result')
        .map((b) => (b as { tool_use_id?: string }).tool_use_id),
    );
    for (const id of orphanUses) {
      expect(results.has(id)).toBe(true);
    }
  });

  it('wraps the transformer with model gating and cache ownership metadata', async () => {
    const unsupported = enc.encode(JSON.stringify({
      model: 'claude-mythos-5',
      system: 'x'.repeat(20_000),
      messages: [{ role: 'user', content: 'hello' }],
    }));
    const skipped = await transformAnthropicMessages({ body: unsupported, model: 'claude-mythos-5' });
    expect(skipped.applied).toBe(false);
    expect(skipped.reason).toBe('vision_capability_unknown');
    expect(skipped.body).toBe(unsupported);

    const supported = enc.encode(JSON.stringify({
      model: 'claude-fable-5',
      system: 'Important system instruction. '.repeat(1200),
      tools: [{
        name: 'read_file',
        description: 'Read a file from disk. '.repeat(200),
        input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      }],
      messages: [{ role: 'user', content: 'hello' }],
    }));
    const transformed = await transformAnthropicMessages({ body: supported, model: 'claude-fable-5' });
    expect(transformed.applied).toBe(true);
    expect(transformed.reason).toBe('applied');
    expect(transformed.info.compressedChars).toBeGreaterThan(0);
    expect(transformed.info.imageCount).toBeGreaterThan(0);
    // Task #21: FuryPipe never adds its own cache_control markers.
    // The caller sent zero markers, so the rewritten body also has zero.
    expect(transformed.cache.ownsCacheControl).toBe(false);
    expect(transformed.cache.markerCount).toBe(0);
  });

  it('applies the Claude profile to direct Anthropic Messages rendering', async () => {
    process.env.FURYPIPE_MODELS = 'claude-fable-5,claude-opus-4-8';
    const body = enc.encode(JSON.stringify({
      model: 'claude-opus-4-8',
      system: Array.from({ length: 1800 }, (_, i) => `setting_${i}=value_${i * 7919}`).join('\n'),
      messages: [{ role: 'user', content: 'continue' }],
    }));
    const transformed = await transformAnthropicMessages({
      body,
      model: 'claude-opus-4-8',
      options: { charsPerToken: 1, minCompressChars: 1, cols: undefined },
    });
    expect(transformed.applied).toBe(true);
    expect(transformed.info.firstImageWidth).toBeLessThanOrEqual(1568);
    expect(transformed.info.firstImageHeight).toBeLessThanOrEqual(728);
  });

  it('preserves the exact Claude Code OAuth identity as the first system block', async () => {
    const identity = "You are Claude Code, Anthropic's official CLI for Claude.";
    const body = enc.encode(JSON.stringify({
      model: 'claude-fable-5',
      system: [
        { type: 'text', text: identity },
        {
          type: 'text',
          text: 'Detailed Claude Code operating instructions. '.repeat(1200),
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [{
        name: 'read_file',
        description: 'Read a file from disk. '.repeat(200),
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      }],
      messages: [{ role: 'user', content: 'hello' }],
    }));

    const transformed = await transformAnthropicMessages({ body, model: 'claude-fable-5' });
    expect(transformed.applied).toBe(true);
    expect(transformed.info.imageCount).toBeGreaterThan(0);

    const out = JSON.parse(dec.decode(transformed.body)) as {
      system?: Array<{ type: string; text?: string; cache_control?: unknown }>;
    };
    expect(out.system?.[0]).toEqual({ type: 'text', text: identity });
    expect(out.system?.[0]?.cache_control).toBeUndefined();
    expect(transformed.info.imageSourceText).not.toContain(identity);
  });

  it('transforms GPT 5.5 chat completions using OpenAI image_url blocks', async () => {
    const body = enc.encode(JSON.stringify({
      model: 'gpt-5.5',
      messages: [
        { role: 'system', content: 'System instruction. '.repeat(700) },
        { role: 'developer', content: 'Developer instruction. '.repeat(400) },
        { role: 'user', content: 'hello' },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file from disk. '.repeat(100),
          parameters: {
            type: 'object',
            description: 'Long root description.',
            properties: {
              path: { type: 'string', description: 'Path to read.' },
            },
            required: ['path'],
          },
        },
      }],
    }));

    const transformed = await transformOpenAIChatCompletions(body, {
      charsPerToken: 1,
      minCompressChars: 1,
    });
    expect(transformed.info.compressed).toBe(true);
    expect(transformed.info.imageCount).toBeGreaterThan(0);
    const out = JSON.parse(dec.decode(transformed.body)) as any;
    const firstUser = out.messages.find((m: any) => m.role === 'user');
    expect(Array.isArray(firstUser.content)).toBe(true);
    expect(firstUser.content[0].type).toBe('image_url');
    expect(firstUser.content[0].image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(out.messages[0].content).toContain('rendered into image');
    expect(out.tools[0].function.description).toBe('Full docs: see "## Tool: read_file" in the rendered context image.');
    expect(out.tools[0].function.parameters.description).toBeUndefined();
    expect(out.tools[0].function.parameters.properties.path.description).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('cache_control');
  });
});
