import { generateKeyPairSync, type KeyObject } from 'node:crypto';
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
  type FuryGatewayPairingCoordinator,
} from '../src/gateway-pairing-node.js';
import {
  FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
  createFuryGatewayNodeRegistry,
  type FuryGatewayNodeRegistry,
} from '../src/gateway-node-registry-node.js';
import {
  FURY_GATEWAY_NODE_HEARTBEAT_FORMAT,
  FuryGatewayNodeSessionError,
  createFuryGatewayNodeSessionCoordinator,
  isGeneratedFuryGatewayNodeSession,
  isGeneratedFuryGatewayNodeSessionCoordinator,
  type FuryGatewayNodeHeartbeat,
  type FuryGatewayNodeSession,
} from '../src/gateway-node-session-node.js';

function envelope(
  role: FuryGatewayRole = 'node',
  instanceId = 'node-instance-1',
) {
  return parseFuryGatewayConnectEnvelope({
    format: FURY_GATEWAY_CONNECT_FORMAT,
    protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
    role,
    client: {
      clientId: 'fury-node',
      instanceId,
      platform: 'linux',
      deviceFamily: 'server',
    },
    capabilities: [],
    commands: [],
  });
}

function authenticate(
  now: () => number,
  privateKey: KeyObject,
  role: FuryGatewayRole = 'node',
  instanceId = 'node-instance-1',
) {
  const auth = createFuryGatewayDeviceAuthCoordinator({ now });
  const connect = envelope(role, instanceId);
  const challenge = auth.issueChallenge();
  return auth.verifyProof(
    connect,
    createFuryGatewayDeviceProof(connect, challenge, privateKey),
  );
}

function heartbeat(session: FuryGatewayNodeSession, sequence: number): FuryGatewayNodeHeartbeat {
  return {
    format: FURY_GATEWAY_NODE_HEARTBEAT_FORMAT,
    sessionId: session.sessionId,
    livenessEpoch: session.livenessEpoch,
    sequence,
  };
}

function harness(overrides: {
  heartbeatTtlMs?: number;
  maxAuthenticatedAgeMs?: number;
  maxActiveSessions?: number;
} = {}) {
  let time = 10_000;
  const now = () => time;
  const keys = generateKeyPairSync('ed25519');
  const pairing = createFuryGatewayPairingCoordinator({ now });
  const firstDevice = authenticate(now, keys.privateKey);
  const request = pairing.requestPairing(firstDevice);
  const paired = pairing.approvePairing(request.requestId, 'principal:owner-1');
  const registry = createFuryGatewayNodeRegistry({ pairingCoordinator: pairing, now });
  const node = registry.registerNode(firstDevice);
  const sessions = createFuryGatewayNodeSessionCoordinator({
    nodeRegistry: registry,
    pairingCoordinator: pairing,
    now,
    ...overrides,
  });
  return {
    get time() { return time; },
    set time(value: number) { time = value; },
    now,
    keys,
    pairing,
    paired,
    registry,
    node,
    sessions,
    firstDevice,
  };
}

