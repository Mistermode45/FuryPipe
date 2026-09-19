import {
  createHash,
  createPublicKey,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import {
  deriveFuryGatewayConnectFingerprint,
  type FuryGatewayConnectEnvelope,
  type FuryGatewayRole,
} from './gateway.js';

export const FURY_GATEWAY_AUTH_CHALLENGE_FORMAT = 'furypipe-gateway-auth-challenge/v1' as const;
export const FURY_GATEWAY_DEVICE_PROOF_FORMAT = 'furypipe-gateway-device-proof/v1' as const;
export const FURY_GATEWAY_AUTHENTICATED_DEVICE_FORMAT = 'furypipe-gateway-authenticated-device/v1' as const;

export interface FuryGatewayAuthChallenge {
  readonly format: typeof FURY_GATEWAY_AUTH_CHALLENGE_FORMAT;
  readonly challengeId: string;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface FuryGatewayDeviceProof {
  readonly format: typeof FURY_GATEWAY_DEVICE_PROOF_FORMAT;
  readonly challengeId: string;
  readonly nonce: string;
  readonly signedAt: number;
  readonly deviceId: string;
  readonly publicKey: string;
  readonly connectFingerprint: string;
  readonly signature: string;
}

export interface FuryGatewayAuthenticatedDevice {
  readonly format: typeof FURY_GATEWAY_AUTHENTICATED_DEVICE_FORMAT;
  readonly deviceId: string;
  readonly publicKeySha256: string;
  readonly connectFingerprint: string;
  readonly role: FuryGatewayRole;
  readonly clientId: string;
  readonly instanceId: string;
  readonly platform?: string;
  readonly deviceFamily?: string;
  readonly authenticatedAt: number;
  readonly authority: 'authenticated-device';
  readonly pairing: 'unpaired';
  readonly authorization: 'none';
}

export type FuryGatewayDeviceAuthErrorCode =
  | 'invalid-challenge'
  | 'challenge-expired'
  | 'challenge-replayed'
  | 'challenge-mismatch'
  | 'invalid-proof'
  | 'invalid-public-key'
  | 'device-id-mismatch'
  | 'invalid-signature'
  | 'limit-exceeded';

export class FuryGatewayDeviceAuthError extends Error {
  readonly code: FuryGatewayDeviceAuthErrorCode;

  constructor(code: FuryGatewayDeviceAuthErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayDeviceAuthError';
    this.code = code;
  }
}

export interface FuryGatewayDeviceAuthCoordinatorOptions {
  readonly now?: () => number;
  readonly challengeTtlMs?: number;
  readonly maxActiveChallenges?: number;
  readonly maxConsumedChallenges?: number;
}

export interface FuryGatewayDeviceAuthCoordinator {
  issueChallenge(): FuryGatewayAuthChallenge;
  verifyProof(
    envelope: FuryGatewayConnectEnvelope,
    proof: FuryGatewayDeviceProof,
  ): FuryGatewayAuthenticatedDevice;
  activeChallengeCount(): number;
}

const DEFAULT_CHALLENGE_TTL_MS = 30_000;
const MIN_CHALLENGE_TTL_MS = 5_000;
const MAX_CHALLENGE_TTL_MS = 120_000;
const DEFAULT_MAX_ACTIVE_CHALLENGES = 4_096;
const DEFAULT_MAX_CONSUMED_CHALLENGES = 4_096;
const MAX_PUBLIC_KEY_BYTES = 512;
const ED25519_SIGNATURE_BYTES = 64;
const DEVICE_ID_PREFIX = 'fgwdev_';

function finiteNow(now: () => number): number {
  const value = now();
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('gateway auth clock must return a finite non-negative timestamp');
  }
  return Math.floor(value);
}

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

function canonicalBase64Url(value: string, label: string, maxBytes: number): Buffer {
  if (typeof value !== 'string' || value.length === 0 || value.includes('=')) {
    throw new FuryGatewayDeviceAuthError('invalid-proof', `${label} must be canonical base64url`);
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, 'base64url');
  } catch {
    throw new FuryGatewayDeviceAuthError('invalid-proof', `${label} is not valid base64url`);
  }
  if (decoded.length === 0 || decoded.length > maxBytes || decoded.toString('base64url') !== value) {
    throw new FuryGatewayDeviceAuthError('invalid-proof', `${label} is not canonical or exceeds bounds`);
  }
  return decoded;
}

function canonicalPublicKeyDer(publicKey: string): Buffer {
  const der = canonicalBase64Url(publicKey, 'publicKey', MAX_PUBLIC_KEY_BYTES);
  let key: KeyObject;
  try {
    key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    throw new FuryGatewayDeviceAuthError('invalid-public-key', 'device public key is invalid');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new FuryGatewayDeviceAuthError('invalid-public-key', 'device public key must be Ed25519');
  }
  const canonical = key.export({ format: 'der', type: 'spki' });
  if (!Buffer.isBuffer(canonical)) {
    throw new FuryGatewayDeviceAuthError('invalid-public-key', 'device public key could not be canonicalized');
  }
  if (canonical.length > MAX_PUBLIC_KEY_BYTES || canonical.toString('base64url') !== publicKey) {
    throw new FuryGatewayDeviceAuthError('invalid-public-key', 'device public key encoding is non-canonical');
  }
  return canonical;
}

