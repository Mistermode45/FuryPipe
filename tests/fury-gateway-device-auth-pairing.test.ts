import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FURY_GATEWAY_CONNECT_FORMAT,
  FURY_GATEWAY_PROTOCOL_VERSION,
  parseFuryGatewayConnectEnvelope,
} from '../src/gateway.js';
import {
  FuryGatewayDeviceAuthError,
  createFuryGatewayDeviceAuthCoordinator,
  createFuryGatewayDeviceProof,
  deriveFuryGatewayDeviceId,
  exportFuryGatewayDevicePublicKey,
  isGeneratedFuryGatewayAuthenticatedDevice,
} from '../src/gateway-auth-node.js';
import {
  FuryGatewayPairingError,
  createFuryGatewayPairingCoordinator,
} from '../src/gateway-pairing-node.js';

function envelope(overrides: Record<string, unknown> = {}) {
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
    capabilities: ['filesystem.read', 'browser.capture'],
    commands: ['shell.run'],
    ...overrides,
  });
}

describe('Fury Gateway device authentication', () => {
  it('authenticates an Ed25519 device without granting pairing or authorization', () => {
    let now = 1_000;
    const auth = createFuryGatewayDeviceAuthCoordinator({ now: () => now });
    const { privateKey } = generateKeyPairSync('ed25519');
    const connect = envelope();
    const challenge = auth.issueChallenge();
    now = 1_100;
    const proof = createFuryGatewayDeviceProof(connect, challenge, privateKey);
    const result = auth.verifyProof(connect, proof);

    expect(result.authority).toBe('authenticated-device');
    expect(result.pairing).toBe('unpaired');
    expect(result.authorization).toBe('none');
    expect(result.role).toBe('node');
    expect(result.clientId).toBe('fury-node');
    expect(result.platform).toBe('linux');
    expect(result.deviceId).toBe(deriveFuryGatewayDeviceId(proof.publicKey));
    expect(isGeneratedFuryGatewayAuthenticatedDevice(result)).toBe(true);
    expect(isGeneratedFuryGatewayAuthenticatedDevice({ ...result })).toBe(false);
  });

  it('consumes a challenge exactly once and rejects replay', () => {
    let now = 2_000;
    const auth = createFuryGatewayDeviceAuthCoordinator({ now: () => now });
    const { privateKey } = generateKeyPairSync('ed25519');
    const connect = envelope();
    const challenge = auth.issueChallenge();
    const proof = createFuryGatewayDeviceProof(connect, challenge, privateKey);

    auth.verifyProof(connect, proof);
    expect(() => auth.verifyProof(connect, proof)).toThrowError(
      expect.objectContaining({ code: 'challenge-replayed' }),
    );
  });

  it('rejects expired challenges with a stable error', () => {
    let now = 10_000;
    const auth = createFuryGatewayDeviceAuthCoordinator({
      now: () => now,
      challengeTtlMs: 5_000,
    });
    const { privateKey } = generateKeyPairSync('ed25519');
    const connect = envelope();
    const challenge = auth.issueChallenge();
    const proof = createFuryGatewayDeviceProof(connect, challenge, privateKey);
    now = 15_001;

    expect(() => auth.verifyProof(connect, proof)).toThrowError(
      expect.objectContaining({ code: 'challenge-expired' }),
    );
  });

  it('binds the proof to the exact connect envelope', () => {
    const auth = createFuryGatewayDeviceAuthCoordinator({ now: () => 20_000 });
    const { privateKey } = generateKeyPairSync('ed25519');
    const connect = envelope();
    const challenge = auth.issueChallenge();
    const proof = createFuryGatewayDeviceProof(connect, challenge, privateKey);

    const altered = envelope({
      capabilities: ['filesystem.read', 'browser.capture', 'gpu.compute'],
    });

    expect(() => auth.verifyProof(altered, proof)).toThrowError(
      expect.objectContaining({ code: 'challenge-mismatch' }),
    );
  });

  it('rejects a forged device id and a signature from the wrong key', () => {
    const auth = createFuryGatewayDeviceAuthCoordinator({ now: () => 30_000 });
    const first = generateKeyPairSync('ed25519');
    const second = generateKeyPairSync('ed25519');
    const connect = envelope();

    const challengeA = auth.issueChallenge();
    const proofA = createFuryGatewayDeviceProof(connect, challengeA, first.privateKey);
    expect(() => auth.verifyProof(connect, {
      ...proofA,
      deviceId: deriveFuryGatewayDeviceId(exportFuryGatewayDevicePublicKey(second.privateKey)),
    })).toThrowError(expect.objectContaining({ code: 'device-id-mismatch' }));

    const challengeB = auth.issueChallenge();
    const proofB = createFuryGatewayDeviceProof(connect, challengeB, first.privateKey);
    const forged = {
      ...proofB,
      signature: createFuryGatewayDeviceProof(connect, challengeB, second.privateKey).signature,
    };
    expect(() => auth.verifyProof(connect, forged)).toThrowError(
      expect.objectContaining({ code: 'invalid-signature' }),
    );
  });

  it('rejects proof schema drift and hidden authority fields', () => {
    const auth = createFuryGatewayDeviceAuthCoordinator({ now: () => 34_000 });
    const { privateKey } = generateKeyPairSync('ed25519');
    const connect = envelope();
    const challenge = auth.issueChallenge();
    const proof = createFuryGatewayDeviceProof(connect, challenge, privateKey);

    expect(() => auth.verifyProof(connect, {
      ...proof,
      token: 'must-not-be-accepted',
    } as typeof proof)).toThrowError(expect.objectContaining({ code: 'invalid-proof' }));

    const accessorProof = { ...proof } as Record<string, unknown>;
    Object.defineProperty(accessorProof, 'signature', {
      enumerable: true,
      get: () => proof.signature,
    });
    expect(() => auth.verifyProof(connect, accessorProof as unknown as typeof proof)).toThrowError(
      expect.objectContaining({ code: 'invalid-proof' }),
    );
  });

  it('enforces proof field bounds before cryptographic work', () => {
    const auth = createFuryGatewayDeviceAuthCoordinator({ now: () => 35_000 });
    const { privateKey } = generateKeyPairSync('ed25519');
    const connect = envelope();
    const challenge = auth.issueChallenge();
    const proof = createFuryGatewayDeviceProof(connect, challenge, privateKey);

    expect(() => auth.verifyProof(connect, {
      ...proof,
      signature: 'A'.repeat(10_000),
    })).toThrowError(expect.objectContaining({ code: 'invalid-proof' }));

    expect(() => auth.verifyProof(connect, {
      ...proof,
      connectFingerprint: 'a'.repeat(65),
    })).toThrowError(expect.objectContaining({ code: 'invalid-proof' }));
  });

  it('enforces a hard active-challenge quota', () => {
    const auth = createFuryGatewayDeviceAuthCoordinator({
      now: () => 40_000,
      maxActiveChallenges: 1,
    });
    auth.issueChallenge();
    expect(() => auth.issueChallenge()).toThrowError(
      expect.objectContaining({ code: 'limit-exceeded' }),
    );
  });
});

