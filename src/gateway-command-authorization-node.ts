import { createHash } from 'node:crypto';

import {
  isGeneratedFuryGatewayAuthenticatedDevice,
  type FuryGatewayAuthenticatedDevice,
} from './gateway-auth-node.js';
import type { FuryGatewayPairingCoordinator } from './gateway-pairing-node.js';
import {
  isFuryGatewayScope,
  isGeneratedFuryGatewaySessionLease,
  type FuryGatewayScope,
  type FuryGatewaySessionCoordinator,
  type FuryGatewaySessionLease,
} from './gateway-session-node.js';
import {
  FURY_GATEWAY_ROLES,
  type FuryGatewayRole,
} from './gateway.js';
import type { FuryPluginPermission } from './plugin-bundles.js';

export const FURY_GATEWAY_COMMAND_FORMAT = 'furypipe-gateway-command-definition/v1' as const;
export const FURY_GATEWAY_COMMAND_ADMISSION_FORMAT = 'furypipe-gateway-command-admission/v1' as const;

export const FURY_GATEWAY_COMMAND_RISK_CLASSES = [
  'inspect',
  'read',
  'write',
  'process',
  'admin',
] as const;
export type FuryGatewayCommandRiskClass =
  (typeof FURY_GATEWAY_COMMAND_RISK_CLASSES)[number];

export const FURY_GATEWAY_CAPABILITY_SCOPE_BY_PLUGIN_PERMISSION = Object.freeze({
  network: 'capability.network',
  browser: 'capability.browser',
  process: 'capability.process',
  'repository-read': 'capability.repository-read',
  'repository-write': 'capability.repository-write',
  'database-read': 'capability.database-read',
  'database-write': 'capability.database-write',
  'design-read': 'capability.design-read',
  'design-write': 'capability.design-write',
  'cloud-read': 'capability.cloud-read',
  'cloud-write': 'capability.cloud-write',
  'provider-inference': 'capability.provider-inference',
  'provider-management': 'capability.provider-management',
} as const satisfies Record<FuryPluginPermission, FuryGatewayScope>);

const PLUGIN_PERMISSION_SET = new Set<FuryPluginPermission>(
  Object.keys(FURY_GATEWAY_CAPABILITY_SCOPE_BY_PLUGIN_PERMISSION) as FuryPluginPermission[],
);

export interface FuryGatewayCommandDefinition {
  readonly format: typeof FURY_GATEWAY_COMMAND_FORMAT;
  readonly name: string;
  readonly allowedRoles: readonly FuryGatewayRole[];
  readonly requiredScopes: readonly FuryGatewayScope[];
  readonly requiredPluginPermissions: readonly FuryPluginPermission[];
  readonly riskClass: FuryGatewayCommandRiskClass;
  readonly requiresFreshApproval: boolean;
}

export interface FuryGatewayCommandRegistry {
  register(definition: FuryGatewayCommandDefinition): void;
  get(name: string): FuryGatewayCommandDefinition | undefined;
  list(): readonly FuryGatewayCommandDefinition[];
  size(): number;
}

export type FuryGatewayCommandAdmissionReason =
  | 'eligible'
  | 'invalid-session'
  | 'session-not-active'
  | 'command-not-registered'
  | 'role-not-allowed'
  | 'missing-scope'
  | 'plugin-permission-mismatch'
  | 'device-proof-required'
  | 'device-binding-mismatch'
  | 'pairing-not-active'
  | 'fresh-approval-required';

export interface FuryGatewayCommandAdmissionDecision {
  readonly format: typeof FURY_GATEWAY_COMMAND_ADMISSION_FORMAT;
  readonly decisionIdSha256: string;
  readonly sessionIdSha256: string;
  readonly principalIdSha256: string;
  readonly commandName: string;
  readonly riskClass: FuryGatewayCommandRiskClass | 'unknown';
  readonly requiredScopes: readonly FuryGatewayScope[];
  readonly requiredPluginPermissions: readonly FuryPluginPermission[];
  readonly outcome: 'eligible' | 'deny';
  readonly reason: FuryGatewayCommandAdmissionReason;
  readonly executionAuthority: false;
}

