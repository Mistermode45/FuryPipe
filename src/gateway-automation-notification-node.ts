import { createHash } from 'node:crypto';

import type {
  RecoveryHandle,
  RecoveryMetadata,
  RecoveryStore,
} from './core/recovery-store.js';
import {
  type FuryGatewayAutomationDefinitionInspection,
  type FuryGatewayAutomationDefinitionStore,
  isGeneratedFuryGatewayAutomationDefinitionStore,
} from './gateway-automation-definition-node.js';
import {
  type FuryGatewayAutomationRunLedger,
  type FuryGatewayAutomationRunStatus,
  type FuryGatewayAutomationTerminalOutcome,
  isGeneratedFuryGatewayAutomationRunLedger,
} from './gateway-automation-run-ledger-node.js';
import {
  type FuryGatewayNotification,
  type FuryGatewayNotificationCoordinator,
  type FuryGatewayNotificationRoutePlan,
  type FuryGatewayNotificationSeverity,
  isGeneratedFuryGatewayNotificationCoordinator,
} from './gateway-notification-node.js';

export const FURY_GATEWAY_AUTOMATION_NOTIFICATION_INTENT_FORMAT =
  'furypipe-gateway-automation-notification-intent/v1' as const;
export const FURY_GATEWAY_AUTOMATION_NOTIFICATION_PLAN_FORMAT =
  'furypipe-gateway-automation-notification-plan/v1' as const;

export type FuryGatewayAutomationNotificationPlanStatus =
  | 'created'
  | 'existing'
  | 'not-eligible'
  | 'not-configured'
  | 'reconciliation-required';

export interface FuryGatewayAutomationNotificationPlan {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_NOTIFICATION_PLAN_FORMAT;
  readonly status: FuryGatewayAutomationNotificationPlanStatus;
  readonly runIdSha256: string;
  readonly terminalFingerprintSha256?: string;
  readonly notification?: FuryGatewayNotification;
  readonly route?: FuryGatewayNotificationRoutePlan;
  readonly underlyingRunStatus: FuryGatewayAutomationRunStatus['state'];
  readonly underlyingTaskStatus: 'not-inferred';
  readonly authority: 'notification-planning-data-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationNotificationBridgeOptions {
  readonly definitions: FuryGatewayAutomationDefinitionStore;
  readonly runs: FuryGatewayAutomationRunLedger;
  readonly notificationCoordinator: FuryGatewayNotificationCoordinator;
  readonly store: RecoveryStore;
  readonly now?: () => number;
  readonly maxIntents?: number;
}

export interface FuryGatewayAutomationNotificationBridge {
  plan(runIdSha256: string): Promise<FuryGatewayAutomationNotificationPlan>;
  intentCount(): Promise<number>;
}

export type FuryGatewayAutomationNotificationBridgeErrorCode =
  | 'invalid-options'
  | 'invalid-run-id'
  | 'run-not-found'
  | 'trigger-not-found'
  | 'definition-not-found'
  | 'definition-corrupt'
  | 'intent-corrupt'
  | 'limit-exceeded';

const ERROR_MESSAGES: Readonly<Record<
  FuryGatewayAutomationNotificationBridgeErrorCode,
  string
>> = Object.freeze({
  'invalid-options': 'Automation notification bridge options are invalid.',
  'invalid-run-id': 'Automation notification run ID is invalid.',
  'run-not-found': 'Automation notification run does not exist.',
  'trigger-not-found': 'Automation notification trigger does not exist.',
  'definition-not-found': 'Automation notification definition does not exist.',
  'definition-corrupt': 'Automation notification definition lineage is inconsistent.',
  'intent-corrupt': 'Automation notification durable intent is corrupt.',
  'limit-exceeded': 'Automation notification intent limit was exceeded.',
});

export class FuryGatewayAutomationNotificationBridgeError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code: FuryGatewayAutomationNotificationBridgeErrorCode,
    readonly runIdSha256?: string,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'FuryGatewayAutomationNotificationBridgeError';
  }
}

