import {
  type FuryGatewayAutomationDefinition,
  type FuryGatewayAutomationDefinitionStore,
  isGeneratedFuryGatewayAutomationDefinitionStore,
} from './gateway-automation-definition-node.js';
import {
  FuryGatewayAutomationRunLedgerError,
  type FuryGatewayAutomationClaimEvidence,
  type FuryGatewayAutomationRunLedger,
  type FuryGatewayAutomationRunStatus,
  isGeneratedFuryGatewayAutomationRunLedger,
} from './gateway-automation-run-ledger-node.js';

export const FURY_GATEWAY_AUTOMATION_SCHEDULER_TICK_FORMAT =
  'furypipe-gateway-automation-scheduler-tick/v1' as const;

export type FuryGatewayAutomationSchedulerDecision =
  | 'disabled'
  | 'not-due'
  | 'misfire-skipped'
  | 'clock-regression-ignored'
  | 'claimed'
  | 'observed';

export interface FuryGatewayAutomationSchedulerTickResult {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_SCHEDULER_TICK_FORMAT;
  readonly automationId: string;
  readonly definitionRevision: number;
  readonly definitionSha256: string;
  readonly observedAt: number;
  readonly decision: FuryGatewayAutomationSchedulerDecision;
  readonly scheduledFor?: number;
  readonly nextDueAt?: number;
  readonly claim?: FuryGatewayAutomationClaimEvidence;
  readonly run?: FuryGatewayAutomationRunStatus;
  readonly authority: 'scheduler-observation-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationSchedulerOptions {
  readonly definitions: FuryGatewayAutomationDefinitionStore;
  readonly runs: FuryGatewayAutomationRunLedger;
  readonly now?: () => number;
  /**
   * Maximum lateness accepted by a trigger configured with misfirePolicy=skip.
   * A run-once trigger intentionally ignores this bound and coalesces downtime
   * to one deterministic logical occurrence.
   */
  readonly misfireGraceMs?: number;
  readonly claimLeaseMs?: number;
}

export interface FuryGatewayAutomationScheduler {
  tick(
    automationId: string,
    claimantInstanceId: string,
    observedAt?: number,
  ): Promise<FuryGatewayAutomationSchedulerTickResult>;
}

export type FuryGatewayAutomationSchedulerErrorCode =
  | 'invalid-options'
  | 'definition-not-found'
  | 'clock-invalid';

const ERROR_MESSAGES: Readonly<Record<
  FuryGatewayAutomationSchedulerErrorCode,
  string
>> = Object.freeze({
  'invalid-options': 'Automation scheduler options are invalid.',
  'definition-not-found': 'Automation definition does not exist.',
  'clock-invalid': 'Automation scheduler clock value is invalid.',
});

export class FuryGatewayAutomationSchedulerError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code: FuryGatewayAutomationSchedulerErrorCode,
    readonly automationId?: string,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'FuryGatewayAutomationSchedulerError';
  }
}

interface DuePlan {
  readonly decision: 'not-due' | 'misfire-skipped' | 'due';
  readonly scheduledFor?: number;
  readonly nextDueAt?: number;
}

const GENERATED_SCHEDULERS = new WeakSet<object>();
const DEFAULT_MISFIRE_GRACE_MS = 60_000;
const MAX_MISFIRE_GRACE_MS = 24 * 60 * 60_000;
const MAX_CLAIM_LEASE_MS = 5 * 60_000;

function safeTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new FuryGatewayAutomationSchedulerError('clock-invalid');
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

function intervalOccurrenceAtOrBefore(
  startAt: number,
  everyMs: number,
  upperBound: number,
): number | undefined {
  if (upperBound < startAt) return undefined;
  const steps = Math.floor((upperBound - startAt) / everyMs);
  const scheduledFor = startAt + steps * everyMs;
  if (!Number.isSafeInteger(scheduledFor)) {
    throw new FuryGatewayAutomationSchedulerError('clock-invalid');
  }
  return scheduledFor;
}

function nextIntervalOccurrence(
  definition: FuryGatewayAutomationDefinition,
  scheduledFor: number,
): number | undefined {
  if (definition.trigger.kind !== 'interval') return undefined;
  const next = scheduledFor + definition.trigger.everyMs;
  if (!Number.isSafeInteger(next)) {
    throw new FuryGatewayAutomationSchedulerError('clock-invalid');
  }
  if (
    definition.trigger.endAt !== undefined
    && next > definition.trigger.endAt
  ) {
    return undefined;
  }
  return next;
}

