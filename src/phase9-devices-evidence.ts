import { createHash } from 'node:crypto';

import {
  FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
  isGeneratedFuryCapabilityIndex,
  type FuryCapabilityIndex,
  type FuryCapabilityIndexEntryInput,
  type FuryCapabilityIndexRecord,
  type FuryCapabilityIndexRiskClass,
} from './capability-index.js';
import {
  isGeneratedFuryGatewayNodeDescriptor,
  isGeneratedFuryGatewayNodeRegistry,
  type FuryGatewayNodeDescriptor,
  type FuryGatewayNodeRegistry,
} from './gateway-node-registry-node.js';
import {
  isGeneratedFuryGatewayNodeSessionCoordinator,
  type FuryGatewayNodeSessionCoordinator,
} from './gateway-node-session-node.js';
import {
  isGeneratedFuryDeviceCaptureRequest,
  isGeneratedFuryDeviceCaptureResult,
  type FuryDeviceCaptureRequest,
  type FuryDeviceCaptureResult,
} from './media-device-capture.js';
import {
  isGeneratedFuryRealtimeVoiceCoordinator,
  isGeneratedFuryRealtimeVoiceLease,
  type FuryRealtimeVoiceCoordinator,
  type FuryRealtimeVoiceLease,
} from './media-realtime-voice.js';
import {
  isGeneratedFuryVoiceOperationResult,
  type FurySttResult,
  type FuryTtsResult,
} from './media-voice-operations.js';

export const FURY_PHASE9_DEVICE_PROJECTION_FORMAT = 'furypipe-phase9-device-capability-projection/v1' as const;
export const FURY_PHASE9_DEVICES_EVIDENCE_FORMAT = 'furypipe-phase9-devices-evidence/v1' as const;

const PHASE9_CAPABILITIES = Object.freeze([
  'camera', 'microphone', 'speaker', 'notifications',
  'media.image.input', 'media.audio.input', 'media.video.input', 'media.document.input',
  'voice.stt', 'voice.tts', 'voice.realtime',
] as const);
export type FuryPhase9IndexedDeviceCapability = (typeof PHASE9_CAPABILITIES)[number];

export interface FuryPhase9DeviceProjectionInput {
  readonly index: FuryCapabilityIndex;
  readonly nodeRegistry: FuryGatewayNodeRegistry;
  readonly nodeSessionCoordinator: FuryGatewayNodeSessionCoordinator;
  readonly nodes: readonly FuryGatewayNodeDescriptor[];
}

export interface FuryPhase9DeviceProjectionReport {
  readonly format: typeof FURY_PHASE9_DEVICE_PROJECTION_FORMAT;
  readonly indexed: number;
  readonly skippedNodes: number;
  readonly skippedCapabilities: number;
  readonly removed: number;
  readonly indexDigestSha256: string;
  readonly authority: 'projection-only';
  readonly executionAuthority: false;
  readonly activationAuthority: false;
  readonly connectionAuthority: false;
}

export interface FuryPhase9RealtimeEvidenceInput {
  readonly coordinator: FuryRealtimeVoiceCoordinator;
  readonly lease: FuryRealtimeVoiceLease;
}
export interface FuryPhase9CaptureEvidenceInput {
  readonly request: FuryDeviceCaptureRequest;
  readonly result: FuryDeviceCaptureResult;
}
export type FuryPhase9VoiceResult = FurySttResult | FuryTtsResult;

export interface FuryPhase9DevicesEvidenceInput {
  readonly index: FuryCapabilityIndex;
  readonly nodeRegistry: FuryGatewayNodeRegistry;
  readonly nodeSessionCoordinator: FuryGatewayNodeSessionCoordinator;
  readonly nodes: readonly FuryGatewayNodeDescriptor[];
  readonly realtime?: readonly FuryPhase9RealtimeEvidenceInput[];
  readonly captures?: readonly FuryPhase9CaptureEvidenceInput[];
  readonly voiceResults?: readonly FuryPhase9VoiceResult[];
  readonly maxNodes?: number;
  readonly maxActivities?: number;
}