interface DurableNotificationIntent {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_NOTIFICATION_INTENT_FORMAT;
  readonly runIdSha256: string;
  readonly triggerIdSha256: string;
  readonly definitionSha256: string;
  readonly notificationPolicyKeySha256: string;
  readonly terminalFingerprintSha256: string;
  readonly runState: 'terminal' | 'outcome-unknown';
  readonly outcome?: FuryGatewayAutomationTerminalOutcome;
  readonly reservedAt: number;
  readonly authority: 'notification-intent-evidence-only';
  readonly executionAuthority: false;
}

interface LocalPlan {
  readonly intent: DurableNotificationIntent;
  readonly plan: FuryGatewayAutomationNotificationPlan;
}

const GENERATED_BRIDGES = new WeakSet<object>();
const SYSTEM = 'gateway-automation-notification-intent';
const SHA256_RE = /^[0-9a-f]{64}$/u;
const DEFAULT_MAX_INTENTS = 10_000;
const HARD_MAX_INTENTS = 10_000;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new FuryGatewayAutomationNotificationBridgeError('invalid-options');
  }
  return value as number;
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

function assertSha(
  value: unknown,
  code: FuryGatewayAutomationNotificationBridgeErrorCode,
): asserts value is string {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new FuryGatewayAutomationNotificationBridgeError(code);
  }
}

function requiredStore(
  store: RecoveryStore,
): RecoveryStore & Required<Pick<
  RecoveryStore,
  'list' | 'putBounded' | 'deleteBounded'
>> {
  if (
    !store
    || typeof store !== 'object'
    || typeof store.get !== 'function'
    || typeof store.list !== 'function'
    || typeof store.putBounded !== 'function'
    || typeof store.deleteBounded !== 'function'
  ) {
    throw new FuryGatewayAutomationNotificationBridgeError('invalid-options');
  }
  return store as RecoveryStore & Required<Pick<
    RecoveryStore,
    'list' | 'putBounded' | 'deleteBounded'
  >>;
}

function intentMetadata(
  intent: DurableNotificationIntent,
): RecoveryMetadata {
  return Object.freeze({
    system: SYSTEM,
    recordType: 'intent',
    runIdSha256: intent.runIdSha256,
    terminalFingerprintSha256: intent.terminalFingerprintSha256,
  });
}

function canonicalIntent(
  intent: DurableNotificationIntent,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(intent));
}

function exactPlainRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new FuryGatewayAutomationNotificationBridgeError('intent-corrupt');
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
      throw new FuryGatewayAutomationNotificationBridgeError('intent-corrupt');
    }
  }
  return record;
}

function parseIntent(bytes: Uint8Array): DurableNotificationIntent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new FuryGatewayAutomationNotificationBridgeError('intent-corrupt');
  }
  const record = exactPlainRecord(parsed, [
    'format',
    'runIdSha256',
    'triggerIdSha256',
    'definitionSha256',
    'notificationPolicyKeySha256',
    'terminalFingerprintSha256',
    'runState',
    'outcome',
    'reservedAt',
    'authority',
    'executionAuthority',
  ]);
  if (
    record.format !== FURY_GATEWAY_AUTOMATION_NOTIFICATION_INTENT_FORMAT
    || (record.runState !== 'terminal' && record.runState !== 'outcome-unknown')
    || record.authority !== 'notification-intent-evidence-only'
    || record.executionAuthority !== false
  ) {
    throw new FuryGatewayAutomationNotificationBridgeError('intent-corrupt');
  }
  assertSha(record.runIdSha256, 'intent-corrupt');
  assertSha(record.triggerIdSha256, 'intent-corrupt');
  assertSha(record.definitionSha256, 'intent-corrupt');
  assertSha(record.notificationPolicyKeySha256, 'intent-corrupt');
  assertSha(record.terminalFingerprintSha256, 'intent-corrupt');
  const reservedAt = safeTimestamp(record.reservedAt);

  let outcome: FuryGatewayAutomationTerminalOutcome | undefined;
  if (record.runState === 'terminal') {
    if (
      record.outcome !== 'succeeded'
      && record.outcome !== 'failed'
      && record.outcome !== 'blocked'
      && record.outcome !== 'cancelled'
      && record.outcome !== 'outcome-unknown'
    ) {
      throw new FuryGatewayAutomationNotificationBridgeError('intent-corrupt');
    }
    outcome = record.outcome;
  } else if (record.outcome !== undefined) {
    throw new FuryGatewayAutomationNotificationBridgeError('intent-corrupt');
  }

  const normalized: DurableNotificationIntent = Object.freeze({
    format: FURY_GATEWAY_AUTOMATION_NOTIFICATION_INTENT_FORMAT,
    runIdSha256: record.runIdSha256,
    triggerIdSha256: record.triggerIdSha256,
    definitionSha256: record.definitionSha256,
    notificationPolicyKeySha256: record.notificationPolicyKeySha256,
    terminalFingerprintSha256: record.terminalFingerprintSha256,
    runState: record.runState,
    ...(outcome === undefined ? {} : { outcome }),
    reservedAt,
    authority: 'notification-intent-evidence-only' as const,
    executionAuthority: false as const,
  });
  if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
    throw new FuryGatewayAutomationNotificationBridgeError('intent-corrupt');
  }
  return normalized;
}