function sha256Base64Url(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function deriveFuryGatewayDeviceId(publicKey: string): string {
  const canonical = canonicalPublicKeyDer(publicKey);
  return `${DEVICE_ID_PREFIX}${sha256Base64Url(canonical)}`;
}

export function exportFuryGatewayDevicePublicKey(
  privateOrPublicKey: KeyObject | string | Buffer,
): string {
  let key: KeyObject;
  try {
    key = createPublicKey(privateOrPublicKey);
  } catch {
    throw new FuryGatewayDeviceAuthError('invalid-public-key', 'device key could not be converted to a public key');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new FuryGatewayDeviceAuthError('invalid-public-key', 'device key must be Ed25519');
  }
  const der = key.export({ format: 'der', type: 'spki' });
  if (!Buffer.isBuffer(der)) {
    throw new FuryGatewayDeviceAuthError('invalid-public-key', 'device public key export failed');
  }
  return der.toString('base64url');
}

function buildProofPayload(
  challenge: FuryGatewayAuthChallenge,
  deviceId: string,
  publicKey: string,
  connectFingerprint: string,
): Buffer {
  return Buffer.from(JSON.stringify({
    format: FURY_GATEWAY_DEVICE_PROOF_FORMAT,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    signedAt: challenge.issuedAt,
    deviceId,
    publicKey,
    connectFingerprint,
  }), 'utf8');
}

export function createFuryGatewayDeviceProof(
  envelope: FuryGatewayConnectEnvelope,
  challenge: FuryGatewayAuthChallenge,
  privateKey: KeyObject | string | Buffer,
): FuryGatewayDeviceProof {
  if (challenge.format !== FURY_GATEWAY_AUTH_CHALLENGE_FORMAT) {
    throw new FuryGatewayDeviceAuthError('invalid-challenge', 'unsupported gateway auth challenge');
  }
  const publicKey = exportFuryGatewayDevicePublicKey(privateKey);
  const deviceId = deriveFuryGatewayDeviceId(publicKey);
  const connectFingerprint = deriveFuryGatewayConnectFingerprint(envelope);
  const payload = buildProofPayload(challenge, deviceId, publicKey, connectFingerprint);
  let signature: Buffer;
  try {
    signature = sign(null, payload, privateKey);
  } catch {
    throw new FuryGatewayDeviceAuthError('invalid-signature', 'device proof could not be signed');
  }
  if (signature.length !== ED25519_SIGNATURE_BYTES) {
    throw new FuryGatewayDeviceAuthError('invalid-signature', 'unexpected Ed25519 signature length');
  }
  return Object.freeze({
    format: FURY_GATEWAY_DEVICE_PROOF_FORMAT,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    signedAt: challenge.issuedAt,
    deviceId,
    publicKey,
    connectFingerprint,
    signature: signature.toString('base64url'),
  });
}

function assertProofShape(proof: FuryGatewayDeviceProof): void {
  if (!proof || typeof proof !== 'object' || proof.format !== FURY_GATEWAY_DEVICE_PROOF_FORMAT) {
    throw new FuryGatewayDeviceAuthError('invalid-proof', 'unsupported gateway device proof');
  }
  for (const [label, value] of [
    ['challengeId', proof.challengeId],
    ['nonce', proof.nonce],
    ['deviceId', proof.deviceId],
    ['publicKey', proof.publicKey],
    ['connectFingerprint', proof.connectFingerprint],
    ['signature', proof.signature],
  ] as const) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new FuryGatewayDeviceAuthError('invalid-proof', `${label} must be a non-empty string`);
    }
  }
  if (!Number.isSafeInteger(proof.signedAt) || proof.signedAt < 0) {
    throw new FuryGatewayDeviceAuthError('invalid-proof', 'signedAt must be a non-negative integer');
  }
}

