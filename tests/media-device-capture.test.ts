import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  FURY_GATEWAY_CONNECT_FORMAT,
  FURY_GATEWAY_PROTOCOL_VERSION,
  parseFuryGatewayConnectEnvelope,
} from '../src/gateway.js';
import { createFuryGatewayDeviceAuthCoordinator, createFuryGatewayDeviceProof } from '../src/gateway-auth-node.js';
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
import { createFuryGatewayNodeOperationCoordinator } from '../src/gateway-node-operation-node.js';
import {
  FURY_MEDIA_PLUGIN_BUNDLE_FORMAT,
  FURY_MEDIA_PLUGIN_PROFILE_FORMAT,
  validateFuryMediaPluginBundle,
} from '../src/media-plugin-contracts.js';
import { createFuryMediaIngestionCoordinator } from '../src/media-ingestion.js';
import {
  FURY_DEVICE_CAPTURE_CONSENT_INPUT_FORMAT,
  FuryDeviceCaptureError,
  createFuryDeviceCaptureAdapterRegistry,
  createFuryDeviceCaptureCoordinator,
  isGeneratedFuryDeviceCaptureAdapterRegistry,
  isGeneratedFuryDeviceCaptureConsent,
  isGeneratedFuryDeviceCaptureCoordinator,
  isGeneratedFuryDeviceCapturePermit,
  isGeneratedFuryDeviceCaptureRequest,
  isGeneratedFuryDeviceCaptureResult,
  type FuryDeviceCaptureAdapter,
  type FuryDeviceCaptureConsent,
  type FuryDeviceCapturePermit,
  type FuryDeviceCaptureRequest,
} from '../src/media-device-capture.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function png(width = 100, height = 50): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set(Buffer.from('IHDR'), 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function wav(dataBytes = 1_000, byteRate = 1_000): Uint8Array {
  const size = 44 + dataBytes;
  const bytes = new Uint8Array(size);
  bytes.set(Buffer.from('RIFF'), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, size - 8, true);
  bytes.set(Buffer.from('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, byteRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  bytes.set(Buffer.from('data'), 36);
  view.setUint32(40, dataBytes, true);
  return bytes;
}

function bundle(observedAt = 100_000) {
  return validateFuryMediaPluginBundle({
    format: FURY_MEDIA_PLUGIN_BUNDLE_FORMAT,
    id: 'capture-lab',
    version: '1.0.0',
    permissions: ['device-camera', 'device-microphone', 'media-write'],
    source: {
      url: 'https://github.com/example/capture-lab',
      commitSha: '1234567890abcdef1234567890abcdef12345678',
      licenseStatus: 'VERIFIED',
      licenseSpdx: 'MIT',
    },
    profiles: [
      {
        format: FURY_MEDIA_PLUGIN_PROFILE_FORMAT,
        id: 'camera-main',
        family: 'device-adapter',
        permissions: ['device-camera', 'media-write'],
        supportedMediaTypes: ['image/png'],
        bounds: { maxInputBytes: 1024, maxOutputBytes: 4096, maxItems: 1 },
        health: { status: 'healthy', observedAt, authority: 'health-observation-only', executionAuthority: false },
        secretRefs: [], lifecycle: 'registered', compatibility: ['phase9-v1'],
      },
      {
        format: FURY_MEDIA_PLUGIN_PROFILE_FORMAT,
        id: 'microphone-main',
        family: 'device-adapter',
        permissions: ['device-microphone', 'media-write'],
        supportedMediaTypes: ['audio/wav'],
        bounds: { maxInputBytes: 1024, maxOutputBytes: 4096, maxItems: 1, maxDurationMs: 5_000 },
        health: { status: 'healthy', observedAt, authority: 'health-observation-only', executionAuthority: false },
        secretRefs: [], lifecycle: 'registered', compatibility: ['phase9-v1'],
      },
    ],
  });
}

function cameraAdapter(overrides: Partial<FuryDeviceCaptureAdapter> = {}): FuryDeviceCaptureAdapter {
  return {
    bundleId: 'capture-lab', bundleVersion: '1.0.0', profileId: 'camera-main', kind: 'camera',
    capture: async () => ({ status: 'captured', mimeType: 'image/png', bytes: png(), providerCaptureId: 'camera-capture-1' }),
    ...overrides,
  };
}

function microphoneAdapter(overrides: Partial<FuryDeviceCaptureAdapter> = {}): FuryDeviceCaptureAdapter {
  return {
    bundleId: 'capture-lab', bundleVersion: '1.0.0', profileId: 'microphone-main', kind: 'microphone',
    capture: async () => ({ status: 'captured', mimeType: 'audio/wav', bytes: wav(), providerCaptureId: 'microphone-capture-1' }),
    ...overrides,
  };
}

function harness(options: { camera?: Partial<FuryDeviceCaptureAdapter>; microphone?: Partial<FuryDeviceCaptureAdapter>; maxActiveConsents?: number; maxActivePermits?: number } = {}) {
  let time = 100_000;
  const now = () => time;
  const keys = generateKeyPairSync('ed25519');
  const connect = parseFuryGatewayConnectEnvelope({
    format: FURY_GATEWAY_CONNECT_FORMAT,
    protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
    role: 'node',
    client: { clientId: 'fury-node', instanceId: 'capture-node-1', platform: 'linux', deviceFamily: 'workstation' },
    capabilities: [], commands: [],
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
  const nodeSessions = createFuryGatewayNodeSessionCoordinator({ nodeRegistry: nodes, pairingCoordinator: pairing, now, heartbeatTtlMs: 60_000 });
  const nodeSession = nodeSessions.openSession(node, device);
  const advertisement = nodes.advertiseCapabilities(node, {
    format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,
    generation: 1,
    capabilities: ['camera', 'microphone'],
  });
  const principals = createFuryGatewayPrincipalRegistry({ now, evidenceTtlMs: 5 * 60_000 });
  const principal = principals.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:owner-1', kind: 'human', issuer: 'local', subject: 'owner-local-account', authenticationMethod: 'local-owner',
  });
  const gatewaySessions = createFuryGatewaySessionCoordinator({ principalRegistry: principals, gatewayInstanceId: 'gateway-phase9-capture', now, defaultTtlMs: 120_000, maxTtlMs: 300_000, terminalRetentionMs: 30_000 });
  const gatewaySession = gatewaySessions.issueSession({ principal, role: 'operator', scopes: ['nodes.manage', 'nodes.inspect'], binding: { kind: 'local-operator' } });
  const nodeOperations = createFuryGatewayNodeOperationCoordinator({ nodeRegistry: nodes, nodeSessionCoordinator: nodeSessions, gatewaySessionCoordinator: gatewaySessions, gatewaySession, now, permitTtlMs: 15_000 });
  const media = createFuryMediaIngestionCoordinator({ maxItemBytes: 8192, maxBatchBytes: 8192, maxActiveBytes: 32_768, maxDurationMs: 10_000 });
  const adapters = createFuryDeviceCaptureAdapterRegistry([cameraAdapter(options.camera), microphoneAdapter(options.microphone)]);
  const coordinator = createFuryDeviceCaptureCoordinator({
    gatewaySession, nodeRegistry: nodes, nodeSessionCoordinator: nodeSessions, node, nodeSession,
    nodeOperationCoordinator: nodeOperations, mediaCoordinator: media, adapters, now,
    maxPresenceAgeMs: 10_000, maxConsentTtlMs: 10_000, maxProfileHealthAgeMs: 60_000,
    ...(options.maxActiveConsents === undefined ? {} : { maxActiveConsents: options.maxActiveConsents }),
    ...(options.maxActivePermits === undefined ? {} : { maxActivePermits: options.maxActivePermits }),
  });
  return { get time() { return time; }, set time(v:number){ time=v; }, now, keys, connect, auth, authenticate, device, pairing, nodes, node, nodeSessions, nodeSession, advertisement, principals, gatewaySessions, gatewaySession, nodeOperations, media, adapters, coordinator };
}

function request(h: ReturnType<typeof harness>, kind: 'camera' | 'microphone' = 'camera', overrides: Record<string, unknown> = {}) {
  return h.coordinator.prepare({
    bundle: bundle(h.time),
    profileId: kind === 'camera' ? 'camera-main' : 'microphone-main',
    kind,
    mimeType: kind === 'camera' ? 'image/png' : 'audio/wav',
    maxBytes: 4096,
    ...(kind === 'microphone' ? { maxDurationMs: 2_000 } : {}),
    ...overrides,
  } as any);
}

function consentInput(h: ReturnType<typeof harness>, req: FuryDeviceCaptureRequest, overrides: Record<string, unknown> = {}) {
  return {
    format: FURY_DEVICE_CAPTURE_CONSENT_INPUT_FORMAT,
    requestDigestSha256: req.requestDigestSha256,
    userPresenceObservedAt: h.time,
    localConfirmationDigestSha256: sha256('local-confirmation-event'),
    consentTextDigestSha256: sha256(`allow-${req.kind}-capture`),
    expiresInMs: 5_000,
    ...overrides,
  } as any;
}

function authorize(h: ReturnType<typeof harness>, kind: 'camera' | 'microphone' = 'camera') {
  const req = request(h, kind);
  const consent = h.coordinator.grantConsent(req, consentInput(h, req));
  const permit = h.coordinator.authorize(req, consent);
  return { req, consent, permit };
}

describe('FuryPipe Phase 9 privacy-sensitive device media capture', () => {
  it('creates genuine process-local capture coordinator, registry and request evidence', () => {
    const h = harness();
    expect(isGeneratedFuryDeviceCaptureAdapterRegistry(h.adapters)).toBe(true);
    expect(isGeneratedFuryDeviceCaptureAdapterRegistry({ ...h.adapters })).toBe(false);
    expect(isGeneratedFuryDeviceCaptureCoordinator(h.coordinator)).toBe(true);
    expect(isGeneratedFuryDeviceCaptureCoordinator({ ...h.coordinator })).toBe(false);
    const req = request(h);
    expect(isGeneratedFuryDeviceCaptureRequest(req)).toBe(true);
    expect(req).toMatchObject({ kind: 'camera', capability: 'camera', authority: 'device-capture-request-evidence-only', executionAuthority: false, automaticReplayAllowed: false, capabilityGeneration: 1 });
  });

  it('binds requests to exact gateway principal, node session, pairing and capability generation', () => {
    const h = harness();
    const req = request(h);
    expect(req.gatewaySessionIdSha256).toBe(sha256(h.gatewaySession.sessionId));
    expect(req.principalIdSha256).toBe(sha256(h.gatewaySession.principalId));
    expect(req.nodeSessionIdSha256).toBe(sha256(h.nodeSession.sessionId));
    expect(req.deviceIdSha256).toBe(sha256(h.node.deviceId));
    expect(req.pairingIdSha256).toBe(sha256(h.node.pairingId));
    expect(req.capabilitiesDigestSha256).toBe(h.advertisement.capabilitiesDigestSha256);
  });

  it('does not treat pairing or advertised camera capability as capture consent', () => {
    const h = harness();
    const req = request(h);
    expect(() => h.coordinator.authorize(req, {} as FuryDeviceCaptureConsent)).toThrowError(expect.objectContaining({ code: 'invalid-consent' }));
  });

  it('requires fresh current user-presence evidence', () => {
    const h = harness();
    const req = request(h);
    expect(() => h.coordinator.grantConsent(req, consentInput(h, req, { userPresenceObservedAt: h.time - 10_001 }))).toThrowError(expect.objectContaining({ code: 'user-presence-stale' }));
    expect(() => h.coordinator.grantConsent(req, consentInput(h, req, { userPresenceObservedAt: h.time + 1 }))).toThrowError(expect.objectContaining({ code: 'invalid-consent' }));
  });

  it('requires explicit local confirmation and consent-text digests', () => {
    const h = harness();
    const req = request(h);
    expect(() => h.coordinator.grantConsent(req, consentInput(h, req, { localConfirmationDigestSha256: 'bad' }))).toThrowError(expect.objectContaining({ code: 'invalid-consent' }));
    expect(() => h.coordinator.grantConsent(req, consentInput(h, req, { consentTextDigestSha256: 'bad' }))).toThrowError(expect.objectContaining({ code: 'invalid-consent' }));
  });

  it('creates one-shot process-local consent bound to exact request/session/device', () => {
    const h = harness();
    const req = request(h);
    const consent = h.coordinator.grantConsent(req, consentInput(h, req));
    expect(isGeneratedFuryDeviceCaptureConsent(consent)).toBe(true);
    expect(consent).toMatchObject({ requestDigestSha256: req.requestDigestSha256, kind: 'camera', mode: 'one-shot', executionAuthority: false, automaticReplayAllowed: false });
    expect(consent.gatewaySessionIdSha256).toBe(req.gatewaySessionIdSha256);
    expect(consent.nodeSessionIdSha256).toBe(req.nodeSessionIdSha256);
    expect(consent.deviceIdSha256).toBe(req.deviceIdSha256);
  });

  it('rejects copied consent and copied requests', () => {
    const h = harness();
    const req = request(h);
    const consent = h.coordinator.grantConsent(req, consentInput(h, req));
    expect(() => h.coordinator.authorize({ ...req } as FuryDeviceCaptureRequest, consent)).toThrowError(expect.objectContaining({ code: 'invalid-request' }));
    expect(() => h.coordinator.authorize(req, { ...consent } as FuryDeviceCaptureConsent)).toThrowError(expect.objectContaining({ code: 'invalid-consent' }));
  });

  it('reserves a consent for exactly one permit', () => {
    const h = harness();
    const req = request(h);
    const consent = h.coordinator.grantConsent(req, consentInput(h, req));
    const permit = h.coordinator.authorize(req, consent);
    expect(isGeneratedFuryDeviceCapturePermit(permit)).toBe(true);
    expect(permit).toMatchObject({ authority: 'device-capture-permit', executionAuthority: true, automaticReplayAllowed: false });
    expect(() => h.coordinator.authorize(req, consent)).toThrowError(expect.objectContaining({ code: 'consent-already-used' }));
  });

  it('rejects expired consent before permit issuance', () => {
    const h = harness();
    const req = request(h);
    const consent = h.coordinator.grantConsent(req, consentInput(h, req, { expiresInMs: 10 }));
    h.time += 10;
    expect(() => h.coordinator.authorize(req, consent)).toThrowError(expect.objectContaining({ code: 'consent-expired' }));
  });

  it('fails closed when capability generation changes before authorization', () => {
    const h = harness();
    const req = request(h);
    const consent = h.coordinator.grantConsent(req, consentInput(h, req));
    h.nodes.advertiseCapabilities(h.node, { format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT, generation: 2, capabilities: ['camera', 'microphone'] });
    expect(() => h.coordinator.authorize(req, consent)).toThrowError(expect.objectContaining({ code: 'node-authority-stale' }));
  });

  it('fails closed when the node session becomes non-live before authorization', () => {
    const h = harness();
    const req = request(h);
    const consent = h.coordinator.grantConsent(req, consentInput(h, req));
    h.time += 60_001;
    expect(() => h.coordinator.authorize(req, consent)).toThrowError();
  });

  it('captures camera bytes only after generic node-operation dispatch admission and governed ingestion', async () => {
    const h = harness();
    const { req, permit } = authorize(h, 'camera');
    const result = await h.coordinator.execute(req, permit);
    expect(isGeneratedFuryDeviceCaptureResult(result)).toBe(true);
    expect(result).toMatchObject({ kind: 'camera', outcome: 'captured' });
    expect(result.mediaHandle?.evidence).toMatchObject({ sourceOrigin: 'node-capture', kind: 'image', mimeType: 'image/png', dimensions: { width: 100, height: 50 } });
    expect(result.receipt).toMatchObject({ outcome: 'captured', userPresence: 'fresh-at-consent', localConfirmation: 'explicit-digest-evidence', rawMediaPersisted: false, retrySafe: false, automaticReplayAllowed: false, executionAuthority: false });
  });

  it('captures bounded microphone audio with duration evidence', async () => {
    const h = harness();
    const { req, permit } = authorize(h, 'microphone');
    const result = await h.coordinator.execute(req, permit);
    expect(result.mediaHandle?.evidence).toMatchObject({ sourceOrigin: 'node-capture', kind: 'audio', mimeType: 'audio/wav', durationMs: 1_000 });
    expect(result.receipt.durationMs).toBe(1_000);
  });

  it('consumes the permit and consent before adapter callback and forbids replay', async () => {
    let h!: ReturnType<typeof harness>;
    h = harness({ camera: { capture: async () => {
      expect(h.coordinator.activePermitCount()).toBe(0);
      expect(h.coordinator.activeConsentCount()).toBe(0);
      return { status: 'captured', mimeType: 'image/png', bytes: png() };
    } } });
    const { req, permit } = authorize(h);
    await h.coordinator.execute(req, permit);
    await expect(h.coordinator.execute(req, permit)).rejects.toMatchObject({ code: 'permit-consumed' });
  });

  it('rejects copied permits and permits from another coordinator', async () => {
    const first = harness();
    const second = harness();
    const { req, permit } = authorize(first);
    await expect(first.coordinator.execute(req, { ...permit } as FuryDeviceCapturePermit)).rejects.toMatchObject({ code: 'invalid-permit' });
    await expect(second.coordinator.execute(req, permit)).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('treats adapter exception and explicit unknown as unknown non-retryable side effects', async () => {
    for (const camera of [
      { capture: async () => { throw new Error('lost response'); } },
      { capture: async () => ({ status: 'unknown' }) },
    ]) {
      const h = harness({ camera });
      const { req, permit } = authorize(h);
      await expect(h.coordinator.execute(req, permit)).rejects.toMatchObject({ adapterInvoked: true, outcome: 'unknown', retrySafe: false });
      await expect(h.coordinator.execute(req, permit)).rejects.toMatchObject({ code: 'permit-consumed' });
    }
  });

  it('supports explicit adapter rejection without media bytes and still consumes authority', async () => {
    const h = harness({ camera: { capture: async () => ({ status: 'rejected', providerCaptureId: 'rejected-1' }) } });
    const { req, permit } = authorize(h);
    const result = await h.coordinator.execute(req, permit);
    expect(result).toMatchObject({ kind: 'camera', outcome: 'rejected', receipt: { outcome: 'rejected', automaticReplayAllowed: false } });
    expect(result.mediaHandle).toBeUndefined();
    await expect(h.coordinator.execute(req, permit)).rejects.toMatchObject({ code: 'permit-consumed' });
  });

  it('rejects mismatched MIME and oversized capture outputs after dispatch as unknown', async () => {
    const mismatch = harness({ camera: { capture: async () => ({ status: 'captured', mimeType: 'image/jpeg', bytes: png() }) } });
    const first = authorize(mismatch);
    await expect(mismatch.coordinator.execute(first.req, first.permit)).rejects.toMatchObject({ code: 'media-type-not-supported', adapterInvoked: true, outcome: 'unknown' });

    const oversized = harness({ camera: { capture: async () => ({ status: 'captured', mimeType: 'image/png', bytes: new Uint8Array(4097).fill(1) }) } });
    const second = authorize(oversized);
    await expect(oversized.coordinator.execute(second.req, second.permit)).rejects.toMatchObject({ code: 'output-limit', adapterInvoked: true, outcome: 'unknown' });
  });

  it('wipes adapter-owned capture bytes after copying them into governed ingestion', async () => {
    const raw = png();
    const h = harness({ camera: { capture: async () => ({ status: 'captured', mimeType: 'image/png', bytes: raw }) } });
    const { req, permit } = authorize(h);
    const result = await h.coordinator.execute(req, permit);
    expect([...raw].every((value) => value === 0)).toBe(true);
    expect(result.mediaHandle?.evidence.mediaSha256).toMatch(/^[0-9a-f]{64}$/u);
  });


  it('wipes sensitive adapter buffers even when post-dispatch output validation fails', async () => {
    const wrongMimeBytes = png();
    const mismatch = harness({ camera: { capture: async () => ({ status: 'captured', mimeType: 'image/jpeg', bytes: wrongMimeBytes }) } });
    const first = authorize(mismatch);
    await expect(mismatch.coordinator.execute(first.req, first.permit)).rejects.toMatchObject({ code: 'media-type-not-supported', outcome: 'unknown' });
    expect([...wrongMimeBytes].every((value) => value === 0)).toBe(true);

    const rejectedBytes = png();
    const rejected = harness({ camera: { capture: async () => ({ status: 'rejected', bytes: rejectedBytes }) } });
    const second = authorize(rejected);
    await expect(rejected.coordinator.execute(second.req, second.permit)).rejects.toMatchObject({ code: 'adapter-result-invalid', outcome: 'unknown' });
    expect([...rejectedBytes].every((value) => value === 0)).toBe(true);
  });

  it('does not restore request, consent or permit authority in a fresh coordinator', async () => {
    const h = harness();
    const { req, consent, permit } = authorize(h);
    const restarted = createFuryDeviceCaptureCoordinator({
      gatewaySession: h.gatewaySession, nodeRegistry: h.nodes, nodeSessionCoordinator: h.nodeSessions, node: h.node, nodeSession: h.nodeSession,
      nodeOperationCoordinator: h.nodeOperations, mediaCoordinator: h.media, adapters: h.adapters, now: h.now,
    });
    expect(() => restarted.grantConsent(req, consentInput(h, req))).toThrowError(expect.objectContaining({ code: 'invalid-request' }));
    await expect(restarted.execute(req, permit)).rejects.toMatchObject({ code: 'invalid-request' });
    expect(isGeneratedFuryDeviceCaptureConsent(consent)).toBe(true);
  });

  it('fails closed for stale health and over-privileged device profiles', () => {
    const h = harness();
    expect(() => request(h, 'camera', { bundle: bundle(h.time - 60_001) })).toThrowError(expect.objectContaining({ code: 'profile-health-not-fresh' }));
    const invalid = validateFuryMediaPluginBundle({
      format: FURY_MEDIA_PLUGIN_BUNDLE_FORMAT, id: 'capture-lab', version: '1.0.0', permissions: ['device-camera', 'device-microphone', 'media-write'],
      source: { url: 'https://example.test/capture', licenseStatus: 'VERIFIED', licenseSpdx: 'MIT' },
      profiles: [{
        format: FURY_MEDIA_PLUGIN_PROFILE_FORMAT, id: 'camera-main', family: 'device-adapter', permissions: ['device-camera', 'device-microphone', 'media-write'], supportedMediaTypes: ['image/png'],
        bounds: { maxInputBytes: 1024, maxOutputBytes: 4096, maxItems: 1 },
        health: { status: 'healthy', observedAt: h.time, authority: 'health-observation-only', executionAuthority: false }, secretRefs: [], lifecycle: 'registered', compatibility: ['phase9-v1'],
      }],
    });
    expect(() => request(h, 'camera', { bundle: invalid })).toThrowError(expect.objectContaining({ code: 'profile-not-eligible' }));
  });

  it('enforces active consent and permit quotas', () => {
    const consentBound = harness({ maxActiveConsents: 1, maxActivePermits: 2 });
    const firstReq = request(consentBound);
    consentBound.coordinator.grantConsent(firstReq, consentInput(consentBound, firstReq));
    const secondReq = request(consentBound, 'camera', { maxBytes: 2048 });
    expect(() => consentBound.coordinator.grantConsent(secondReq, consentInput(consentBound, secondReq))).toThrowError(expect.objectContaining({ code: 'limit-exceeded' }));

    const permitBound = harness({ maxActiveConsents: 2, maxActivePermits: 1 });
    const a = request(permitBound);
    const ac = permitBound.coordinator.grantConsent(a, consentInput(permitBound, a));
    permitBound.coordinator.authorize(a, ac);
    const b = request(permitBound, 'camera', { maxBytes: 2048 });
    const bc = permitBound.coordinator.grantConsent(b, consentInput(permitBound, b));
    expect(() => permitBound.coordinator.authorize(b, bc)).toThrowError(expect.objectContaining({ code: 'limit-exceeded' }));
    expect(permitBound.coordinator.activePermitCount()).toBe(1);
  });

  it('rejects schema drift and forged authority-like fields', () => {
    const h = harness();
    expect(() => h.coordinator.prepare({ bundle: bundle(h.time), profileId: 'camera-main', kind: 'camera', mimeType: 'image/png', maxBytes: 4096, silentCapture: true } as any)).toThrowError(/unsupported field/u);
    const req = request(h);
    expect(() => h.coordinator.grantConsent(req, { ...consentInput(h, req), ambientConsent: true } as any)).toThrowError(/unsupported field/u);
  });

  it('keeps receipts digest-only and non-authoritative', async () => {
    const h = harness();
    const { req, permit } = authorize(h);
    const result = await h.coordinator.execute(req, permit);
    const encoded = JSON.stringify(result.receipt);
    expect(encoded).not.toContain(h.gatewaySession.sessionId);
    expect(encoded).not.toContain(h.nodeSession.sessionId);
    expect(result.receipt).toMatchObject({ executionAuthority: false, automaticReplayAllowed: false, retrySafe: false, adapterResult: 'adapter-reported-unverified' });
  });

  it('exposes deterministic fail-closed error metadata', () => {
    const error = new FuryDeviceCaptureError('adapter-error', 'x', true, 'unknown');
    expect(error).toMatchObject({ code: 'adapter-error', retrySafe: false, adapterInvoked: true, outcome: 'unknown' });
  });
});
