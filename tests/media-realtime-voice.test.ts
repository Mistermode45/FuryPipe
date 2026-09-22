import { createHash, generateKeyPairSync } from 'node:crypto';
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
import { createFuryGatewayPairingCoordinator } from '../src/gateway-pairing-node.js';
import {
  FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
  createFuryGatewayNodeRegistry,
} from '../src/gateway-node-registry-node.js';
import { createFuryGatewayNodeSessionCoordinator } from '../src/gateway-node-session-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
} from '../src/gateway-principal-node.js';
import { createFuryGatewaySessionCoordinator } from '../src/gateway-session-node.js';
import {
  FURY_MEDIA_PLUGIN_BUNDLE_FORMAT,
  FURY_MEDIA_PLUGIN_PROFILE_FORMAT,
  validateFuryMediaPluginBundle,
} from '../src/media-plugin-contracts.js';
import {
  FURY_REALTIME_VOICE_FRAME_FORMAT,
  FURY_REALTIME_VOICE_POLICY_FORMAT,
  FuryRealtimeVoiceError,
  createFuryRealtimeVoiceAdapterRegistry,
  createFuryRealtimeVoiceCoordinator,
  isGeneratedFuryRealtimeVoiceAdapterRegistry,
  isGeneratedFuryRealtimeVoiceCoordinator,
  isGeneratedFuryRealtimeVoiceLease,
  isGeneratedFuryRealtimeVoiceRequest,
  type FuryRealtimeVoiceAdapter,
  type FuryRealtimeVoiceLease,
  type FuryRealtimeVoicePolicy,
  type FuryRealtimeVoiceRequest,
} from '../src/media-realtime-voice.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function bundle(observedAt = 100_000) {
  return validateFuryMediaPluginBundle({
    format: FURY_MEDIA_PLUGIN_BUNDLE_FORMAT,
    id: 'realtime-lab',
    version: '1.0.0',
    permissions: ['media-read', 'media-write', 'voice-realtime'],
    source: {
      url: 'https://github.com/example/realtime-lab',
      commitSha: '1234567890abcdef1234567890abcdef12345678',
      licenseStatus: 'VERIFIED',
      licenseSpdx: 'MIT',
    },
    profiles: [{
      format: FURY_MEDIA_PLUGIN_PROFILE_FORMAT,
      id: 'voice-main',
      family: 'realtime-voice-provider',
      permissions: ['media-read', 'media-write', 'voice-realtime'],
      supportedMediaTypes: ['audio/wav'],
      bounds: {
        maxInputBytes: 4096,
        maxOutputBytes: 4096,
        maxItems: 1,
        maxDurationMs: 60_000,
      },
      health: {
        status: 'healthy',
        observedAt,
        authority: 'health-observation-only',
        executionAuthority: false,
      },
      secretRefs: ['VOICE_REALTIME_API_KEY'],
      lifecycle: 'registered',
      compatibility: ['phase9-v1'],
    }],
  });
}

function adapter(overrides: Partial<FuryRealtimeVoiceAdapter> = {}): FuryRealtimeVoiceAdapter {
  return {
    bundleId: 'realtime-lab',
    bundleVersion: '1.0.0',
    profileId: 'voice-main',
    sendFrame: async () => ({ status: 'accepted', providerSessionId: 'provider-session-1' }),
    interrupt: async () => ({ status: 'acknowledged', providerSessionId: 'provider-session-1' }),
    cancel: async () => ({ status: 'acknowledged', providerSessionId: 'provider-session-1' }),
    ...overrides,
  };
}

