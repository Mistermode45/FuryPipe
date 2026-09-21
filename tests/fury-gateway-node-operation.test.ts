import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  FURY_GATEWAY_CONNECT_FORMAT,
  FURY_GATEWAY_PROTOCOL_VERSION,
  parseFuryGatewayConnectEnvelope,
} from '../src/gateway.js';
import {
  createFuryGatewayDeviceAuthCoordinator,
  createFuryGatewayDeviceProof,
} from '../src/gateway-auth-node.js';
import {
  createFuryGatewayPairingCoordinator,
} from '../src/gateway-pairing-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
} from '../src/gateway-principal-node.js';
import {
  createFuryGatewaySessionCoordinator,
  type FuryGatewaySessionCoordinator,
} from '../src/gateway-session-node.js';
import {
  FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
  createFuryGatewayNodeRegistry,
  type FuryGatewayNodeCapabilityAdvertisement,
  type FuryGatewayNodeRegistry,
} from '../src/gateway-node-registry-node.js';
import {
  createFuryGatewayNodeSessionCoordinator,
  type FuryGatewayNodeSessionCoordinator,
} from '../src/gateway-node-session-node.js';
import {
  FURY_GATEWAY_NODE_OPERATION_FORMAT,
  FuryGatewayNodeOperationError,
  createFuryGatewayNodeOperationCoordinator,
  isGeneratedFuryGatewayNodeOperationCoordinator,
  isGeneratedFuryGatewayNodeOperationPermit,
  type FuryGatewayNodeOperation,
  type FuryGatewayNodeOperationCoordinator,
  type FuryGatewayNodeOperationPermit,
} from '../src/gateway-node-operation-node.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function envelope() {
  return parseFuryGatewayConnectEnvelope({
    format: FURY_GATEWAY_CONNECT_FORMAT,
    protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
    role: 'node',
    client: {
      clientId: 'fury-node',
      instanceId: 'node-instance-1',
      platform: 'linux',
      deviceFamily: 'server',
    },
    capabilities: [],
    commands: [],
  });
}

function authenticate(now: () => number, privateKey: KeyObject) {
  const auth = createFuryGatewayDeviceAuthCoordinator({ now });
  const connect = envelope();
  const challenge = auth.issueChallenge();
  return auth.verifyProof(
    connect,
    createFuryGatewayDeviceProof(connect, challenge, privateKey),
  );
}

function operation(overrides: Partial<FuryGatewayNodeOperation> = {}): FuryGatewayNodeOperation {
  return {
    format: FURY_GATEWAY_NODE_OPERATION_FORMAT,
    operationId: 'node.notify.once',
    capability: 'notification.show',
    action: 'notification.show',
    targetDigestSha256: sha256('bounded-notification-payload'),
    sideEffecting: true,
    ...overrides,
  };
}

function harness(overrides: {
  permitTtlMs?: number;
  maxActivePermits?: number;
  gatewayScopes?: readonly ('nodes.manage' | 'nodes.inspect')[];
} = {}) {
  let time = 100_000;
  const now = () => time;
  const keys = generateKeyPairSync('ed25519');

  const pairing = createFuryGatewayPairingCoordinator({ now });
  const device = authenticate(now, keys.privateKey);
  const request = pairing.requestPairing(device);
  pairing.approvePairing(request.requestId, 'principal:owner');

  const nodeRegistry = createFuryGatewayNodeRegistry({
    pairingCoordinator: pairing,
    now,
  });
  const node = nodeRegistry.registerNode(device);
  const nodeSessions = createFuryGatewayNodeSessionCoordinator({
    nodeRegistry,
    pairingCoordinator: pairing,
    now,
  });
  const nodeSession = nodeSessions.openSession(node, device);
  const advertisement = nodeRegistry.advertiseCapabilities(node, {
    format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
    generation: 1,
    capabilities: ['notification.show', 'system.inspect'],
  });

  const principals = createFuryGatewayPrincipalRegistry({ now });
  const principal = principals.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:user-1',
    kind: 'human',
    issuer: 'local',
    subject: 'owner-local-account',
    authenticationMethod: 'local-owner',
  });
  const gatewaySessions = createFuryGatewaySessionCoordinator({
    principalRegistry: principals,
    gatewayInstanceId: 'gateway-test',
    now,
    defaultTtlMs: 60_000,
    maxTtlMs: 60_000,
  });
  const gatewaySession = gatewaySessions.issueSession({
    principal,
    role: 'operator',
    scopes: overrides.gatewayScopes ?? ['nodes.manage'],
    binding: { kind: 'local-operator' },
  });

  const coordinator = createFuryGatewayNodeOperationCoordinator({
    nodeRegistry,
    nodeSessionCoordinator: nodeSessions,
    gatewaySessionCoordinator: gatewaySessions,
    gatewaySession,
    now,
    ...(overrides.permitTtlMs === undefined ? {} : { permitTtlMs: overrides.permitTtlMs }),
    ...(overrides.maxActivePermits === undefined ? {} : { maxActivePermits: overrides.maxActivePermits }),
  });

  return {
    get time() { return time; },
    set time(value: number) { time = value; },
    now,
    keys,
    pairing,
    device,
    nodeRegistry,
    node,
    nodeSessions,
    nodeSession,
    advertisement,
    principals,
    principal,
    gatewaySessions,
    gatewaySession,
    coordinator,
  };
}