export interface FuryPhase9DeviceObservation {
  readonly registrationIdSha256: string;
  readonly deviceIdSha256: string;
  readonly pairingIdSha256: string;
  readonly clientIdSha256: string;
  readonly platform?: string;
  readonly deviceFamily?: string;
  readonly registeredAt: number;
  readonly connected: boolean;
  readonly sessionIdSha256?: string;
  readonly livenessEpochSha256?: string;
  readonly liveUntil?: number;
  readonly capabilityGeneration?: number;
  readonly capabilitiesDigestSha256?: string;
  readonly capabilities: readonly FuryPhase9IndexedDeviceCapability[];
  readonly authority: 'devices-observation-only';
  readonly executionAuthority: false;
}

export interface FuryPhase9ActivityObservation {
  readonly kind: 'realtime-voice' | 'device-capture' | 'voice-operation';
  readonly status: string;
  readonly bundleId?: string;
  readonly bundleVersion?: string;
  readonly profileId?: string;
  readonly requestDigestSha256: string;
  readonly registrationIdSha256?: string;
  readonly evidenceDigestSha256: string;
  readonly operation?: 'stt' | 'tts';
  readonly deviceCaptureKind?: 'camera' | 'microphone';
  readonly unknownOutcome: boolean;
  readonly retrySafe: false;
  readonly automaticReplayAllowed: false;
  readonly executionAuthority: false;
  readonly authority: 'devices-observation-only';
}

export interface FuryPhase9DevicesEvidenceSnapshot {
  readonly format: typeof FURY_PHASE9_DEVICES_EVIDENCE_FORMAT;
  readonly observedAt: number;
  readonly indexDigestSha256: string;
  readonly nodeCount: number;
  readonly connectedNodeCount: number;
  readonly activityCount: number;
  readonly unknownOutcomeCount: number;
  readonly nodes: readonly FuryPhase9DeviceObservation[];
  readonly activities: readonly FuryPhase9ActivityObservation[];
  readonly authority: 'dashboard-observation-only';
  readonly executionAuthority: false;
  readonly activationAuthority: false;
  readonly connectionAuthority: false;
  readonly policyAuthority: false;
}

