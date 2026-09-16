import { afterEach, describe, expect, it } from 'vitest';

import {
  createModelFabricRegistry,
  normalizeAnthropicModelsPayload,
  normalizeGeminiModelsPayload,
  normalizeMistralModelsPayload,
  normalizeOpenAIModelsPayload,
  normalizeOpenRouterModelsPayload,
  normalizeXaiModelsPayload,
  registerRuntimeModelCatalog,
  resetRuntimeModelFabricForTests,
} from '../src/core/model-fabric.js';
import {
  isFuryPipeSupportedModel,
  resolveFuryPipeModelEligibility,
} from '../src/core/applicability.js';

afterEach(() => {
  delete process.env.FURYPIPE_MODELS;
  delete process.env.FURYPIPE_VISUAL_POLICY;
  delete process.env.FURYPIPE_GPT_PROFILES;
  resetRuntimeModelFabricForTests();
});

describe('model fabric', () => {
  it('recognizes current Claude, OpenAI, Gemini and Grok vision families without a hard-coded per-model chip list', () => {
    const registry = createModelFabricRegistry();

    expect(registry.resolveVisual('claude-opus-5')).toMatchObject({
      provider: 'anthropic',
      imageInput: 'yes',
      profile: 'calibrated',
      mode: 'canary',
      reason: 'calibrated_profile',
    });
    expect(registry.resolveVisual('gpt-6-astra')).toMatchObject({
      provider: 'openai',
      imageInput: 'yes',
      mode: 'canary',
      reason: 'vision_unprofiled_canary',
    });
    expect(registry.resolveVisual('gemini-3.8-flash')).toMatchObject({
      provider: 'google',
      imageInput: 'yes',
      mode: 'visual',
    });
    expect(registry.resolveVisual('grok-4.6')).toMatchObject({
      provider: 'xai',
      imageInput: 'yes',
      profile: 'calibrated',
      mode: 'canary',
    });
  });

  it('normalizes xAI modality metadata and refuses a proven text-only model for visual compression', () => {
    const registry = createModelFabricRegistry();
    registry.upsertMany(normalizeXaiModelsPayload({
      models: [
        {
          id: 'grok-text-only-example',
          aliases: ['grok-text-latest'],
          input_modalities: ['text'],
          output_modalities: ['text'],
        },
      ],
    }, '2026-09-16T00:00:00.000Z'));

    expect(registry.resolveVisual('grok-text-latest')).toMatchObject({
      imageInput: 'no',
      mode: 'native',
      reason: 'text_only',
    });
  });

  it('keeps provider text-only evidence authoritative over weaker runtime family inference', () => {
    const registry = createModelFabricRegistry();
    registry.upsertMany(normalizeXaiModelsPayload({
      models: [{
        id: 'grok-4.6-text-only',
        input_modalities: ['text'],
        output_modalities: ['text'],
      }],
    }, '2026-09-16T00:00:00.000Z'));

    expect(registry.resolveVisual('grok-4.6-text-only')).toMatchObject({
      imageInput: 'no',
      profile: 'not_applicable',
      mode: 'native',
      reason: 'text_only',
    });

    // Runtime observation/name inference is weaker than provider metadata and
    // therefore cannot turn the explicit denial back into image support.
    registry.observe('grok-4.6-text-only', 'xai');
    expect(registry.resolveVisual('grok-4.6-text-only')).toMatchObject({
      imageInput: 'no',
      profile: 'not_applicable',
      mode: 'native',
      reason: 'text_only',
    });

    // A later provider refresh is authoritative and may update the fact.
    registry.upsertMany(normalizeXaiModelsPayload({
      models: [{
        id: 'grok-4.6-text-only',
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
      }],
    }, '2026-09-17T00:00:00.000Z'));
    expect(registry.resolveVisual('grok-4.6-text-only')).toMatchObject({
      imageInput: 'yes',
      profile: 'calibrated',
      mode: 'canary',
    });
  });

  it('does not let an older or same-time conflicting provider refresh override truth conservatively', () => {
    const registry = createModelFabricRegistry();
    registry.upsertMany(normalizeXaiModelsPayload({
      models: [{ id: 'grok-conflict', input_modalities: ['text', 'image'], output_modalities: ['text'] }],
    }, '2026-09-17T00:00:00.000Z'));

    registry.upsertMany(normalizeXaiModelsPayload({
      models: [{ id: 'grok-conflict', input_modalities: ['text'], output_modalities: ['text'] }],
    }, '2026-09-16T00:00:00.000Z'));
    expect(registry.resolveVisual('grok-conflict')).toMatchObject({ imageInput: 'yes' });

    registry.upsertMany(normalizeXaiModelsPayload({
      models: [{ id: 'grok-conflict', input_modalities: ['text'], output_modalities: ['text'] }],
    }, '2026-09-17T00:00:00.000Z'));
    expect(registry.resolveVisual('grok-conflict')).toMatchObject({
      imageInput: 'no',
      reason: 'text_only',
    });
  });

  it('rejects identity truncation and keeps a batch atomic on invalid input', () => {
    const registry = createModelFabricRegistry();
    const valid = normalizeXaiModelsPayload({
      models: [{ id: 'grok-valid', input_modalities: ['text', 'image'], output_modalities: ['text'] }],
    })[0]!;
    const invalid = { ...valid, id: 'x'.repeat(513) };

    expect(() => registry.upsertMany([valid, invalid])).toThrow(/entry id is invalid/u);
    expect(registry.list()).toEqual([]);
    expect(() => registry.observe('x'.repeat(513))).toThrow(/entry id is invalid/u);
  });

  it('rejects alias collisions instead of routing one alias to an arbitrary entry', () => {
    const registry = createModelFabricRegistry();
    const first = normalizeXaiModelsPayload({ models: [{ id: 'grok-first', aliases: ['shared-alias'] }] })[0]!;
    const second = normalizeXaiModelsPayload({ models: [{ id: 'grok-second', aliases: ['shared-alias'] }] })[0]!;
    registry.upsert(first);
    expect(() => registry.upsert(second)).toThrow(/alias collision/u);
    expect(registry.get('shared-alias')?.id).toBe('grok-first');
  });

  it('uses provider capability metadata instead of name guessing for Mistral', () => {
    const registry = createModelFabricRegistry();
    registry.upsertMany(normalizeMistralModelsPayload({
      data: [
        {
          id: 'mistral-future-vision',
          aliases: ['mistral-future-latest'],
          capabilities: { vision: true, function_calling: true },
          max_context_length: 1_000_000,
          archived: false,
        },
        {
          id: 'mistral-future-text',
          capabilities: { vision: false, function_calling: true },
          archived: false,
        },
      ],
    }));

    expect(registry.resolveVisual('mistral-future-latest')).toMatchObject({
      provider: 'mistral',
      imageInput: 'yes',
      mode: 'canary',
    });
    expect(registry.resolveVisual('mistral-future-text')).toMatchObject({
      imageInput: 'no',
      mode: 'native',
      reason: 'text_only',
    });
  });

  it('normalizes OpenRouter input modalities for arbitrary future providers', () => {
    const registry = createModelFabricRegistry();
    registry.upsertMany(normalizeOpenRouterModelsPayload({
      data: [
        {
          id: 'futurecorp/model-x',
          name: 'Model X',
          canonical_slug: 'futurecorp/model-x-2026',
          context_length: 524288,
          architecture: {
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
          },
        },
      ],
    }));

    expect(registry.resolveVisual('futurecorp/model-x-2026')).toMatchObject({
      provider: 'openrouter',
      imageInput: 'yes',
      mode: 'canary',
    });
  });

  it('normalizes Anthropic catalog metadata and preserves Claude vision-family evidence', () => {
    const models = normalizeAnthropicModelsPayload({
      data: [{
        id: 'claude-opus-5',
        display_name: 'Claude Opus 5',
        max_input_tokens: 1_000_000,
        max_tokens: 64_000,
        capabilities: { thinking: { supported: true } },
      }],
    }, '2026-09-16T00:00:00.000Z');

    expect(models[0]).toMatchObject({
      provider: 'anthropic',
      id: 'claude-opus-5',
      displayName: 'Claude Opus 5',
      modalities: { imageInput: 'yes' },
      capabilities: { reasoning: 'yes' },
      limits: { contextTokens: 1_000_000, outputTokens: 64_000 },
    });
  });

  it('normalizes Gemini and OpenAI catalog payloads without claiming unsupported metadata', () => {
    const gemini = normalizeGeminiModelsPayload({
      models: [{
        name: 'models/gemini-3.8-flash',
        baseModelId: 'gemini-3.8-flash',
        displayName: 'Gemini 3.8 Flash',
        inputTokenLimit: 1_048_576,
        outputTokenLimit: 65_536,
      }],
    });
    expect(gemini[0]).toMatchObject({
      provider: 'google',
      id: 'gemini-3.8-flash',
      limits: { contextTokens: 1_048_576, outputTokens: 65_536 },
    });

    const openai = normalizeOpenAIModelsPayload({ data: [{ id: 'gpt-6-astra', owned_by: 'openai' }] });
    expect(openai[0]).toMatchObject({
      provider: 'openai',
      id: 'gpt-6-astra',
      modalities: { imageInput: 'yes' },
    });
  });

  it('keeps a truly unknown model native until image capability is proven', () => {
    const registry = createModelFabricRegistry();
    expect(registry.resolveVisual('future-vendor/model-999')).toMatchObject({
      imageInput: 'unknown',
      mode: 'native',
      reason: 'unknown_capability',
    });
  });

  it('lets AUTO use calibrated readers but reserves unprofiled readers for MAX_SAVINGS', () => {
    expect(isFuryPipeSupportedModel('claude-fable-5')).toBe(true);
    expect(isFuryPipeSupportedModel('claude-opus-5')).toBe(true);
    expect(isFuryPipeSupportedModel('grok-4.6')).toBe(true);
    expect(resolveFuryPipeModelEligibility('gpt-6-astra')).toMatchObject({
      eligible: false,
      reason: 'visual_profile_unverified',
      pricingEvidence: 'unknown',
    });

    process.env.FURYPIPE_VISUAL_POLICY = 'safe_exact';
    expect(isFuryPipeSupportedModel('claude-fable-5')).toBe(true);
    expect(isFuryPipeSupportedModel('claude-opus-5')).toBe(false);
    expect(isFuryPipeSupportedModel('grok-4.6')).toBe(false);

    process.env.FURYPIPE_VISUAL_POLICY = 'max_savings';
    expect(isFuryPipeSupportedModel('claude-fable-5')).toBe(true);
    expect(isFuryPipeSupportedModel('claude-opus-5')).toBe(true);
    expect(resolveFuryPipeModelEligibility('gpt-6-astra')).toMatchObject({
      eligible: false,
      reason: 'visual_pricing_unknown',
      pricingEvidence: 'unknown',
    });
    expect(isFuryPipeSupportedModel('grok-4.6')).toBe(true);

    process.env.FURYPIPE_VISUAL_POLICY = 'text_only';
    expect(isFuryPipeSupportedModel('claude-fable-5')).toBe(false);
    expect(isFuryPipeSupportedModel('claude-opus-5')).toBe(false);
  });

  it('does not invent OpenAI image pricing for provider-discovered Mistral vision models', () => {
    registerRuntimeModelCatalog(normalizeMistralModelsPayload({
      data: [
        { id: 'mistral-future-vision', capabilities: { vision: true } },
        { id: 'mistral-future-text', capabilities: { vision: false } },
      ],
    }, '2026-09-16T00:00:00.000Z'));

    process.env.FURYPIPE_VISUAL_POLICY = 'max_savings';

    expect(resolveFuryPipeModelEligibility('mistral-future-vision')).toMatchObject({
      eligible: false,
      reason: 'visual_pricing_unknown',
      pricingEvidence: 'unknown',
    });
    expect(isFuryPipeSupportedModel('mistral-future-text')).toBe(false);

    // An operator can provide an explicit provider-appropriate profile without
    // waiting for a FuryPipe release. That is evidence distinct from discovery.
    process.env.FURYPIPE_GPT_PROFILES = JSON.stringify({
      'mistral-future-vision': {
        vision: { regime: 'mpix', tokensPerMegapixel: 900 },
        stripCols: 100,
      },
    });
    expect(resolveFuryPipeModelEligibility('mistral-future-vision')).toMatchObject({
      eligible: true,
      reason: 'eligible',
      pricingEvidence: 'operator_profile',
    });
  });

  it('keeps arbitrary OpenRouter multimodal catalog entries native until pricing is known', () => {
    registerRuntimeModelCatalog(normalizeOpenRouterModelsPayload({
      data: [{
        id: 'futurecorp/model-x',
        canonical_slug: 'futurecorp/model-x-2026',
        architecture: {
          input_modalities: ['text', 'image'],
          output_modalities: ['text'],
        },
      }],
    }));

    process.env.FURYPIPE_VISUAL_POLICY = 'max_savings';
    expect(resolveFuryPipeModelEligibility('futurecorp/model-x-2026')).toMatchObject({
      eligible: false,
      reason: 'visual_pricing_unknown',
      pricingEvidence: 'unknown',
    });
  });

  it('keeps known-family pricing evidence through provider-qualified model ids', () => {
    registerRuntimeModelCatalog(normalizeOpenRouterModelsPayload({
      data: [{
        id: 'anthropic/claude-opus-5',
        architecture: {
          input_modalities: ['text', 'image'],
          output_modalities: ['text'],
        },
      }],
    }));
    process.env.FURYPIPE_VISUAL_POLICY = 'max_savings';

    expect(resolveFuryPipeModelEligibility('anthropic/claude-opus-5')).toMatchObject({
      eligible: true,
      pricingEvidence: 'provider_profile',
    });
    expect(resolveFuryPipeModelEligibility('gpt-6-astra')).toMatchObject({
      eligible: false,
      reason: 'visual_pricing_unknown',
      pricingEvidence: 'unknown',
    });
    process.env.FURYPIPE_GPT_PROFILES = JSON.stringify({
      'gpt-6-astra': {
        vision: { regime: 'patch', multiplier: 1 },
        stripCols: 84,
      },
    });
    expect(resolveFuryPipeModelEligibility('gpt-6-astra')).toMatchObject({
      eligible: true,
      pricingEvidence: 'operator_profile',
    });
    expect(resolveFuryPipeModelEligibility('grok-4.6')).toMatchObject({
      eligible: true,
      pricingEvidence: 'provider_profile',
    });
  });
  it('does not route non-generative Gemini catalog entries into visual compression', () => {
    const registry = createModelFabricRegistry();
    registry.upsertMany(normalizeGeminiModelsPayload({
      models: [
        {
          name: 'models/gemini-embedding-future',
          baseModelId: 'gemini-embedding-future',
          displayName: 'Gemini Embedding Future',
          supportedGenerationMethods: ['embedContent'],
        },
        {
          name: 'models/gemini-3.8-flash',
          baseModelId: 'gemini-3.8-flash',
          displayName: 'Gemini 3.8 Flash',
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
      ],
    }));

    expect(registry.resolveVisual('gemini-embedding-future')).toMatchObject({
      imageInput: 'no',
      mode: 'native',
      reason: 'text_only',
    });
    expect(registry.resolveVisual('gemini-3.8-flash')).toMatchObject({
      imageInput: 'yes',
    });
  });

  it('does not mistake OpenAI embedding, audio or image-generation IDs for chat vision readers', () => {
    const registry = createModelFabricRegistry();
    registry.upsertMany(normalizeOpenAIModelsPayload({
      data: [
        { id: 'text-embedding-4-large' },
        { id: 'gpt-image-2' },
        { id: 'gpt-realtime-2.1' },
        { id: 'gpt-6-astra' },
      ],
    }));

    for (const id of ['text-embedding-4-large', 'gpt-image-2', 'gpt-realtime-2.1']) {
      expect(registry.resolveVisual(id)).toMatchObject({
        imageInput: 'no',
        mode: 'native',
        reason: 'text_only',
      });
    }
    expect(registry.resolveVisual('gpt-6-astra')).toMatchObject({
      imageInput: 'yes',
    });
  });

});
