import { createHash } from 'node:crypto';

import {
  type FuryGatewayAutomationDefinitionStore,
  type FuryGatewayAutomationTrigger,
  isGeneratedFuryGatewayAutomationDefinitionStore,
} from './gateway-automation-definition-node.js';
import {
  type FuryGatewayAutomationRunLedger,
  type FuryGatewayAutomationRunStatus,
  type FuryGatewayAutomationTerminalOutcome,
  type FuryGatewayAutomationTriggerSourceKind,
  isGeneratedFuryGatewayAutomationRunLedger,
} from './gateway-automation-run-ledger-node.js';

export const FURY_GATEWAY_AUTOMATION_OBSERVABILITY_FORMAT =
  'furypipe-gateway-automation-observability/v1' as const;
export const FURY_GATEWAY_AUTOMATION_OBSERVABILITY_RESULT_FORMAT =
  'furypipe-gateway-automation-observability-result/v1' as const;

export interface FuryGatewayAutomationStatusSummary {
  readonly automationIdSha256: string;
  readonly triggerKind: FuryGatewayAutomationTrigger['kind'];
  readonly enabled: boolean;
  readonly notificationConfigured: boolean;
  readonly definitionRevision: number;
  readonly definitionSha256: string;
  readonly authority: 'observability-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationRunStatusSummary {
  readonly runIdSha256: string;
  readonly triggerIdSha256: string;
  readonly automationIdSha256: string;
  readonly triggerKind: FuryGatewayAutomationTriggerSourceKind;
  readonly scheduledFor: number;
  readonly state: FuryGatewayAutomationRunStatus['state'];
  readonly outcome?: FuryGatewayAutomationTerminalOutcome;
  readonly automaticReplayAllowed?: false;
  readonly authority: 'observability-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationObservabilitySnapshot {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_OBSERVABILITY_FORMAT;
  readonly observedAt: number;
  readonly automations: {
    readonly total: number;
    readonly enabled: number;
    readonly disabled: number;
    readonly notificationConfigured: number;
    readonly byTriggerKind: Readonly<Record<
      FuryGatewayAutomationTrigger['kind'],
      number
    >>;
    readonly summaries: readonly FuryGatewayAutomationStatusSummary[];
    readonly summariesTruncated: boolean;
  };
  readonly runs: {
    readonly total: number;
    readonly summarized: number;
    readonly summariesTruncated: boolean;
    readonly summarizedByState: Readonly<Record<
      FuryGatewayAutomationRunStatus['state'],
      number
    >>;
    readonly recent: readonly FuryGatewayAutomationRunStatusSummary[];
  };
  readonly authority: 'observability-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationObservabilityCommandResult {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_OBSERVABILITY_RESULT_FORMAT;
  readonly commandName: 'automations.status';
  readonly status: 'ok' | 'rejected';
  readonly result?: FuryGatewayAutomationObservabilitySnapshot;
  readonly error?: {
    readonly code: string;
  };
  readonly authority: 'observability-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationObservabilityOptions {
  readonly definitions: FuryGatewayAutomationDefinitionStore;
  readonly runs: FuryGatewayAutomationRunLedger;
  readonly now?: () => number;
  readonly maxAutomationSummaries?: number;
  readonly maxRunSummaries?: number;
  readonly maxResultBytes?: number;
}

export interface FuryGatewayAutomationObservability {
  snapshot(): Promise<FuryGatewayAutomationObservabilitySnapshot>;
  dispatchState(
    commandName: 'automations.status',
    input: unknown,
  ): Promise<FuryGatewayAutomationObservabilityCommandResult>;
}

const GENERATED_OBSERVERS = new WeakSet<object>();
const DEFAULT_MAX_AUTOMATION_SUMMARIES = 64;
const DEFAULT_MAX_RUN_SUMMARIES = 64;
const HARD_MAX_SUMMARIES = 256;
const DEFAULT_MAX_RESULT_BYTES = 64 * 1024;
const HARD_MAX_RESULT_BYTES = 256 * 1024;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('automation observability clock must return a safe non-negative timestamp');
  }
  return value;
}

function exactEmptyRecord(value: unknown): void {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== 0
  ) {
    throw new Error('automations.status input must be an empty plain data object');
  }
}

function emptyTriggerCounts(): Record<FuryGatewayAutomationTrigger['kind'], number> {
  return {
    'one-shot': 0,
    interval: 0,
    cron: 0,
    webhook: 0,
  };
}

function emptyRunStateCounts(): Record<FuryGatewayAutomationRunStatus['state'], number> {
  return {
    pending: 0,
    claimed: 0,
    'claim-expired': 0,
    'outcome-unknown': 0,
    terminal: 0,
  };
}

function runSummary(
  triggerKind: FuryGatewayAutomationTriggerSourceKind,
  scheduledFor: number,
  status: FuryGatewayAutomationRunStatus,
): FuryGatewayAutomationRunStatusSummary {
  return Object.freeze({
    runIdSha256: status.runIdSha256,
    triggerIdSha256: status.triggerIdSha256,
    automationIdSha256: sha256(status.automationId),
    triggerKind,
    scheduledFor,
    state: status.state,
    ...(status.state === 'terminal' ? { outcome: status.outcome } : {}),
    ...(status.state === 'terminal' || status.state === 'outcome-unknown'
      ? { automaticReplayAllowed: false as const }
      : {}),
    authority: 'observability-only' as const,
    executionAuthority: false as const,
  });
}

