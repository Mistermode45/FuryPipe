import type {
  RecoveryHandle,
  RecoveryMetadata,
  RecoveryStore,
} from './core/recovery-store.js';
import {
  FURY_GATEWAY_SCOPES,
  type FuryGatewayScope,
} from './gateway-session-node.js';
import type { FuryPluginPermission } from './plugin-bundles.js';

export const FURY_GATEWAY_AUTOMATION_DEFINITION_FORMAT =
  'furypipe-gateway-automation-definition/v1' as const;
export const FURY_GATEWAY_AUTOMATION_DEFINITION_INSPECTION_FORMAT =
  'furypipe-gateway-automation-definition-inspection/v1' as const;

export const FURY_GATEWAY_AUTOMATION_MISFIRE_POLICIES = Object.freeze([
  'skip',
  'run-once',
] as const);
export type FuryGatewayAutomationMisfirePolicy =
  (typeof FURY_GATEWAY_AUTOMATION_MISFIRE_POLICIES)[number];

export interface FuryGatewayAutomationOneShotTrigger {
  readonly kind: 'one-shot';
  readonly at: number;
  readonly misfirePolicy: FuryGatewayAutomationMisfirePolicy;
}

export interface FuryGatewayAutomationIntervalTrigger {
  readonly kind: 'interval';
  readonly everyMs: number;
  readonly startAt: number;
  readonly endAt?: number;
  readonly misfirePolicy: FuryGatewayAutomationMisfirePolicy;
}

export type FuryGatewayAutomationTrigger =
  | FuryGatewayAutomationOneShotTrigger
  | FuryGatewayAutomationIntervalTrigger;

export interface FuryGatewayAutomationBudgets {
  readonly maxWallTimeMs: number;
  readonly maxToolCalls: number;
  readonly maxProviderCalls: number;
}

export interface FuryGatewayAutomationDefinition {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_DEFINITION_FORMAT;
  readonly automationId: string;
  readonly revision: number;
  readonly ownerPrincipalId: string;
  readonly workflowId: string;
  readonly enabled: boolean;
  readonly trigger: FuryGatewayAutomationTrigger;
  readonly requestedScopes: readonly FuryGatewayScope[];
  readonly requestedPluginPermissions: readonly FuryPluginPermission[];
  readonly budgets: FuryGatewayAutomationBudgets;
  readonly notificationPolicyKey?: string;
  readonly reason?: string;
  readonly createdAt: number;
  readonly previousRevisionSha256?: string;
  readonly authority: 'automation-policy-data-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationDefinitionInspection {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_DEFINITION_INSPECTION_FORMAT;
  readonly definitionSha256: string;
  readonly definition: FuryGatewayAutomationDefinition;
  readonly authority: 'observability-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationDefinitionInput {
  readonly automationId: string;
  readonly ownerPrincipalId: string;
  readonly workflowId: string;
  readonly enabled: boolean;
  readonly trigger: FuryGatewayAutomationTrigger;
  readonly requestedScopes: readonly FuryGatewayScope[];
  readonly requestedPluginPermissions: readonly FuryPluginPermission[];
  readonly budgets: FuryGatewayAutomationBudgets;
  readonly notificationPolicyKey?: string;
  readonly reason?: string;
}

export interface FuryGatewayAutomationDefinitionRevisionInput {
  readonly automationId: string;
  readonly expectedRevision: number;
  readonly ownerPrincipalId?: string;
  readonly workflowId?: string;
  readonly enabled?: boolean;
  readonly trigger?: FuryGatewayAutomationTrigger;
  readonly requestedScopes?: readonly FuryGatewayScope[];
  readonly requestedPluginPermissions?: readonly FuryPluginPermission[];
  readonly budgets?: FuryGatewayAutomationBudgets;
  readonly notificationPolicyKey?: string | null;
  readonly reason?: string | null;
}

