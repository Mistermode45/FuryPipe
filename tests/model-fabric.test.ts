import { afterEach, describe, expect, it } from 'vitest';

import {
  createModelFabricRegistry,
  normalizeAnthropicModelsPayload,
  normalizeGeminiModelsPayload,
  normalizeMistralModelsPayload,
  normalizeOpenAIModelsPayload,
  normalizeOpenRouterModelsPayload,
  normalizeXaiModelsPayload,
} from '../src/core/model-fabric.js';

afterEach(() => {
  delete process.env.FURYPIPE_MODELS;
});

describe('model fabric', () => {
  it('recognizes current Claude, OpenAI, Gemini and Grok vision families without a hard-coded per-model chip list', () => {
    const registry = createModelFabricRegistry();

    expect(registry.resolveVisual('claude-opus-5')).toMatchObject({
      provider: 'anthropic',
      imageInput: 'yes',
      mode: 'visual',
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
      mode: 'visual',
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
});
