import type { ModelFabricEntry, ModelFabricRegistry } from './core/model-fabric.js';
import type { ProviderDefinition, ProviderRegistry } from './core/provider-fabric.js';
import type { FuryAiConnections } from './fury-ai-connections.js';

export const FURY_MODEL_HUB_FORMAT = 'furypipe-model-hub/v1' as const;

export type FuryModelHubProviderState =
  | 'AVAILABLE_VERIFIED'
  | 'CONFIGURED_UNVERIFIED'
  | 'RUNTIME_DETECTED'
  | 'NOT_CONFIGURED'
  | 'UNKNOWN';

export interface FuryModelHubProvider {
  readonly id: string;
  readonly protocol: string;
  readonly displayName: string;
  readonly state: FuryModelHubProviderState;
  readonly registration: ProviderDefinition['status'];
  readonly availability: ProviderDefinition['availability'];
  readonly configuredVia: readonly string[];
  readonly runtimes: readonly string[];
  readonly evidence: readonly string[];
  readonly executionAuthorized: false;
}

export interface FuryModelHubModel {
  readonly provider: ModelFabricEntry['provider'];
  readonly id: string;
  readonly displayName: string;
  readonly lifecycle: ModelFabricEntry['lifecycle'];
  readonly modalities: ModelFabricEntry['modalities'];
  readonly capabilities: ModelFabricEntry['capabilities'];
  readonly limits: ModelFabricEntry['limits'];
  readonly pricing?: ModelFabricEntry['pricing'];
  readonly provenance: ModelFabricEntry['provenance'];
  readonly executionAuthorized: false;
}

export interface FuryModelHubSnapshot {
  readonly format: typeof FURY_MODEL_HUB_FORMAT;
  readonly providers: readonly FuryModelHubProvider[];
  readonly models: readonly FuryModelHubModel[];
  readonly authority: 'inspection-and-routing-only';
  readonly executionAuthorized: false;
}

function providerState(
  provider: ProviderDefinition,
  connection: FuryAiConnections['connections'][number] | undefined,
): FuryModelHubProviderState {
  if (provider.availability === 'available' && connection?.accountVerification === 'authenticated') {
    return 'AVAILABLE_VERIFIED';
  }
  if (connection?.state === 'authenticated' || connection?.state === 'credential-configured') {
    return 'CONFIGURED_UNVERIFIED';
  }
  if (connection?.state === 'runtime-detected') return 'RUNTIME_DETECTED';
  if (connection?.state === 'not-detected') return 'NOT_CONFIGURED';
  return provider.availability === 'unknown' ? 'UNKNOWN' : 'NOT_CONFIGURED';
}

export function buildFuryModelHubSnapshot(input: {
  readonly providers: ProviderRegistry;
  readonly models: ModelFabricRegistry;
  readonly connections: FuryAiConnections;
}): FuryModelHubSnapshot {
  const byConnection = new Map(input.connections.connections.map((connection) => [connection.id, connection] as const));
  const providers = input.providers.list()
    .map((provider): FuryModelHubProvider => {
      const connection = byConnection.get(provider.id);
      return Object.freeze({
        id: provider.id,
        protocol: provider.protocol,
        displayName: connection?.displayName ?? provider.id,
        state: providerState(provider, connection),
        registration: provider.status,
        availability: provider.availability,
        configuredVia: Object.freeze([...(connection?.configuredVia ?? [])]),
        runtimes: Object.freeze((connection?.runtimes ?? []).map((runtime) => runtime.id)),
        evidence: Object.freeze(provider.evidence.map((entry) => entry.source)),
        executionAuthorized: false,
      });
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const models = input.models.list()
    .map((model): FuryModelHubModel => Object.freeze({
      provider: model.provider,
      id: model.id,
      displayName: model.displayName,
      lifecycle: model.lifecycle,
      modalities: model.modalities,
      capabilities: model.capabilities,
      limits: model.limits,
      ...(model.pricing === undefined ? {} : { pricing: model.pricing }),
      provenance: model.provenance,
      executionAuthorized: false,
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));

  return Object.freeze({
    format: FURY_MODEL_HUB_FORMAT,
    providers: Object.freeze(providers),
    models: Object.freeze(models),
    authority: 'inspection-and-routing-only',
    executionAuthorized: false,
  });
}