const GENERATED_SNAPSHOTS = new WeakSet<object>();
const PHASE9_SET = new Set<string>(PHASE9_CAPABILITIES);
const MAX_NODES = 4096;
const MAX_ACTIVITIES = 1024;
const PROJECTION_PREFIX = 'phase9-device/';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function digest(label: string, value: unknown): string {
  return createHash('sha256')
    .update('furypipe-phase9-devices-evidence/v1\0', 'utf8')
    .update(label, 'utf8').update('\0', 'utf8')
    .update(JSON.stringify(value), 'utf8').digest('hex');
}
function bounded(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new RangeError(`${label} must be an integer between ${min} and ${max}`);
  return n;
}
function safeArray<T>(value: readonly T[], label: string, max: number): readonly T[] {
  if (!Array.isArray(value) || value.length > max) throw new RangeError(`${label} exceeds its item bound`);
  const out: T[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !d.enumerable || !('value' in d)) throw new TypeError(`${label} contains sparse or accessor entries`);
    out.push(d.value as T);
  }
  return Object.freeze(out);
}
function requireCore(index: FuryCapabilityIndex, registry: FuryGatewayNodeRegistry, sessions: FuryGatewayNodeSessionCoordinator): void {
  if (!isGeneratedFuryCapabilityIndex(index)) throw new TypeError('Phase 9 device evidence requires a process-local capability index');
  if (!isGeneratedFuryGatewayNodeRegistry(registry)) throw new TypeError('Phase 9 device evidence requires a process-local node registry');
  if (!isGeneratedFuryGatewayNodeSessionCoordinator(sessions)) throw new TypeError('Phase 9 device evidence requires a process-local node-session coordinator');
}
function capabilityPermission(capability: FuryPhase9IndexedDeviceCapability): string {
  switch (capability) {
    case 'camera': return 'device-camera';
    case 'microphone': return 'device-microphone';
    case 'speaker': return 'device-speaker';
    case 'notifications': return 'device-notify';
    case 'voice.stt': return 'voice-stt';
    case 'voice.tts': return 'voice-tts';
    case 'voice.realtime': return 'voice-realtime';
    default: return 'media-read';
  }
}
function capabilityRisk(capability: FuryPhase9IndexedDeviceCapability): FuryCapabilityIndexRiskClass {
  if (capability === 'notifications') return 'write';
  if (capability.startsWith('media.')) return 'read';
  return 'process';
}
function capabilityFamily(capability: FuryPhase9IndexedDeviceCapability): readonly string[] {
  if (capability.startsWith('voice.')) return Object.freeze(['phase9-device', 'voice', capability.replace('.', '-')]);
  if (capability.startsWith('media.')) return Object.freeze(['phase9-device', 'media-input', capability.replaceAll('.', '-')]);
  return Object.freeze(['phase9-device', 'device-media', capability]);
}
function toInput(record: FuryCapabilityIndexRecord): FuryCapabilityIndexEntryInput {
  return {
    format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
    kind: record.kind,
    id: record.id,
    name: record.name,
    description: record.description,
    families: record.families,
    tags: record.tags,
    keywords: record.keywords,
    trust: record.trust,
    license: record.license,
    health: record.health,
    riskClass: record.riskClass,
    requiredPermissions: record.requiredPermissions,
    compatibility: record.compatibility,
    ...(record.estimatedContextTokens === undefined ? {} : { estimatedContextTokens: record.estimatedContextTokens }),
    source: record.source,
  };
}
function validateNodes(registry: FuryGatewayNodeRegistry, nodes: readonly FuryGatewayNodeDescriptor[]): readonly FuryGatewayNodeDescriptor[] {
  const values = safeArray(nodes, 'Phase 9 node descriptors', MAX_NODES);
  const snap = registry.snapshot();
  if (snap.nodeCount !== values.length) throw new Error('Phase 9 node projection requires the complete current registry descriptor set');
  const expected = new Set(snap.nodes.map((n) => n.registrationId));
  const seen = new Set<string>();
  for (const node of values) {
    if (!isGeneratedFuryGatewayNodeDescriptor(node)) throw new TypeError('Phase 9 node descriptor must be process-local registry evidence');
    if (!expected.has(node.registrationId) || seen.has(node.registrationId)) throw new Error('Phase 9 node descriptor set does not match the registry snapshot');
    try { registry.currentAdvertisement(node); } catch { throw new Error('Phase 9 node descriptor does not belong to the supplied registry'); }
    seen.add(node.registrationId);
  }
  if (seen.size !== expected.size) throw new Error('Phase 9 node descriptor set is incomplete');
  return values;
}
function liveSessionMap(sessions: FuryGatewayNodeSessionCoordinator) {
  const snap = sessions.snapshot();
  return { snapshot: snap, byRegistration: new Map(snap.sessions.map((s) => [s.registrationId, s])) };
}
function currentCapabilities(registry: FuryGatewayNodeRegistry, node: FuryGatewayNodeDescriptor, live: ReturnType<typeof liveSessionMap>['byRegistration'] extends Map<string, infer V> ? V | undefined : never): readonly FuryPhase9IndexedDeviceCapability[] {
  if (!live || live.capabilityGeneration === undefined || live.capabilitiesDigestSha256 === undefined) return Object.freeze([]);
  const ad = registry.currentAdvertisement(node);
  if (!ad || ad.generation !== live.capabilityGeneration || ad.capabilitiesDigestSha256 !== live.capabilitiesDigestSha256) return Object.freeze([]);
  return Object.freeze(ad.capabilities.filter((c): c is FuryPhase9IndexedDeviceCapability => PHASE9_SET.has(c)));
}
function projectedId(node: FuryGatewayNodeDescriptor, capability: FuryPhase9IndexedDeviceCapability): string {
  return `device:${sha256(node.registrationId).slice(0, 32)}:${capability}`;
}
function projectionEntry(node: FuryGatewayNodeDescriptor, capability: FuryPhase9IndexedDeviceCapability, generation: number, adDigest: string, observedAt: number): FuryCapabilityIndexEntryInput {
  const id = projectedId(node, capability);
  return {
    format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
    kind: 'plugin',
    id,
    name: `Device ${capability.replaceAll('.', ' ')}`,
    description: `Current live Phase 9 device capability ${capability}; routing metadata only; authorization remains false.`,
    families: capabilityFamily(capability),
    tags: Object.freeze(['phase9', 'device', 'live', `generation-${generation}`]),
    keywords: Object.freeze([...new Set(['device', 'phase9', capability, ...capability.split('.')])]),
    trust: 'verified',
    license: 'not-applicable',
    health: 'ready',
    riskClass: capabilityRisk(capability),
    requiredPermissions: Object.freeze([capabilityPermission(capability)]),
    compatibility: Object.freeze(['phase9-v1']),
    source: Object.freeze({
      system: 'host',
      sourceId: `${PROJECTION_PREFIX}${sha256(node.registrationId).slice(0, 32)}/${capability}`,
      sourceRevision: `g${generation}:${adDigest}`,
      observedAt: new Date(observedAt).toISOString(),
    }),
  };
}

