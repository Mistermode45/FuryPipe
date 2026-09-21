import { createHash, randomBytes } from 'node:crypto';
import {
  isAbsolute,
  relative,
  sep,
} from 'node:path';

import type * as acp from '@agentclientprotocol/sdk';

import {
  createCodingProcessRuntime,
  isGeneratedCodingSandbox,
  type CodingSandbox,
  type ProcessExecutionRequest,
} from './coding-runtime.js';
import {
  isGeneratedFuryAcpPermissionBridge,
  type FuryAcpPermissionBridge,
  type FuryAcpPermissionConsumeReceipt,
  type FuryAcpPermissionOperation,
  type FuryAcpPermissionPermit,
} from './acp-permission-bridge-node.js';
import {
  isGeneratedFuryAcpV1SessionSnapshot,
  type FuryAcpV1SessionSnapshot,
} from './acp-v1-server-node.js';
import {
  assertFuryAcpV1ClientCapability,
  isGeneratedFuryAcpV1ClientTransport,
  requestFuryAcpV1ClientTransport,
  type FuryAcpV1ClientTransport,
} from './acp-client-transport-node.js';

export const FURY_ACP_CLIENT_OPERATION_PLAN_FORMAT =
  'furypipe-acp-client-operation-plan/v1' as const;
export const FURY_ACP_CLIENT_OPERATION_RECEIPT_FORMAT =
  'furypipe-acp-client-operation-receipt/v1' as const;

export type FuryAcpClientOperationKind =
  | 'fs.read'
  | 'fs.write'
  | 'terminal.execute';

export type FuryAcpClientOperationOutcome =
  | 'succeeded'
  | 'failed'
  | 'unknown';

export interface FuryAcpClientOperationPlan {
  readonly format: typeof FURY_ACP_CLIENT_OPERATION_PLAN_FORMAT;
  readonly planIdSha256: string;
  readonly kind: FuryAcpClientOperationKind;
  readonly requestDigestSha256: string;
  readonly sandboxPolicySha256: string;
  readonly permissionOperation: FuryAcpPermissionOperation;
  readonly authority: 'planned-client-operation-data-only';
  readonly executionAuthority: false;
}

export interface FuryAcpClientOperationReceipt {
  readonly format: typeof FURY_ACP_CLIENT_OPERATION_RECEIPT_FORMAT;
  readonly planIdSha256: string;
  readonly kind: FuryAcpClientOperationKind;
  readonly requestDigestSha256: string;
  readonly sandboxPolicySha256: string;
  readonly permissionConsumeReceiptSha256: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly outcome: FuryAcpClientOperationOutcome;
  readonly automaticReplayAllowed: false;
  readonly resultSha256?: string;
  readonly resultBytes?: number;
  readonly outputTruncated?: boolean;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly errorCode?:
    | 'client-request-failed'
    | 'response-invalid'
    | 'response-oversized'
    | 'timeout-or-cancelled'
    | 'terminal-exit-failed'
    | 'terminal-cleanup-uncertain';
  readonly authority: 'evidence-only';
  readonly executionAuthority: false;
}

export interface FuryAcpFsReadRequest {
  readonly path: string;
  readonly line?: number;
  readonly limit?: number;
}

export interface FuryAcpFsWriteRequest {
  readonly path: string;
  readonly content: string;
}

export interface FuryAcpTerminalExecutionRequest {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly outputByteLimit?: number;
  readonly timeoutMs?: number;
}

export type FuryAcpClientExecutionResult =
  | Readonly<{
      receipt: FuryAcpClientOperationReceipt;
      content?: string;
    }>
  | Readonly<{
      receipt: FuryAcpClientOperationReceipt;
      output?: string;
    }>;

export interface FuryAcpClientCapabilityRuntime {
  prepareFsRead(
    transport: FuryAcpV1ClientTransport,
    session: FuryAcpV1SessionSnapshot,
    request: FuryAcpFsReadRequest,
  ): Promise<FuryAcpClientOperationPlan>;
  prepareFsWrite(
    transport: FuryAcpV1ClientTransport,
    session: FuryAcpV1SessionSnapshot,
    request: FuryAcpFsWriteRequest,
  ): Promise<FuryAcpClientOperationPlan>;
  prepareTerminalExecution(
    transport: FuryAcpV1ClientTransport,
    session: FuryAcpV1SessionSnapshot,
    request: FuryAcpTerminalExecutionRequest,
  ): Promise<FuryAcpClientOperationPlan>;
  execute(
    plan: FuryAcpClientOperationPlan,
    permit: FuryAcpPermissionPermit,
    session: FuryAcpV1SessionSnapshot,
    signal?: AbortSignal,
  ): Promise<FuryAcpClientExecutionResult>;
}

