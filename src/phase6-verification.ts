import { createHash, randomUUID } from 'node:crypto';
import type {
  ProcessExecutionPermit,
  ProcessExecutionReceipt,
  ProcessExecutionRequest,
  ProcessExecutionResult,
} from './coding-runtime.js';
import type { CodingProcessOutcome } from './coding-runtime.js';

export const FURY_PHASE6_VERIFICATION_FORMAT = 'furypipe-phase6-verification/v1' as const;

export type VerificationClass =
  | 'unit'
  | 'integration'
  | 'e2e'
  | 'lint'
  | 'typecheck'
  | 'security'
  | 'package-smoke'
  | 'browser-qa';

export type VerificationLifecycle =
  | 'requested'
  | 'started'
  | 'completed'
  | 'passed'
  | 'failed'
  | 'outcome-unknown'
  | 'accepted'
  | 'rejected';

export interface VerificationCase {
  readonly caseId: string;
  readonly classification: VerificationClass;
  readonly request: ProcessExecutionRequest;
  readonly expectedExitCode?: number;
  readonly requiredStdoutMarker?: string;
  readonly accept?: (result: ProcessExecutionResult) => boolean | Promise<boolean>;
}

export interface VerificationReceipt {
  readonly format: typeof FURY_PHASE6_VERIFICATION_FORMAT;
  readonly verificationId: string;
  readonly caseId: string;
  readonly classification: VerificationClass;
  readonly requestSha256: string;
  readonly processReceipt?: ProcessExecutionReceipt;
  readonly lifecycle: VerificationLifecycle;
  readonly passed: boolean;
  readonly verificationAccepted: boolean;
  readonly reason:
    | 'not-started'
    | 'exit-code'
    | 'output-marker'
    | 'explicit-verifier'
    | 'process-failed'
    | 'outcome-unknown'
    | 'verifier-rejected';
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly executionAuthority: false;
}

export interface VerificationCoordinatorOptions {
  authorize(request: ProcessExecutionRequest): Promise<ProcessExecutionPermit>;
  execute(permit: ProcessExecutionPermit): Promise<ProcessExecutionResult>;
  readonly now?: () => number;
  readonly maxCases?: number;
}

export interface VerificationCoordinator {
  run(cases: readonly VerificationCase[]): Promise<readonly VerificationReceipt[]>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new TypeError('verification case ID is invalid');
  }
  return value;
}

function time(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('verification clock must be a non-negative safe integer');
  return value;
}

function requestDigest(request: ProcessExecutionRequest): string {
  return sha256(JSON.stringify({
    command: request.command,
    args: request.args,
    cwd: request.cwd,
    environmentNames: Object.keys(request.environment ?? {}).sort(),
    stdinBytes: request.stdin === undefined ? 0 : Buffer.byteLength(request.stdin, 'utf8'),
    timeoutMs: request.timeoutMs,
  }));
}

function baseReceipt(
  input: {
    readonly verificationId: string;
    readonly testCase: VerificationCase;
    readonly requestSha256: string;
    readonly startedAt: number;
    readonly finishedAt: number;
    readonly processReceipt?: ProcessExecutionReceipt;
    readonly lifecycle: VerificationLifecycle;
    readonly passed: boolean;
    readonly verificationAccepted: boolean;
    readonly reason: VerificationReceipt['reason'];
  },
): VerificationReceipt {
  return Object.freeze({
    format: FURY_PHASE6_VERIFICATION_FORMAT,
    verificationId: input.verificationId,
    caseId: input.testCase.caseId,
    classification: input.testCase.classification,
    requestSha256: input.requestSha256,
    ...(input.processReceipt === undefined ? {} : { processReceipt: input.processReceipt }),
    lifecycle: input.lifecycle,
    passed: input.passed,
    verificationAccepted: input.verificationAccepted,
    reason: input.reason,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    executionAuthority: false,
  });
}