describe('Fury Gateway pairing', () => {
  function authenticated(nowValue = 50_000) {
    const auth = createFuryGatewayDeviceAuthCoordinator({ now: () => nowValue });
    const { privateKey } = generateKeyPairSync('ed25519');
    const connect = envelope();
    const challenge = auth.issueChallenge();
    const proof = createFuryGatewayDeviceProof(connect, challenge, privateKey);
    return auth.verifyProof(connect, proof);
  }

  it('requires explicit approval and still grants no execution authorization', () => {
    let now = 50_000;
    const pairing = createFuryGatewayPairingCoordinator({ now: () => now });
    const device = authenticated(now);
    const request = pairing.requestPairing(device);
    expect(request.status).toBe('pending');
    expect(request.authorization).toBe('none');

    now = 50_100;
    const paired = pairing.approvePairing(request.requestId, 'principal:user-1');
    expect(paired.status).toBe('paired');
    expect(paired.authorization).toBe('none');
    expect(paired.pairedByPrincipalId).toBe('principal:user-1');
    expect(pairing.inspectPairing(device)?.pairingId).toBe(paired.pairingId);
  });

  it('rejects duplicate pending and duplicate paired identities', () => {
    const pairing = createFuryGatewayPairingCoordinator({ now: () => 60_000 });
    const device = authenticated(60_000);
    const request = pairing.requestPairing(device);
    expect(() => pairing.requestPairing(device)).toThrowError(
      expect.objectContaining({ code: 'pairing-already-pending' }),
    );
    pairing.approvePairing(request.requestId, 'principal:user-1');
    expect(() => pairing.requestPairing(device)).toThrowError(
      expect.objectContaining({ code: 'pairing-already-exists' }),
    );
  });

  it('rejects copied or fabricated authenticated-device lookalikes', () => {
    const pairing = createFuryGatewayPairingCoordinator({ now: () => 65_000 });
    const device = authenticated(65_000);

    expect(() => pairing.requestPairing({ ...device })).toThrowError(
      expect.objectContaining({ code: 'invalid-authenticated-device' }),
    );

    expect(() => pairing.requestPairing({
      ...device,
      deviceId: 'fgwdev_fabricated',
      authority: 'authenticated-device',
      pairing: 'unpaired',
      authorization: 'none',
    })).toThrowError(expect.objectContaining({ code: 'invalid-authenticated-device' }));
  });

  it('pins device role and stable client metadata across fresh authenticated evidence', () => {
    let now = 70_000;
    const keys = generateKeyPairSync('ed25519');
    const firstAuth = createFuryGatewayDeviceAuthCoordinator({ now: () => now });
    const firstConnect = envelope();
    const firstChallenge = firstAuth.issueChallenge();
    const firstDevice = firstAuth.verifyProof(
      firstConnect,
      createFuryGatewayDeviceProof(firstConnect, firstChallenge, keys.privateKey),
    );

    const pairing = createFuryGatewayPairingCoordinator({ now: () => now });
    const request = pairing.requestPairing(firstDevice);
    pairing.approvePairing(request.requestId, 'principal:user-1');

    const secondAuth = createFuryGatewayDeviceAuthCoordinator({ now: () => now });
    const secondConnect = envelope({
      client: {
        clientId: 'fury-node',
        instanceId: 'node-instance-2',
        platform: 'windows',
        deviceFamily: 'server',
      },
    });
    const secondChallenge = secondAuth.issueChallenge();
    const secondDevice = secondAuth.verifyProof(
      secondConnect,
      createFuryGatewayDeviceProof(secondConnect, secondChallenge, keys.privateKey),
    );

    expect(secondDevice.deviceId).toBe(firstDevice.deviceId);
    expect(() => pairing.inspectPairing(secondDevice)).toThrowError(
      expect.objectContaining({ code: 'pairing-mismatch' }),
    );
  });

  it('requires fresh authentication evidence to request pairing', () => {
    let now = 75_000;
    const auth = createFuryGatewayDeviceAuthCoordinator({ now: () => now });
    const { privateKey } = generateKeyPairSync('ed25519');
    const connect = envelope();
    const challenge = auth.issueChallenge();
    const device = auth.verifyProof(
      connect,
      createFuryGatewayDeviceProof(connect, challenge, privateKey),
    );

    const pairing = createFuryGatewayPairingCoordinator({
      now: () => now,
      maxAuthenticatedAgeMs: 60_000,
    });
    now += 60_001;

    expect(() => pairing.requestPairing(device)).toThrowError(
      expect.objectContaining({ code: 'auth-evidence-stale' }),
    );
  });

  it('supports explicit revocation', () => {
    const pairing = createFuryGatewayPairingCoordinator({ now: () => 80_000 });
    const device = authenticated(80_000);
    const request = pairing.requestPairing(device);
    pairing.approvePairing(request.requestId, 'principal:user-1');

    expect(pairing.revokePairing(device.deviceId, device.role)).toBe(true);
    expect(pairing.inspectPairing(device)).toBeUndefined();
  });

  it('rejects expired approval requests', () => {
    let now = 90_000;
    const pairing = createFuryGatewayPairingCoordinator({
      now: () => now,
      requestTtlMs: 30_000,
    });
    const device = authenticated(now);
    const request = pairing.requestPairing(device);
    now = 120_001;
    expect(() => pairing.approvePairing(request.requestId, 'principal:user-1')).toThrowError(
      expect.objectContaining({ code: 'pairing-expired' }),
    );
  });

  it('enforces pending and paired registry quotas', () => {
    const pairing = createFuryGatewayPairingCoordinator({
      now: () => 130_000,
      maxPending: 1,
      maxPaired: 1,
    });
    const first = authenticated(130_000);
    const request = pairing.requestPairing(first);

    const auth2 = createFuryGatewayDeviceAuthCoordinator({ now: () => 130_000 });
    const secondKeys = generateKeyPairSync('ed25519');
    const secondConnect = envelope({
      client: {
        clientId: 'fury-node',
        instanceId: 'node-instance-2',
        platform: 'linux',
        deviceFamily: 'server',
      },
    });
    const secondChallenge = auth2.issueChallenge();
    const second = auth2.verifyProof(
      secondConnect,
      createFuryGatewayDeviceProof(secondConnect, secondChallenge, secondKeys.privateKey),
    );

    expect(() => pairing.requestPairing(second)).toThrowError(
      expect.objectContaining({ code: 'limit-exceeded' }),
    );

    pairing.approvePairing(request.requestId, 'principal:user-1');
    const secondRequest = pairing.requestPairing(second);
    expect(() => pairing.approvePairing(secondRequest.requestId, 'principal:user-1')).toThrowError(
      expect.objectContaining({ code: 'limit-exceeded' }),
    );
  });
});