export interface FuryGatewayAutomationDefinitionStoreOptions {
  readonly store: RecoveryStore;
  readonly now?: () => number;
  readonly maxDefinitionRecords?: number;
  readonly maxRevisionsPerAutomation?: number;
}

export interface FuryGatewayAutomationDefinitionStore {
  create(
    input: FuryGatewayAutomationDefinitionInput,
  ): Promise<FuryGatewayAutomationDefinitionInspection>;
  revise(
    input: FuryGatewayAutomationDefinitionRevisionInput,
  ): Promise<FuryGatewayAutomationDefinitionInspection>;
  inspect(
    automationId: string,
  ): Promise<FuryGatewayAutomationDefinitionInspection | undefined>;
  history(
    automationId: string,
  ): Promise<readonly FuryGatewayAutomationDefinitionInspection[]>;
  countRecords(): Promise<number>;
}

export type FuryGatewayAutomationDefinitionErrorCode =
  | 'store-capability-missing'
  | 'invalid-input'
  | 'definition-conflict'
  | 'definition-not-found'
  | 'stale-revision'
  | 'definition-corrupt'
  | 'limit-exceeded';

const ERROR_MESSAGES: Readonly<Record<
  FuryGatewayAutomationDefinitionErrorCode,
  string
>> = Object.freeze({
  'store-capability-missing':
    'Automation definition persistence requires RecoveryStore list and atomic putBounded capabilities.',
  'invalid-input': 'Automation definition input is invalid.',
  'definition-conflict': 'Automation definition already exists.',
  'definition-not-found': 'Automation definition does not exist.',
  'stale-revision': 'Automation definition revision is stale.',
  'definition-corrupt': 'Automation definition durable state is inconsistent or corrupt.',
  'limit-exceeded': 'Automation definition durable limit was exceeded.',
});

export class FuryGatewayAutomationDefinitionError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code: FuryGatewayAutomationDefinitionErrorCode,
    readonly automationId?: string,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'FuryGatewayAutomationDefinitionError';
  }
}

interface LoadedDefinition {
  readonly handle: RecoveryHandle;
  readonly definition: FuryGatewayAutomationDefinition;
}

const GENERATED_STORES = new WeakSet<object>();
const SYSTEM = 'gateway-automation-definition';
const AUTOMATION_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const POLICY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const MAX_DEFINITION_BYTES = 32 * 1024;
const MAX_DEFINITION_DEPTH = 16;
const DEFAULT_MAX_DEFINITION_RECORDS = 10_000;
const HARD_MAX_DEFINITION_RECORDS = 100_000;
const DEFAULT_MAX_REVISIONS_PER_AUTOMATION = 128;
const HARD_MAX_REVISIONS_PER_AUTOMATION = 1_024;
const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 365 * 24 * 60 * 60_000;
const MIN_WALL_TIME_MS = 1_000;
const MAX_WALL_TIME_MS = 24 * 60 * 60_000;
const MAX_TOOL_CALLS = 10_000;
const MAX_PROVIDER_CALLS = 10_000;
const MAX_REASON_BYTES = 1_024;

const PLUGIN_PERMISSIONS = new Set<FuryPluginPermission>([
  'network',
  'browser',
  'process',
  'repository-read',
  'repository-write',
  'database-read',
  'database-write',
  'design-read',
  'design-write',
  'cloud-read',
  'cloud-write',
  'provider-inference',
  'provider-management',
]);

function exactDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new FuryGatewayAutomationDefinitionError('invalid-input');
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !allowed.has(key)
    ) {
      throw new FuryGatewayAutomationDefinitionError('invalid-input');
    }
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryGatewayAutomationDefinitionError('invalid-input');
    }
  }
  return record;
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
    throw new RangeError(label + ' must be an integer from ' + min + ' to ' + max);
  }
  return resolved;
}

function nowValue(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FuryGatewayAutomationDefinitionError('invalid-input');
  }
  return value;
}

function id(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new FuryGatewayAutomationDefinitionError('invalid-input');
  }
  return value;
}

