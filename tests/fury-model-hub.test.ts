import { describe, expect, it } from 'vitest';

import { createModelFabricRegistry } from '../src/core/model-fabric.js';
import { createProviderRegistry } from '../src/core/provider-fabric.js';
import { buildFuryModelHubSnapshot } from '../src/fury-model-hub.js';

describe('Fury Model Hub', () => {
  it('keeps configured providers unverified until live availability is proven', () => {
    const providers = createProviderRegistry();
    const models = createModelFabricRegistry();
    models.upsert({
      provider: 'openai',
      id: 'gpt-test',
      displayName: 'GPT Test',
      aliases: [],
      lifecycle: 'active',
      modalities: {
        textInput: 'yes',
        imageInput: 'unknown',
        audioInput: 'unknown',
        videoInput: 'unknown',
        fileInput: 'unknown',
        textOutput: 'yes',
        imageOutput: 'unknown',
        audioOutput: 'unknown',
      },
      capabilities: {
        reasoning: 'unknown',
        tools: 'unknown',
        structuredOutput: 'unknown',
        streaming: 'yes',
      },
      limits: {},
      visual: { profile: 'unprofiled', policy: 'auto' },
      provenance: [{ kind: 'operator_override', source: 'test fixture' }],
    });

    const snapshot = buildFuryModelHubSnapshot({
      providers,
      models,
      connections: {
        format: 'furypipe-ai-connections/v1',
        connections: [
          {
            id: 'openai',
            displayName: 'OpenAI',
            state: 'credential-configured',
            configuredVia: ['OPENAI_API_KEY'],
            runtimes: [],
            accountVerification: 'not-probed',
          },
        ],
        policy: {
          browserSessions: 'not-inspected',
          credentialStores: 'not-inspected',
          secretValues: 'never-returned',
          accountStatus: 'official-cli-only',
        },
      },
    });

    expect(snapshot).toMatchObject({
      format: 'furypipe-model-hub/v1',
      authority: 'inspection-and-routing-only',
      executionAuthorized: false,
    });
    expect(snapshot.providers.find((provider) => provider.id === 'openai')).toMatchObject({
      state: 'CONFIGURED_UNVERIFIED',
      configuredVia: ['OPENAI_API_KEY'],
      executionAuthorized: false,
    });
    expect(snapshot.models).toContainEqual(expect.objectContaining({
      provider: 'openai',
      id: 'gpt-test',
      executionAuthorized: false,
    }));
  });

  it('does not convert runtime detection into provider availability', () => {
    const snapshot = buildFuryModelHubSnapshot({
      providers: createProviderRegistry(),
      models: createModelFabricRegistry(),
      connections: {
        format: 'furypipe-ai-connections/v1',
        connections: [
          {
            id: 'anthropic',
            displayName: 'Claude / Anthropic',
            state: 'runtime-detected',
            configuredVia: [],
            runtimes: [{ id: 'claude-code', displayName: 'Claude Code' }],
            accountVerification: 'not-probed',
          },
        ],
        policy: {
          browserSessions: 'not-inspected',
          credentialStores: 'not-inspected',
          secretValues: 'never-returned',
          accountStatus: 'official-cli-only',
        },
      },
    });

    expect(snapshot.providers.find((provider) => provider.id === 'anthropic')).toMatchObject({
      state: 'RUNTIME_DETECTED',
      availability: 'unknown',
      runtimes: ['claude-code'],
      executionAuthorized: false,
    });
  });
});
