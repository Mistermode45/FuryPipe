import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FURY_GATEWAY_CONNECT_FORMAT,
  FURY_GATEWAY_PROTOCOL_VERSION,
  parseFuryGatewayConnectEnvelope,
  type FuryGatewayRole,
} from '../src/gateway.js';
import {
  createFuryGatewayDeviceAuthCoordinator,
  createFuryGatewayDeviceProof,
} from '../src/gateway-auth-node.js';
import {
  createFuryGatewayPairingCoordinator,
  isGeneratedFuryGatewayPairingCoordinator,
  type FuryGatewayPairingCoordinator,
} from '../src/gateway-pairing-node.js';
import {
  FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
  FuryGatewayNodeRegistryError,
  createFuryGatewayNodeRegistry,
  isGeneratedFuryGatewayNodeCapabilityAdvertisement,
  isGeneratedFuryGatewayNodeDescriptor,
  isGeneratedFuryGatewayNodeRegistry,
} from '../src/gateway-node-registry-node.js';

function envelope(
  role: FuryGatewayRole = 'node',
  instanceId = 'node-instance-1',
) {
  return parseFuryGatewayConnectEnvelope({
    format: FURY_GATEWAY_CONNECT_FORMAT,
    protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
    role,
    client: {
      clientId: role === 'node' ? 'fury-node' : `fury-${role}`,
      instanceId,
      platform: 'linux',
      deviceFamily: role === 'node' ? 'server' : 'worker',
    },
    capabilities: [],
    commands: [],
  });
}

function authenticate(
  now: () => number,
  role: FuryGatewayRole = 'node',
  instanceId = 'node-instance-1',
) {
  const auth = createFuryGatewayDeviceAuthCoordinator({ now });
  const keys = generateKeyPairSync('ed25519');
  const connect = envelope(role, instanceId);
  const challenge = auth.issueChallenge();
  const proof = createFuryGatewayDeviceProof(connect, challenge, keys.privateKey);
  return auth.verifyProof(connect, proof);
}

function pair(
  pairing: FuryGatewayPairingCoordinator,
  device: ReturnType<typeof authenticate>,
  principalId = 'principal:user-1',
) {
  const request = pairing.requestPairing(device);
  return pairing.approvePairing(request.requestId, principalId);
}

function advertisement(
  generation: number,
  capabilities: readonly string[],
) {
  return {
    format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
    generation,
    capabilities,
  } as const;
}

