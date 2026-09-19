import { randomBytes } from 'node:crypto';
import {
  isGeneratedFuryGatewayAuthenticatedDevice,
  type FuryGatewayAuthenticatedDevice,
} from './gateway-auth-node.js';
import type { FuryGatewayRole } from './gateway.js';

export const FURY_GATEWAY_PAIRING_REQUEST_FORMAT = 'furypipe-gateway-pairing-request/v1' as const;
export const FURY_GATEWAY_PAIRED_DEVICE_FORMAT = 'furypipe-gateway-paired-device/v1' as const;

export interface FuryGatewayPairingRequest {
  readonly format: typeof FURY_GATEWAY_PAIRING_REQUEST_FORMAT;
  readonly requestId: string;
  readonly deviceId: string;
  readonly publicKeySha256: string;
  readonly role: FuryGatewayRole;
  readonly clientId: string;
  readonly platform?: string;
  readonly deviceFamily?: string;
  readonly requestedAt: number;
  readonly expiresAt: number;
  readonly status: 'pending';
  readonly authorization: 'none';
}

export interface FuryGatewayPairedDevice {
  readonly format: typeof FURY_GATEWAY_PAIRED_DEVICE_FORMAT;
  readonly pairingId: string;
  readonly deviceId: string;
  readonly publicKeySha256: string;
  readonly role: FuryGatewayRole;
  readonly clientId: string;
  readonly platform?: string;
  readonly deviceFamily?: string;
  readonly pairedAt: number;
  readonly pairedByPrincipalId: string;
  readonly status: 'paired';
  readonly authorization: 'none';
}

export type FuryGatewayPairingErrorCode =
  | 'invalid-authenticated-device'
  | 'pairing-already-pending'
  | 'pairing-already-exists'
  | 'pairing-not-found'
  | 'pairing-expired'
  | 'pairing-mismatch'
  | 'invalid-principal'
  | 'limit-exceeded';

export class FuryGatewayPairingError extends Error {
  readonly code: FuryGatewayPairingErrorCode;

  constructor(code: FuryGatewayPairingErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayPairingError';
    this.code = code;
  }
}

export interface FuryGatewayPairingCoordinatorOptions {
  readonly now?: () => number;
  readonly requestTtlMs?: number;
  readonly maxPending?: number;
  readonly maxPaired?: number;
}

export interface FuryGatewayPairingCoordinator {
  requestPairing(device: FuryGatewayAuthenticatedDevice): FuryGatewayPairingRequest;
  approvePairing(requestId: string, pairedByPrincipalId: string): FuryGatewayPairedDevice;
  rejectPairing(requestId: string): boolean;
  revokePairing(deviceId: string, role: FuryGatewayRole): boolean;
  inspectPairing(device: FuryGatewayAuthenticatedDevice): FuryGatewayPairedDevice | undefined;
  pendingCount(): number;
  pairedCount(): number;
}

const DEFAULT_REQUEST_TTL_MS = 5 * 60_000;
const MIN_REQUEST_TTL_MS = 30_000;
const MAX_REQUEST_TTL_MS = 30 * 60_000;
const DEFAULT_MAX_PENDING = 1_024;
const DEFAULT_MAX_PAIRED = 8_192;
const PRINCIPAL_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u;

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

function finiteNow(now: () => number): number {
  const value = now();
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('gateway pairing clock must return a finite non-negative timestamp');
  }
  return Math.floor(value);
}

function pairingKey(deviceId: string, role: FuryGatewayRole): string {
  return `${deviceId}\u0000${role}`;
}

function assertAuthenticatedDevice(device: FuryGatewayAuthenticatedDevice): void {
  if (
    !isGeneratedFuryGatewayAuthenticatedDevice(device)
    || device.authority !== 'authenticated-device'
    || device.pairing !== 'unpaired'
    || device.authorization !== 'none'
  ) {
    throw new FuryGatewayPairingError(
      'invalid-authenticated-device',
      'pairing requires fresh authenticated-device evidence',
    );
  }
}

function assertPrincipal(principalId: string): string {
  if (
    typeof principalId !== 'string'
    || principalId.length === 0
    || principalId.length > 256
    || principalId.trim() !== principalId
    || !PRINCIPAL_RE.test(principalId)
  ) {
    throw new FuryGatewayPairingError('invalid-principal', 'pairing approval principal is invalid');
  }
  return principalId;
}

function samePinnedIdentity(
  paired: FuryGatewayPairedDevice,
  device: FuryGatewayAuthenticatedDevice,
): boolean {
  return paired.deviceId === device.deviceId
    && paired.publicKeySha256 === device.publicKeySha256
    && paired.role === device.role
    && paired.clientId === device.clientId
    && paired.platform === device.platform
    && paired.deviceFamily === device.deviceFamily;
}