export interface FuryGatewayCommandAdmissionInput {
  readonly sessionCoordinator: FuryGatewaySessionCoordinator;
  readonly session: FuryGatewaySessionLease;
  readonly commandRegistry: FuryGatewayCommandRegistry;
  readonly commandName: string;
  /** Exact permissions declared by the selected plugin/tool capability. */
  readonly declaredPluginPermissions?: readonly FuryPluginPermission[];
  readonly currentDevice?: FuryGatewayAuthenticatedDevice;
  readonly pairing?: FuryGatewayPairingCoordinator;
}

const COMMAND_NAME_RE = /^[a-z][a-z0-9._:-]{0,127}$/u;
const MAX_COMMANDS = 2_048;

function exactPlainDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must use a plain-object prototype`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`${label} must not contain symbol keys`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new Error(`${label} must contain enumerable data properties only`);
    }
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported fields`);
  }
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new Error(`${label} is missing required fields`);
    }
  }
  return record;
}

function normalizeRoles(roles: readonly FuryGatewayRole[]): readonly FuryGatewayRole[] {
  if (!Array.isArray(roles) || roles.length < 1 || roles.length > FURY_GATEWAY_ROLES.length) {
    throw new Error('Gateway command allowedRoles is invalid');
  }
  const seen = new Set<string>();
  const normalized: FuryGatewayRole[] = [];
  for (const role of roles) {
    if (!(FURY_GATEWAY_ROLES as readonly string[]).includes(role) || seen.has(role)) {
      throw new Error('Gateway command allowedRoles contains an invalid or duplicate role');
    }
    seen.add(role);
    normalized.push(role);
  }
  normalized.sort();
  return Object.freeze(normalized);
}

function normalizeScopes(scopes: readonly FuryGatewayScope[]): readonly FuryGatewayScope[] {
  if (!Array.isArray(scopes) || scopes.length > 64) {
    throw new Error('Gateway command requiredScopes is invalid');
  }
  const seen = new Set<string>();
  const normalized: FuryGatewayScope[] = [];
  for (const scope of scopes) {
    if (!isFuryGatewayScope(scope) || seen.has(scope)) {
      throw new Error('Gateway command requiredScopes contains an unknown or duplicate scope');
    }
    seen.add(scope);
    normalized.push(scope);
  }
  normalized.sort();
  return Object.freeze(normalized);
}

function normalizePluginPermissions(
  permissions: readonly FuryPluginPermission[],
): readonly FuryPluginPermission[] {
  if (!Array.isArray(permissions) || permissions.length > PLUGIN_PERMISSION_SET.size) {
    throw new Error('Gateway command plugin permissions are invalid');
  }
  const seen = new Set<FuryPluginPermission>();
  const normalized: FuryPluginPermission[] = [];
  for (const permission of permissions) {
    if (!PLUGIN_PERMISSION_SET.has(permission) || seen.has(permission)) {
      throw new Error('Gateway command plugin permissions contain an unknown or duplicate permission');
    }
    seen.add(permission);
    normalized.push(permission);
  }
  normalized.sort();
  return Object.freeze(normalized);
}