describe('Fury Gateway Phase 9 node registry', () => {
  it('requires a process-local FuryPipe pairing coordinator', () => {
    const pairing = createFuryGatewayPairingCoordinator({ now: () => 1_000 });
    expect(isGeneratedFuryGatewayPairingCoordinator(pairing)).toBe(true);
    expect(isGeneratedFuryGatewayPairingCoordinator({ ...pairing })).toBe(false);

    expect(() => createFuryGatewayNodeRegistry({
      pairingCoordinator: { ...pairing } as FuryGatewayPairingCoordinator,
      now: () => 1_000,
    })).toThrowError(expect.objectContaining({
      code: 'invalid-pairing-coordinator',
    }));
  });

  it('requires current pairing and accepts Gateway role node only', () => {
    const now = () => 2_000;
    const pairing = createFuryGatewayPairingCoordinator({ now });
    const registry = createFuryGatewayNodeRegistry({ pairingCoordinator: pairing, now });

    const unpairedNode = authenticate(now);
    expect(() => registry.registerNode(unpairedNode)).toThrowError(
      expect.objectContaining({ code: 'pairing-required' }),
    );

    const worker = authenticate(now, 'worker', 'worker-instance-1');
    pair(pairing, worker);
    expect(() => registry.registerNode(worker)).toThrowError(
      expect.objectContaining({ code: 'invalid-node-role' }),
    );
  });

  it('registers paired identity as non-authoritative process-local evidence', () => {
    const now = () => 3_000;
    const pairing = createFuryGatewayPairingCoordinator({ now });
    const device = authenticate(now);
    const paired = pair(pairing, device);
    const registry = createFuryGatewayNodeRegistry({ pairingCoordinator: pairing, now });
    const node = registry.registerNode(device);

    expect(isGeneratedFuryGatewayNodeRegistry(registry)).toBe(true);
    expect(isGeneratedFuryGatewayNodeDescriptor(node)).toBe(true);
    expect(isGeneratedFuryGatewayNodeDescriptor({ ...node })).toBe(false);
    expect(node.deviceId).toBe(device.deviceId);
    expect(node.publicKeySha256).toBe(device.publicKeySha256);
    expect(node.pairingId).toBe(paired.pairingId);
    expect(node.role).toBe('node');
    expect(node.authority).toBe('registry-evidence-only');
    expect(node.executionAuthority).toBe(false);
    expect('execute' in registry).toBe(false);

    expect(() => registry.currentAdvertisement({ ...node })).toThrowError(
      expect.objectContaining({ code: 'invalid-node-evidence' }),
    );
  });

  it('rejects stale authenticated-device evidence at registration', () => {
    let time = 10_000;
    const now = () => time;
    const pairing = createFuryGatewayPairingCoordinator({ now });
    const device = authenticate(now);
    pair(pairing, device);

    const registry = createFuryGatewayNodeRegistry({
      pairingCoordinator: pairing,
      now,
      maxAuthenticatedAgeMs: 5_000,
    });
    time = 15_001;

    expect(() => registry.registerNode(device)).toThrowError(
      expect.objectContaining({ code: 'authenticated-device-stale' }),
    );
  });

  it('publishes canonical bounded capability evidence with no execution authority', () => {
    const now = () => 20_000;
    const pairing = createFuryGatewayPairingCoordinator({ now });
    const device = authenticate(now);
    pair(pairing, device);
    const registry = createFuryGatewayNodeRegistry({ pairingCoordinator: pairing, now });
    const node = registry.registerNode(device);

    const result = registry.advertiseCapabilities(
      node,
      advertisement(1, ['voice.stt', 'camera', 'media.audio.input']),
    );

    expect(result.generation).toBe(1);
    expect(result.capabilities).toEqual(['camera', 'media.audio.input', 'voice.stt']);
    expect(result.capabilitiesDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.authority).toBe('advertisement-only');
    expect(result.executionAuthority).toBe(false);
    expect(result.automaticReplayAllowed).toBe(false);
    expect(isGeneratedFuryGatewayNodeCapabilityAdvertisement(result)).toBe(true);
    expect(isGeneratedFuryGatewayNodeCapabilityAdvertisement({ ...result })).toBe(false);
    expect(registry.currentAdvertisement(node)).toBe(result);
  });

  it('requires monotonically increasing advertisement generations', () => {
    const now = () => 30_000;
    const pairing = createFuryGatewayPairingCoordinator({ now });
    const device = authenticate(now);
    pair(pairing, device);
    const registry = createFuryGatewayNodeRegistry({ pairingCoordinator: pairing, now });
    const node = registry.registerNode(device);

    registry.advertiseCapabilities(node, advertisement(7, ['camera']));

    expect(() => registry.advertiseCapabilities(
      node,
      advertisement(7, ['camera', 'microphone']),
    )).toThrowError(expect.objectContaining({ code: 'stale-generation' }));

    expect(() => registry.advertiseCapabilities(
      node,
      advertisement(6, ['microphone']),
    )).toThrowError(expect.objectContaining({ code: 'stale-generation' }));

    const next = registry.advertiseCapabilities(
      node,
      advertisement(9, ['microphone']),
    );
    expect(next.generation).toBe(9);
  });

  it('rejects schema drift, accessors, duplicate and invalid capabilities', () => {
    const now = () => 40_000;
    const pairing = createFuryGatewayPairingCoordinator({ now });
    const device = authenticate(now);
    pair(pairing, device);
    const registry = createFuryGatewayNodeRegistry({ pairingCoordinator: pairing, now });
    const node = registry.registerNode(device);

    expect(() => registry.advertiseCapabilities(node, {
      ...advertisement(1, ['camera']),
      authorization: 'granted',
    } as ReturnType<typeof advertisement>)).toThrowError(
      expect.objectContaining({ code: 'invalid-advertisement' }),
    );

    const accessor = {
      format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
      generation: 1,
      capabilities: ['camera'],
    } as Record<string, unknown>;
    Object.defineProperty(accessor, 'generation', {
      enumerable: true,
      get: () => 1,
    });
    expect(() => registry.advertiseCapabilities(
      node,
      accessor as unknown as ReturnType<typeof advertisement>,
    )).toThrowError(expect.objectContaining({ code: 'invalid-advertisement' }));

    expect(() => registry.advertiseCapabilities(
      node,
      advertisement(1, ['camera', 'camera']),
    )).toThrowError(expect.objectContaining({ code: 'duplicate-capability' }));

    expect(() => registry.advertiseCapabilities(
      node,
      advertisement(1, ['Camera']),
    )).toThrowError(expect.objectContaining({ code: 'invalid-advertisement' }));
  });

  it('enforces capability count and serialized advertisement byte bounds', () => {
    const now = () => 50_000;
    const pairing = createFuryGatewayPairingCoordinator({ now });
    const device = authenticate(now);
    pair(pairing, device);

    const countRegistry = createFuryGatewayNodeRegistry({
      pairingCoordinator: pairing,
      now,
      maxCapabilitiesPerNode: 2,
    });
    const countNode = countRegistry.registerNode(device);
    expect(() => countRegistry.advertiseCapabilities(
      countNode,
      advertisement(1, ['camera', 'microphone', 'speaker']),
    )).toThrowError(expect.objectContaining({ code: 'limit-exceeded' }));

    countRegistry.unregisterNode(countNode);
    const byteRegistry = createFuryGatewayNodeRegistry({
      pairingCoordinator: pairing,
      now,
      maxCapabilitiesPerNode: 8,
      maxAdvertisementBytes: 256,
    });
    const byteNode = byteRegistry.registerNode(device);
    const long = (prefix: string) => `${prefix}.${'x'.repeat(80)}`;
    expect(() => byteRegistry.advertiseCapabilities(
      byteNode,
      advertisement(1, [long('camera'), long('microphone'), long('speaker')]),
    )).toThrowError(expect.objectContaining({ code: 'limit-exceeded' }));
  });

  it('revalidates pairing before accepting a newer advertisement', () => {
    const now = () => 60_000;
    const pairing = createFuryGatewayPairingCoordinator({ now });
    const device = authenticate(now);
    pair(pairing, device);
    const registry = createFuryGatewayNodeRegistry({ pairingCoordinator: pairing, now });
    const node = registry.registerNode(device);
    registry.advertiseCapabilities(node, advertisement(1, ['camera']));

    expect(pairing.revokePairing(device.deviceId, device.role)).toBe(true);
    expect(() => registry.advertiseCapabilities(
      node,
      advertisement(2, ['microphone']),
    )).toThrowError(expect.objectContaining({ code: 'pairing-required' }));

    expect(registry.currentAdvertisement(node)?.generation).toBe(1);
  });

  it('bounds node count and permits explicit unregister/re-registration', () => {
    const now = () => 70_000;
    const pairing = createFuryGatewayPairingCoordinator({ now });
    const first = authenticate(now, 'node', 'node-instance-1');
    const second = authenticate(now, 'node', 'node-instance-2');
    pair(pairing, first, 'principal:user-1');
    pair(pairing, second, 'principal:user-1');

    const registry = createFuryGatewayNodeRegistry({
      pairingCoordinator: pairing,
      now,
      maxNodes: 1,
    });
    const firstNode = registry.registerNode(first);
    expect(() => registry.registerNode(second)).toThrowError(
      expect.objectContaining({ code: 'limit-exceeded' }),
    );

    expect(registry.unregisterNode(firstNode)).toBe(true);
    expect(registry.nodeCount()).toBe(0);
    expect(() => registry.currentAdvertisement(firstNode)).toThrowError(
      expect.objectContaining({ code: 'node-not-found' }),
    );

    const secondNode = registry.registerNode(second);
    expect(secondNode.deviceId).toBe(second.deviceId);
    expect(registry.nodeCount()).toBe(1);
  });

  it('exposes digest-only bounded registry observations rather than pairing authority', () => {
    const now = () => 80_000;
    const pairing = createFuryGatewayPairingCoordinator({ now });
    const device = authenticate(now);
    pair(pairing, device, 'principal:operator-1');
    const registry = createFuryGatewayNodeRegistry({ pairingCoordinator: pairing, now });
    const node = registry.registerNode(device);
    const ad = registry.advertiseCapabilities(
      node,
      advertisement(1, ['camera', 'microphone']),
    );

    const snapshot = registry.snapshot();
    expect(snapshot.nodeCount).toBe(1);
    expect(snapshot.authority).toBe('registry-observation-only');
    expect(snapshot.executionAuthority).toBe(false);
    expect(snapshot.nodes[0]?.advertisement).toEqual({
      generation: 1,
      capabilityCount: 2,
      capabilitiesDigestSha256: ad.capabilitiesDigestSha256,
      advertisedAt: 80_000,
      authority: 'advertisement-only',
      executionAuthority: false,
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('principal:operator-1');
    expect(serialized).not.toContain('"capabilities"');
    expect(serialized).not.toContain('executionAuthority":true');
  });
});