function duePlan(
  definition: FuryGatewayAutomationDefinition,
  observedAt: number,
  misfireGraceMs: number,
): DuePlan {
  const trigger = definition.trigger;

  if (trigger.kind === 'one-shot') {
    if (observedAt < trigger.at) {
      return Object.freeze({
        decision: 'not-due' as const,
        nextDueAt: trigger.at,
      });
    }
    const lateness = observedAt - trigger.at;
    if (
      trigger.misfirePolicy === 'skip'
      && lateness > misfireGraceMs
    ) {
      return Object.freeze({
        decision: 'misfire-skipped' as const,
        scheduledFor: trigger.at,
      });
    }
    return Object.freeze({
      decision: 'due' as const,
      scheduledFor: trigger.at,
    });
  }

  if (observedAt < trigger.startAt) {
    return Object.freeze({
      decision: 'not-due' as const,
      nextDueAt: trigger.startAt,
    });
  }

  const upperBound = trigger.endAt === undefined
    ? observedAt
    : Math.min(observedAt, trigger.endAt);
  const scheduledFor = intervalOccurrenceAtOrBefore(
    trigger.startAt,
    trigger.everyMs,
    upperBound,
  );
  if (scheduledFor === undefined) {
    return Object.freeze({
      decision: 'not-due' as const,
      nextDueAt: trigger.startAt,
    });
  }

  const nextDueAt = nextIntervalOccurrence(definition, scheduledFor);
  const lateness = observedAt - scheduledFor;
  if (
    trigger.misfirePolicy === 'skip'
    && lateness > misfireGraceMs
  ) {
    return Object.freeze({
      decision: 'misfire-skipped' as const,
      scheduledFor,
      ...(nextDueAt === undefined ? {} : { nextDueAt }),
    });
  }

  return Object.freeze({
    decision: 'due' as const,
    scheduledFor,
    ...(nextDueAt === undefined ? {} : { nextDueAt }),
  });
}

function occurrenceKey(
  definition: FuryGatewayAutomationDefinition,
  scheduledFor: number,
): string {
  if (definition.trigger.kind === 'one-shot') {
    return 'one-shot:' + scheduledFor;
  }
  return 'interval:' + scheduledFor;
}

function result(
  automationId: string,
  definitionRevision: number,
  definitionSha256: string,
  observedAt: number,
  decision: FuryGatewayAutomationSchedulerDecision,
  extras: {
    readonly scheduledFor?: number;
    readonly nextDueAt?: number;
    readonly claim?: FuryGatewayAutomationClaimEvidence;
    readonly run?: FuryGatewayAutomationRunStatus;
  } = {},
): FuryGatewayAutomationSchedulerTickResult {
  return Object.freeze({
    format: FURY_GATEWAY_AUTOMATION_SCHEDULER_TICK_FORMAT,
    automationId,
    definitionRevision,
    definitionSha256,
    observedAt,
    decision,
    ...(extras.scheduledFor === undefined
      ? {}
      : { scheduledFor: extras.scheduledFor }),
    ...(extras.nextDueAt === undefined
      ? {}
      : { nextDueAt: extras.nextDueAt }),
    ...(extras.claim === undefined ? {} : { claim: extras.claim }),
    ...(extras.run === undefined ? {} : { run: extras.run }),
    authority: 'scheduler-observation-only' as const,
    executionAuthority: false as const,
  });
}

export function isGeneratedFuryGatewayAutomationScheduler(
  value: unknown,
): value is FuryGatewayAutomationScheduler {
  return typeof value === 'object'
    && value !== null
    && GENERATED_SCHEDULERS.has(value);
}