export function createFuryGatewayPairingCoordinator(
  options: FuryGatewayPairingCoordinatorOptions = {},
): FuryGatewayPairingCoordinator {
  const now = options.now ?? Date.now;
  const requestTtlMs = boundedInteger(
    options.requestTtlMs,
    DEFAULT_REQUEST_TTL_MS,
    MIN_REQUEST_TTL_MS,
    MAX_REQUEST_TTL_MS,
    'requestTtlMs',
  );
  const maxPending = boundedInteger(options.maxPending, DEFAULT_MAX_PENDING, 1, 65_536, 'maxPending');
  const maxPaired = boundedInteger(options.maxPaired, DEFAULT_MAX_PAIRED, 1, 1_000_000, 'maxPaired');

  const pendingById = new Map<string, FuryGatewayPairingRequest>();
  const pendingByKey = new Map<string, string>();
  const pairedByKey = new Map<string, FuryGatewayPairedDevice>();

  const prunePending = (at: number): void => {
    for (const [requestId, request] of pendingById) {
      if (request.expiresAt < at) {
        pendingById.delete(requestId);
        pendingByKey.delete(pairingKey(request.deviceId, request.role));
      }
    }
  };

  return Object.freeze({
    requestPairing(device: FuryGatewayAuthenticatedDevice): FuryGatewayPairingRequest {
      assertAuthenticatedDevice(device);
      const requestedAt = finiteNow(now);
      prunePending(requestedAt);
      const key = pairingKey(device.deviceId, device.role);

      if (pairedByKey.has(key)) {
        throw new FuryGatewayPairingError('pairing-already-exists', 'device is already paired for this role');
      }
      if (pendingByKey.has(key)) {
        throw new FuryGatewayPairingError('pairing-already-pending', 'device already has a pending pairing request');
      }
      if (pendingById.size >= maxPending) {
        throw new FuryGatewayPairingError('limit-exceeded', 'too many pending gateway pairing requests');
      }

      let requestId: string;
      do {
        requestId = randomBytes(16).toString('base64url');
      } while (pendingById.has(requestId));

      const request = Object.freeze({
        format: FURY_GATEWAY_PAIRING_REQUEST_FORMAT,
        requestId,
        deviceId: device.deviceId,
        publicKeySha256: device.publicKeySha256,
        role: device.role,
        clientId: device.clientId,
        ...(device.platform === undefined ? {} : { platform: device.platform }),
        ...(device.deviceFamily === undefined ? {} : { deviceFamily: device.deviceFamily }),
        requestedAt,
        expiresAt: requestedAt + requestTtlMs,
        status: 'pending' as const,
        authorization: 'none' as const,
      });

      pendingById.set(requestId, request);
      pendingByKey.set(key, requestId);
      return request;
    },

    approvePairing(requestId: string, pairedByPrincipalId: string): FuryGatewayPairedDevice {
      const pairedAt = finiteNow(now);
      const request = pendingById.get(requestId);
      if (!request) {
        throw new FuryGatewayPairingError('pairing-not-found', 'pairing request does not exist or expired');
      }
      if (pairedAt > request.expiresAt) {
        pendingById.delete(requestId);
        pendingByKey.delete(pairingKey(request.deviceId, request.role));
        throw new FuryGatewayPairingError('pairing-expired', 'pairing request expired');
      }

      const key = pairingKey(request.deviceId, request.role);
      if (pairedByKey.has(key)) {
        throw new FuryGatewayPairingError('pairing-already-exists', 'device is already paired for this role');
      }
      if (pairedByKey.size >= maxPaired) {
        throw new FuryGatewayPairingError('limit-exceeded', 'paired device registry is full');
      }

      const principal = assertPrincipal(pairedByPrincipalId);
      const paired = Object.freeze({
        format: FURY_GATEWAY_PAIRED_DEVICE_FORMAT,
        pairingId: randomBytes(16).toString('base64url'),
        deviceId: request.deviceId,
        publicKeySha256: request.publicKeySha256,
        role: request.role,
        clientId: request.clientId,
        ...(request.platform === undefined ? {} : { platform: request.platform }),
        ...(request.deviceFamily === undefined ? {} : { deviceFamily: request.deviceFamily }),
        pairedAt,
        pairedByPrincipalId: principal,
        status: 'paired' as const,
        authorization: 'none' as const,
      });

      pendingById.delete(requestId);
      pendingByKey.delete(key);
      pairedByKey.set(key, paired);
      return paired;
    },

    rejectPairing(requestId: string): boolean {
      const at = finiteNow(now);
      prunePending(at);
      const request = pendingById.get(requestId);
      if (!request) return false;
      pendingById.delete(requestId);
      pendingByKey.delete(pairingKey(request.deviceId, request.role));
      return true;
    },

    revokePairing(deviceId: string, role: FuryGatewayRole): boolean {
      finiteNow(now);
      return pairedByKey.delete(pairingKey(deviceId, role));
    },

    inspectPairing(device: FuryGatewayAuthenticatedDevice): FuryGatewayPairedDevice | undefined {
      assertAuthenticatedDevice(device);
      const at = finiteNow(now);
      prunePending(at);
      const paired = pairedByKey.get(pairingKey(device.deviceId, device.role));
      if (!paired) return undefined;
      if (!samePinnedIdentity(paired, device)) {
        throw new FuryGatewayPairingError(
          'pairing-mismatch',
          'authenticated device metadata does not match the pinned pairing identity',
        );
      }
      return paired;
    },

    pendingCount(): number {
      prunePending(finiteNow(now));
      return pendingById.size;
    },

    pairedCount(): number {
      finiteNow(now);
      return pairedByKey.size;
    },
  });
}