describe('Fury Gateway Phase 9 node session/liveness', () => {
  it('requires genuine process-local registry and pairing coordinators', () => {
    const h = harness();
    expect(isGeneratedFuryGatewayNodeSessionCoordinator(h.sessions)).toBe(true);
    expect(isGeneratedFuryGatewayNodeSessionCoordinator({ ...h.sessions })).toBe(false);

    expect(() => createFuryGatewayNodeSessionCoordinator({
      nodeRegistry: { ...h.registry } as FuryGatewayNodeRegistry,
      pairingCoordinator: h.pairing,
      now: h.now,
    })).toThrowError(expect.objectContaining({ code: 'invalid-node-registry' }));

    expect(() => createFuryGatewayNodeSessionCoordinator({
      nodeRegistry: h.registry,
      pairingCoordinator: { ...h.pairing } as FuryGatewayPairingCoordinator,
      now: h.now,
    })).toThrowError(expect.objectContaining({ code: 'invalid-pairing-coordinator' }));
  });

  it('opens evidence-only live sessions from current node, fresh auth and pairing evidence', () => {
    const h = harness();
    const session = h.sessions.openSession(h.node, h.firstDevice);

    expect(isGeneratedFuryGatewayNodeSession(session)).toBe(true);
    expect(session.deviceId).toBe(h.firstDevice.deviceId);
    expect(session.publicKeySha256).toBe(h.firstDevice.publicKeySha256);
    expect(session.pairingId).toBe(h.paired.pairingId);
    expect(session.registrationId).toBe(h.node.registrationId);
    expect(session.clientId).toBe(h.node.clientId);
    expect(session.instanceId).toBe(h.node.instanceId);
    expect(session.authority).toBe('node-session-evidence-only');
    expect(session.authorization).toBe('none');
    expect(session.executionAuthority).toBe(false);
    expect(session.automaticReplayAllowed).toBe(false);
    expect(h.sessions.isLiveSession(session)).toBe(true);
    expect(h.sessions.activeSessionCount()).toBe(1);
    expect('execute' in h.sessions).toBe(false);
    expect('shell' in h.sessions).toBe(false);
    expect('camera' in h.sessions).toBe(false);
    expect('microphone' in h.sessions).toBe(false);
    expect('speaker' in h.sessions).toBe(false);
    expect('notify' in h.sessions).toBe(false);
    expect('write' in h.sessions).toBe(false);
  });

  it('rejects copied node and copied session evidence', () => {
    const h = harness();
    expect(() => h.sessions.openSession({ ...h.node }, h.firstDevice)).toThrowError(
      expect.objectContaining({ code: 'invalid-node-evidence' }),
    );

    const session = h.sessions.openSession(h.node, h.firstDevice);
    const copied = { ...session } as FuryGatewayNodeSession;
    expect(isGeneratedFuryGatewayNodeSession(copied)).toBe(false);
    expect(() => h.sessions.inspectSession(copied)).toThrowError(
      expect.objectContaining({ code: 'invalid-session-evidence' }),
    );
  });

  it('rejects identity mismatch and non-node authenticated evidence', () => {
    const h = harness();
    h.time += 100;
    const changedInstance = authenticate(h.now, h.keys.privateKey, 'node', 'node-instance-2');
    expect(() => h.sessions.openSession(h.node, changedInstance)).toThrowError(
      expect.objectContaining({ code: 'identity-mismatch' }),
    );

    const worker = authenticate(h.now, h.keys.privateKey, 'worker', 'node-instance-1');
    expect(() => h.sessions.openSession(h.node, worker)).toThrowError(
      expect.objectContaining({ code: 'invalid-authenticated-device' }),
    );
  });

  it('requires fresh authenticated-device evidence on every connect/reconnect', () => {
    const h = harness({ maxAuthenticatedAgeMs: 5_000 });
    h.time += 5_001;
    expect(() => h.sessions.openSession(h.node, h.firstDevice)).toThrowError(
      expect.objectContaining({ code: 'authenticated-device-stale' }),
    );
  });

  it('accepts monotonically increasing heartbeats and updates liveness', () => {
    const h = harness({ heartbeatTtlMs: 5_000 });
    const session = h.sessions.openSession(h.node, h.firstDevice);
    h.time += 2_000;
    const first = h.sessions.heartbeat(session, heartbeat(session, 1));
    expect(first.status).toBe('live');
    expect(first.lastHeartbeatAt).toBe(h.time);
    expect(first.heartbeatSequence).toBe(1);
    expect(first.liveUntil).toBe(h.time + 5_000);

    h.time += 1_000;
    const second = h.sessions.heartbeat(session, heartbeat(session, 9));
    expect(second.status).toBe('live');
    expect(second.heartbeatSequence).toBe(9);
  });

  it('rejects stale heartbeat sequences', () => {
    const h = harness();
    const session = h.sessions.openSession(h.node, h.firstDevice);
    h.sessions.heartbeat(session, heartbeat(session, 5));
    expect(() => h.sessions.heartbeat(session, heartbeat(session, 5))).toThrowError(
      expect.objectContaining({ code: 'stale-heartbeat' }),
    );
    expect(() => h.sessions.heartbeat(session, heartbeat(session, 4))).toThrowError(
      expect.objectContaining({ code: 'stale-heartbeat' }),
    );
  });

  it('rejects heartbeat schema drift, accessors and wrong session identity', () => {
    const h = harness();
    const session = h.sessions.openSession(h.node, h.firstDevice);

    expect(() => h.sessions.heartbeat(session, {
      ...heartbeat(session, 1),
      authorization: 'granted',
    } as FuryGatewayNodeHeartbeat)).toThrowError(
      expect.objectContaining({ code: 'invalid-heartbeat' }),
    );

    const accessor = heartbeat(session, 1) as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, 'sequence', {
      enumerable: true,
      get: () => 1,
    });
    expect(() => h.sessions.heartbeat(
      session,
      accessor as unknown as FuryGatewayNodeHeartbeat,
    )).toThrowError(expect.objectContaining({ code: 'invalid-heartbeat' }));

    const wrongEpoch = {
      ...heartbeat(session, 1),
      livenessEpoch: 'A'.repeat(22),
    };
    expect(() => h.sessions.heartbeat(session, wrongEpoch)).toThrowError(
      expect.objectContaining({ code: 'invalid-heartbeat' }),
    );
  });

  it('times out liveness and requires a new session instead of reviving the old one', () => {
    const h = harness({ heartbeatTtlMs: 5_000 });
    const session = h.sessions.openSession(h.node, h.firstDevice);
    h.time += 5_001;

    expect(h.sessions.isLiveSession(session)).toBe(false);
    expect(h.sessions.inspectSession(session).status).toBe('timed-out');
    expect(() => h.sessions.heartbeat(session, heartbeat(session, 1))).toThrowError(
      expect.objectContaining({ code: 'session-not-live' }),
    );
    expect(h.sessions.activeSessionCount()).toBe(0);
  });

  it('explicit close disconnects without rollback/replay semantics', () => {
    const h = harness();
    const session = h.sessions.openSession(h.node, h.firstDevice);
    expect(h.sessions.closeSession(session)).toBe(true);
    expect(h.sessions.closeSession(session)).toBe(false);
    const observed = h.sessions.inspectSession(session);
    expect(observed.status).toBe('closed');
    expect(observed.automaticReplayAllowed).toBe(false);
    expect(observed.executionAuthority).toBe(false);
    expect(() => h.sessions.heartbeat(session, heartbeat(session, 1))).toThrowError(
      expect.objectContaining({ code: 'session-not-live' }),
    );
  });

  it('reconnect creates a new session identity/epoch and supersedes the old session', () => {
    const h = harness();
    const first = h.sessions.openSession(h.node, h.firstDevice);
    h.time += 100;
    const fresh = authenticate(h.now, h.keys.privateKey);
    const second = h.sessions.openSession(h.node, fresh);

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.livenessEpoch).not.toBe(first.livenessEpoch);
    expect(second.deviceId).toBe(first.deviceId);
    expect(second.pairingId).toBe(first.pairingId);
    expect(h.sessions.inspectSession(first).status).toBe('superseded');
    expect(h.sessions.isLiveSession(first)).toBe(false);
    expect(h.sessions.isLiveSession(second)).toBe(true);
    expect(() => h.sessions.heartbeat(first, heartbeat(first, 1))).toThrowError(
      expect.objectContaining({ code: 'session-not-live' }),
    );
    expect(h.sessions.activeSessionCount()).toBe(1);
  });

  it('pairing revocation invalidates future liveness use', () => {
    const h = harness();
    const session = h.sessions.openSession(h.node, h.firstDevice);
    expect(h.pairing.revokePairing(h.firstDevice.deviceId, h.firstDevice.role)).toBe(true);

    expect(h.sessions.isLiveSession(session)).toBe(false);
    expect(h.sessions.inspectSession(session).status).toBe('pairing-revoked');
    expect(() => h.sessions.heartbeat(session, heartbeat(session, 1))).toThrowError(
      expect.objectContaining({ code: 'session-not-live' }),
    );
  });

  it('a changed pairing identity cannot restore the old node session', () => {
    const h = harness();
    const session = h.sessions.openSession(h.node, h.firstDevice);
    h.pairing.revokePairing(h.firstDevice.deviceId, h.firstDevice.role);
    h.time += 100;
    const fresh = authenticate(h.now, h.keys.privateKey);
    const request = h.pairing.requestPairing(fresh);
    const replacement = h.pairing.approvePairing(request.requestId, 'principal:owner-2');
    expect(replacement.pairingId).not.toBe(h.node.pairingId);

    expect(h.sessions.inspectSession(session).status).toBe('pairing-changed');
    expect(() => h.sessions.openSession(h.node, fresh)).toThrowError(
      expect.objectContaining({ code: 'pairing-changed' }),
    );
  });

  it('does not make a pre-reconnect advertisement current for the new session', () => {
    const h = harness();
    h.registry.advertiseCapabilities(h.node, {
      format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
      generation: 1,
      capabilities: ['camera'],
    });
    const first = h.sessions.openSession(h.node, h.firstDevice);
    expect(h.sessions.inspectSession(first).capability).toBeUndefined();

    h.registry.advertiseCapabilities(h.node, {
      format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
      generation: 2,
      capabilities: ['camera', 'microphone'],
    });
    expect(h.sessions.inspectSession(first).capability?.generation).toBe(2);

    h.time += 100;
    const fresh = authenticate(h.now, h.keys.privateKey);
    const second = h.sessions.openSession(h.node, fresh);
    expect(h.sessions.inspectSession(second).capability).toBeUndefined();

    const current = h.registry.advertiseCapabilities(h.node, {
      format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
      generation: 3,
      capabilities: ['microphone'],
    });
    const observed = h.sessions.inspectSession(second);
    expect(observed.capability).toEqual({
      generation: 3,
      capabilitiesDigestSha256: current.capabilitiesDigestSha256,
      advertisedAt: current.advertisedAt,
      currentForSession: true,
      authority: 'advertisement-observation-only',
      executionAuthority: false,
    });
  });

  it('a fresh coordinator after restart does not recognize old process-local session evidence', () => {
    const h = harness();
    const old = h.sessions.openSession(h.node, h.firstDevice);
    const afterRestart = createFuryGatewayNodeSessionCoordinator({
      nodeRegistry: h.registry,
      pairingCoordinator: h.pairing,
      now: h.now,
    });

    expect(afterRestart.isLiveSession(old)).toBe(false);
    expect(() => afterRestart.inspectSession(old)).toThrowError(
      expect.objectContaining({ code: 'invalid-session-evidence' }),
    );
  });

  it('enforces live-session quota while allowing same-node reconnect replacement', () => {
    const h = harness({ maxActiveSessions: 1 });
    const first = h.sessions.openSession(h.node, h.firstDevice);

    const otherKeys = generateKeyPairSync('ed25519');
    const otherDevice = authenticate(h.now, otherKeys.privateKey, 'node', 'node-instance-2');
    const request = h.pairing.requestPairing(otherDevice);
    h.pairing.approvePairing(request.requestId, 'principal:owner-1');
    const otherNode = h.registry.registerNode(otherDevice);

    expect(() => h.sessions.openSession(otherNode, otherDevice)).toThrowError(
      expect.objectContaining({ code: 'limit-exceeded' }),
    );

    h.time += 100;
    const fresh = authenticate(h.now, h.keys.privateKey);
    const replacement = h.sessions.openSession(h.node, fresh);
    expect(h.sessions.inspectSession(first).status).toBe('superseded');
    expect(h.sessions.isLiveSession(replacement)).toBe(true);
    expect(h.sessions.activeSessionCount()).toBe(1);
  });

  it('unregistering the node invalidates session liveness', () => {
    const h = harness();
    const session = h.sessions.openSession(h.node, h.firstDevice);
    expect(h.registry.unregisterNode(h.node)).toBe(true);

    expect(h.sessions.isLiveSession(session)).toBe(false);
    expect(h.sessions.inspectSession(session).status).toBe('node-unregistered');
  });

  it('exposes bounded observation-only snapshots without raw capabilities or authority', () => {
    const h = harness();
    const session = h.sessions.openSession(h.node, h.firstDevice);
    h.time += 100;
    h.sessions.heartbeat(session, heartbeat(session, 1));
    const ad = h.registry.advertiseCapabilities(h.node, {
      format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
      generation: 1,
      capabilities: ['camera', 'microphone'],
    });

    const snapshot = h.sessions.snapshot();
    expect(snapshot.liveSessionCount).toBe(1);
    expect(snapshot.authority).toBe('node-session-observation-only');
    expect(snapshot.executionAuthority).toBe(false);
    expect(snapshot.sessions[0]?.capabilityGeneration).toBe(1);
    expect(snapshot.sessions[0]?.capabilitiesDigestSha256).toBe(ad.capabilitiesDigestSha256);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('"capabilities"');
    expect(serialized).not.toContain('executionAuthority":true');
    expect(serialized).not.toContain('authorization":"granted');
  });

  it('rejects invalid heartbeat sequence bounds without mutating liveness', () => {
    const h = harness();
    const session = h.sessions.openSession(h.node, h.firstDevice);
    expect(() => h.sessions.heartbeat(session, heartbeat(session, 0))).toThrowError(
      expect.objectContaining({ code: 'invalid-heartbeat' }),
    );
    expect(() => h.sessions.heartbeat(
      session,
      heartbeat(session, 1_000_000_001),
    )).toThrowError(expect.objectContaining({ code: 'invalid-heartbeat' }));
    expect(h.sessions.inspectSession(session).heartbeatSequence).toBe(0);
  });

  it('uses explicit FuryGatewayNodeSessionError codes for non-live heartbeat attempts', () => {
    const h = harness();
    const session = h.sessions.openSession(h.node, h.firstDevice);
    h.sessions.closeSession(session);
    try {
      h.sessions.heartbeat(session, heartbeat(session, 1));
      throw new Error('expected heartbeat to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(FuryGatewayNodeSessionError);
      expect((error as FuryGatewayNodeSessionError).code).toBe('session-not-live');
    }
  });
});