function reason(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.trim() !== value
    || Buffer.byteLength(value, 'utf8') > MAX_REASON_BYTES
    || /[ -]/u.test(value)
  ) {
    throw new FuryGatewayAutomationDefinitionError('invalid-input');
  }
  return value;
}

function sortedUniqueScopes(value: unknown): readonly FuryGatewayScope[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new FuryGatewayAutomationDefinitionError('invalid-input');
  }
  const allowed = new Set<string>(FURY_GATEWAY_SCOPES);
  const result: FuryGatewayScope[] = [];
  const seen = new Set<string>();
  for (const scope of value) {
    if (
      typeof scope !== 'string'
      || !allowed.has(scope)
      || seen.has(scope)
    ) {
      throw new FuryGatewayAutomationDefinitionError('invalid-input');
    }
    seen.add(scope);
    result.push(scope as FuryGatewayScope);
  }
  result.sort();
  return Object.freeze(result);
}

function sortedUniquePluginPermissions(
  value: unknown,
): readonly FuryPluginPermission[] {
  if (!Array.isArray(value) || value.length > PLUGIN_PERMISSIONS.size) {
    throw new FuryGatewayAutomationDefinitionError('invalid-input');
  }
  const result: FuryPluginPermission[] = [];
  const seen = new Set<string>();
  for (const permission of value) {
    if (
      typeof permission !== 'string'
      || !PLUGIN_PERMISSIONS.has(permission as FuryPluginPermission)
      || seen.has(permission)
    ) {
      throw new FuryGatewayAutomationDefinitionError('invalid-input');
    }
    seen.add(permission);
    result.push(permission as FuryPluginPermission);
  }
  result.sort();
  return Object.freeze(result);
}

function misfirePolicy(value: unknown): FuryGatewayAutomationMisfirePolicy {
  if (
    typeof value !== 'string'
    || !(FURY_GATEWAY_AUTOMATION_MISFIRE_POLICIES as readonly string[])
      .includes(value)
  ) {
    throw new FuryGatewayAutomationDefinitionError('invalid-input');
  }
  return value as FuryGatewayAutomationMisfirePolicy;
}

function timestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new FuryGatewayAutomationDefinitionError('invalid-input');
  }
  return value as number;
}

function trigger(value: unknown): FuryGatewayAutomationTrigger {
  const record = exactDataRecord(
    value,
    ['kind', 'at', 'everyMs', 'startAt', 'endAt', 'misfirePolicy'],
    ['kind', 'misfirePolicy'],
    'automation trigger',
  );
  const policy = misfirePolicy(record.misfirePolicy);
  if (record.kind === 'one-shot') {
    if (!Object.prototype.hasOwnProperty.call(record, 'at')) {
      throw new FuryGatewayAutomationDefinitionError('invalid-input');
    }
    for (const key of ['everyMs', 'startAt', 'endAt']) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        throw new FuryGatewayAutomationDefinitionError('invalid-input');
      }
    }
    return Object.freeze({
      kind: 'one-shot' as const,
      at: timestamp(record.at),
      misfirePolicy: policy,
    });
  }
  if (record.kind === 'interval') {
    if (
      !Object.prototype.hasOwnProperty.call(record, 'everyMs')
      || !Object.prototype.hasOwnProperty.call(record, 'startAt')
      || Object.prototype.hasOwnProperty.call(record, 'at')
    ) {
      throw new FuryGatewayAutomationDefinitionError('invalid-input');
    }
    if (
      !Number.isSafeInteger(record.everyMs)
      || (record.everyMs as number) < MIN_INTERVAL_MS
      || (record.everyMs as number) > MAX_INTERVAL_MS
    ) {
      throw new FuryGatewayAutomationDefinitionError('invalid-input');
    }
    const startAt = timestamp(record.startAt);
    const endAt = record.endAt === undefined ? undefined : timestamp(record.endAt);
    if (endAt !== undefined && endAt <= startAt) {
      throw new FuryGatewayAutomationDefinitionError('invalid-input');
    }
    return Object.freeze({
      kind: 'interval' as const,
      everyMs: record.everyMs as number,
      startAt,
      ...(endAt === undefined ? {} : { endAt }),
      misfirePolicy: policy,
    });
  }
  throw new FuryGatewayAutomationDefinitionError('invalid-input');
}