async function loadIntent(
  store: RecoveryStore & Required<Pick<RecoveryStore, 'list'>>,
  runIdSha256: string,
  terminalFingerprintSha256: string,
): Promise<{
  readonly handle: RecoveryHandle;
  readonly intent: DurableNotificationIntent;
} | undefined> {
  const handles = await store.list({
    metadata: {
      system: SYSTEM,
      recordType: 'intent',
      runIdSha256,
      terminalFingerprintSha256,
    },
    limit: 2,
  });
  if (handles.length > 1) {
    throw new FuryGatewayAutomationNotificationBridgeError(
      'intent-corrupt',
      runIdSha256,
    );
  }
  const handle = handles[0];
  if (!handle) return undefined;
  const intent = parseIntent(await store.get(handle));
  if (
    intent.runIdSha256 !== runIdSha256
    || intent.terminalFingerprintSha256 !== terminalFingerprintSha256
    || handle.metadata?.system !== SYSTEM
    || handle.metadata?.recordType !== 'intent'
    || handle.metadata?.runIdSha256 !== runIdSha256
    || handle.metadata?.terminalFingerprintSha256 !== terminalFingerprintSha256
  ) {
    throw new FuryGatewayAutomationNotificationBridgeError(
      'intent-corrupt',
      runIdSha256,
    );
  }
  return Object.freeze({ handle, intent });
}

function eligibleFingerprint(
  status: FuryGatewayAutomationRunStatus,
): string | undefined {
  if (status.state === 'terminal') {
    return sha256(JSON.stringify([
      'terminal',
      status.runIdSha256,
      status.triggerIdSha256,
      status.generation,
      status.terminalAt,
      status.outcome,
      status.evidenceSha256 ?? null,
    ]));
  }
  if (status.state === 'outcome-unknown') {
    return sha256(JSON.stringify([
      'outcome-unknown',
      status.runIdSha256,
      status.triggerIdSha256,
      status.generation,
      status.armedAt,
    ]));
  }
  return undefined;
}

function exactDefinition(
  history: readonly FuryGatewayAutomationDefinitionInspection[],
  revision: number,
  definitionSha256: string,
  runIdSha256: string,
): FuryGatewayAutomationDefinitionInspection {
  const matches = history.filter((entry) =>
    entry.definition.revision === revision
    && entry.definitionSha256 === definitionSha256);
  if (matches.length !== 1) {
    throw new FuryGatewayAutomationNotificationBridgeError(
      matches.length === 0 ? 'definition-not-found' : 'definition-corrupt',
      runIdSha256,
    );
  }
  return matches[0]!;
}