function rejected(
  code: string,
): FuryGatewayAutomationObservabilityCommandResult {
  return Object.freeze({
    format: FURY_GATEWAY_AUTOMATION_OBSERVABILITY_RESULT_FORMAT,
    commandName: 'automations.status' as const,
    status: 'rejected' as const,
    error: Object.freeze({ code }),
    authority: 'observability-only' as const,
    executionAuthority: false as const,
  });
}

function boundResult(
  result: FuryGatewayAutomationObservabilityCommandResult,
  maxResultBytes: number,
): FuryGatewayAutomationObservabilityCommandResult {
  let encoded: string;
  try {
    encoded = JSON.stringify(result);
  } catch {
    return rejected('automation-observability-result-not-serializable');
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxResultBytes) {
    return rejected('automation-observability-result-too-large');
  }
  return result;
}

export function isGeneratedFuryGatewayAutomationObservability(
  value: unknown,
): value is FuryGatewayAutomationObservability {
  return typeof value === 'object'
    && value !== null
    && GENERATED_OBSERVERS.has(value);
}

export function createFuryGatewayAutomationObservability(
  options: FuryGatewayAutomationObservabilityOptions,
): FuryGatewayAutomationObservability {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !isGeneratedFuryGatewayAutomationDefinitionStore(options.definitions)
    || !isGeneratedFuryGatewayAutomationRunLedger(options.runs)
  ) {
    throw new Error(
      'automation observability requires process-local definition and run stores',
    );
  }
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new Error('automation observability now must be a function');
  }
  safeNow(now);

  const maxAutomationSummaries = boundedInteger(
    options.maxAutomationSummaries,
    DEFAULT_MAX_AUTOMATION_SUMMARIES,
    1,
    HARD_MAX_SUMMARIES,
    'maxAutomationSummaries',
  );
  const maxRunSummaries = boundedInteger(
    options.maxRunSummaries,
    DEFAULT_MAX_RUN_SUMMARIES,
    1,
    HARD_MAX_SUMMARIES,
    'maxRunSummaries',
  );
  const maxResultBytes = boundedInteger(
    options.maxResultBytes,
    DEFAULT_MAX_RESULT_BYTES,
    1024,
    HARD_MAX_RESULT_BYTES,
    'maxResultBytes',
  );

  let api: FuryGatewayAutomationObservability;

  api = Object.freeze({
    async snapshot(): Promise<FuryGatewayAutomationObservabilitySnapshot> {
      const observedAt = safeNow(now);
      const definitions = await options.definitions.listCurrent();
      const triggerCounts = emptyTriggerCounts();
      let enabled = 0;
      let notificationConfigured = 0;

      for (const inspection of definitions) {
        if (inspection.definition.enabled) enabled += 1;
        if (inspection.definition.notificationPolicyKey !== undefined) {
          notificationConfigured += 1;
        }
        triggerCounts[inspection.definition.trigger.kind] += 1;
      }

      const automationSummaries = Object.freeze(
        definitions
          .slice(0, maxAutomationSummaries)
          .map((inspection) => Object.freeze({
            automationIdSha256: sha256(inspection.definition.automationId),
            triggerKind: inspection.definition.trigger.kind,
            enabled: inspection.definition.enabled,
            notificationConfigured:
              inspection.definition.notificationPolicyKey !== undefined,
            definitionRevision: inspection.definition.revision,
            definitionSha256: inspection.definitionSha256,
            authority: 'observability-only' as const,
            executionAuthority: false as const,
          })),
      );

      const totalRuns = await options.runs.countRuns();
      const recentInspections = await options.runs.listRecent(
        maxRunSummaries,
        observedAt,
      );
      const stateCounts = emptyRunStateCounts();
      const recent = Object.freeze(
        recentInspections.map((inspection) => {
          stateCounts[inspection.status.state] += 1;
          return runSummary(
            inspection.trigger.sourceKind,
            inspection.trigger.scheduledFor,
            inspection.status,
          );
        }),
      );

      return Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_OBSERVABILITY_FORMAT,
        observedAt,
        automations: Object.freeze({
          total: definitions.length,
          enabled,
          disabled: definitions.length - enabled,
          notificationConfigured,
          byTriggerKind: Object.freeze({ ...triggerCounts }),
          summaries: automationSummaries,
          summariesTruncated: definitions.length > automationSummaries.length,
        }),
        runs: Object.freeze({
          total: totalRuns,
          summarized: recent.length,
          summariesTruncated: totalRuns > recent.length,
          summarizedByState: Object.freeze({ ...stateCounts }),
          recent,
        }),
        authority: 'observability-only' as const,
        executionAuthority: false as const,
      });
    },

    async dispatchState(
      commandName: 'automations.status',
      input: unknown,
    ): Promise<FuryGatewayAutomationObservabilityCommandResult> {
      if (commandName !== 'automations.status') {
        throw new Error('Gateway automation observability command is unsupported');
      }
      try {
        exactEmptyRecord(input);
        const snapshot = await api.snapshot();
        return boundResult(Object.freeze({
          format: FURY_GATEWAY_AUTOMATION_OBSERVABILITY_RESULT_FORMAT,
          commandName: 'automations.status' as const,
          status: 'ok' as const,
          result: snapshot,
          authority: 'observability-only' as const,
          executionAuthority: false as const,
        }), maxResultBytes);
      } catch {
        return rejected('automation-observability-input-invalid');
      }
    },
  });

  GENERATED_OBSERVERS.add(api);
  return api;
}
