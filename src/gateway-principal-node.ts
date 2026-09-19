import { createHash } from 'node:crypto';

export const FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT = 'furypipe-gateway-principal-assertion/v1' as const;
export const FURY_GATEWAY_AUTHENTICATED_PRINCIPAL_FORMAT = 'furypipe-gateway-authenticated-principal/v1' as const;

export const FURY_GATEWAY_PRINCIPAL_KINDS = ['human', 'service', 'automation'] as const;
export type FuryGatewayPrincipalKind = (typeof FURY_GATEWAY_PRINCIPAL_KINDS)[number];

export const FURY_GATEWAY_PRINCIPAL_AUTH_METHODS = [
  'local-owner',
  'oidc',
  'service-credential',
  'automation-owner',
] as const;
export type FuryGatewayPrincipalAuthenticationMethod =
  (typeof FURY_GATEWAY_PRINCIPAL_AUTH_METHODS)[number];

export interface FuryGatewayTrustedPrincipalAssertion {
  readonly format: typeof FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT;
  readonly principalId: string;
  readonly kind: FuryGatewayPrincipalKind;
  readonly issuer: string;
  readonly subject: string;
  readonly authenticationMethod: FuryGatewayPrincipalAuthenticationMethod;
}

export interface FuryGatewayAuthenticatedPrincipal {
  readonly format: typeof FURY_GATEWAY_AUTHENTICATED_PRINCIPAL_FORMAT;
  readonly principalId: string;
  readonly kind: FuryGatewayPrincipalKind;
  readonly issuer: string;
  readonly subjectSha256: string;
  readonly authenticationMethod: FuryGatewayPrincipalAuthenticationMethod;
  readonly generation: number;
  readonly authenticatedAt: number;
  readonly expiresAt: number;
  readonly authority: 'authenticated-principal';
}

export type FuryGatewayPrincipalErrorCode =
  | 'invalid-assertion'
  | 'invalid-principal'
  | 'principal-revoked'
  | 'principal-evidence-stale'
  | 'limit-exceeded';

export class FuryGatewayPrincipalError extends Error {
  readonly code: FuryGatewayPrincipalErrorCode;

  constructor(code: FuryGatewayPrincipalErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayPrincipalError';
    this.code = code;
  }
}

export interface FuryGatewayPrincipalRegistryOptions {
  readonly now?: () => number;
  readonly evidenceTtlMs?: number;
  readonly maxPrincipals?: number;
}

export interface FuryGatewayPrincipalInspection {
  readonly principalId: string;
  readonly kind: FuryGatewayPrincipalKind;
  readonly issuer: string;
  readonly authenticationMethod: FuryGatewayPrincipalAuthenticationMethod;
  readonly generation: number;
  readonly status: 'active' | 'revoked';
  readonly lastAuthenticatedAt: number;
}

export interface FuryGatewayPrincipalRegistry {
  /**
   * Trusted-host boundary only. The caller must authenticate the principal
   * before supplying this assertion. This function validates/binds evidence;
   * it does not validate passwords, OIDC tokens or service credentials.
   */
  recordAuthenticatedPrincipal(
    assertion: FuryGatewayTrustedPrincipalAssertion,
  ): FuryGatewayAuthenticatedPrincipal;
  revokePrincipal(principalId: string): boolean;
  isCurrentEvidence(principal: FuryGatewayAuthenticatedPrincipal): boolean;
  isActiveGeneration(principalId: string, generation: number): boolean;
  inspect(principalId: string): FuryGatewayPrincipalInspection | undefined;
  size(): number;
}

interface PrincipalState {
  readonly principalId: string;
  readonly kind: FuryGatewayPrincipalKind;
  readonly issuer: string;
  readonly authenticationMethod: FuryGatewayPrincipalAuthenticationMethod;
  readonly subjectSha256: string;
  generation: number;
  status: 'active' | 'revoked';
  lastAuthenticatedAt: number;
}

const PRINCIPAL_EVIDENCE = new WeakSet<object>();
const PRINCIPAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u;
const DEFAULT_EVIDENCE_TTL_MS = 5 * 60_000;
const MIN_EVIDENCE_TTL_MS = 30_000;
const MAX_EVIDENCE_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_PRINCIPALS = 4_096;
const MAX_PRINCIPALS = 100_000;