export function createFuryGatewayDeviceAuthCoordinator(
  options: FuryGatewayDeviceAuthCoordinatorOptions = {},
): FuryGatewayDeviceAuthCoordinator {
  const now = options.now ?? Date.now;
  const challengeTtlMs = boundedInteger(
    options.challengeTtlMs,
    DEFAULT_CHALLENGE_TTL_MS,
    MIN_CHALLENGE_TTL_MS,
    MAX_CHALLENGE_TTL_MS,
    'challengeTtlMs',
  );
  const maxActiveChallenges = boundedInteger(
    options.maxActiveChallenges,
    DEFAULT_MAX_ACTIVE_CHALLENGES,
    1,
    65_536,
    'maxActiveChallenges',
  );
  const maxConsumedChallenges = boundedInteger(
    options.maxConsumedChallenges,
    DEFAULT_MAX_CONSUMED_CHALLENGES,
    1,
    65_536,
    'maxConsumedChallenges',
  );

  const active = new Map<string, FuryGatewayAuthChallenge>();
  const consumed = new Map<string, number>();

  const prune = (at: number): void => {
    for (const [challengeId, challenge] of active) {
      if (challenge.expiresAt < at) active.delete(challengeId);
    }
    while (consumed.size > maxConsumedChallenges) {
      const oldest = consumed.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      consumed.delete(oldest);
    }
  };

  const rememberConsumed = (challengeId: string, at: number): void => {
    consumed.delete(challengeId);
    consumed.set(challengeId, at);
    while (consumed.size > maxConsumedChallenges) {
      const oldest = consumed.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      consumed.delete(oldest);
    }
  };

  return Object.freeze({
    issueChallenge(): FuryGatewayAuthChallenge {
      const issuedAt = finiteNow(now);
      prune(issuedAt);
      if (active.size >= maxActiveChallenges) {
        throw new FuryGatewayDeviceAuthError('limit-exceeded', 'too many active gateway auth challenges');
      }
      let challengeId: string;
      do {
        challengeId = randomBytes(16).toString('base64url');
      } while (active.has(challengeId) || consumed.has(challengeId));
      const challenge = Object.freeze({
        format: FURY_GATEWAY_AUTH_CHALLENGE_FORMAT,
        challengeId,
        nonce: randomBytes(32).toString('base64url'),
        issuedAt,
        expiresAt: issuedAt + challengeTtlMs,
      });
      active.set(challengeId, challenge);
      return challenge;
    },

    verifyProof(
      envelope: FuryGatewayConnectEnvelope,
      proof: FuryGatewayDeviceProof,
    ): FuryGatewayAuthenticatedDevice {
      assertProofShape(proof);
      const verifiedAt = finiteNow(now);
      prune(verifiedAt);

      if (consumed.has(proof.challengeId)) {
        throw new FuryGatewayDeviceAuthError('challenge-replayed', 'gateway auth challenge was already consumed');
      }

      const challenge = active.get(proof.challengeId);
      if (!challenge) {
        throw new FuryGatewayDeviceAuthError('invalid-challenge', 'gateway auth challenge is unknown');
      }
      if (verifiedAt > challenge.expiresAt) {
        active.delete(proof.challengeId);
        throw new FuryGatewayDeviceAuthError('challenge-expired', 'gateway auth challenge expired');
      }
      if (
        proof.nonce !== challenge.nonce
        || proof.signedAt !== challenge.issuedAt
      ) {
        throw new FuryGatewayDeviceAuthError('challenge-mismatch', 'device proof does not match the issued challenge');
      }

      const connectFingerprint = deriveFuryGatewayConnectFingerprint(envelope);
      if (proof.connectFingerprint !== connectFingerprint) {
        throw new FuryGatewayDeviceAuthError('challenge-mismatch', 'device proof is bound to a different connect envelope');
      }

      const canonicalKey = canonicalPublicKeyDer(proof.publicKey);
      const expectedDeviceId = `${DEVICE_ID_PREFIX}${sha256Base64Url(canonicalKey)}`;
      if (proof.deviceId !== expectedDeviceId) {
        throw new FuryGatewayDeviceAuthError('device-id-mismatch', 'device id does not match the supplied public key');
      }

      const signature = canonicalBase64Url(proof.signature, 'signature', ED25519_SIGNATURE_BYTES);
      if (signature.length !== ED25519_SIGNATURE_BYTES) {
        throw new FuryGatewayDeviceAuthError('invalid-signature', 'device signature has the wrong length');
      }

      const payload = buildProofPayload(challenge, proof.deviceId, proof.publicKey, connectFingerprint);
      let publicKeyObject: KeyObject;
      try {
        publicKeyObject = createPublicKey({ key: canonicalKey, format: 'der', type: 'spki' });
      } catch {
        throw new FuryGatewayDeviceAuthError('invalid-public-key', 'device public key is invalid');
      }

      if (!verify(null, payload, publicKeyObject, signature)) {
        throw new FuryGatewayDeviceAuthError('invalid-signature', 'device signature verification failed');
      }

      active.delete(proof.challengeId);
      rememberConsumed(proof.challengeId, verifiedAt);

      return Object.freeze({
        format: FURY_GATEWAY_AUTHENTICATED_DEVICE_FORMAT,
        deviceId: proof.deviceId,
        publicKeySha256: sha256Base64Url(canonicalKey),
        connectFingerprint,
        role: envelope.role,
        clientId: envelope.client.clientId,
        instanceId: envelope.client.instanceId,
        ...(envelope.client.platform === undefined ? {} : { platform: envelope.client.platform }),
        ...(envelope.client.deviceFamily === undefined ? {} : { deviceFamily: envelope.client.deviceFamily }),
        authenticatedAt: verifiedAt,
        authority: 'authenticated-device',
        pairing: 'unpaired',
        authorization: 'none',
      });
    },

    activeChallengeCount(): number {
      prune(finiteNow(now));
      return active.size;
    },
  });
}
