import { createHash, randomBytes } from 'node:crypto';
import {
  isGeneratedFuryGatewayAuthenticatedDevice,
  type FuryGatewayAuthenticatedDevice,
} from './gateway-auth-node.js';
import {
  isGeneratedFuryGatewayPairingCoordinator,
  type FuryGatewayPairingCoordinator,
} from './gateway-pairing-node.js';

export const FURY_GATEWAY_NODE_DESCRIPTOR_FORMAT =
  'furypipe-gateway-node-descriptor/v1' as const;
export const FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT =
  'furypipe-gateway-node-capability-advertisement-input/v1' as const;
export const FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_FORMAT =
  'furypipe-gateway-node-capability-advertisement/v1' as const;
export const FURY_GATEWAY_NODE_REGISTRY_SNAPSHOT_FORMAT =
  'furypipe-gateway-node-registry-snapshot/v1' as const;

export interface FuryGatewayNodeDescriptor {
  readonly format: typeof FURY_GATEWAY_NODE_DESCRIPTOR_FORMAT;
  readonly registrationId: string;
  readonly deviceId: string;
  readonly publicKeySha256: string;
  readonly role: 'node';
  readonly clientId: string;
  readonly instanceId: string;
  readonly platform?: string;
  readonly deviceFamily?: string;
  readonly pairingId: string;
  readonly registeredAt: number;
  readonly authority: 'registry-evidence-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayNodeCapabilityAdvertisementInput {
  readonly format: typeof FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT;
  readonly generation: number;
  readonly capabilities: readonly string[];
}

export interface FuryGatewayNodeCapabilityAdvertisement {
  readonly format: typeof FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_FORMAT;
  readonly registrationId: string;
  readonly deviceId: string;
  readonly pairingId: string;
  readonly generation: number;
  readonly capabilities: readonly string[];
  readonly capabilitiesDigestSha256: string;
  readonly advertisedAt: number;
  readonly authority: 'advertisement-only';
  readonly executionAuthority: false;
  readonly automaticReplayAllowed: false;
}

export interface FuryGatewayNodeRegistrySnapshotEntry {
  readonly registrationId: string;
  readonly deviceId: string;
  readonly pairingId: string;
  readonly clientId: string;
  readonly platform?: string;
  readonly deviceFamily?: string;
  readonly registeredAt: number;
  readonly advertisement?: {
    readonly generation: number;
    readonly capabilityCount: number;
    readonly capabilitiesDigestSha256: string;
    readonly advertisedAt: number;
    readonly authority: 'advertisement-only';
    readonly executionAuthority: false;
  };
  readonly authority: 'registry-observation-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayNodeRegistrySnapshot {
  readonly format: typeof FURY_GATEWAY_NODE_REGISTRY_SNAPSHOT_FORMAT;
  readonly observedAt: number;
  readonly nodeCount: number;
  readonly nodes: readonly FuryGatewayNodeRegistrySnapshotEntry[];
  readonly authority: 'registry-observation-only';
  readonly executionAuthority: false;
}

export type FuryGatewayNodeRegistryErrorCode =
  | 'invalid-pairing-coordinator'
  | 'invalid-authenticated-device'
  | 'authenticated-device-stale'
  | 'invalid-node-role'
  | 'pairing-required'
  | 'pairing-changed'
  | 'duplicate-node'
  | 'node-not-found'
  | 'invalid-node-evidence'
  | 'invalid-advertisement'
  | 'duplicate-capability'
  | 'stale-generation'
  | 'limit-exceeded';

export class FuryGatewayNodeRegistryError extends Error {
  readonly code: FuryGatewayNodeRegistryErrorCode;

  constructor(code: FuryGatewayNodeRegistryErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayNodeRegistryError';
    this.code = code;
  }
}

export interface FuryGatewayNodeRegistryOptions {
  readonly pairingCoordinator: FuryGatewayPairingCoordinator;
  readonly now?: () => number;
  readonly maxAuthenticatedAgeMs?: number;
  readonly maxNodes?: number;
  readonly maxCapabilitiesPerNode?: number;
  readonly maxAdvertisementBytes?: number;
}