function harness(adapterOverride: Partial<FuryRealtimeVoiceAdapter> = {}, options: { maxActiveLeases?: number } = {}) {
  let time = 100_000;
  const now = () => time;
  const keys = generateKeyPairSync('ed25519');
  const connect = parseFuryGatewayConnectEnvelope({
    format: FURY_GATEWAY_CONNECT_FORMAT,
    protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
    role: 'node',
    client: {
      clientId: 'fury-node',
      instanceId: 'voice-node-1',
      platform: 'linux',
      deviceFamily: 'workstation',
    },
    capabilities: [],
    commands: [],
  });
  const auth = createFuryGatewayDeviceAuthCoordinator({ now });
  const authenticate = () => {
    const challenge = auth.issueChallenge();
    return auth.verifyProof(connect, createFuryGatewayDeviceProof(connect, challenge, keys.privateKey));
  };
  const device = authenticate();
  const pairing = createFuryGatewayPairingCoordinator({ now });
  const pairingRequest = pairing.requestPairing(device);
  pairing.approvePairing(pairingRequest.requestId, 'principal:owner-1');
  const nodes = createFuryGatewayNodeRegistry({ pairingCoordinator: pairing, now });
  const node = nodes.registerNode(device);
  const nodeSessions = createFuryGatewayNodeSessionCoordinator({
    nodeRegistry: nodes,
    pairingCoordinator: pairing,
    now,
    heartbeatTtlMs: 60_000,
  });
  const nodeSession = nodeSessions.openSession(node, device);
  nodes.advertiseCapabilities(node, {
    format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
    generation: 1,
    capabilities: ['voice.realtime'],
  });

  const principals = createFuryGatewayPrincipalRegistry({ now, evidenceTtlMs: 5 * 60_000 });
  const principal = principals.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:owner-1',
    kind: 'human',
    issuer: 'local',
    subject: 'owner-local-account',
    authenticationMethod: 'local-owner',
  });
  const gatewaySessions = createFuryGatewaySessionCoordinator({
    principalRegistry: principals,
    gatewayInstanceId: 'gateway-phase9-test',
    now,
    defaultTtlMs: 120_000,
    maxTtlMs: 300_000,
    terminalRetentionMs: 30_000,
  });
  const gatewaySession = gatewaySessions.issueSession({
    principal,
    role: 'operator',
    scopes: ['nodes.manage', 'nodes.inspect'],
    binding: { kind: 'local-operator' },
  });
  const adapters = createFuryRealtimeVoiceAdapterRegistry([adapter(adapterOverride)]);
  const coordinator = createFuryRealtimeVoiceCoordinator({
    gatewaySessionCoordinator: gatewaySessions,
    gatewaySession,
    nodeSessionCoordinator: nodeSessions,
    nodeSession,
    nodeRegistry: nodes,
    node,
    adapters,
    now,
    maxHealthAgeMs: 60_000,
    maxLeaseTtlMs: 60_000,
    ...(options.maxActiveLeases === undefined ? {} : { maxActiveLeases: options.maxActiveLeases }),
  });
  return {
    get time() { return time; },
    set time(value: number) { time = value; },
    now,
    keys,
    connect,
    auth,
    authenticate,
    pairing,
    nodes,
    node,
    nodeSessions,
    nodeSession,
    principals,
    gatewaySessions,
    gatewaySession,
    adapters,
    coordinator,
  };
}

function request(h: ReturnType<typeof harness>, overrides: Partial<Parameters<typeof h.coordinator.prepare>[0]> = {}) {
  return h.coordinator.prepare({
    bundle: bundle(h.time),
    profileId: 'voice-main',
    direction: 'duplex',
    sourceDigestSha256: sha256('microphone:voice-node-1'),
    sinkDigestSha256: sha256('provider:realtime-lab'),
    maxBytes: 4096,
    maxFrames: 8,
    maxDurationMs: 30_000,
    ...overrides,
  });
}

function policy(req: FuryRealtimeVoiceRequest, overrides: Partial<FuryRealtimeVoicePolicy> = {}): FuryRealtimeVoicePolicy {
  return {
    format: FURY_REALTIME_VOICE_POLICY_FORMAT,
    policyId: 'realtime-policy-1',
    allowStream: true,
    requestDigestSha256: req.requestDigestSha256,
    bundleId: req.bundleId,
    bundleVersion: req.bundleVersion,
    profileId: req.profileId,
    direction: req.direction,
    sourceDigestSha256: req.sourceDigestSha256,
    sinkDigestSha256: req.sinkDigestSha256,
    expiresInMs: 20_000,
    ...overrides,
  };
}

function lease(h: ReturnType<typeof harness>) {
  const req = request(h);
  return { req, lease: h.coordinator.authorize(req, policy(req)) };
}

function frame(sequence: number, overrides: Partial<{ direction: 'input' | 'output'; mimeType: string; bytes: Uint8Array }> = {}) {
  return {
    format: FURY_REALTIME_VOICE_FRAME_FORMAT,
    sequence,
    direction: 'input' as const,
    mimeType: 'audio/wav',
    bytes: new Uint8Array([1, 2, 3, 4]),
    ...overrides,
  };
}