function budgets(value: unknown): FuryGatewayAutomationBudgets {
  const record = exactDataRecord(
    value,
    ['maxWallTimeMs', 'maxToolCalls', 'maxProviderCalls'],
    ['maxWallTimeMs', 'maxToolCalls', 'maxProviderCalls'],
    'automation budgets',
  );
  if (
    !Number.isSafeInteger(record.maxWallTimeMs)
    || (record.maxWallTimeMs as number) < MIN_WALL_TIME_MS
    || (record.maxWallTimeMs as number) > MAX_WALL_TIME_MS
    || !Number.isSafeInteger(record.maxToolCalls)
    || (record.maxToolCalls as number) < 0
    || (record.maxToolCalls as number) > MAX_TOOL_CALLS
    || !Number.isSafeInteger(record.maxProviderCalls)
    || (record.maxProviderCalls as number) < 0
    || (record.maxProviderCalls as number) > MAX_PROVIDER_CALLS
  ) {
    throw new FuryGatewayAutomationDefinitionError('invalid-input');
  }
  return Object.freeze({
    maxWallTimeMs: record.maxWallTimeMs as number,
    maxToolCalls: record.maxToolCalls as number,
    maxProviderCalls: record.maxProviderCalls as number,
  });
}

function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (
    typeof encoded !== 'string'
    || Buffer.byteLength(encoded, 'utf8') > MAX_DEFINITION_BYTES
  ) {
    throw new FuryGatewayAutomationDefinitionError('limit-exceeded');
  }
  return encoded;
}

function definitionBytes(
  definition: FuryGatewayAutomationDefinition,
): Uint8Array {
  return new TextEncoder().encode(canonicalJson(definition));
}

function metadata(
  automationId: string,
  revision: number,
): RecoveryMetadata {
  return Object.freeze({
    system: SYSTEM,
    recordType: 'definition',
    automationId,
    revision,
  });
}

function inspection(
  handle: RecoveryHandle,
  definition: FuryGatewayAutomationDefinition,
): FuryGatewayAutomationDefinitionInspection {
  return Object.freeze({
    format: FURY_GATEWAY_AUTOMATION_DEFINITION_INSPECTION_FORMAT,
    definitionSha256: handle.digest,
    definition,
    authority: 'observability-only' as const,
    executionAuthority: false as const,
  });
}

function storedDefinition(
  input: FuryGatewayAutomationDefinitionInput,
  revision: number,
  createdAt: number,
  previousRevisionSha256?: string,
): FuryGatewayAutomationDefinition {
  exactDataRecord(
    input,
    [
      'automationId',
      'ownerPrincipalId',
      'workflowId',
      'enabled',
      'trigger',
      'requestedScopes',
      'requestedPluginPermissions',
      'budgets',
      'notificationPolicyKey',
      'reason',
    ],
    [
      'automationId',
      'ownerPrincipalId',
      'workflowId',
      'enabled',
      'trigger',
      'requestedScopes',
      'requestedPluginPermissions',
      'budgets',
    ],
    'automation definition input',
  );
  if (typeof input.enabled !== 'boolean') {
    throw new FuryGatewayAutomationDefinitionError('invalid-input');
  }
  const automationId = id(input.automationId, AUTOMATION_ID_RE);
  const ownerPrincipalId = id(input.ownerPrincipalId, ID_RE);
  const workflowId = id(input.workflowId, ID_RE);
  const notificationPolicyKey = input.notificationPolicyKey === undefined
    ? undefined
    : id(input.notificationPolicyKey, POLICY_KEY_RE);
  return Object.freeze({
    format: FURY_GATEWAY_AUTOMATION_DEFINITION_FORMAT,
    automationId,
    revision,
    ownerPrincipalId,
    workflowId,
    enabled: input.enabled,
    trigger: trigger(input.trigger),
    requestedScopes: sortedUniqueScopes(input.requestedScopes),
    requestedPluginPermissions:
      sortedUniquePluginPermissions(input.requestedPluginPermissions),
    budgets: budgets(input.budgets),
    ...(notificationPolicyKey === undefined
      ? {}
      : { notificationPolicyKey }),
    ...(reason(input.reason) === undefined ? {} : { reason: reason(input.reason)! }),
    createdAt,
    ...(previousRevisionSha256 === undefined
      ? {}
      : { previousRevisionSha256 }),
    authority: 'automation-policy-data-only' as const,
    executionAuthority: false as const,
  });
}