function notificationPresentation(
  status: FuryGatewayAutomationRunStatus,
): {
  readonly kind: string;
  readonly severity: FuryGatewayNotificationSeverity;
  readonly title: string;
  readonly summary: string;
  readonly acknowledgementRequired: boolean;
} {
  const shortRun = status.runIdSha256.slice(0, 12);
  if (status.state === 'outcome-unknown') {
    return Object.freeze({
      kind: 'automation.run.outcome-unknown',
      severity: 'warning' as const,
      title: 'Automation run requires reconciliation',
      summary:
        'Run ' + shortRun
        + ' has an unknown side-effect outcome. Automatic replay is disabled.',
      acknowledgementRequired: true,
    });
  }
  const outcome = status.outcome;
  if (outcome === 'succeeded') {
    return Object.freeze({
      kind: 'automation.run.succeeded',
      severity: 'info' as const,
      title: 'Automation run succeeded',
      summary: 'Run ' + shortRun + ' completed with known success evidence.',
      acknowledgementRequired: false,
    });
  }
  if (outcome === 'failed') {
    return Object.freeze({
      kind: 'automation.run.failed',
      severity: 'error' as const,
      title: 'Automation run failed',
      summary: 'Run ' + shortRun + ' completed with a known failure outcome.',
      acknowledgementRequired: false,
    });
  }
  if (outcome === 'blocked') {
    return Object.freeze({
      kind: 'automation.run.blocked',
      severity: 'warning' as const,
      title: 'Automation run blocked',
      summary: 'Run ' + shortRun + ' was blocked before a side effect.',
      acknowledgementRequired: false,
    });
  }
  if (outcome === 'cancelled') {
    return Object.freeze({
      kind: 'automation.run.cancelled',
      severity: 'info' as const,
      title: 'Automation run cancelled',
      summary: 'Run ' + shortRun + ' was cancelled before completion.',
      acknowledgementRequired: false,
    });
  }
  return Object.freeze({
    kind: 'automation.run.outcome-unknown',
    severity: 'warning' as const,
    title: 'Automation run requires reconciliation',
    summary:
      'Run ' + shortRun
      + ' has an unknown side-effect outcome. Automatic replay is disabled.',
    acknowledgementRequired: true,
  });
}

function planResult(
  status: FuryGatewayAutomationRunStatus,
  state: FuryGatewayAutomationNotificationPlanStatus,
  terminalFingerprintSha256?: string,
  extras: {
    readonly notification?: FuryGatewayNotification;
    readonly route?: FuryGatewayNotificationRoutePlan;
  } = {},
): FuryGatewayAutomationNotificationPlan {
  return Object.freeze({
    format: FURY_GATEWAY_AUTOMATION_NOTIFICATION_PLAN_FORMAT,
    status: state,
    runIdSha256: status.runIdSha256,
    ...(terminalFingerprintSha256 === undefined
      ? {}
      : { terminalFingerprintSha256 }),
    ...(extras.notification === undefined
      ? {}
      : { notification: extras.notification }),
    ...(extras.route === undefined ? {} : { route: extras.route }),
    underlyingRunStatus: status.state,
    underlyingTaskStatus: 'not-inferred' as const,
    authority: 'notification-planning-data-only' as const,
    executionAuthority: false as const,
  });
}

export function isGeneratedFuryGatewayAutomationNotificationBridge(
  value: unknown,
): value is FuryGatewayAutomationNotificationBridge {
  return typeof value === 'object'
    && value !== null
    && GENERATED_BRIDGES.has(value);
}

