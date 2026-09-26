import { describe, expect, it } from 'vitest';

import { createFuryCapabilityIndex } from '../src/capability-index.js';
import { projectModelsIntoCapabilityIndex } from '../src/capability-index-adapters.js';
import { selectFuryCapabilitiesForTask } from '../src/capability-autopilot.js';
import { createModelFabricRegistry } from '../src/core/model-fabric.js';
import {
  localModelCapabilityId,
  observeFuryLocalModelsInModelFabric,
} from '../src/fury-local-model-fabric.js';

describe('FuryLocal → Model Fabric bridge', () => {
  it('projects only reachable non-embedding models and keeps invocation permission separate', () => {
    const registry = createModelFabricRegistry();
    const health = observeFuryLocalModelsInModelFabric(registry, [
      {
        kind: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        reachable: true,
        protocols: ['native', 'openai-chat'],
        models: [
          { backend: 'ollama', baseUrl: 'http://127.0.0.1:11434', id: 'coder:latest', modality: 'text', contextLength: 32_768 },
          { backend: 'ollama', baseUrl: 'http://127.0.0.1:11434', id: 'embed:latest', modality: 'embeddings' },
        ],
      },
      {
        kind: 'lmstudio',
        baseUrl: 'http://127.0.0.1:1234',
        reachable: false,
        protocols: [],
        models: [{ backend: 'lmstudio', baseUrl: 'http://127.0.0.1:1234', id: 'stale-model' }],
      },
    ]);

    expect(registry.list().map((entry) => entry.id)).toEqual(['local:ollama:coder:latest']);
    const capabilityId = localModelCapabilityId('ollama', 'coder:latest');
    expect(health).toEqual({ [capabilityId]: 'ready' });

    const index = createFuryCapabilityIndex();
    projectModelsIntoCapabilityIndex(index, registry, health);
    const plan = selectFuryCapabilitiesForTask({
      objective: 'Use coder latest to review repository code',
      index,
      explicitRequests: [{ kind: 'model', id: capabilityId }],
      availablePermissions: [],
      options: { maxSelectedByKind: { model: 1 } },
    });

    expect(plan.selected).toEqual([]);
    expect(plan.blocked).toContainEqual(expect.objectContaining({
      kind: 'model',
      id: capabilityId,
      reason: 'missing-permission',
      requiredPermissions: ['provider-inference'],
      requestedExplicitly: true,
    }));
    expect(plan.executionAuthority).toBe(false);
  });
});