function validateStoredDefinition(
  value: unknown,
): FuryGatewayAutomationDefinition {
  try {
    const record = exactDataRecord(
      value,
      [
        'format',
        'automationId',
        'revision',
        'ownerPrincipalId',
        'workflowId',
        'enabled',
        'trigger',
        'requestedScopes',
        'requestedPluginPermissions',
        'budgets',
        'notificationPolicyKey',
        'reason',
        'createdAt',
        'previousRevisionSha256',
        'authority',
        'executionAuthority',
      ],
      [
        'format',
        'automationId',
        'revision',
        'ownerPrincipalId',
        'workflowId',
        'enabled',
        'trigger',
        'requestedScopes',
        'requestedPluginPermissions',
        'budgets',
        'createdAt',
        'authority',
        'executionAuthority',
      ],
      'stored automation definition',
    );
    if (
      record.format !== FURY_GATEWAY_AUTOMATION_DEFINITION_FORMAT
      || !Number.isSafeInteger(record.revision)
      || (record.revision as number) < 1
      || typeof record.enabled !== 'boolean'
      || record.authority !== 'automation-policy-data-only'
      || record.executionAuthority !== false
    ) {
      throw new FuryGatewayAutomationDefinitionError('definition-corrupt');
    }
    const previousRevisionSha256 = record.previousRevisionSha256;
    if (
      previousRevisionSha256 !== undefined
      && (
        typeof previousRevisionSha256 !== 'string'
        || !SHA256_RE.test(previousRevisionSha256)
      )
    ) {
      throw new FuryGatewayAutomationDefinitionError('definition-corrupt');
    }
    const notificationPolicyKey = record.notificationPolicyKey === undefined
      ? undefined
      : id(record.notificationPolicyKey, POLICY_KEY_RE);
    const normalized: FuryGatewayAutomationDefinition = Object.freeze({
      format: FURY_GATEWAY_AUTOMATION_DEFINITION_FORMAT,
      automationId: id(record.automationId, AUTOMATION_ID_RE),
      revision: record.revision as number,
      ownerPrincipalId: id(record.ownerPrincipalId, ID_RE),
      workflowId: id(record.workflowId, ID_RE),
      enabled: record.enabled,
      trigger: trigger(record.trigger),
      requestedScopes: sortedUniqueScopes(record.requestedScopes),
      requestedPluginPermissions:
        sortedUniquePluginPermissions(record.requestedPluginPermissions),
      budgets: budgets(record.budgets),
      ...(notificationPolicyKey === undefined
        ? {}
        : { notificationPolicyKey }),
      ...(reason(record.reason) === undefined
        ? {}
        : { reason: reason(record.reason)! }),
      createdAt: timestamp(record.createdAt),
      ...(previousRevisionSha256 === undefined
        ? {}
        : { previousRevisionSha256 }),
      authority: 'automation-policy-data-only' as const,
      executionAuthority: false as const,
    });
    if (canonicalJson(normalized) !== canonicalJson(value)) {
      throw new FuryGatewayAutomationDefinitionError('definition-corrupt');
    }
    return normalized;
  } catch (error) {
    if (
      error instanceof FuryGatewayAutomationDefinitionError
      && error.code === 'definition-corrupt'
    ) {
      throw error;
    }
    throw new FuryGatewayAutomationDefinitionError('definition-corrupt');
  }
}