export function projectFuryPhase9DevicesIntoCapabilityIndex(input: FuryPhase9DeviceProjectionInput): FuryPhase9DeviceProjectionReport {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Phase 9 device projection input is invalid');
  requireCore(input.index, input.nodeRegistry, input.nodeSessionCoordinator);
  const nodes = validateNodes(input.nodeRegistry, input.nodes);
  const { snapshot, byRegistration } = liveSessionMap(input.nodeSessionCoordinator);
  const desired: FuryCapabilityIndexEntryInput[] = [];
  let skippedNodes = 0;
  let skippedCapabilities = 0;
  for (const node of nodes) {
    const live = byRegistration.get(node.registrationId);
    const capabilities = currentCapabilities(input.nodeRegistry, node, live);
    if (!live || capabilities.length === 0) { skippedNodes += 1; continue; }
    const ad = input.nodeRegistry.currentAdvertisement(node)!;
    for (const capability of capabilities) desired.push(projectionEntry(node, capability, ad.generation, ad.capabilitiesDigestSha256, ad.advertisedAt));
    skippedCapabilities += ad.capabilities.length - capabilities.length;
  }

  const prior = input.index.list('plugin').filter((r) => r.source.system === 'host' && r.source.sourceId.startsWith(PROJECTION_PREFIX));
  const desiredIds = new Set(desired.map((entry) => entry.id));
  const applied: string[] = [];
  try {
    for (const record of prior) input.index.remove(record.kind, record.id);
    for (const entry of desired) { input.index.upsert(entry); applied.push(entry.id); }
  } catch (error) {
    for (const id of applied) input.index.remove('plugin', id);
    for (const record of prior) input.index.upsert(toInput(record));
    throw error;
  }
  const snapshotAfter = input.index.snapshot();
  return Object.freeze({
    format: FURY_PHASE9_DEVICE_PROJECTION_FORMAT,
    indexed: desired.length,
    skippedNodes,
    skippedCapabilities,
    removed: prior.filter((r) => !desiredIds.has(r.id)).length,
    indexDigestSha256: snapshotAfter.digestSha256,
    authority: 'projection-only' as const,
    executionAuthority: false as const,
    activationAuthority: false as const,
    connectionAuthority: false as const,
  });
}