export class FuryAcpClientCapabilityError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code:
      | 'invalid-config'
      | 'invalid-session'
      | 'invalid-request'
      | 'path-denied'
      | 'invalid-plan'
      | 'plan-consumed'
      | 'plan-stale',
  ) {
    super({
      'invalid-config': 'ACP client capability runtime configuration is invalid.',
      'invalid-session': 'ACP client session evidence is invalid.',
      'invalid-request': 'ACP client operation request is invalid.',
      'path-denied': 'ACP client operation path is outside the Phase 6 sandbox.',
      'invalid-plan': 'ACP client operation plan is not current process-local evidence.',
      'plan-consumed': 'ACP client operation plan was already attempted.',
      'plan-stale': 'ACP client operation plan no longer matches current bounded authority.',
    }[code]);
    this.name = 'FuryAcpClientCapabilityError';
  }
}

interface FsReadState {
  readonly kind: 'fs.read';
  readonly relativePath: string;
  readonly canonicalPath: string;
  readonly line?: number;
  readonly limit?: number;
}

interface FsWriteState {
  readonly kind: 'fs.write';
  readonly relativePath: string;
  readonly canonicalPath: string;
  readonly content: string;
}

interface TerminalState {
  readonly kind: 'terminal.execute';
  readonly relativeCwd: string;
  readonly canonicalCwd: string;
  readonly request: ProcessExecutionRequest;
  readonly environment: Readonly<Record<string, string>>;
  readonly outputByteLimit: number;
  readonly timeoutMs: number;
  readonly phase6RequestSha256: string;
}

type RequestState = FsReadState | FsWriteState | TerminalState;

interface PlanState {
  readonly runtime: FuryAcpClientCapabilityRuntime;
  readonly transport: FuryAcpV1ClientTransport;
  readonly sessionId: string;
  readonly plan: FuryAcpClientOperationPlan;
  readonly request: RequestState;
  attempted: boolean;
}

const PLANS = new WeakMap<object, PlanState>();
const SHA256_RE = /^[0-9a-f]{64}$/u;
const MAX_PATH_BYTES = 4096;
const MAX_COMMAND_BYTES = 128;
const MAX_ARGS = 128;
const MAX_ARG_BYTES = 16 * 1024;
const MAX_ENVIRONMENT_ENTRIES = 128;
const MAX_ENV_VALUE_BYTES = 8192;
const MAX_LINE = 0xffff_ffff;
const CLEANUP_TIMEOUT_MS = 1_000;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function digest(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FuryAcpClientCapabilityError('invalid-config');
  }
  return value;
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new FuryAcpClientCapabilityError('invalid-request');
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
      throw new FuryAcpClientCapabilityError('invalid-request');
    }
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryAcpClientCapabilityError('invalid-request');
    }
  }
  return record;
}

function boundedText(
  value: unknown,
  maxBytes: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string'
    || value.includes('\0')
    || (!allowEmpty && value.trim().length === 0)
    || Buffer.byteLength(value, 'utf8') > maxBytes
  ) {
    throw new FuryAcpClientCapabilityError('invalid-request');
  }
  return value;
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new FuryAcpClientCapabilityError('invalid-request');
  }
  return value as number;
}

function optionalLine(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  return boundedInteger(value, 1, MAX_LINE);
}

function rawParentTraversal(value: string): boolean {
  return value.split(/[\\/]/u).some((part) => part === '..');
}

function rejectPortableDeviceOrUnc(value: string): void {
  if (
    value.startsWith('\\\\')
    || value.startsWith('//')
    || /^\\\\[?.][\\/]/u.test(value)
  ) {
    throw new FuryAcpClientCapabilityError('path-denied');
  }
}

/**
 * Node may expose a local Windows realpath with the extended-length \\?\
 * prefix. That prefix is trusted sandbox-internal representation, not ACP
 * input authority. Strip it only from the already-generated Phase 6 root for
 * lexical comparison; untrusted ACP device/UNC paths are still rejected above.
 */