function requiredStore(
  store: RecoveryStore,
): RecoveryStore & Required<Pick<RecoveryStore, 'list' | 'putBounded'>> {
  if (
    !store
    || typeof store !== 'object'
    || typeof store.get !== 'function'
    || typeof store.list !== 'function'
    || typeof store.putBounded !== 'function'
  ) {
    throw new FuryGatewayAutomationDefinitionError('store-capability-missing');
  }
  return store as RecoveryStore & Required<Pick<RecoveryStore, 'list' | 'putBounded'>>;
}

async function loadAutomation(
  store: RecoveryStore & Required<Pick<RecoveryStore, 'list'>>,
  automationId: string,
  maxRevisionsPerAutomation: number,
): Promise<readonly LoadedDefinition[]> {
  const handles = await store.list({
    metadata: {
      system: SYSTEM,
      recordType: 'definition',
      automationId,
    },
    limit: maxRevisionsPerAutomation + 1,
  });
  if (handles.length > maxRevisionsPerAutomation) {
    throw new FuryGatewayAutomationDefinitionError(
      'definition-corrupt',
      automationId,
    );
  }
  const loaded: LoadedDefinition[] = [];
  for (const handle of handles) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(await store.get(handle)),
      ) as unknown;
    } catch {
      throw new FuryGatewayAutomationDefinitionError(
        'definition-corrupt',
        automationId,
      );
    }
    const definition = validateStoredDefinition(parsed);
    if (
      definition.automationId !== automationId
      || handle.metadata?.system !== SYSTEM
      || handle.metadata?.recordType !== 'definition'
      || handle.metadata?.automationId !== automationId
      || handle.metadata?.revision !== definition.revision
    ) {
      throw new FuryGatewayAutomationDefinitionError(
        'definition-corrupt',
        automationId,
      );
    }
    loaded.push(Object.freeze({ handle, definition }));
  }
  loaded.sort((left, right) =>
    left.definition.revision - right.definition.revision);

  for (let index = 0; index < loaded.length; index += 1) {
    const current = loaded[index]!;
    const expectedRevision = index + 1;
    if (current.definition.revision !== expectedRevision) {
      throw new FuryGatewayAutomationDefinitionError(
        'definition-corrupt',
        automationId,
      );
    }
    if (index === 0) {
      if (current.definition.previousRevisionSha256 !== undefined) {
        throw new FuryGatewayAutomationDefinitionError(
          'definition-corrupt',
          automationId,
        );
      }
    } else {
      const previous = loaded[index - 1]!;
      if (
        current.definition.previousRevisionSha256 !== previous.handle.digest
        || current.definition.createdAt < previous.definition.createdAt
      ) {
        throw new FuryGatewayAutomationDefinitionError(
          'definition-corrupt',
          automationId,
        );
      }
    }
  }
  return Object.freeze(loaded);
}