function nodeObservations(registry: FuryGatewayNodeRegistry, sessions: FuryGatewayNodeSessionCoordinator, nodes: readonly FuryGatewayNodeDescriptor[], maxNodes: number): { observedAt: number; nodes: readonly FuryPhase9DeviceObservation[] } {
  if (nodes.length > maxNodes) throw new RangeError('Devices evidence node count exceeds its bound');
  const { snapshot, byRegistration } = liveSessionMap(sessions);
  const output = nodes.map((node): FuryPhase9DeviceObservation => {
    const live = byRegistration.get(node.registrationId);
    const capabilities = currentCapabilities(registry, node, live);
    return Object.freeze({
      registrationIdSha256: sha256(node.registrationId),
      deviceIdSha256: sha256(node.deviceId),
      pairingIdSha256: sha256(node.pairingId),
      clientIdSha256: sha256(node.clientId),
      ...(node.platform === undefined ? {} : { platform: node.platform }),
      ...(node.deviceFamily === undefined ? {} : { deviceFamily: node.deviceFamily }),
      registeredAt: node.registeredAt,
      connected: live !== undefined,
      ...(live === undefined ? {} : {
        sessionIdSha256: sha256(live.sessionId),
        livenessEpochSha256: sha256(live.livenessEpoch),
        liveUntil: live.liveUntil,
      }),
      ...(live?.capabilityGeneration === undefined ? {} : { capabilityGeneration: live.capabilityGeneration }),
      ...(live?.capabilitiesDigestSha256 === undefined ? {} : { capabilitiesDigestSha256: live.capabilitiesDigestSha256 }),
      capabilities,
      authority: 'devices-observation-only' as const,
      executionAuthority: false as const,
    });
  }).sort((a,b)=>a.registrationIdSha256.localeCompare(b.registrationIdSha256));
  return { observedAt: snapshot.observedAt, nodes: Object.freeze(output) };
}
function realtimeObservation(value: FuryPhase9RealtimeEvidenceInput): FuryPhase9ActivityObservation {
  if (!value || typeof value !== 'object' || !isGeneratedFuryRealtimeVoiceCoordinator(value.coordinator) || !isGeneratedFuryRealtimeVoiceLease(value.lease)) throw new TypeError('Realtime Devices evidence requires process-local coordinator and lease evidence');
  const inspection = value.coordinator.inspect(value.lease);
  return Object.freeze({
    kind: 'realtime-voice' as const,
    status: inspection.status,
    bundleId: value.lease.bundleId,
    bundleVersion: value.lease.bundleVersion,
    profileId: value.lease.profileId,
    requestDigestSha256: inspection.requestDigestSha256,
    registrationIdSha256: value.lease.registrationIdSha256,
    evidenceDigestSha256: digest('realtime', inspection),
    unknownOutcome: inspection.status === 'unknown',
    retrySafe: false as const,
    automaticReplayAllowed: false as const,
    executionAuthority: false as const,
    authority: 'devices-observation-only' as const,
  });
}
function captureObservation(value: FuryPhase9CaptureEvidenceInput): FuryPhase9ActivityObservation {
  if (!value || typeof value !== 'object' || !isGeneratedFuryDeviceCaptureRequest(value.request) || !isGeneratedFuryDeviceCaptureResult(value.result)) throw new TypeError('Capture Devices evidence requires process-local request and result evidence');
  if (value.request.requestDigestSha256 !== value.result.receipt.requestDigestSha256 || value.request.kind !== value.result.kind) throw new Error('Capture Devices evidence request/result binding is invalid');
  return Object.freeze({
    kind: 'device-capture' as const,
    status: value.result.outcome,
    bundleId: value.request.bundleId,
    bundleVersion: value.request.bundleVersion,
    profileId: value.request.profileId,
    requestDigestSha256: value.request.requestDigestSha256,
    registrationIdSha256: value.request.registrationIdSha256,
    evidenceDigestSha256: digest('capture', value.result.receipt),
    deviceCaptureKind: value.request.kind,
    unknownOutcome: false,
    retrySafe: false as const,
    automaticReplayAllowed: false as const,
    executionAuthority: false as const,
    authority: 'devices-observation-only' as const,
  });
}
function voiceObservation(result: FuryPhase9VoiceResult): FuryPhase9ActivityObservation {
  if (!isGeneratedFuryVoiceOperationResult(result)) throw new TypeError('Voice Devices evidence requires process-local result evidence');
  const e = result.evidence;
  return Object.freeze({
    kind: 'voice-operation' as const,
    status: e.outcome,
    bundleId: e.bundleId,
    bundleVersion: e.bundleVersion,
    profileId: e.profileId,
    requestDigestSha256: e.requestDigestSha256,
    evidenceDigestSha256: digest('voice', e),
    operation: e.operation,
    unknownOutcome: false,
    retrySafe: false as const,
    automaticReplayAllowed: false as const,
    executionAuthority: false as const,
    authority: 'devices-observation-only' as const,
  });
}