export interface FuryGatewayNodeRegistry {
  registerNode(device: FuryGatewayAuthenticatedDevice): FuryGatewayNodeDescriptor;
  advertiseCapabilities(
    node: FuryGatewayNodeDescriptor,
    input: FuryGatewayNodeCapabilityAdvertisementInput,
  ): FuryGatewayNodeCapabilityAdvertisement;
  currentAdvertisement(
    node: FuryGatewayNodeDescriptor,
  ): FuryGatewayNodeCapabilityAdvertisement | undefined;
  unregisterNode(node: FuryGatewayNodeDescriptor): boolean;
  snapshot(): FuryGatewayNodeRegistrySnapshot;
  nodeCount(): number;
}

interface NodeRecord {
  readonly descriptor: FuryGatewayNodeDescriptor;
  readonly authenticatedDevice: FuryGatewayAuthenticatedDevice;
  advertisement?: FuryGatewayNodeCapabilityAdvertisement;
}

const GENERATED_NODE_REGISTRIES = new WeakSet<object>();
const GENERATED_NODE_DESCRIPTORS = new WeakSet<object>();
const GENERATED_NODE_ADVERTISEMENTS = new WeakSet<object>();

const DEFAULT_MAX_AUTHENTICATED_AGE_MS = 60_000;
const MIN_AUTHENTICATED_AGE_MS = 5_000;
const HARD_MAX_AUTHENTICATED_AGE_MS = 5 * 60_000;
const DEFAULT_MAX_NODES = 1_024;
const HARD_MAX_NODES = 65_536;
const DEFAULT_MAX_CAPABILITIES_PER_NODE = 128;
const HARD_MAX_CAPABILITIES_PER_NODE = 512;
const DEFAULT_MAX_ADVERTISEMENT_BYTES = 16 * 1024;
const HARD_MAX_ADVERTISEMENT_BYTES = 64 * 1024;
const MAX_CAPABILITY_BYTES = 96;
const MAX_GENERATION = 1_000_000_000;
const CAPABILITY_RE = /^[a-z][a-z0-9._:-]*$/u;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new RangeError(`${label} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('gateway node registry clock must return a safe non-negative timestamp');
  }
  return value;
}

function exactPlainDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FuryGatewayNodeRegistryError(
      'invalid-advertisement',
      `${label} must be a plain data object`,
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FuryGatewayNodeRegistryError(
      'invalid-advertisement',
      `${label} must use a plain-object prototype`,
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new FuryGatewayNodeRegistryError(
      'invalid-advertisement',
      `${label} must not contain symbol keys`,
    );
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(record)) {
    if (!allowed.has(key)) {
      throw new FuryGatewayNodeRegistryError(
        'invalid-advertisement',
        `${label} contains unsupported field: ${key}`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new FuryGatewayNodeRegistryError(
        'invalid-advertisement',
        `${label} must contain enumerable data properties only`,
      );
    }
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryGatewayNodeRegistryError(
        'invalid-advertisement',
        `${label} is missing required field: ${key}`,
      );
    }
  }
  return record;
}

function normalizeCapabilities(
  value: unknown,
  maxCapabilitiesPerNode: number,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new FuryGatewayNodeRegistryError(
      'invalid-advertisement',
      'node capabilities must be an array',
    );
  }
  if (value.length > maxCapabilitiesPerNode) {
    throw new FuryGatewayNodeRegistryError(
      'limit-exceeded',
      'node capability advertisement exceeds its item limit',
    );
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const capability of value) {
    if (
      typeof capability !== 'string'
      || capability.length === 0
      || capability.trim() !== capability
      || Buffer.byteLength(capability, 'utf8') > MAX_CAPABILITY_BYTES
      || !CAPABILITY_RE.test(capability)
    ) {
      throw new FuryGatewayNodeRegistryError(
        'invalid-advertisement',
        'node capability contains unsupported or non-canonical text',
      );
    }
    if (seen.has(capability)) {
      throw new FuryGatewayNodeRegistryError(
        'duplicate-capability',
        'node capability advertisement contains duplicates',
      );
    }
    seen.add(capability);
    normalized.push(capability);
  }

  normalized.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.freeze(normalized);
}

function validateAdvertisementInput(
  input: FuryGatewayNodeCapabilityAdvertisementInput,
  maxCapabilitiesPerNode: number,
  maxAdvertisementBytes: number,
): {
  readonly generation: number;
  readonly capabilities: readonly string[];
} {
  const record = exactPlainDataRecord(
    input,
    ['format', 'generation', 'capabilities'],
    ['format', 'generation', 'capabilities'],
    'node capability advertisement',
  );

  if (record.format !== FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT) {
    throw new FuryGatewayNodeRegistryError(
      'invalid-advertisement',
      'unsupported node capability advertisement format',
    );
  }
  if (
    typeof record.generation !== 'number'
    || !Number.isSafeInteger(record.generation)
    || record.generation < 1
    || record.generation > MAX_GENERATION
  ) {
    throw new FuryGatewayNodeRegistryError(
      'invalid-advertisement',
      'node capability advertisement generation is invalid',
    );
  }

  const capabilities = normalizeCapabilities(
    record.capabilities,
    maxCapabilitiesPerNode,
  );
  const canonical = JSON.stringify({
    format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
    generation: record.generation,
    capabilities,
  });
  if (Buffer.byteLength(canonical, 'utf8') > maxAdvertisementBytes) {
    throw new FuryGatewayNodeRegistryError(
      'limit-exceeded',
      'node capability advertisement exceeds its byte limit',
    );
  }

  return Object.freeze({
    generation: record.generation,
    capabilities,
  });
}

function capabilityDigest(
  registrationId: string,
  deviceId: string,
  pairingId: string,
  generation: number,
  capabilities: readonly string[],
): string {
  return createHash('sha256').update(JSON.stringify({
    format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_FORMAT,
    registrationId,
    deviceId,
    pairingId,
    generation,
    capabilities,
  })).digest('hex');
}

function assertGeneratedNode(
  node: FuryGatewayNodeDescriptor,
  records: ReadonlyMap<FuryGatewayNodeDescriptor, NodeRecord>,
): NodeRecord {
  if (
    !isGeneratedFuryGatewayNodeDescriptor(node)
    || node.authority !== 'registry-evidence-only'
    || node.executionAuthority !== false
  ) {
    throw new FuryGatewayNodeRegistryError(
      'invalid-node-evidence',
      'node operation requires process-local registry evidence',
    );
  }
  const record = records.get(node);
  if (!record || record.descriptor !== node) {
    throw new FuryGatewayNodeRegistryError(
      'node-not-found',
      'node descriptor does not belong to this registry',
    );
  }
  return record;
}

export function isGeneratedFuryGatewayNodeRegistry(
  value: unknown,
): value is FuryGatewayNodeRegistry {
  return typeof value === 'object'
    && value !== null
    && GENERATED_NODE_REGISTRIES.has(value);
}

export function isGeneratedFuryGatewayNodeDescriptor(
  value: unknown,
): value is FuryGatewayNodeDescriptor {
  return typeof value === 'object'
    && value !== null
    && GENERATED_NODE_DESCRIPTORS.has(value);
}

export function isGeneratedFuryGatewayNodeCapabilityAdvertisement(
  value: unknown,
): value is FuryGatewayNodeCapabilityAdvertisement {
  return typeof value === 'object'
    && value !== null
    && GENERATED_NODE_ADVERTISEMENTS.has(value);
}

export function createFuryGatewayNodeRegistry(
  options: FuryGatewayNodeRegistryOptions,
): FuryGatewayNodeRegistry {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !isGeneratedFuryGatewayPairingCoordinator(options.pairingCoordinator)
  ) {
    throw new FuryGatewayNodeRegistryError(
      'invalid-pairing-coordinator',
      'node registry requires a process-local FuryPipe pairing coordinator',
    );
  }

  const pairingCoordinator = options.pairingCoordinator;
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new TypeError('gateway node registry now must be a function');
  }
  safeNow(now);

  const maxAuthenticatedAgeMs = boundedInteger(
    options.maxAuthenticatedAgeMs,
    DEFAULT_MAX_AUTHENTICATED_AGE_MS,
    MIN_AUTHENTICATED_AGE_MS,
    HARD_MAX_AUTHENTICATED_AGE_MS,
    'maxAuthenticatedAgeMs',
  );
  const maxNodes = boundedInteger(
    options.maxNodes,
    DEFAULT_MAX_NODES,
    1,
    HARD_MAX_NODES,
    'maxNodes',
  );
  const maxCapabilitiesPerNode = boundedInteger(
    options.maxCapabilitiesPerNode,
    DEFAULT_MAX_CAPABILITIES_PER_NODE,
    1,
    HARD_MAX_CAPABILITIES_PER_NODE,
    'maxCapabilitiesPerNode',
  );
  const maxAdvertisementBytes = boundedInteger(
    options.maxAdvertisementBytes,
    DEFAULT_MAX_ADVERTISEMENT_BYTES,
    256,
    HARD_MAX_ADVERTISEMENT_BYTES,
    'maxAdvertisementBytes',
  );

  const records = new Map<FuryGatewayNodeDescriptor, NodeRecord>();
  const descriptorsByDeviceId = new Map<string, FuryGatewayNodeDescriptor>();

  const api: FuryGatewayNodeRegistry = Object.freeze({
    registerNode(device: FuryGatewayAuthenticatedDevice): FuryGatewayNodeDescriptor {
      if (
        !isGeneratedFuryGatewayAuthenticatedDevice(device)
        || device.authority !== 'authenticated-device'
        || device.pairing !== 'unpaired'
        || device.authorization !== 'none'
      ) {
        throw new FuryGatewayNodeRegistryError(
          'invalid-authenticated-device',
          'node registration requires process-local authenticated-device evidence',
        );
      }
      if (device.role !== 'node') {
        throw new FuryGatewayNodeRegistryError(
          'invalid-node-role',
          'Phase 9 node registry accepts Gateway role node only',
        );
      }

      const registeredAt = safeNow(now);
      if (
        device.authenticatedAt > registeredAt
        || registeredAt - device.authenticatedAt > maxAuthenticatedAgeMs
      ) {
        throw new FuryGatewayNodeRegistryError(
          'authenticated-device-stale',
          'node registration requires fresh authenticated-device evidence',
        );
      }
      if (descriptorsByDeviceId.has(device.deviceId)) {
        throw new FuryGatewayNodeRegistryError(
          'duplicate-node',
          'device is already registered as a Phase 9 node',
        );
      }
      if (records.size >= maxNodes) {
        throw new FuryGatewayNodeRegistryError(
          'limit-exceeded',
          'gateway node registry is full',
        );
      }

      const pairing = pairingCoordinator.inspectPairing(device);
      if (!pairing) {
        throw new FuryGatewayNodeRegistryError(
          'pairing-required',
          'node registration requires an active pairing for the authenticated device',
        );
      }

      const descriptor: FuryGatewayNodeDescriptor = Object.freeze({
        format: FURY_GATEWAY_NODE_DESCRIPTOR_FORMAT,
        registrationId: randomBytes(16).toString('base64url'),
        deviceId: device.deviceId,
        publicKeySha256: device.publicKeySha256,
        role: 'node' as const,
        clientId: device.clientId,
        instanceId: device.instanceId,
        ...(device.platform === undefined ? {} : { platform: device.platform }),
        ...(device.deviceFamily === undefined ? {} : { deviceFamily: device.deviceFamily }),
        pairingId: pairing.pairingId,
        registeredAt,
        authority: 'registry-evidence-only' as const,
        executionAuthority: false as const,
      });

      const record: NodeRecord = {
        descriptor,
        authenticatedDevice: device,
      };
      records.set(descriptor, record);
      descriptorsByDeviceId.set(device.deviceId, descriptor);
      GENERATED_NODE_DESCRIPTORS.add(descriptor);
      return descriptor;
    },

    advertiseCapabilities(
      node: FuryGatewayNodeDescriptor,
      input: FuryGatewayNodeCapabilityAdvertisementInput,
    ): FuryGatewayNodeCapabilityAdvertisement {
      const record = assertGeneratedNode(node, records);
      const currentPairing = pairingCoordinator.inspectPairing(record.authenticatedDevice);
      if (!currentPairing) {
        throw new FuryGatewayNodeRegistryError(
          'pairing-required',
          'node pairing was revoked or is no longer available',
        );
      }
      if (currentPairing.pairingId !== node.pairingId) {
        throw new FuryGatewayNodeRegistryError(
          'pairing-changed',
          'node registration is bound to an older pairing identity',
        );
      }

      const normalized = validateAdvertisementInput(
        input,
        maxCapabilitiesPerNode,
        maxAdvertisementBytes,
      );
      if (
        record.advertisement !== undefined
        && normalized.generation <= record.advertisement.generation
      ) {
        throw new FuryGatewayNodeRegistryError(
          'stale-generation',
          'node capability advertisement generation must increase monotonically',
        );
      }

      const advertisedAt = safeNow(now);
      const advertisement: FuryGatewayNodeCapabilityAdvertisement = Object.freeze({
        format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_FORMAT,
        registrationId: node.registrationId,
        deviceId: node.deviceId,
        pairingId: node.pairingId,
        generation: normalized.generation,
        capabilities: normalized.capabilities,
        capabilitiesDigestSha256: capabilityDigest(
          node.registrationId,
          node.deviceId,
          node.pairingId,
          normalized.generation,
          normalized.capabilities,
        ),
        advertisedAt,
        authority: 'advertisement-only' as const,
        executionAuthority: false as const,
        automaticReplayAllowed: false as const,
      });

      record.advertisement = advertisement;
      GENERATED_NODE_ADVERTISEMENTS.add(advertisement);
      return advertisement;
    },

    currentAdvertisement(
      node: FuryGatewayNodeDescriptor,
    ): FuryGatewayNodeCapabilityAdvertisement | undefined {
      return assertGeneratedNode(node, records).advertisement;
    },

    unregisterNode(node: FuryGatewayNodeDescriptor): boolean {
      const record = assertGeneratedNode(node, records);
      descriptorsByDeviceId.delete(record.descriptor.deviceId);
      records.delete(node);
      return true;
    },

    snapshot(): FuryGatewayNodeRegistrySnapshot {
      const observedAt = safeNow(now);
      const nodes = [...records.values()]
        .sort((a, b) => (a.descriptor.deviceId < b.descriptor.deviceId ? -1 : a.descriptor.deviceId > b.descriptor.deviceId ? 1 : 0))
        .map((record): FuryGatewayNodeRegistrySnapshotEntry => {
          const advertisement = record.advertisement;
          return Object.freeze({
            registrationId: record.descriptor.registrationId,
            deviceId: record.descriptor.deviceId,
            pairingId: record.descriptor.pairingId,
            clientId: record.descriptor.clientId,
            ...(record.descriptor.platform === undefined
              ? {}
              : { platform: record.descriptor.platform }),
            ...(record.descriptor.deviceFamily === undefined
              ? {}
              : { deviceFamily: record.descriptor.deviceFamily }),
            registeredAt: record.descriptor.registeredAt,
            ...(advertisement === undefined
              ? {}
              : {
                  advertisement: Object.freeze({
                    generation: advertisement.generation,
                    capabilityCount: advertisement.capabilities.length,
                    capabilitiesDigestSha256: advertisement.capabilitiesDigestSha256,
                    advertisedAt: advertisement.advertisedAt,
                    authority: 'advertisement-only' as const,
                    executionAuthority: false as const,
                  }),
                }),
            authority: 'registry-observation-only' as const,
            executionAuthority: false as const,
          });
        });

      return Object.freeze({
        format: FURY_GATEWAY_NODE_REGISTRY_SNAPSHOT_FORMAT,
        observedAt,
        nodeCount: nodes.length,
        nodes: Object.freeze(nodes),
        authority: 'registry-observation-only' as const,
        executionAuthority: false as const,
      });
    },

    nodeCount(): number {
      safeNow(now);
      return records.size;
    },
  });

  GENERATED_NODE_REGISTRIES.add(api);
  return api;
}