function revisionInput(
  previous: FuryGatewayAutomationDefinition,
  input: FuryGatewayAutomationDefinitionRevisionInput,
): FuryGatewayAutomationDefinitionInput {
  exactDataRecord(
    input,
    [
      'automationId',
      'expectedRevision',
      'ownerPrincipalId',
      'workflowId',
      'enabled',
      'trigger',
      'requestedScopes',
      'requestedPluginPermissions',
      'budgets',
      'notificationPolicyKey',
      'reason',
    ],
    ['automationId', 'expectedRevision'],
    'automation definition revision input',
  );
  if (
    !Number.isSafeInteger(input.expectedRevision)
    || input.expectedRevision < 1
  ) {
    throw new FuryGatewayAutomationDefinitionError('invalid-input');
  }
  const automationId = id(input.automationId, AUTOMATION_ID_RE);
  if (automationId !== previous.automationId) {
    throw new FuryGatewayAutomationDefinitionError('invalid-input');
  }
  const notificationPolicyKey = input.notificationPolicyKey === null
    ? undefined
    : input.notificationPolicyKey ?? previous.notificationPolicyKey;
  const nextReason = input.reason === null
    ? undefined
    : input.reason ?? previous.reason;
  return Object.freeze({
    automationId,
    ownerPrincipalId: input.ownerPrincipalId ?? previous.ownerPrincipalId,
    workflowId: input.workflowId ?? previous.workflowId,
    enabled: input.enabled ?? previous.enabled,
    trigger: input.trigger ?? previous.trigger,
    requestedScopes: input.requestedScopes ?? previous.requestedScopes,
    requestedPluginPermissions:
      input.requestedPluginPermissions ?? previous.requestedPluginPermissions,
    budgets: input.budgets ?? previous.budgets,
    ...(notificationPolicyKey === undefined
      ? {}
      : { notificationPolicyKey }),
    ...(nextReason === undefined ? {} : { reason: nextReason }),
  });
}

export function isGeneratedFuryGatewayAutomationDefinitionStore(
  value: unknown,
): value is FuryGatewayAutomationDefinitionStore {
  return typeof value === 'object'
    && value !== null
    && GENERATED_STORES.has(value);
}