function comparableTrustedSandboxRoot(value: string): string {
  return /^\\\\\?\\[A-Za-z]:\\/u.test(value)
    ? value.slice(4)
    : value;
}

async function mapAbsolutePath(
  sandbox: CodingSandbox,
  value: unknown,
  mode: 'read' | 'write',
  allowRoot = false,
): Promise<{
  readonly relativePath: string;
  readonly canonicalPath: string;
}> {
  const pathValue = boundedText(value, MAX_PATH_BYTES);
  rejectPortableDeviceOrUnc(pathValue);
  if (!isAbsolute(pathValue) || rawParentTraversal(pathValue)) {
    throw new FuryAcpClientCapabilityError('path-denied');
  }
  const relativePath = relative(
    comparableTrustedSandboxRoot(sandbox.rootPath),
    pathValue,
  );
  if (
    (!allowRoot && relativePath.length === 0)
    || relativePath === '..'
    || relativePath.startsWith('..' + sep)
    || isAbsolute(relativePath)
  ) {
    throw new FuryAcpClientCapabilityError('path-denied');
  }
  try {
    const canonicalPath = mode === 'read'
      ? await sandbox.resolveReadPath(relativePath || '.')
      : await sandbox.resolveWritePath(relativePath || '.');
    return Object.freeze({ relativePath: relativePath || '.', canonicalPath });
  } catch {
    throw new FuryAcpClientCapabilityError('path-denied');
  }
}

function permissionOperation(
  kind: FuryAcpClientOperationKind,
  requestDigestSha256: string,
): FuryAcpPermissionOperation {
  if (!SHA256_RE.test(requestDigestSha256)) {
    throw new FuryAcpClientCapabilityError('invalid-request');
  }
  if (kind === 'fs.read') {
    return Object.freeze({
      format: 'furypipe-acp-permission-operation/v1' as const,
      operationId: 'acp.fs.read.' + requestDigestSha256.slice(0, 24),
      title: 'Read one bounded workspace text file',
      toolKind: 'read' as const,
      riskClass: 'read' as const,
      requiredScopes: Object.freeze([]),
      requiredPluginPermissions: Object.freeze(['repository-read'] as const),
      targetDigestSha256: requestDigestSha256,
    });
  }
  if (kind === 'fs.write') {
    return Object.freeze({
      format: 'furypipe-acp-permission-operation/v1' as const,
      operationId: 'acp.fs.write.' + requestDigestSha256.slice(0, 24),
      title: 'Write one bounded workspace text file',
      toolKind: 'edit' as const,
      riskClass: 'write' as const,
      requiredScopes: Object.freeze([]),
      requiredPluginPermissions: Object.freeze(['repository-write'] as const),
      targetDigestSha256: requestDigestSha256,
    });
  }
  return Object.freeze({
    format: 'furypipe-acp-permission-operation/v1' as const,
    operationId: 'acp.terminal.execute.' + requestDigestSha256.slice(0, 18),
    title: 'Run one bounded workspace command',
    toolKind: 'execute' as const,
    riskClass: 'process' as const,
    requiredScopes: Object.freeze([]),
    requiredPluginPermissions: Object.freeze(['process'] as const),
    targetDigestSha256: requestDigestSha256,
  });
}

function receipt(
  plan: FuryAcpClientOperationPlan,
  permissionReceipt: FuryAcpPermissionConsumeReceipt,
  now: () => number,
  startedAt: number,
  outcome: FuryAcpClientOperationOutcome,
  extra: Partial<FuryAcpClientOperationReceipt> = {},
): FuryAcpClientOperationReceipt {
  return Object.freeze({
    format: FURY_ACP_CLIENT_OPERATION_RECEIPT_FORMAT,
    planIdSha256: plan.planIdSha256,
    kind: plan.kind,
    requestDigestSha256: plan.requestDigestSha256,
    sandboxPolicySha256: plan.sandboxPolicySha256,
    permissionConsumeReceiptSha256: digest(permissionReceipt),
    startedAt,
    finishedAt: safeNow(now),
    outcome,
    automaticReplayAllowed: false as const,
    ...extra,
    authority: 'evidence-only' as const,
    executionAuthority: false as const,
  });
}

