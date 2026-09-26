import { createHash } from 'node:crypto';
import type { ModelFabricEntry, ModelFabricRegistry } from './core/model-fabric.js';
import type { FuryLocalBackendKind, FuryLocalBackendStatus, FuryLocalModel } from './fury-local-fabric.js';

const EMPTY_UNKNOWN_MODALITIES = Object.freeze({
  textInput: 'unknown' as const,
  imageInput: 'unknown' as const,
  audioInput: 'unknown' as const,
  videoInput: 'unknown' as const,
  fileInput: 'unknown' as const,
  textOutput: 'unknown' as const,
  imageOutput: 'unknown' as const,
  audioOutput: 'unknown' as const,
});

function modelFabricId(backend: FuryLocalBackendKind, id: string): string {
  const safe = /^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,179}$/u.test(id)
    ? id
    : `sha256-${createHash('sha256').update(id,'utf8').digest('hex')}`;
  return `local:${backend}:${safe}`;
}

export function localModelCapabilityId(
  backend: FuryLocalBackendKind,
  id: string,
): string {
  return `custom/${modelFabricId(backend, id)}`;
}

function modelEntry(
  backend: FuryLocalBackendStatus,
  model: FuryLocalModel,
): ModelFabricEntry {
  const modality = model.modality;
  const modalities = Object.freeze({
    ...EMPTY_UNKNOWN_MODALITIES,
    textInput: modality === 'embeddings' ? 'no' as const : 'yes' as const,
    imageInput: modality === 'vision' ? 'yes' as const : modality === 'text' ? 'no' as const : 'unknown' as const,
    textOutput: modality === 'embeddings' ? 'no' as const : 'yes' as const,
  });
  return Object.freeze({
    provider: 'custom' as const,
    id: modelFabricId(backend.kind, model.id),
    displayName: model.id,
    aliases: Object.freeze([]),
    lifecycle: 'active' as const,
    modalities,
    capabilities: Object.freeze({
      reasoning: 'unknown' as const,
      tools: 'unknown' as const,
      structuredOutput: 'unknown' as const,
      streaming: backend.protocols.length > 0 ? 'yes' as const : 'unknown' as const,
    }),
    limits: Object.freeze({
      ...(model.contextLength === undefined ? {} : { contextTokens: model.contextLength }),
    }),
    visual: Object.freeze({
      profile: modality === 'text' ? 'not_applicable' as const : 'unprofiled' as const,
      policy: 'auto' as const,
    }),
    provenance: Object.freeze([Object.freeze({
      kind: 'local_profile' as const,
      source: `FuryLocal ${backend.kind} discovery`,
    })]),
  });
}

/**
 * Project only currently reachable local inference models into Model Fabric.
 * Discovery proves availability metadata, not provider-invocation authority.
 */
export function observeFuryLocalModelsInModelFabric(
  registry: ModelFabricRegistry,
  backends: readonly FuryLocalBackendStatus[],
): Readonly<Record<string, 'ready'>> {
  const health: Record<string, 'ready'> = {};
  for (const backend of backends) {
    if (!backend.reachable) continue;
    for (const model of backend.models.slice(0, 512)) {
      if (model.modality === 'embeddings') continue;
      const entry = modelEntry(backend, model);
      registry.upsert(entry);
      health[localModelCapabilityId(backend.kind, model.id)] = 'ready';
    }
  }
  return Object.freeze(health);
}