export function createVerificationCoordinator(options: VerificationCoordinatorOptions): VerificationCoordinator {
  const now = options.now ?? Date.now;
  const maxCases = options.maxCases ?? 64;
  if (!Number.isSafeInteger(maxCases) || maxCases < 1 || maxCases > 1024) throw new TypeError('verification maxCases is invalid');
  return Object.freeze({
    async run(cases: readonly VerificationCase[]): Promise<readonly VerificationReceipt[]> {
      if (!Array.isArray(cases) || cases.length === 0 || cases.length > maxCases) throw new TypeError('verification case count is invalid');
      const ids = new Set<string>();
      const receipts: VerificationReceipt[] = [];
      for (const testCase of cases) {
        const caseId = safeId(testCase.caseId);
        if (ids.has(caseId)) throw new TypeError('verification case IDs must be unique');
        ids.add(caseId);
        const requestSha256 = requestDigest(testCase.request);
        const verificationId = 'ver_' + randomUUID();
        const startedAt = time(now());
        let permit: ProcessExecutionPermit;
        try {
          permit = await options.authorize(testCase.request);
        } catch {
          receipts.push(baseReceipt({
            verificationId,
            testCase,
            requestSha256,
            startedAt,
            finishedAt: time(now()),
            lifecycle: 'rejected',
            passed: false,
            verificationAccepted: false,
            reason: 'not-started',
          }));
          continue;
        }
        let result: ProcessExecutionResult;
        try {
          result = await options.execute(permit);
        } catch {
          receipts.push(baseReceipt({
            verificationId,
            testCase,
            requestSha256,
            startedAt,
            finishedAt: time(now()),
            lifecycle: 'outcome-unknown',
            passed: false,
            verificationAccepted: false,
            reason: 'outcome-unknown',
          }));
          continue;
        }
        const processReceipt = result.receipt;
        const outcome: CodingProcessOutcome = processReceipt.outcome;
        if (outcome === 'outcome-unknown') {
          receipts.push(baseReceipt({
            verificationId,
            testCase,
            requestSha256,
            startedAt,
            finishedAt: time(now()),
            processReceipt,
            lifecycle: 'outcome-unknown',
            passed: false,
            verificationAccepted: false,
            reason: 'outcome-unknown',
          }));
          continue;
        }
        const expectedExitCode = testCase.expectedExitCode ?? 0;
        const exitMatches = processReceipt.exitCode === expectedExitCode;
        const markerMatches = testCase.requiredStdoutMarker === undefined
          || result.stdout.includes(testCase.requiredStdoutMarker);
        const passed = outcome === 'succeeded' && exitMatches && markerMatches;
        if (!passed) {
          receipts.push(baseReceipt({
            verificationId,
            testCase,
            requestSha256,
            startedAt,
            finishedAt: time(now()),
            processReceipt,
            lifecycle: 'failed',
            passed: false,
            verificationAccepted: false,
            reason: 'process-failed',
          }));
          continue;
        }
        if (testCase.accept === undefined) {
          receipts.push(baseReceipt({
            verificationId,
            testCase,
            requestSha256,
            startedAt,
            finishedAt: time(now()),
            processReceipt,
            lifecycle: 'passed',
            passed: true,
            verificationAccepted: false,
            reason: testCase.requiredStdoutMarker === undefined ? 'exit-code' : 'output-marker',
          }));
          continue;
        }
        let accepted = false;
        try {
          accepted = await testCase.accept(result);
        } catch {
          accepted = false;
        }
        receipts.push(baseReceipt({
          verificationId,
          testCase,
          requestSha256,
          startedAt,
          finishedAt: time(now()),
          processReceipt,
          lifecycle: accepted ? 'accepted' : 'rejected',
          passed: true,
          verificationAccepted: accepted,
          reason: accepted ? 'explicit-verifier' : 'verifier-rejected',
        }));
      }
      return Object.freeze(receipts);
    },
  });
}