function planSnapshot(
  kind: FuryAcpClientOperationKind,
  requestDigestSha256: string,
  sandbox: CodingSandbox,
): FuryAcpClientOperationPlan {
  const operation = permissionOperation(kind, requestDigestSha256);
  return Object.freeze({
    format: FURY_ACP_CLIENT_OPERATION_PLAN_FORMAT,
    planIdSha256: sha256(
      'furypipe-acp-client-plan/v1\0'
      + randomBytes(32).toString('base64url'),
    ),
    kind,
    requestDigestSha256,
    sandboxPolicySha256: sandbox.policySha256,
    permissionOperation: operation,
    authority: 'planned-client-operation-data-only' as const,
    executionAuthority: false as const,
  });
}

function validateSession(
  session: FuryAcpV1SessionSnapshot,
): FuryAcpV1SessionSnapshot {
  if (!isGeneratedFuryAcpV1SessionSnapshot(session)) {
    throw new FuryAcpClientCapabilityError('invalid-session');
  }
  return session;
}

function validateTransport(
  transport: FuryAcpV1ClientTransport,
): FuryAcpV1ClientTransport {
  if (!isGeneratedFuryAcpV1ClientTransport(transport)) {
    throw new FuryAcpClientCapabilityError('invalid-request');
  }
  return transport;
}

function normalizeEnvironment(
  value: unknown,
): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new FuryAcpClientCapabilityError('invalid-request');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_ENVIRONMENT_ENTRIES) {
    throw new FuryAcpClientCapabilityError('invalid-request');
  }
  const result: Record<string, string> = {};
  for (const [name, raw] of entries) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(name)
      || typeof raw !== 'string'
      || raw.includes('\0')
      || /[\r\n]/u.test(raw)
      || Buffer.byteLength(raw, 'utf8') > MAX_ENV_VALUE_BYTES
    ) {
      throw new FuryAcpClientCapabilityError('invalid-request');
    }
    result[name] = raw;
  }
  return Object.freeze(result);
}

function normalizeArgs(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (
    !Array.isArray(value)
    || value.length > MAX_ARGS
    || value.some((_, index) => !Object.prototype.hasOwnProperty.call(value, index))
  ) {
    throw new FuryAcpClientCapabilityError('invalid-request');
  }
  return Object.freeze(value.map((arg) =>
    boundedText(arg, MAX_ARG_BYTES, true),
  ));
}

function terminalWireEnvironment(
  environment: Readonly<Record<string, string>>,
): readonly acp.EnvVariable[] {
  return Object.freeze(
    Object.entries(environment)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => Object.freeze({ name, value })),
  );
}

function redactOutput(
  value: string,
  environment: Readonly<Record<string, string>>,
): string {
  let output = value;
  for (const secret of Object.values(environment)) {
    if (secret.length >= 4) {
      output = output.split(secret).join('[redacted]');
    }
  }
  return output;
}

async function bestEffortRequest(
  transport: FuryAcpV1ClientTransport,
  operation: 'terminal.kill' | 'terminal.release',
  params: unknown,
): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('cleanup-timeout'));
      }, CLEANUP_TIMEOUT_MS);
      timer.unref?.();
    });
    await Promise.race([
      requestFuryAcpV1ClientTransport(
        transport,
        operation,
        params,
        controller.signal,
      ),
      timeout,
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function requestWithDeadline<Response>(
  transport: FuryAcpV1ClientTransport,
  operation:
    | 'terminal.create'
    | 'terminal.output'
    | 'terminal.wait',
  params: unknown,
  signal: AbortSignal | undefined,
  deadline: number,
  now: () => number,
): Promise<Response> {
  const remaining = deadline - safeNow(now);
  if (remaining <= 0 || signal?.aborted) {
    throw new Error('timeout-or-cancelled');
  }
  const timeoutController = new AbortController();
  const combined = signal === undefined
    ? timeoutController.signal
    : AbortSignal.any([signal, timeoutController.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timeoutController.abort();
        reject(new Error('timeout-or-cancelled'));
      }, remaining);
      timer.unref?.();
    });
    const aborted = new Promise<never>((_, reject) => {
      if (combined.aborted) {
        reject(new Error('timeout-or-cancelled'));
        return;
      }
      abortListener = () => reject(new Error('timeout-or-cancelled'));
      combined.addEventListener('abort', abortListener, { once: true });
    });
    return await Promise.race([
      requestFuryAcpV1ClientTransport<Response>(
        transport,
        operation,
        params,
        combined,
      ),
      timeout,
      aborted,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener) combined.removeEventListener('abort', abortListener);
  }
}