export function validateFuryGatewayCommandDefinition(
  definition: FuryGatewayCommandDefinition,
): FuryGatewayCommandDefinition {
  exactPlainDataRecord(
    definition,
    [
      'format',
      'name',
      'allowedRoles',
      'requiredScopes',
      'requiredPluginPermissions',
      'riskClass',
      'requiresFreshApproval',
    ],
    'Gateway command definition',
  );
  if (
    definition.format !== FURY_GATEWAY_COMMAND_FORMAT
    || typeof definition.name !== 'string'
    || !COMMAND_NAME_RE.test(definition.name)
  ) {
    throw new Error('Gateway command identity is invalid');
  }
  if (!(FURY_GATEWAY_COMMAND_RISK_CLASSES as readonly string[]).includes(definition.riskClass)) {
    throw new Error('Gateway command risk class is invalid');
  }
  if (typeof definition.requiresFreshApproval !== 'boolean') {
    throw new Error('Gateway command requiresFreshApproval must be boolean');
  }

  const requiredScopes = normalizeScopes(definition.requiredScopes);
  const requiredPluginPermissions = normalizePluginPermissions(definition.requiredPluginPermissions);
  for (const permission of requiredPluginPermissions) {
    const expectedScope = FURY_GATEWAY_CAPABILITY_SCOPE_BY_PLUGIN_PERMISSION[permission];
    if (!requiredScopes.includes(expectedScope)) {
      throw new Error(
        `Gateway command plugin permission ${permission} requires session scope ${expectedScope}`,
      );
    }
  }

  return Object.freeze({
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: definition.name,
    allowedRoles: normalizeRoles(definition.allowedRoles),
    requiredScopes,
    requiredPluginPermissions,
    riskClass: definition.riskClass,
    requiresFreshApproval: definition.requiresFreshApproval,
  });
}