export function createFuryGatewayAutomationScheduler(
  options: FuryGatewayAutomationSchedulerOptions,
): FuryGatewayAutomationScheduler {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !isGeneratedFuryGatewayAutomationDefinitionStore(options.definitions)
    || !isGeneratedFuryGatewayAutomationRunLedger(options.runs)
  ) {
    throw new FuryGatewayAutomationSchedulerError('invalid-options');
  }
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new FuryGatewayAutomationSchedulerError('invalid-options');
  }
  safeTimestamp(now());

  const misfireGraceMs = boundedInteger(
    options.misfireGraceMs,
    DEFAULT_MISFIRE_GRACE_MS,
    0,
    MAX_MISFIRE_GRACE_MS,
    'misfireGraceMs',
  );
  const claimLeaseMs = options.claimLeaseMs === undefined
    ? undefined
    : boundedInteger(
        options.claimLeaseMs,
        options.claimLeaseMs,
        1,
        MAX_CLAIM_LEASE_MS,
        'claimLeaseMs',
      );

  const api: FuryGatewayAutomationScheduler = Object.freeze({
    async tick(
      automationId: string,
      claimantInstanceId: string,
      observedAtInput?: number,
    ): Promise<FuryGatewayAutomationSchedulerTickResult> {
      const observedAt = observedAtInput === undefined
        ? safeTimestamp(now())
        : safeTimestamp(observedAtInput);
      const inspected = await options.definitions.inspect(automationId);
      if (!inspected) {
        throw new FuryGatewayAutomationSchedulerError(
          'definition-not-found',
          automationId,
        );
      }
      const definition = inspected.definition;
      if (!definition.enabled) {
        return result(
          definition.automationId,
          definition.revision,
          inspected.definitionSha256,
          observedAt,
          'disabled',
        );
      }

      const plan = duePlan(definition, observedAt, misfireGraceMs);
      if (plan.decision === 'not-due') {
        return result(
          definition.automationId,
          definition.revision,
          inspected.definitionSha256,
          observedAt,
          'not-due',
          { nextDueAt: plan.nextDueAt },
        );
      }
      if (plan.decision === 'misfire-skipped') {
        return result(
          definition.automationId,
          definition.revision,
          inspected.definitionSha256,
          observedAt,
          'misfire-skipped',
          {
            scheduledFor: plan.scheduledFor,
            nextDueAt: plan.nextDueAt,
          },
        );
      }

      const scheduledFor = plan.scheduledFor;
      if (scheduledFor === undefined) {
        throw new FuryGatewayAutomationSchedulerError('clock-invalid');
      }

      const latestTrigger = await options.runs.latestTrigger(
        definition.automationId,
      );
      if (
        latestTrigger !== undefined
        && scheduledFor < latestTrigger.scheduledFor
      ) {
        const watermarkNextDueAt = definition.trigger.kind === 'interval'
          ? nextIntervalOccurrence(
              definition,
              latestTrigger.scheduledFor,
            )
          : undefined;
        return result(
          definition.automationId,
          definition.revision,
          inspected.definitionSha256,
          observedAt,
          'clock-regression-ignored',
          {
            scheduledFor,
            ...(watermarkNextDueAt === undefined
              ? {}
              : { nextDueAt: watermarkNextDueAt }),
          },
        );
      }

      const run = await options.runs.registerTrigger({
        automationId: definition.automationId,
        definitionRevision: definition.revision,
        definitionSha256: inspected.definitionSha256,
        sourceKind: definition.trigger.kind,
        occurrenceKey: occurrenceKey(definition, scheduledFor),
        scheduledFor,
      });

      if (run.state === 'pending' || run.state === 'claim-expired') {
        try {
          const claim = await options.runs.claim(
            run.runIdSha256,
            claimantInstanceId,
            claimLeaseMs,
          );
          const claimedRun = await options.runs.inspect(
            run.runIdSha256,
            observedAt,
          );
          return result(
            definition.automationId,
            definition.revision,
            inspected.definitionSha256,
            observedAt,
            'claimed',
            {
              scheduledFor,
              nextDueAt: plan.nextDueAt,
              claim,
              ...(claimedRun === undefined ? {} : { run: claimedRun }),
            },
          );
        } catch (error) {
          if (
            error instanceof FuryGatewayAutomationRunLedgerError
            && error.code === 'run-conflict'
          ) {
            const raced = await options.runs.inspect(
              run.runIdSha256,
              observedAt,
            );
            if (raced) {
              return result(
                definition.automationId,
                definition.revision,
                inspected.definitionSha256,
                observedAt,
                'observed',
                {
                  scheduledFor,
                  nextDueAt: plan.nextDueAt,
                  run: raced,
                },
              );
            }
          }
          throw error;
        }
      }

      return result(
        definition.automationId,
        definition.revision,
        inspected.definitionSha256,
        observedAt,
        'observed',
        {
          scheduledFor,
          nextDueAt: plan.nextDueAt,
          run,
        },
      );
    },
  });

  GENERATED_SCHEDULERS.add(api);
  return api;
}