export function isGeneratedFuryAcpClientOperationPlan(
  value: unknown,
): value is FuryAcpClientOperationPlan {
  return typeof value === 'object' && value !== null && PLANS.has(value);
}

export function createFuryAcpClientCapabilityRuntime(options: {
  readonly sandbox: CodingSandbox;
  readonly permissionBridge: FuryAcpPermissionBridge;
  readonly now?: () => number;
}): FuryAcpClientCapabilityRuntime {
  if (
    !options
    || typeof options !== 'object'
    || !isGeneratedCodingSandbox(options.sandbox)
    || !isGeneratedFuryAcpPermissionBridge(options.permissionBridge)
  ) {
    throw new FuryAcpClientCapabilityError('invalid-config');
  }
  const sandbox = options.sandbox;
  const permissionBridge = options.permissionBridge;
  const now = options.now ?? Date.now;
  safeNow(now);
  const processValidator = createCodingProcessRuntime({ sandbox, now });
  let api: FuryAcpClientCapabilityRuntime;

  const register = (
    transport: FuryAcpV1ClientTransport,
    session: FuryAcpV1SessionSnapshot,
    request: RequestState,
    requestDigestSha256: string,
  ): FuryAcpClientOperationPlan => {
    const plan = planSnapshot(request.kind, requestDigestSha256, sandbox);
    PLANS.set(plan, {
      runtime: api,
      transport,
      sessionId: session.sessionId,
      plan,
      request,
      attempted: false,
    });
    return plan;
  };

  api = Object.freeze({
    async prepareFsRead(
      transportInput: FuryAcpV1ClientTransport,
      sessionInput: FuryAcpV1SessionSnapshot,
      requestInput: FuryAcpFsReadRequest,
    ): Promise<FuryAcpClientOperationPlan> {
      const transport = validateTransport(transportInput);
      const session = validateSession(sessionInput);
      assertFuryAcpV1ClientCapability(transport, 'fs.read');
      const record = exactRecord(
        requestInput,
        ['path', 'line', 'limit'],
        ['path'],
      );
      const mapped = await mapAbsolutePath(
        sandbox,
        record.path,
        'read',
      );
      const line = optionalLine(record.line);
      const limit = optionalLine(record.limit);
      const requestDigestSha256 = digest({
        kind: 'fs.read',
        canonicalPathSha256: sha256(mapped.canonicalPath),
        line,
        limit,
      });
      return register(
        transport,
        session,
        Object.freeze({
          kind: 'fs.read' as const,
          relativePath: mapped.relativePath,
          canonicalPath: mapped.canonicalPath,
          ...(line === undefined ? {} : { line }),
          ...(limit === undefined ? {} : { limit }),
        }),
        requestDigestSha256,
      );
    },

    async prepareFsWrite(
      transportInput: FuryAcpV1ClientTransport,
      sessionInput: FuryAcpV1SessionSnapshot,
      requestInput: FuryAcpFsWriteRequest,
    ): Promise<FuryAcpClientOperationPlan> {
      const transport = validateTransport(transportInput);
      const session = validateSession(sessionInput);
      assertFuryAcpV1ClientCapability(transport, 'fs.write');
      const record = exactRecord(
        requestInput,
        ['path', 'content'],
        ['path', 'content'],
      );
      const content = boundedText(
        record.content,
        sandbox.limits.maxFileBytes,
        true,
      );
      const mapped = await mapAbsolutePath(
        sandbox,
        record.path,
        'write',
      );
      const requestDigestSha256 = digest({
        kind: 'fs.write',
        canonicalPathSha256: sha256(mapped.canonicalPath),
        contentSha256: sha256(content),
        contentBytes: Buffer.byteLength(content, 'utf8'),
      });
      return register(
        transport,
        session,
        Object.freeze({
          kind: 'fs.write' as const,
          relativePath: mapped.relativePath,
          canonicalPath: mapped.canonicalPath,
          content,
        }),
        requestDigestSha256,
      );
    },

    async prepareTerminalExecution(
      transportInput: FuryAcpV1ClientTransport,
      sessionInput: FuryAcpV1SessionSnapshot,
      requestInput: FuryAcpTerminalExecutionRequest,
    ): Promise<FuryAcpClientOperationPlan> {
      const transport = validateTransport(transportInput);
      const session = validateSession(sessionInput);
      assertFuryAcpV1ClientCapability(transport, 'terminal.create');
      const record = exactRecord(
        requestInput,
        ['command', 'args', 'cwd', 'environment', 'outputByteLimit', 'timeoutMs'],
        ['command'],
      );
      const command = boundedText(record.command, MAX_COMMAND_BYTES);
      const args = normalizeArgs(record.args);
      const environment = normalizeEnvironment(record.environment);
      const mapped = await mapAbsolutePath(
        sandbox,
        record.cwd ?? session.cwd,
        'read',
        true,
      );
      const outputByteLimit = record.outputByteLimit === undefined
        ? sandbox.limits.maxOutputBytes
        : boundedInteger(
            record.outputByteLimit,
            1,
            Math.min(sandbox.limits.maxOutputBytes, MAX_LINE),
          );
      const timeoutMs = record.timeoutMs === undefined
        ? sandbox.limits.maxTimeoutMs
        : boundedInteger(record.timeoutMs, 1, sandbox.limits.maxTimeoutMs);
      const processRequest: ProcessExecutionRequest = Object.freeze({
        command,
        args,
        cwd: mapped.relativePath,
        ...(Object.keys(environment).length === 0 ? {} : { environment }),
        timeoutMs,
      });
      let phase6Permit;
      try {
        phase6Permit = await processValidator.authorize(processRequest);
      } catch {
        throw new FuryAcpClientCapabilityError('invalid-request');
      }
      const requestDigestSha256 = digest({
        kind: 'terminal.execute',
        phase6RequestSha256: phase6Permit.requestSha256,
        canonicalCwdSha256: sha256(mapped.canonicalPath),
        outputByteLimit,
        timeoutMs,
        environmentNames: Object.keys(environment).sort(),
        environmentValueDigests: Object.entries(environment)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, value]) => [name, sha256(value)]),
      });
      return register(
        transport,
        session,
        Object.freeze({
          kind: 'terminal.execute' as const,
          relativeCwd: mapped.relativePath,
          canonicalCwd: mapped.canonicalPath,
          request: processRequest,
          environment,
          outputByteLimit,
          timeoutMs,
          phase6RequestSha256: phase6Permit.requestSha256,
        }),
        requestDigestSha256,
      );
    },

    async execute(
      planInput: FuryAcpClientOperationPlan,
      permit: FuryAcpPermissionPermit,
      sessionInput: FuryAcpV1SessionSnapshot,
      signal?: AbortSignal,
    ): Promise<FuryAcpClientExecutionResult> {
      const state = PLANS.get(planInput as object);
      if (!state || state.runtime !== api || state.plan !== planInput) {
        throw new FuryAcpClientCapabilityError('invalid-plan');
      }
      if (state.attempted) {
        throw new FuryAcpClientCapabilityError('plan-consumed');
      }
      const session = validateSession(sessionInput);
      if (state.sessionId !== session.sessionId) {
        throw new FuryAcpClientCapabilityError('plan-stale');
      }
      if (
        planInput.permissionOperation.targetDigestSha256
          !== planInput.requestDigestSha256
        || planInput.sandboxPolicySha256 !== sandbox.policySha256
      ) {
        throw new FuryAcpClientCapabilityError('plan-stale');
      }

      if (state.request.kind === 'fs.read') {
        assertFuryAcpV1ClientCapability(state.transport, 'fs.read');
        const current = await sandbox.resolveReadPath(state.request.relativePath);
        if (current !== state.request.canonicalPath) {
          throw new FuryAcpClientCapabilityError('plan-stale');
        }
      } else if (state.request.kind === 'fs.write') {
        assertFuryAcpV1ClientCapability(state.transport, 'fs.write');
        const current = await sandbox.resolveWritePath(state.request.relativePath);
        if (current !== state.request.canonicalPath) {
          throw new FuryAcpClientCapabilityError('plan-stale');
        }
      } else {
        assertFuryAcpV1ClientCapability(state.transport, 'terminal.create');
        const current = await sandbox.resolveReadPath(state.request.relativeCwd);
        if (current !== state.request.canonicalCwd) {
          throw new FuryAcpClientCapabilityError('plan-stale');
        }
        let revalidated;
        try {
          revalidated = await processValidator.authorize(state.request.request);
        } catch {
          throw new FuryAcpClientCapabilityError('plan-stale');
        }
        if (revalidated.requestSha256 !== state.request.phase6RequestSha256) {
          throw new FuryAcpClientCapabilityError('plan-stale');
        }
      }

      const permissionReceipt = permissionBridge.consume(
        permit,
        session,
        planInput.permissionOperation,
      );
      state.attempted = true;
      const startedAt = safeNow(now);

      if (state.request.kind === 'fs.read') {
        try {
          const response = await requestFuryAcpV1ClientTransport<
            acp.ReadTextFileResponse
          >(
            state.transport,
            'fs.read',
            {
              sessionId: session.sessionId,
              path: state.request.canonicalPath,
              ...(state.request.line === undefined
                ? {}
                : { line: state.request.line }),
              ...(state.request.limit === undefined
                ? {}
                : { limit: state.request.limit }),
            } satisfies acp.ReadTextFileRequest,
            signal,
          );
          if (
            !response
            || typeof response !== 'object'
            || typeof response.content !== 'string'
          ) {
            return Object.freeze({
              receipt: receipt(
                planInput,
                permissionReceipt,
                now,
                startedAt,
                'failed',
                { errorCode: 'response-invalid' },
              ),
            });
          }
          const resultBytes = Buffer.byteLength(response.content, 'utf8');
          if (resultBytes > sandbox.limits.maxFileBytes) {
            return Object.freeze({
              receipt: receipt(
                planInput,
                permissionReceipt,
                now,
                startedAt,
                'failed',
                { errorCode: 'response-oversized' },
              ),
            });
          }
          return Object.freeze({
            receipt: receipt(
              planInput,
              permissionReceipt,
              now,
              startedAt,
              'succeeded',
              {
                resultSha256: sha256(response.content),
                resultBytes,
              },
            ),
            content: response.content,
          });
        } catch {
          return Object.freeze({
            receipt: receipt(
              planInput,
              permissionReceipt,
              now,
              startedAt,
              'failed',
              { errorCode: signal?.aborted
                ? 'timeout-or-cancelled'
                : 'client-request-failed' },
            ),
          });
        }
      }

      if (state.request.kind === 'fs.write') {
        try {
          await requestFuryAcpV1ClientTransport<acp.WriteTextFileResponse>(
            state.transport,
            'fs.write',
            {
              sessionId: session.sessionId,
              path: state.request.canonicalPath,
              content: state.request.content,
            } satisfies acp.WriteTextFileRequest,
            signal,
          );
          return Object.freeze({
            receipt: receipt(
              planInput,
              permissionReceipt,
              now,
              startedAt,
              'succeeded',
              {
                resultSha256: sha256(state.request.content),
                resultBytes: Buffer.byteLength(state.request.content, 'utf8'),
              },
            ),
          });
        } catch {
          return Object.freeze({
            receipt: receipt(
              planInput,
              permissionReceipt,
              now,
              startedAt,
              'unknown',
              {
                errorCode: signal?.aborted
                  ? 'timeout-or-cancelled'
                  : 'client-request-failed',
              },
            ),
          });
        }
      }

      const deadline = startedAt + state.request.timeoutMs;
      let terminalId: string | undefined;
      const baseParams = { sessionId: session.sessionId };
      const unknownTerminal = async (
        errorCode: FuryAcpClientOperationReceipt['errorCode'],
      ): Promise<FuryAcpClientExecutionResult> => {
        let cleanup = true;
        if (terminalId !== undefined) {
          cleanup = await bestEffortRequest(
            state.transport,
            'terminal.kill',
            { ...baseParams, terminalId } satisfies acp.KillTerminalRequest,
          );
          const released = await bestEffortRequest(
            state.transport,
            'terminal.release',
            { ...baseParams, terminalId } satisfies acp.ReleaseTerminalRequest,
          );
          cleanup = cleanup && released;
        }
        return Object.freeze({
          receipt: receipt(
            planInput,
            permissionReceipt,
            now,
            startedAt,
            'unknown',
            {
              errorCode: cleanup
                ? errorCode
                : 'terminal-cleanup-uncertain',
            },
          ),
        });
      };

      try {
        const created = await requestWithDeadline<acp.CreateTerminalResponse>(
          state.transport,
          'terminal.create',
          {
            sessionId: session.sessionId,
            command: state.request.request.command,
            args: [...state.request.request.args],
            env: [...terminalWireEnvironment(state.request.environment)],
            cwd: state.request.canonicalCwd,
            outputByteLimit: state.request.outputByteLimit,
          } satisfies acp.CreateTerminalRequest,
          signal,
          deadline,
          now,
        );
        terminalId = boundedText(created?.terminalId, 512);

        const exited = await requestWithDeadline<acp.WaitForTerminalExitResponse>(
          state.transport,
          'terminal.wait',
          { ...baseParams, terminalId } satisfies acp.WaitForTerminalExitRequest,
          signal,
          deadline,
          now,
        );
        const outputResponse = await requestWithDeadline<acp.TerminalOutputResponse>(
          state.transport,
          'terminal.output',
          { ...baseParams, terminalId } satisfies acp.TerminalOutputRequest,
          signal,
          deadline,
          now,
        );

        if (
          typeof outputResponse?.output !== 'string'
          || typeof outputResponse?.truncated !== 'boolean'
        ) {
          return await unknownTerminal('response-invalid');
        }
        const redacted = redactOutput(
          outputResponse.output,
          state.request.environment,
        );
        const rawBytes = Buffer.byteLength(redacted, 'utf8');
        if (rawBytes > state.request.outputByteLimit) {
          return await unknownTerminal('response-oversized');
        }

        const released = await bestEffortRequest(
          state.transport,
          'terminal.release',
          { ...baseParams, terminalId } satisfies acp.ReleaseTerminalRequest,
        );
        if (!released) {
          return Object.freeze({
            receipt: receipt(
              planInput,
              permissionReceipt,
              now,
              startedAt,
              'unknown',
              {
                resultSha256: sha256(redacted),
                resultBytes: rawBytes,
                outputTruncated: outputResponse.truncated,
                errorCode: 'terminal-cleanup-uncertain',
              },
            ),
            output: redacted,
          });
        }

        const exitCode = exited.exitCode;
        const exitSignal = exited.signal;
        const validExitCode = exitCode === undefined
          || exitCode === null
          || Number.isSafeInteger(exitCode);
        const validSignal = exitSignal === undefined
          || exitSignal === null
          || (typeof exitSignal === 'string'
            && Buffer.byteLength(exitSignal, 'utf8') <= 128);
        if (!validExitCode || !validSignal) {
          return Object.freeze({
            receipt: receipt(
              planInput,
              permissionReceipt,
              now,
              startedAt,
              'unknown',
              {
                resultSha256: sha256(redacted),
                resultBytes: rawBytes,
                outputTruncated: outputResponse.truncated,
                errorCode: 'response-invalid',
              },
            ),
            output: redacted,
          });
        }
        const normalizedExit = typeof exitCode === 'number'
          ? exitCode
          : undefined;
        const normalizedSignal = typeof exitSignal === 'string'
          ? exitSignal
          : undefined;
        const outcome: FuryAcpClientOperationOutcome =
          normalizedExit === 0 && normalizedSignal === undefined
            ? 'succeeded'
            : 'failed';
        return Object.freeze({
          receipt: receipt(
            planInput,
            permissionReceipt,
            now,
            startedAt,
            outcome,
            {
              resultSha256: sha256(redacted),
              resultBytes: rawBytes,
              outputTruncated: outputResponse.truncated,
              ...(normalizedExit === undefined ? {} : { exitCode: normalizedExit }),
              ...(normalizedSignal === undefined ? {} : { signal: normalizedSignal }),
              ...(outcome === 'failed'
                ? { errorCode: 'terminal-exit-failed' as const }
                : {}),
            },
          ),
          output: redacted,
        });
      } catch (error) {
        return await unknownTerminal(
          error instanceof Error && error.message === 'timeout-or-cancelled'
            ? 'timeout-or-cancelled'
            : 'client-request-failed',
        );
      }
    },
  });

  return api;
}