function finiteNow(now: () => number): number {
  const value = now();
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('gateway principal clock must return a finite non-negative timestamp');
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

function exactPlainDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FuryGatewayPrincipalError('invalid-assertion', `${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FuryGatewayPrincipalError('invalid-assertion', `${label} must use a plain-object prototype`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new FuryGatewayPrincipalError('invalid-assertion', `${label} must not contain symbol keys`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new FuryGatewayPrincipalError('invalid-assertion', `${label} must contain enumerable data properties only`);
    }
    if (!allowed.has(key)) {
      throw new FuryGatewayPrincipalError('invalid-assertion', `${label} contains unsupported field: ${key}`);
    }
  }
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryGatewayPrincipalError('invalid-assertion', `${label} is missing required field: ${key}`);
    }
  }
  return record;
}

function boundedText(value: unknown, label: string, maxBytes: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || Buffer.byteLength(value, 'utf8') > maxBytes
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new FuryGatewayPrincipalError('invalid-assertion', `${label} must be bounded printable text`);
  }
  return value;
}

function validateAssertion(
  assertion: FuryGatewayTrustedPrincipalAssertion,
): FuryGatewayTrustedPrincipalAssertion {
  exactPlainDataRecord(
    assertion,
    ['format', 'principalId', 'kind', 'issuer', 'subject', 'authenticationMethod'],
    'gateway principal assertion',
  );
  if (assertion.format !== FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT) {
    throw new FuryGatewayPrincipalError('invalid-assertion', 'unsupported gateway principal assertion format');
  }
  if (typeof assertion.principalId !== 'string' || !PRINCIPAL_ID_RE.test(assertion.principalId)) {
    throw new FuryGatewayPrincipalError('invalid-principal', 'gateway principal ID is invalid');
  }
  if (!(FURY_GATEWAY_PRINCIPAL_KINDS as readonly string[]).includes(assertion.kind)) {
    throw new FuryGatewayPrincipalError('invalid-assertion', 'gateway principal kind is unsupported');
  }
  if (!(FURY_GATEWAY_PRINCIPAL_AUTH_METHODS as readonly string[]).includes(assertion.authenticationMethod)) {
    throw new FuryGatewayPrincipalError('invalid-assertion', 'gateway principal authentication method is unsupported');
  }
  const issuer = boundedText(assertion.issuer, 'issuer', 256);
  const subject = boundedText(assertion.subject, 'subject', 512);
  return Object.freeze({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: assertion.principalId,
    kind: assertion.kind,
    issuer,
    subject,
    authenticationMethod: assertion.authenticationMethod,
  });
}

function subjectDigest(issuer: string, subject: string): string {
  const hash = createHash('sha256');
  const issuerBytes = Buffer.from(issuer, 'utf8');
  const subjectBytes = Buffer.from(subject, 'utf8');
  const lengths = Buffer.allocUnsafe(8);
  lengths.writeUInt32BE(issuerBytes.byteLength, 0);
  lengths.writeUInt32BE(subjectBytes.byteLength, 4);
  hash.update(lengths);
  hash.update(issuerBytes);
  hash.update(subjectBytes);
  return hash.digest('hex');
}

export function isGeneratedFuryGatewayAuthenticatedPrincipal(
  value: unknown,
): value is FuryGatewayAuthenticatedPrincipal {
  return typeof value === 'object'
    && value !== null
    && PRINCIPAL_EVIDENCE.has(value);
}

export function createFuryGatewayPrincipalRegistry(
  options: FuryGatewayPrincipalRegistryOptions = {},
): FuryGatewayPrincipalRegistry {
  const now = options.now ?? Date.now;
  const evidenceTtlMs = boundedInteger(
    options.evidenceTtlMs,
    DEFAULT_EVIDENCE_TTL_MS,
    MIN_EVIDENCE_TTL_MS,
    MAX_EVIDENCE_TTL_MS,
    'evidenceTtlMs',
  );
  const maxPrincipals = boundedInteger(
    options.maxPrincipals,
    DEFAULT_MAX_PRINCIPALS,
    1,
    MAX_PRINCIPALS,
    'maxPrincipals',
  );
  const states = new Map<string, PrincipalState>();

  const isCurrent = (principal: FuryGatewayAuthenticatedPrincipal, at: number): boolean => {
    if (!isGeneratedFuryGatewayAuthenticatedPrincipal(principal)) return false;
    if (principal.expiresAt < at) return false;
    const state = states.get(principal.principalId);
    return state !== undefined
      && state.status === 'active'
      && state.generation === principal.generation
      && state.kind === principal.kind
      && state.issuer === principal.issuer
      && state.authenticationMethod === principal.authenticationMethod;
  };

  return Object.freeze({
    recordAuthenticatedPrincipal(
      assertionInput: FuryGatewayTrustedPrincipalAssertion,
    ): FuryGatewayAuthenticatedPrincipal {
      const assertion = validateAssertion(assertionInput);
      const authenticatedAt = finiteNow(now);
      const existing = states.get(assertion.principalId);
      const assertionSubjectSha256 = subjectDigest(assertion.issuer, assertion.subject);

      if (existing?.status === 'revoked') {
        throw new FuryGatewayPrincipalError(
          'principal-revoked',
          'gateway principal is revoked and cannot be silently reactivated',
        );
      }
      if (existing !== undefined && (
        existing.kind !== assertion.kind
        || existing.issuer !== assertion.issuer
        || existing.authenticationMethod !== assertion.authenticationMethod
        || existing.subjectSha256 !== assertionSubjectSha256
      )) {
        throw new FuryGatewayPrincipalError(
          'invalid-principal',
          'gateway principal identity metadata changed for an existing principal ID',
        );
      }
      if (existing === undefined && states.size >= maxPrincipals) {
        throw new FuryGatewayPrincipalError('limit-exceeded', 'gateway principal registry is full');
      }

      const state: PrincipalState = existing ?? {
        principalId: assertion.principalId,
        kind: assertion.kind,
        issuer: assertion.issuer,
        authenticationMethod: assertion.authenticationMethod,
        subjectSha256: assertionSubjectSha256,
        generation: 1,
        status: 'active',
        lastAuthenticatedAt: authenticatedAt,
      };
      state.lastAuthenticatedAt = authenticatedAt;
      states.set(assertion.principalId, state);

      const principal = Object.freeze({
        format: FURY_GATEWAY_AUTHENTICATED_PRINCIPAL_FORMAT,
        principalId: assertion.principalId,
        kind: assertion.kind,
        issuer: assertion.issuer,
        subjectSha256: assertionSubjectSha256,
        authenticationMethod: assertion.authenticationMethod,
        generation: state.generation,
        authenticatedAt,
        expiresAt: authenticatedAt + evidenceTtlMs,
        authority: 'authenticated-principal' as const,
      });
      PRINCIPAL_EVIDENCE.add(principal);
      return principal;
    },

    revokePrincipal(principalId: string): boolean {
      if (typeof principalId !== 'string' || !PRINCIPAL_ID_RE.test(principalId)) {
        throw new FuryGatewayPrincipalError('invalid-principal', 'gateway principal ID is invalid');
      }
      const state = states.get(principalId);
      if (!state || state.status === 'revoked') return false;
      state.status = 'revoked';
      state.generation += 1;
      return true;
    },

    isCurrentEvidence(principal: FuryGatewayAuthenticatedPrincipal): boolean {
      return isCurrent(principal, finiteNow(now));
    },

    isActiveGeneration(principalId: string, generation: number): boolean {
      if (typeof principalId !== 'string' || !PRINCIPAL_ID_RE.test(principalId)) return false;
      if (!Number.isSafeInteger(generation) || generation < 1) return false;
      const state = states.get(principalId);
      return state !== undefined
        && state.status === 'active'
        && state.generation === generation;
    },

    inspect(principalId: string): FuryGatewayPrincipalInspection | undefined {
      if (typeof principalId !== 'string' || !PRINCIPAL_ID_RE.test(principalId)) {
        throw new FuryGatewayPrincipalError('invalid-principal', 'gateway principal ID is invalid');
      }
      const state = states.get(principalId);
      if (!state) return undefined;
      return Object.freeze({
        principalId: state.principalId,
        kind: state.kind,
        issuer: state.issuer,
        authenticationMethod: state.authenticationMethod,
        generation: state.generation,
        status: state.status,
        lastAuthenticatedAt: state.lastAuthenticatedAt,
      });
    },

    size(): number {
      finiteNow(now);
      return states.size;
    },
  });
}