export function createFuryGatewayAutomationDefinitionStore(
  options: FuryGatewayAutomationDefinitionStoreOptions,
): FuryGatewayAutomationDefinitionStore {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
  ) {
    throw new FuryGatewayAutomationDefinitionError('invalid-input');
  }
  const store = requiredStore(options.store);
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new FuryGatewayAutomationDefinitionError('invalid-input');
  }
  nowValue(now);

  const maxDefinitionRecords = boundedInteger(
    options.maxDefinitionRecords,
    DEFAULT_MAX_DEFINITION_RECORDS,
    1,
    HARD_MAX_DEFINITION_RECORDS,
    'maxDefinitionRecords',
  );
  const maxRevisionsPerAutomation = boundedInteger(
    options.maxRevisionsPerAutomation,
    DEFAULT_MAX_REVISIONS_PER_AUTOMATION,
    1,
    HARD_MAX_REVISIONS_PER_AUTOMATION,
    'maxRevisionsPerAutomation',
  );

  const api: FuryGatewayAutomationDefinitionStore = Object.freeze({
    async create(
      input: FuryGatewayAutomationDefinitionInput,
    ): Promise<FuryGatewayAutomationDefinitionInspection> {
      const createdAt = nowValue(now);
      const definition = storedDefinition(input, 1, createdAt);
      const automationId = definition.automationId;
      try {
        const handle = await store.putBounded(
          definitionBytes(definition),
          metadata(automationId, 1),
          {
            metadata: { system: SYSTEM },
            maxMatches: maxDefinitionRecords,
            additionalBounds: [
              {
                metadata: {
                  system: SYSTEM,
                  recordType: 'definition',
                  automationId,
                },
                maxMatches: maxRevisionsPerAutomation,
              },
              {
                metadata: {
                  system: SYSTEM,
                  recordType: 'definition',
                  automationId,
                  revision: 1,
                },
                maxMatches: 1,
              },
            ],
            matchConstraints: [
              {
                metadata: {
                  system: SYSTEM,
                  recordType: 'definition',
                  automationId,
                },
                maxMatches: 0,
              },
            ],
          },
        );
        return inspection(handle, definition);
      } catch (error) {
        if (
          error instanceof FuryGatewayAutomationDefinitionError
          || error instanceof RangeError
        ) {
          throw error;
        }
        const existing = await loadAutomation(
          store,
          automationId,
          maxRevisionsPerAutomation,
        );
        if (existing.length > 0) {
          throw new FuryGatewayAutomationDefinitionError(
            'definition-conflict',
            automationId,
          );
        }
        throw new FuryGatewayAutomationDefinitionError(
          'limit-exceeded',
          automationId,
        );
      }
    },

    async revise(
      input: FuryGatewayAutomationDefinitionRevisionInput,
    ): Promise<FuryGatewayAutomationDefinitionInspection> {
      const automationId = id(input.automationId, AUTOMATION_ID_RE);
      const history = await loadAutomation(
        store,
        automationId,
        maxRevisionsPerAutomation,
      );
      const previous = history[history.length - 1];
      if (!previous) {
        throw new FuryGatewayAutomationDefinitionError(
          'definition-not-found',
          automationId,
        );
      }
      if (input.expectedRevision !== previous.definition.revision) {
        throw new FuryGatewayAutomationDefinitionError(
          'stale-revision',
          automationId,
        );
      }
      if (previous.definition.revision >= maxRevisionsPerAutomation) {
        throw new FuryGatewayAutomationDefinitionError(
          'limit-exceeded',
          automationId,
        );
      }
      const nextRevision = previous.definition.revision + 1;
      const nextInput = revisionInput(previous.definition, input);
      const definition = storedDefinition(
        nextInput,
        nextRevision,
        nowValue(now),
        previous.handle.digest,
      );
      try {
        const handle = await store.putBounded(
          definitionBytes(definition),
          metadata(automationId, nextRevision),
          {
            metadata: { system: SYSTEM },
            maxMatches: maxDefinitionRecords,
            additionalBounds: [
              {
                metadata: {
                  system: SYSTEM,
                  recordType: 'definition',
                  automationId,
                },
                maxMatches: maxRevisionsPerAutomation,
              },
              {
                metadata: {
                  system: SYSTEM,
                  recordType: 'definition',
                  automationId,
                  revision: nextRevision,
                },
                maxMatches: 1,
              },
            ],
            matchConstraints: [
              {
                metadata: {
                  system: SYSTEM,
                  recordType: 'definition',
                  automationId,
                  revision: previous.definition.revision,
                },
                minMatches: 1,
                maxMatches: 1,
              },
              {
                metadata: {
                  system: SYSTEM,
                  recordType: 'definition',
                  automationId,
                  revision: nextRevision,
                },
                maxMatches: 0,
              },
            ],
          },
        );
        return inspection(handle, definition);
      } catch (error) {
        if (error instanceof FuryGatewayAutomationDefinitionError) throw error;
        const latest = await loadAutomation(
          store,
          automationId,
          maxRevisionsPerAutomation,
        );
        if (
          latest[latest.length - 1]?.definition.revision
          !== previous.definition.revision
        ) {
          throw new FuryGatewayAutomationDefinitionError(
            'stale-revision',
            automationId,
          );
        }
        throw new FuryGatewayAutomationDefinitionError(
          'limit-exceeded',
          automationId,
        );
      }
    },

    async inspect(
      automationIdInput: string,
    ): Promise<FuryGatewayAutomationDefinitionInspection | undefined> {
      const automationId = id(automationIdInput, AUTOMATION_ID_RE);
      const history = await loadAutomation(
        store,
        automationId,
        maxRevisionsPerAutomation,
      );
      const latest = history[history.length - 1];
      return latest === undefined
        ? undefined
        : inspection(latest.handle, latest.definition);
    },

    async history(
      automationIdInput: string,
    ): Promise<readonly FuryGatewayAutomationDefinitionInspection[]> {
      const automationId = id(automationIdInput, AUTOMATION_ID_RE);
      const history = await loadAutomation(
        store,
        automationId,
        maxRevisionsPerAutomation,
      );
      return Object.freeze(
        history.map((loaded) => inspection(loaded.handle, loaded.definition)),
      );
    },

    async countRecords(): Promise<number> {
      const handles = await store.list({
        metadata: { system: SYSTEM },
        limit: maxDefinitionRecords,
      });
      if (handles.length >= maxDefinitionRecords) return handles.length;
      return handles.length;
    },
  });

  GENERATED_STORES.add(api);
  return api;
}