export function isGeneratedFuryPhase9DevicesEvidenceSnapshot(value: unknown): value is FuryPhase9DevicesEvidenceSnapshot {
  return typeof value === 'object' && value !== null && GENERATED_SNAPSHOTS.has(value);
}

export function createFuryPhase9DevicesEvidenceSnapshot(input: FuryPhase9DevicesEvidenceInput): FuryPhase9DevicesEvidenceSnapshot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Devices evidence input is invalid');
  requireCore(input.index, input.nodeRegistry, input.nodeSessionCoordinator);
  const maxNodes = bounded(input.maxNodes, 1024, 1, MAX_NODES, 'maxNodes');
  const maxActivities = bounded(input.maxActivities, 256, 0, MAX_ACTIVITIES, 'maxActivities');
  const nodes = validateNodes(input.nodeRegistry, input.nodes);
  const observed = nodeObservations(input.nodeRegistry, input.nodeSessionCoordinator, nodes, maxNodes);
  const realtime = safeArray(input.realtime ?? [], 'realtime evidence', maxActivities);
  const captures = safeArray(input.captures ?? [], 'capture evidence', maxActivities);
  const voice = safeArray(input.voiceResults ?? [], 'voice result evidence', maxActivities);
  if (realtime.length + captures.length + voice.length > maxActivities) throw new RangeError('Devices evidence activity count exceeds its bound');
  const activities = Object.freeze([
    ...realtime.map(realtimeObservation),
    ...captures.map(captureObservation),
    ...voice.map(voiceObservation),
  ].sort((a,b)=>a.requestDigestSha256.localeCompare(b.requestDigestSha256) || a.kind.localeCompare(b.kind)));
  const nodeDigests = new Set(observed.nodes.map((node) => node.registrationIdSha256));
  for (const activity of activities) {
    if (activity.registrationIdSha256 !== undefined && !nodeDigests.has(activity.registrationIdSha256)) {
      throw new Error('Devices evidence activity is bound to a node outside this snapshot');
    }
  }
  const value: FuryPhase9DevicesEvidenceSnapshot = Object.freeze({
    format: FURY_PHASE9_DEVICES_EVIDENCE_FORMAT,
    observedAt: observed.observedAt,
    indexDigestSha256: input.index.snapshot().digestSha256,
    nodeCount: observed.nodes.length,
    connectedNodeCount: observed.nodes.filter((n)=>n.connected).length,
    activityCount: activities.length,
    unknownOutcomeCount: activities.filter((a)=>a.unknownOutcome).length,
    nodes: observed.nodes,
    activities,
    authority: 'dashboard-observation-only' as const,
    executionAuthority: false as const,
    activationAuthority: false as const,
    connectionAuthority: false as const,
    policyAuthority: false as const,
  });
  GENERATED_SNAPSHOTS.add(value);
  return value;
}