export function createFuryGatewayCommandRegistry(
  initial: readonly FuryGatewayCommandDefinition[] = [],
): FuryGatewayCommandRegistry {
  if (!Array.isArray(initial) || initial.length > MAX_COMMANDS) {
    throw new Error('Gateway command registry initial set exceeds its bound');
  }
  const definitions = new Map<string, FuryGatewayCommandDefinition>();
  const registry: FuryGatewayCommandRegistry = Object.freeze({
    register(definition: FuryGatewayCommandDefinition): void {
      if (definitions.size >= MAX_COMMANDS) {
        throw new Error('Gateway command registry is full');
      }
      const valid = validateFuryGatewayCommandDefinition(definition);
      if (definitions.has(valid.name)) {
        throw new Error(`Gateway command already registered: ${valid.name}`);
      }
      definitions.set(valid.name, valid);
    },
    get(name: string): FuryGatewayCommandDefinition | undefined {
      if (typeof name !== 'string' || !COMMAND_NAME_RE.test(name)) return undefined;
      return definitions.get(name);
    },
    list(): readonly FuryGatewayCommandDefinition[] {
      return Object.freeze([...definitions.values()].sort((a, b) => a.name.localeCompare(b.name)));
    },
    size(): number {
      return definitions.size;
    },
  });
  for (const definition of initial) registry.register(definition);
  return registry;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function decision(
  session: FuryGatewaySessionLease | undefined,
  commandName: string,
  definition: FuryGatewayCommandDefinition | undefined,
  outcome: 'eligible' | 'deny',
  reason: FuryGatewayCommandAdmissionReason,
): FuryGatewayCommandAdmissionDecision {
  const requiredScopes = definition?.requiredScopes ?? Object.freeze([]);
  const requiredPluginPermissions = definition?.requiredPluginPermissions ?? Object.freeze([]);
  const validSessionEvidence = isGeneratedFuryGatewaySessionLease(session);
  const sessionIdSha256 = sha256(validSessionEvidence ? session.sessionId : 'invalid-session');
  const principalIdSha256 = sha256(validSessionEvidence ? session.principalId : 'invalid-principal');
  const riskClass = definition?.riskClass ?? 'unknown';
  const decisionIdSha256 = sha256(JSON.stringify({
    sessionIdSha256,
    principalIdSha256,
    commandName,
    riskClass,
    requiredScopes,
    requiredPluginPermissions,
    outcome,
    reason,
    executionAuthority: false,
  }));
  return Object.freeze({
    format: FURY_GATEWAY_COMMAND_ADMISSION_FORMAT,
    decisionIdSha256,
    sessionIdSha256,
    principalIdSha256,
    commandName,
    riskClass,
    requiredScopes,
    requiredPluginPermissions,
    outcome,
    reason,
    executionAuthority: false,
  });
}

function declaredPermissionsSatisfy(
  required: readonly FuryPluginPermission[],
  declared: readonly FuryPluginPermission[] | undefined,
): boolean {
  if (required.length === 0) return true;
  if (!Array.isArray(declared) || declared.length > PLUGIN_PERMISSION_SET.size) return false;
  const seen = new Set<FuryPluginPermission>();
  for (const permission of declared) {
    if (!PLUGIN_PERMISSION_SET.has(permission) || seen.has(permission)) return false;
    seen.add(permission);
  }
  return required.every((permission) => seen.has(permission));
}

function pairedBindingStillValid(
  session: FuryGatewaySessionLease,
  currentDevice: FuryGatewayAuthenticatedDevice | undefined,
  pairing: FuryGatewayPairingCoordinator | undefined,
): 'valid' | 'device-proof-required' | 'device-binding-mismatch' | 'pairing-not-active' {
  if (session.binding.kind !== 'paired-device') return 'valid';
  if (!currentDevice || !pairing || !isGeneratedFuryGatewayAuthenticatedDevice(currentDevice)) {
    return 'device-proof-required';
  }
  if (
    currentDevice.deviceId !== session.binding.deviceId
    || currentDevice.publicKeySha256 !== session.binding.publicKeySha256
    || currentDevice.role !== session.role
  ) {
    return 'device-binding-mismatch';
  }
  try {
    const paired = pairing.inspectPairing(currentDevice);
    if (!paired || paired.pairingId !== session.binding.pairingId) return 'pairing-not-active';
  } catch {
    return 'pairing-not-active';
  }
  return 'valid';
}

/**
 * Session/command admission only.
 *
 * An "eligible" result is deliberately NOT an execution permit. Downstream
 * plugin/tool/MCP/worker governance must still authorize and execute the action.
 */
export function evaluateFuryGatewayCommandAdmission(
  input: FuryGatewayCommandAdmissionInput,
): FuryGatewayCommandAdmissionDecision {
  const commandName = typeof input?.commandName === 'string' && COMMAND_NAME_RE.test(input.commandName)
    ? input.commandName
    : '<invalid-command>';
  if (!input || !isGeneratedFuryGatewaySessionLease(input.session)) {
    return decision(undefined, commandName, undefined, 'deny', 'invalid-session');
  }

  let inspection;
  try {
    inspection = input.sessionCoordinator.inspectSession(input.session);
  } catch {
    return decision(input.session, commandName, undefined, 'deny', 'invalid-session');
  }
  if (inspection.status !== 'active') {
    return decision(input.session, commandName, undefined, 'deny', 'session-not-active');
  }

  const definition = input.commandRegistry.get(commandName);
  if (!definition) {
    return decision(input.session, commandName, undefined, 'deny', 'command-not-registered');
  }
  if (!definition.allowedRoles.includes(input.session.role)) {
    return decision(input.session, commandName, definition, 'deny', 'role-not-allowed');
  }

  const sessionScopes = new Set(input.session.scopes);
  if (definition.requiredScopes.some((scope) => !sessionScopes.has(scope))) {
    return decision(input.session, commandName, definition, 'deny', 'missing-scope');
  }

  if (!declaredPermissionsSatisfy(
    definition.requiredPluginPermissions,
    input.declaredPluginPermissions,
  )) {
    return decision(
      input.session,
      commandName,
      definition,
      'deny',
      'plugin-permission-mismatch',
    );
  }

  const binding = pairedBindingStillValid(input.session, input.currentDevice, input.pairing);
  if (binding !== 'valid') {
    return decision(input.session, commandName, definition, 'deny', binding);
  }

  if (definition.requiresFreshApproval) {
    return decision(input.session, commandName, definition, 'deny', 'fresh-approval-required');
  }

  return decision(input.session, commandName, definition, 'eligible', 'eligible');
}