export function createFuryGatewayAutomationNotificationBridge(
  options: FuryGatewayAutomationNotificationBridgeOptions,
): FuryGatewayAutomationNotificationBridge {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !isGeneratedFuryGatewayAutomationDefinitionStore(options.definitions)
    || !isGeneratedFuryGatewayAutomationRunLedger(options.runs)
    || !isGeneratedFuryGatewayNotificationCoordinator(
      options.notificationCoordinator,
    )
  ) {
    throw new FuryGatewayAutomationNotificationBridgeError('invalid-options');
  }
  const store = requiredStore(options.store);
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new FuryGatewayAutomationNotificationBridgeError('invalid-options');
  }
  safeTimestamp(now());
  const maxIntents = boundedInteger(
    options.maxIntents,
    DEFAULT_MAX_INTENTS,
    1,
    HARD_MAX_INTENTS,
    'maxIntents',
  );
  const localPlans = new Map<string, LocalPlan>();

  const api: FuryGatewayAutomationNotificationBridge = Object.freeze({
    async plan(
      runIdSha256Input: string,
    ): Promise<FuryGatewayAutomationNotificationPlan> {
      assertSha(runIdSha256Input, 'invalid-run-id');
      const runIdSha256 = runIdSha256Input;
      const status = await options.runs.inspect(runIdSha256);
      if (!status) {
        throw new FuryGatewayAutomationNotificationBridgeError(
          'run-not-found',
          runIdSha256,
        );
      }
      const terminalFingerprintSha256 = eligibleFingerprint(status);
      if (
        !terminalFingerprintSha256
        || (
          status.state !== 'terminal'
          && status.state !== 'outcome-unknown'
        )
      ) {
        return planResult(status, 'not-eligible');
      }

      const trigger = await options.runs.inspectTrigger(runIdSha256);
      if (!trigger) {
        throw new FuryGatewayAutomationNotificationBridgeError(
          'trigger-not-found',
          runIdSha256,
        );
      }
      const definition = exactDefinition(
        await options.definitions.history(trigger.automationId),
        trigger.definitionRevision,
        trigger.definitionSha256,
        runIdSha256,
      );
      const notificationPolicyKey = definition.definition.notificationPolicyKey;
      if (notificationPolicyKey === undefined) {
        return planResult(
          status,
          'not-configured',
          terminalFingerprintSha256,
        );
      }

      const localKey = runIdSha256 + ':' + terminalFingerprintSha256;
      const local = localPlans.get(localKey);
      if (local) {
        return Object.freeze({
          ...local.plan,
          status: 'existing' as const,
        });
      }

      const existing = await loadIntent(
        store,
        runIdSha256,
        terminalFingerprintSha256,
      );
      if (existing) {
        return planResult(
          status,
          'reconciliation-required',
          terminalFingerprintSha256,
        );
      }

      const intent: DurableNotificationIntent = Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_NOTIFICATION_INTENT_FORMAT,
        runIdSha256,
        triggerIdSha256: trigger.triggerIdSha256,
        definitionSha256: trigger.definitionSha256,
        notificationPolicyKeySha256: sha256(notificationPolicyKey),
        terminalFingerprintSha256,
        runState: status.state,
        ...(status.state === 'terminal' ? { outcome: status.outcome } : {}),
        reservedAt: safeTimestamp(now()),
        authority: 'notification-intent-evidence-only' as const,
        executionAuthority: false as const,
      });

      let handle: RecoveryHandle;
      try {
        handle = await store.putBounded(
          canonicalIntent(intent),
          intentMetadata(intent),
          {
            metadata: { system: SYSTEM },
            maxMatches: maxIntents,
            additionalBounds: [{
              metadata: {
                system: SYSTEM,
                recordType: 'intent',
                runIdSha256,
                terminalFingerprintSha256,
              },
              maxMatches: 1,
            }],
          },
        );
      } catch {
        const raced = await loadIntent(
          store,
          runIdSha256,
          terminalFingerprintSha256,
        );
        if (raced) {
          return planResult(
            status,
            'reconciliation-required',
            terminalFingerprintSha256,
          );
        }
        throw new FuryGatewayAutomationNotificationBridgeError(
          'limit-exceeded',
          runIdSha256,
        );
      }

      try {
        const presentation = notificationPresentation(status);
        const notification = options.notificationCoordinator.createNotification({
          kind: presentation.kind,
          severity: presentation.severity,
          title: presentation.title,
          summary: presentation.summary,
          sourceEvidenceId:
            runIdSha256 + ':' + terminalFingerprintSha256,
          destinationPolicyKey: notificationPolicyKey,
          acknowledgementRequired: presentation.acknowledgementRequired,
        });
        const route = options.notificationCoordinator.selectDestination(
          notification,
        );
        const plan = planResult(
          status,
          'created',
          terminalFingerprintSha256,
          { notification, route },
        );
        localPlans.set(localKey, Object.freeze({ intent, plan }));
        return plan;
      } catch (error) {
        try {
          await store.deleteBounded(handle, {
            targetMetadata: {
              system: SYSTEM,
              recordType: 'intent',
              runIdSha256,
              terminalFingerprintSha256,
            },
            matchConstraints: [{
              metadata: {
                system: SYSTEM,
                recordType: 'intent',
                runIdSha256,
                terminalFingerprintSha256,
              },
              minMatches: 1,
              maxMatches: 1,
            }],
          });
        } catch {
          // If exact cleanup cannot be proven, keep the durable barrier. A
          // later retry must reconcile instead of risking duplicate delivery.
        }
        throw error;
      }
    },

    async intentCount(): Promise<number> {
      const handles = await store.list({
        metadata: {
          system: SYSTEM,
          recordType: 'intent',
        },
        limit: maxIntents,
      });
      return handles.length;
    },
  });

  GENERATED_BRIDGES.add(api);
  return api;
}