describe('FuryPipe Phase 9 realtime voice streaming leases', () => {
  it('creates genuine process-local coordinator and adapter registry evidence', () => {
    const h = harness();
    expect(isGeneratedFuryRealtimeVoiceAdapterRegistry(h.adapters)).toBe(true);
    expect(isGeneratedFuryRealtimeVoiceAdapterRegistry({ ...h.adapters })).toBe(false);
    expect(isGeneratedFuryRealtimeVoiceCoordinator(h.coordinator)).toBe(true);
    expect(isGeneratedFuryRealtimeVoiceCoordinator({ ...h.coordinator })).toBe(false);
  });

  it('prepares evidence-only requests bound to gateway/node sessions and current capability generation', () => {
    const h = harness();
    const req = request(h);
    expect(isGeneratedFuryRealtimeVoiceRequest(req)).toBe(true);
    expect(req).toMatchObject({
      authority: 'realtime-voice-request-evidence-only',
      executionAuthority: false,
      direction: 'duplex',
      capabilityGeneration: 1,
    });
    expect(req.gatewaySessionIdSha256).toBe(sha256(h.gatewaySession.sessionId));
    expect(req.principalIdSha256).toBe(sha256(h.gatewaySession.principalId));
    expect(req.nodeSessionIdSha256).toBe(sha256(h.nodeSession.sessionId));
    expect(req.registrationIdSha256).toBe(sha256(h.node.registrationId));
    expect(req.deviceIdSha256).toBe(sha256(h.node.deviceId));
    expect(req.pairingIdSha256).toBe(sha256(h.node.pairingId));
    expect(req.livenessEpochSha256).toBe(sha256(h.nodeSession.livenessEpoch));
  });

  it('issues short-lived bounded leases only for exact policy scope', () => {
    const h = harness();
    const req = request(h);
    const authorized = h.coordinator.authorize(req, policy(req));
    expect(isGeneratedFuryRealtimeVoiceLease(authorized)).toBe(true);
    expect(authorized).toMatchObject({
      authority: 'realtime-voice-stream-lease',
      executionAuthority: true,
      automaticReplayAllowed: false,
      maxBytes: 4096,
      maxFrames: 8,
    });
    expect(authorized.expiresAt).toBeLessThanOrEqual(h.time + 20_000);
    expect(() => h.coordinator.authorize(req, policy(req, { sinkDigestSha256: sha256('wrong') }))).toThrowError(
      expect.objectContaining({ code: 'execution-not-authorized' }),
    );
  });

  it('rejects copied requests and copied leases', () => {
    const h = harness();
    const { req, lease: liveLease } = lease(h);
    expect(() => h.coordinator.authorize({ ...req } as FuryRealtimeVoiceRequest, policy(req))).toThrowError(
      expect.objectContaining({ code: 'invalid-request' }),
    );
    expect(() => h.coordinator.inspect({ ...liveLease } as FuryRealtimeVoiceLease)).toThrowError(
      expect.objectContaining({ code: 'invalid-lease' }),
    );
  });

  it('dispatches exact ordered frames and returns digest-only non-replayable receipts', async () => {
    let captured: Uint8Array | undefined;
    const h = harness({ sendFrame: async (input) => { captured = input.bytes; return { status: 'accepted', providerSessionId: 'provider-secret-session' }; } });
    const { lease: liveLease } = lease(h);
    const receipt = await h.coordinator.sendFrame(liveLease, frame(1));
    expect(receipt).toMatchObject({ outcome: 'accepted', cumulativeFrames: 1, cumulativeBytes: 4, speakerPlaybackAuthorized: false, retrySafe: false, automaticReplayAllowed: false });
    expect(receipt.providerSessionIdSha256).toBe(sha256('provider-secret-session'));
    expect(JSON.stringify(receipt)).not.toContain('provider-secret-session');
    expect([...captured!]).toEqual([0, 0, 0, 0]);
  });

  it('enforces monotonic sequence and media direction before adapter dispatch', async () => {
    let calls = 0;
    const h = harness({ sendFrame: async () => { calls += 1; return { status: 'accepted' }; } });
    const req = request(h, { direction: 'input' });
    const liveLease = h.coordinator.authorize(req, policy(req));
    await h.coordinator.sendFrame(liveLease, frame(1));
    await expect(h.coordinator.sendFrame(liveLease, frame(1))).rejects.toMatchObject({ code: 'frame-order', adapterInvoked: false });
    await expect(h.coordinator.sendFrame(liveLease, frame(2, { direction: 'output' }))).rejects.toMatchObject({ code: 'frame-direction', adapterInvoked: false });
    expect(calls).toBe(1);
  });

  it('enforces frame MIME, per-frame bytes, cumulative bytes and frame budgets independently', async () => {
    const mimeHarness = harness();
    const mimeReq = request(mimeHarness, { maxBytes: 16, maxFrames: 3 });
    const mimeLease = mimeHarness.coordinator.authorize(mimeReq, policy(mimeReq));
    await expect(mimeHarness.coordinator.sendFrame(
      mimeLease,
      frame(1, { mimeType: 'audio/mpeg' }),
    )).rejects.toMatchObject({ code: 'media-type-not-supported' });

    const perFrameHarness = harness();
    const perFrameReq = request(perFrameHarness, { maxBytes: 4096, maxFrames: 3 });
    const perFrameLease = perFrameHarness.coordinator.authorize(perFrameReq, policy(perFrameReq));
    await expect(perFrameHarness.coordinator.sendFrame(
      perFrameLease,
      frame(1, { bytes: new Uint8Array(4097) }),
    )).rejects.toMatchObject({ code: 'byte-limit' });

    const byteHarness = harness();
    const byteReq = request(byteHarness, { maxBytes: 8, maxFrames: 3 });
    const byteLease = byteHarness.coordinator.authorize(byteReq, policy(byteReq));
    await byteHarness.coordinator.sendFrame(byteLease, frame(1));
    await byteHarness.coordinator.sendFrame(byteLease, frame(2));
    await expect(byteHarness.coordinator.sendFrame(byteLease, frame(3))).rejects.toMatchObject({ code: 'byte-limit' });

    const frameHarness = harness();
    const frameReq = request(frameHarness, { maxBytes: 12, maxFrames: 2 });
    const frameLease = frameHarness.coordinator.authorize(frameReq, policy(frameReq));
    await frameHarness.coordinator.sendFrame(frameLease, frame(1));
    await frameHarness.coordinator.sendFrame(frameLease, frame(2));
    await expect(frameHarness.coordinator.sendFrame(frameLease, frame(3))).rejects.toMatchObject({ code: 'frame-limit' });
  });

  it('fails closed when voice.realtime is absent from the current node advertisement', () => {
    const h = harness();
    h.nodes.advertiseCapabilities(h.node, {
      format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
      generation: 2,
      capabilities: ['microphone.capture'],
    });
    expect(() => request(h)).toThrowError(expect.objectContaining({ code: 'capability-not-current' }));
  });

  it('requires nodes.manage scope before realtime voice authority can be prepared', () => {
    const h = harness();
    const inspectOnly = h.gatewaySessions.issueSession({
      principal: h.principals.recordAuthenticatedPrincipal({
        format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
        principalId: 'principal:inspect-only',
        kind: 'human',
        issuer: 'local',
        subject: 'inspect-only-local-account',
        authenticationMethod: 'local-owner',
      }),
      role: 'operator',
      scopes: ['nodes.inspect'],
      binding: { kind: 'local-operator' },
    });
    const inspectOnlyCoordinator = createFuryRealtimeVoiceCoordinator({
      gatewaySessionCoordinator: h.gatewaySessions,
      gatewaySession: inspectOnly,
      nodeSessionCoordinator: h.nodeSessions,
      nodeSession: h.nodeSession,
      nodeRegistry: h.nodes,
      node: h.node,
      adapters: h.adapters,
      now: h.now,
    });
    expect(() => inspectOnlyCoordinator.prepare({
      bundle: bundle(h.time),
      profileId: 'voice-main',
      direction: 'duplex',
      sourceDigestSha256: sha256('microphone:voice-node-1'),
      sinkDigestSha256: sha256('provider:realtime-lab'),
      maxBytes: 4096,
      maxFrames: 8,
      maxDurationMs: 30_000,
    })).toThrowError(expect.objectContaining({ code: 'gateway-session-scope-missing' }));
  });

  it('invalidates the lease when capability generation changes', async () => {
    let calls = 0;
    const h = harness({ sendFrame: async () => { calls += 1; return { status: 'accepted' }; } });
    const { lease: liveLease } = lease(h);
    h.nodes.advertiseCapabilities(h.node, {
      format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
      generation: 2,
      capabilities: ['voice.realtime', 'microphone.capture'],
    });
    await expect(h.coordinator.sendFrame(liveLease, frame(1))).rejects.toMatchObject({ code: 'lease-not-live', adapterInvoked: false });
    expect(h.coordinator.inspect(liveLease).status).toBe('authority-stale');
    expect(calls).toBe(0);
  });

  it('invalidates old leases after node reconnect/supersede', async () => {
    const h = harness();
    const { lease: liveLease } = lease(h);
    h.time += 100;
    const freshDevice = h.authenticate();
    h.nodeSessions.openSession(h.node, freshDevice);
    await expect(h.coordinator.sendFrame(liveLease, frame(1))).rejects.toMatchObject({ code: 'lease-not-live' });
    expect(h.coordinator.inspect(liveLease).status).toBe('authority-stale');
  });

  it('invalidates leases when the gateway session is revoked', async () => {
    const h = harness();
    const { lease: liveLease } = lease(h);
    h.gatewaySessions.revokeSession(h.gatewaySession.sessionId);
    await expect(h.coordinator.sendFrame(liveLease, frame(1))).rejects.toMatchObject({ code: 'lease-not-live' });
    expect(h.coordinator.inspect(liveLease).status).toBe('authority-stale');
  });

  it('expires leases monotonically and never resurrects them', async () => {
    const h = harness();
    const req = request(h);
    const liveLease = h.coordinator.authorize(req, policy(req, { expiresInMs: 1_000 }));
    h.time += 1_000;
    expect(h.coordinator.inspect(liveLease).status).toBe('expired');
    h.time -= 500;
    expect(h.coordinator.inspect(liveLease).status).toBe('expired');
    await expect(h.coordinator.sendFrame(liveLease, frame(1))).rejects.toMatchObject({ code: 'lease-expired' });
  });

  it('makes adapter exceptions terminal unknown and forbids blind replay', async () => {
    const h = harness({ sendFrame: async () => { throw new Error('network lost after dispatch'); } });
    const { lease: liveLease } = lease(h);
    await expect(h.coordinator.sendFrame(liveLease, frame(1))).rejects.toMatchObject({ code: 'adapter-error', adapterInvoked: true, outcome: 'unknown', retrySafe: false });
    expect(h.coordinator.inspect(liveLease).status).toBe('unknown');
    await expect(h.coordinator.sendFrame(liveLease, frame(1))).rejects.toMatchObject({ code: 'lease-not-live', adapterInvoked: false });
  });

  it('treats adapter-reported unknown and malformed results as terminal unknown', async () => {
    for (const sendFrame of [
      async () => ({ status: 'unknown' }),
      async () => null,
    ]) {
      const h = harness({ sendFrame });
      const { lease: liveLease } = lease(h);
      await expect(h.coordinator.sendFrame(liveLease, frame(1))).rejects.toMatchObject({ adapterInvoked: true, outcome: 'unknown' });
      expect(h.coordinator.inspect(liveLease).status).toBe('unknown');
    }
  });

  it('interrupts a stream without claiming remote rollback or speaker authority', async () => {
    const h = harness();
    const { lease: liveLease } = lease(h);
    const receipt = await h.coordinator.interrupt(liveLease);
    expect(receipt).toMatchObject({ action: 'interrupt', status: 'interrupted', remoteRollbackAssumed: false, retrySafe: false, automaticReplayAllowed: false });
    expect(h.coordinator.inspect(liveLease).status).toBe('interrupted');
    expect('speaker' in h.coordinator).toBe(false);
    await expect(h.coordinator.sendFrame(liveLease, frame(1))).rejects.toMatchObject({ code: 'lease-not-live' });
  });

  it('marks interruption unknown when the remote acknowledgement is lost', async () => {
    const h = harness({ interrupt: async () => { throw new Error('lost'); } });
    const { lease: liveLease } = lease(h);
    await expect(h.coordinator.interrupt(liveLease)).rejects.toMatchObject({ adapterInvoked: true, outcome: 'unknown', retrySafe: false });
    expect(h.coordinator.inspect(liveLease).status).toBe('unknown');
  });

  it('supports explicit cancel and revoke terminal paths', async () => {
    const first = harness();
    const firstLease = lease(first).lease;
    expect((await first.coordinator.cancel(firstLease)).status).toBe('cancelled');
    expect(first.coordinator.inspect(firstLease).status).toBe('cancelled');

    const second = harness();
    const secondLease = lease(second).lease;
    expect((await second.coordinator.revoke(secondLease)).status).toBe('revoked');
    expect(second.coordinator.inspect(secondLease).status).toBe('revoked');
  });

  it('keeps terminal adapter uncertainty terminal for cancel/revoke', async () => {
    for (const action of ['cancel', 'revoke'] as const) {
      const h = harness({ cancel: async () => ({ status: 'unknown' }) });
      const liveLease = lease(h).lease;
      await expect(h.coordinator[action](liveLease)).rejects.toMatchObject({ adapterInvoked: true, outcome: 'unknown' });
      expect(h.coordinator.inspect(liveLease).status).toBe('unknown');
    }
  });

  it('does not restore request or lease authority in a fresh coordinator', async () => {
    const h = harness();
    const { req, lease: liveLease } = lease(h);
    const restarted = createFuryRealtimeVoiceCoordinator({
      gatewaySessionCoordinator: h.gatewaySessions,
      gatewaySession: h.gatewaySession,
      nodeSessionCoordinator: h.nodeSessions,
      nodeSession: h.nodeSession,
      nodeRegistry: h.nodes,
      node: h.node,
      adapters: h.adapters,
      now: h.now,
    });
    expect(() => restarted.authorize(req, policy(req))).toThrowError(expect.objectContaining({ code: 'invalid-request' }));
    expect(() => restarted.inspect(liveLease)).toThrowError(expect.objectContaining({ code: 'invalid-lease' }));
  });

  it('enforces the active streaming lease quota', () => {
    const h = harness({}, { maxActiveLeases: 1 });
    const first = request(h);
    h.coordinator.authorize(first, policy(first));
    const second = request(h, { sourceDigestSha256: sha256('another-source') });
    expect(() => h.coordinator.authorize(second, policy(second))).toThrowError(expect.objectContaining({ code: 'limit-exceeded' }));
  });

  it('fails closed when profile health is stale or profile permissions are absent', () => {
    const h = harness();
    expect(() => request(h, { bundle: bundle(h.time - 60_001) })).toThrowError(expect.objectContaining({ code: 'profile-health-not-fresh' }));
    const invalid = validateFuryMediaPluginBundle({
      format: FURY_MEDIA_PLUGIN_BUNDLE_FORMAT,
      id: 'realtime-lab',
      version: '1.0.0',
      permissions: ['media-read'],
      source: { url: 'https://example.test/realtime', licenseStatus: 'VERIFIED', licenseSpdx: 'MIT' },
      profiles: [{
        format: FURY_MEDIA_PLUGIN_PROFILE_FORMAT,
        id: 'voice-main',
        family: 'realtime-voice-provider',
        permissions: ['media-read'],
        supportedMediaTypes: ['audio/wav'],
        bounds: { maxInputBytes: 4096, maxOutputBytes: 4096, maxItems: 1, maxDurationMs: 60_000 },
        health: { status: 'healthy', observedAt: h.time, authority: 'health-observation-only', executionAuthority: false },
        secretRefs: [], lifecycle: 'registered', compatibility: ['phase9-v1'],
      }],
    });
    expect(() => request(h, { bundle: invalid })).toThrowError(expect.objectContaining({ code: 'profile-not-eligible' }));
  });

  it('rejects schema drift in prepare inputs and policies', () => {
    const h = harness();
    expect(() => h.coordinator.prepare({
      bundle: bundle(h.time), profileId: 'voice-main', direction: 'duplex',
      sourceDigestSha256: sha256('source'), sinkDigestSha256: sha256('sink'), maxBytes: 1024, maxFrames: 4, maxDurationMs: 1000,
      ambientAuthority: true,
    } as Parameters<typeof h.coordinator.prepare>[0])).toThrowError(/unsupported field/u);
    const req = request(h);
    expect(() => h.coordinator.authorize(req, { ...policy(req), replay: true } as FuryRealtimeVoicePolicy)).toThrowError(
      expect.objectContaining({ code: 'execution-not-authorized' }),
    );
  });

  it('keeps inspections digest-only and explicitly non-authoritative', () => {
    const h = harness();
    const liveLease = lease(h).lease;
    const observation = h.coordinator.inspect(liveLease);
    expect(observation).toMatchObject({ status: 'live', authority: 'realtime-voice-observation-only', executionAuthority: false, remoteTerminationVerified: false, automaticReplayAllowed: false });
    expect(JSON.stringify(observation)).not.toContain(h.gatewaySession.sessionId);
    expect(JSON.stringify(observation)).not.toContain(h.nodeSession.sessionId);
  });

  it('exposes deterministic fail-closed error metadata', () => {
    const error = new FuryRealtimeVoiceError('adapter-error', 'x', true, 'unknown');
    expect(error).toMatchObject({ code: 'adapter-error', retrySafe: false, adapterInvoked: true, outcome: 'unknown' });
  });
});