function issue(h: ReturnType<typeof harness>, op = operation()): FuryGatewayNodeOperationPermit {
  return h.coordinator.issuePermit(h.node, h.nodeSession, h.advertisement, op);
}

describe('Fury Gateway Phase 9 governed node-operation permits', () => {
  it('requires genuine process-local node/session authority coordinators', () => {
    const h = harness();
    expect(isGeneratedFuryGatewayNodeOperationCoordinator(h.coordinator)).toBe(true);
    expect(isGeneratedFuryGatewayNodeOperationCoordinator({ ...h.coordinator })).toBe(false);

    expect(() => createFuryGatewayNodeOperationCoordinator({
      nodeRegistry: { ...h.nodeRegistry } as FuryGatewayNodeRegistry,
      nodeSessionCoordinator: h.nodeSessions,
      gatewaySessionCoordinator: h.gatewaySessions,
      gatewaySession: h.gatewaySession,
      now: h.now,
    })).toThrowError(expect.objectContaining({ code: 'invalid-config' }));

    expect(() => createFuryGatewayNodeOperationCoordinator({
      nodeRegistry: h.nodeRegistry,
      nodeSessionCoordinator: { ...h.nodeSessions } as FuryGatewayNodeSessionCoordinator,
      gatewaySessionCoordinator: h.gatewaySessions,
      gatewaySession: h.gatewaySession,
      now: h.now,
    })).toThrowError(expect.objectContaining({ code: 'invalid-config' }));
  });

  it('mints one-shot process-local permits bound to exact principal, node session and capability generation', () => {
    const h = harness();
    const permit = issue(h);

    expect(isGeneratedFuryGatewayNodeOperationPermit(permit)).toBe(true);
    expect(permit.authority).toBe('node-operation-permit');
    expect(permit.executionAuthority).toBe(true);
    expect(permit.automaticReplayAllowed).toBe(false);
    expect(permit.capability).toBe('notification.show');
    expect(permit.capabilityGeneration).toBe(1);
    expect(permit.capabilitiesDigestSha256).toBe(h.advertisement.capabilitiesDigestSha256);
    expect(permit.operationDigestSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(permit.gatewaySessionIdSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(permit.principalIdSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(permit.nodeSessionIdSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(h.coordinator.activePermitCount()).toBe(1);
  });

  it('does not expose a node execution, shell, filesystem or media transport surface', () => {
    const h = harness();
    expect('execute' in h.coordinator).toBe(false);
    expect('dispatch' in h.coordinator).toBe(false);
    expect('shell' in h.coordinator).toBe(false);
    expect('writeFile' in h.coordinator).toBe(false);
    expect('camera' in h.coordinator).toBe(false);
    expect('microphone' in h.coordinator).toBe(false);
    expect('speaker' in h.coordinator).toBe(false);
  });

  it('rejects copied permit evidence', () => {
    const h = harness();
    const permit = issue(h);
    const copied = { ...permit } as FuryGatewayNodeOperationPermit;
    expect(isGeneratedFuryGatewayNodeOperationPermit(copied)).toBe(false);
    expect(() => h.coordinator.consumeForDispatch(copied, operation())).toThrowError(
      expect.objectContaining({ code: 'invalid-permit' }),
    );
  });

  it('binds the permit to the exact operation digest', () => {
    const h = harness();
    const permit = issue(h);
    expect(() => h.coordinator.consumeForDispatch(
      permit,
      operation({ targetDigestSha256: sha256('different-payload') }),
    )).toThrowError(expect.objectContaining({ code: 'permit-stale' }));
    expect(h.coordinator.activePermitCount()).toBe(1);
  });

  it('requires the requested capability to be currently advertised for the live session', () => {
    const h = harness();
    expect(() => issue(h, operation({ capability: 'camera.capture' }))).toThrowError(
      expect.objectContaining({ code: 'capability-not-advertised' }),
    );
  });

  it('requires current Gateway policy admission and nodes.manage scope', () => {
    const h = harness({ gatewayScopes: ['nodes.inspect'] });
    expect(() => issue(h)).toThrowError(
      expect.objectContaining({ code: 'gateway-admission-denied' }),
    );
  });

  it('revalidates policy immediately before dispatch consumption', () => {
    const h = harness();
    const permit = issue(h);
    expect(h.gatewaySessions.revokeSession(h.gatewaySession.sessionId)).toBe(true);
    expect(() => h.coordinator.consumeForDispatch(permit, operation())).toThrowError(
      expect.objectContaining({ code: 'permit-stale' }),
    );
  });

  it('rejects stale capability generation replacement before dispatch', () => {
    const h = harness();
    const permit = issue(h);
    h.nodeRegistry.advertiseCapabilities(h.node, {
      format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
      generation: 2,
      capabilities: ['notification.show', 'system.inspect'],
    });
    expect(() => h.coordinator.consumeForDispatch(permit, operation())).toThrowError(
      expect.objectContaining({ code: 'permit-stale' }),
    );
  });

  it('rejects disconnect before dispatch and never converts it to safe retry', () => {
    const h = harness();
    const permit = issue(h);
    expect(h.nodeSessions.closeSession(h.nodeSession)).toBe(true);
    expect(() => h.coordinator.consumeForDispatch(permit, operation())).toThrowError(
      expect.objectContaining({ code: 'permit-stale', retrySafe: false }),
    );
  });

  it('consumes a permit exactly once at the dispatch boundary', () => {
    const h = harness();
    const permit = issue(h);
    const receipt = h.coordinator.consumeForDispatch(permit, operation());

    expect(receipt.outcome).toBe('consumed-for-dispatch');
    expect(receipt.authority).toBe('dispatch-admission-evidence-only');
    expect(receipt.executionAuthority).toBe(false);
    expect(receipt.automaticReplayAllowed).toBe(false);
    expect(receipt.retrySafe).toBe(false);
    expect(receipt.reconciliationRequiredIfDispatchOutcomeUnknown).toBe(true);
    expect(h.coordinator.activePermitCount()).toBe(0);
    expect(() => h.coordinator.consumeForDispatch(permit, operation())).toThrowError(
      expect.objectContaining({ code: 'permit-consumed' }),
    );
  });

  it('expires permits without restoring authority', () => {
    const h = harness({ permitTtlMs: 1_000 });
    const permit = issue(h);
    h.time += 1_001;
    expect(() => h.coordinator.consumeForDispatch(permit, operation())).toThrowError(
      expect.objectContaining({ code: 'permit-expired' }),
    );
    expect(h.coordinator.activePermitCount()).toBe(0);
  });

  it('invalidates old permits across reconnect and requires a new capability advertisement', () => {
    const h = harness();
    const oldPermit = issue(h);
    h.time += 100;
    const freshDevice = authenticate(h.now, h.keys.privateKey);
    const newSession = h.nodeSessions.openSession(h.node, freshDevice);

    expect(() => h.coordinator.consumeForDispatch(oldPermit, operation())).toThrowError(
      expect.objectContaining({ code: 'permit-stale' }),
    );
    expect(h.nodeSessions.inspectSession(newSession).capability).toBeUndefined();

    const nextAdvertisement = h.nodeRegistry.advertiseCapabilities(h.node, {
      format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
      generation: 2,
      capabilities: ['notification.show'],
    });
    const nextPermit = h.coordinator.issuePermit(
      h.node,
      newSession,
      nextAdvertisement,
      operation(),
    );
    expect(nextPermit.nodeSessionIdSha256).not.toBe(oldPermit.nodeSessionIdSha256);
  });

  it('does not recognize old permits after coordinator restart', () => {
    const h = harness();
    const permit = issue(h);
    const restarted = createFuryGatewayNodeOperationCoordinator({
      nodeRegistry: h.nodeRegistry,
      nodeSessionCoordinator: h.nodeSessions,
      gatewaySessionCoordinator: h.gatewaySessions,
      gatewaySession: h.gatewaySession,
      now: h.now,
    });
    expect(() => restarted.consumeForDispatch(permit, operation())).toThrowError(
      expect.objectContaining({ code: 'invalid-permit' }),
    );
  });

  it('enforces a bounded active permit registry and releases quota after expiry', () => {
    const h = harness({ maxActivePermits: 1, permitTtlMs: 1_000 });
    issue(h);
    expect(() => issue(h, operation({ operationId: 'node.notify.second' }))).toThrowError(
      expect.objectContaining({ code: 'limit-exceeded' }),
    );
    h.time += 1_001;
    expect(h.coordinator.activePermitCount()).toBe(0);
    expect(() => issue(h, operation({ operationId: 'node.notify.second' }))).not.toThrow();
  });

  it('rejects schema drift and copied capability evidence', () => {
    const h = harness();
    expect(() => issue(h, {
      ...operation(),
      authorization: 'ambient',
    } as FuryGatewayNodeOperation)).toThrowError(
      expect.objectContaining({ code: 'invalid-operation' }),
    );

    expect(() => h.coordinator.issuePermit(
      h.node,
      h.nodeSession,
      { ...h.advertisement } as FuryGatewayNodeCapabilityAdvertisement,
      operation(),
    )).toThrowError(expect.objectContaining({ code: 'capability-not-current' }));
  });

});