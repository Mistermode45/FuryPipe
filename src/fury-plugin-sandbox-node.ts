import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { validateFuryPluginBundle, type FuryPluginBundle } from './plugin-bundles.js';
import {
  planFuryPluginActivation,
  validateFuryPluginRuntimeDescriptor,
  type FuryPluginRuntimeDescriptor,
} from './fury-plugin-runtime.js';

export const FURY_PLUGIN_SANDBOX_PLAN_FORMAT = 'furypipe-plugin-sandbox-plan/v1' as const;
export const FURY_PLUGIN_SANDBOX_APPROVAL_FORMAT = 'furypipe-plugin-sandbox-approval/v1' as const;
export const FURY_PLUGIN_SANDBOX_RECEIPT_FORMAT = 'furypipe-plugin-sandbox-receipt/v1' as const;

export type FuryPluginSandboxPlanState = 'READY_FOR_APPROVAL' | 'REJECTED';

export interface FuryPluginSandboxPlan {
  readonly format: typeof FURY_PLUGIN_SANDBOX_PLAN_FORMAT;
  readonly state: FuryPluginSandboxPlanState;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly entrypoint: string;
  readonly hostApiVersion: string;
  readonly hostNodeVersion: string;
  readonly descriptorDigestSha256: string;
  readonly planDigestSha256: string;
  readonly heapLimitMiB: number;
  readonly wallTimeoutMs: number;
  readonly isolation: 'subprocess';
  readonly reasons: readonly string[];
  readonly requiresOperatorApproval: true;
  readonly networkAuthorized: false;
  readonly filesystemWriteAuthorized: false;
  readonly childProcessAuthorized: false;
  readonly workerAuthorized: false;
  readonly addonAuthorized: false;
  readonly wasiAuthorized: false;
  readonly executionAuthorized: false;
}

export interface FuryPluginSandboxApproval {
  readonly format: typeof FURY_PLUGIN_SANDBOX_APPROVAL_FORMAT;
  readonly planDigestSha256: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly executionAuthorized: true;
}

export interface FuryPluginSandboxReceipt {
  readonly format: typeof FURY_PLUGIN_SANDBOX_RECEIPT_FORMAT;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly planDigestSha256: string;
  readonly outcome: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'OUTPUT_REJECTED';
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly durationMs: number;
  readonly stdoutBytes: number;
  readonly stdoutSha256: string | null;
  readonly stderrBytes: number;
  readonly stderrSha256: string | null;
  readonly output?: unknown;
  readonly executionPerformed: true;
  readonly networkAuthorized: false;
  readonly filesystemWriteAuthorized: false;
  readonly childProcessAuthorized: false;
  readonly workerAuthorized: false;
  readonly addonAuthorized: false;
  readonly wasiAuthorized: false;
}

const ENTRYPOINT = /^(?![A-Za-z]:)(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$))[A-Za-z0-9._/\\-]{1,256}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_INPUT_BYTES = 256 * 1024;
const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const plans = new WeakSet<object>();
const approvals = new WeakSet<object>();

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Readonly<Record<string, unknown>>;
  return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
}

function printable(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(label + ' must be bounded printable text');
  }
  return value;
}

function normalizedEntrypoint(value: unknown): string {
  const entrypoint = printable(value, 'plugin sandbox entrypoint', 256);
  if (!ENTRYPOINT.test(entrypoint) || entrypoint.includes('\\')) {
    throw new Error('plugin sandbox entrypoint must be a normalized relative path');
  }
  return entrypoint;
}

function parseNodeMajor(value: string): number {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(value);
  if (!match?.[1]) throw new Error('hostNodeVersion must be semver-like');
  return Number(match[1]);
}

function normalizeIso(value: string, label: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(label + ' must be an ISO timestamp');
  return new Date(time).toISOString();
}

function hasRuntimeAuthority(bundle: FuryPluginBundle): boolean {
  return bundle.permissions.length > 0
    || bundle.secrets.length > 0
    || bundle.mcpProfiles.length > 0
    || bundle.cliProfiles.length > 0
    || bundle.providerProfiles.length > 0;
}

function minimalEnvironment(pluginId: string, pluginVersion: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    FURYPIPE_PLUGIN_ID: pluginId,
    FURYPIPE_PLUGIN_VERSION: pluginVersion,
    FURYPIPE_PLUGIN_SANDBOX: '1',
  };
  if (process.platform === 'win32') {
    for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
      if (process.env[name]) env[name] = process.env[name];
    }
  }
  return env;
}

function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

export function planFuryPluginSandboxExecution(input: {
  readonly bundle: FuryPluginBundle;
  readonly descriptor: FuryPluginRuntimeDescriptor;
  readonly entrypoint: string;
  readonly hostApiVersion: string;
  readonly hostNodeVersion?: string;
}): FuryPluginSandboxPlan {
  const bundle = validateFuryPluginBundle(input.bundle);
  const descriptor = validateFuryPluginRuntimeDescriptor(bundle, input.descriptor);
  const entrypoint = normalizedEntrypoint(input.entrypoint);
  const hostNodeVersion = input.hostNodeVersion ?? process.versions.node;
  const nodeMajor = parseNodeMajor(hostNodeVersion);
  const activation = planFuryPluginActivation({
    bundle,
    descriptor,
    hostApiVersion: input.hostApiVersion,
    supportedIsolation: ['subprocess'],
  });
  const reasons = [...activation.incompatibilities];

  if (descriptor.isolation !== 'subprocess') reasons.push('runtime execution requires subprocess isolation');
  if (hasRuntimeAuthority(bundle)) reasons.push('sandbox v1 executes only zero-authority plugins with no declared runtime permissions, secrets, MCP, CLI or provider profiles');
  if (nodeMajor < 25) reasons.push('Node <25 cannot provide deny-by-default network isolation through the Node Permission Model');

  const payload = Object.freeze({
    pluginId: bundle.id,
    pluginVersion: bundle.version,
    entrypoint,
    hostApiVersion: input.hostApiVersion,
    hostNodeVersion,
    descriptorDigestSha256: activation.descriptorDigestSha256,
    heapLimitMiB: descriptor.memoryLimitMiB,
    wallTimeoutMs: descriptor.cpuTimeLimitMs,
    isolation: 'subprocess' as const,
  });
  const plan = Object.freeze({
    format: FURY_PLUGIN_SANDBOX_PLAN_FORMAT,
    state: reasons.length === 0 ? 'READY_FOR_APPROVAL' as const : 'REJECTED' as const,
    ...payload,
    planDigestSha256: sha256(canonical(payload)),
    reasons: Object.freeze(reasons),
    requiresOperatorApproval: true as const,
    networkAuthorized: false as const,
    filesystemWriteAuthorized: false as const,
    childProcessAuthorized: false as const,
    workerAuthorized: false as const,
    addonAuthorized: false as const,
    wasiAuthorized: false as const,
    executionAuthorized: false as const,
  });
  plans.add(plan);
  return plan;
}

export function approveFuryPluginSandboxExecution(
  plan: FuryPluginSandboxPlan,
  input: { readonly confirm: true; readonly approvedBy: string; readonly approvedAt: string },
): FuryPluginSandboxApproval {
  if (!plans.has(plan)) throw new Error('plugin sandbox plan is not a process-local FuryPipe plan');
  if (plan.state !== 'READY_FOR_APPROVAL') throw new Error('plugin sandbox plan is rejected');
  if (input.confirm !== true) throw new Error('plugin sandbox execution requires explicit operator approval');
  const approvedBy = printable(input.approvedBy, 'plugin sandbox approver', 160);
  const approvedAt = normalizeIso(input.approvedAt, 'plugin sandbox approvedAt');
  const approval = Object.freeze({
    format: FURY_PLUGIN_SANDBOX_APPROVAL_FORMAT,
    planDigestSha256: plan.planDigestSha256,
    approvedBy,
    approvedAt,
    executionAuthorized: true as const,
  });
  approvals.add(approval);
  return approval;
}

export async function executeFuryPluginSandbox(input: {
  readonly plan: FuryPluginSandboxPlan;
  readonly approval: FuryPluginSandboxApproval;
  readonly pluginRoot: string;
  readonly payload: unknown;
}): Promise<FuryPluginSandboxReceipt> {
  if (!plans.has(input.plan)) throw new Error('plugin sandbox plan is not process-local');
  if (!approvals.has(input.approval)) throw new Error('plugin sandbox approval is forged or replayed outside this process');
  if (input.approval.planDigestSha256 !== input.plan.planDigestSha256 || !SHA256.test(input.plan.planDigestSha256)) {
    throw new Error('plugin sandbox approval does not match plan');
  }
  if (input.plan.state !== 'READY_FOR_APPROVAL') throw new Error('plugin sandbox plan is not executable');
  if (parseNodeMajor(process.versions.node) < 25) throw new Error('plugin sandbox execution requires Node 25+ for deny-by-default network isolation');
  if (input.plan.hostNodeVersion !== process.versions.node) throw new Error('plugin sandbox plan Node version does not match the executing runtime');

  const pluginRoot = await realpath(input.pluginRoot);
  const entrypoint = await realpath(path.resolve(pluginRoot, input.plan.entrypoint));
  if (!inside(pluginRoot, entrypoint)) throw new Error('plugin sandbox entrypoint escapes plugin root');

  const encodedInput = JSON.stringify(input.payload ?? null);
  if (Buffer.byteLength(encodedInput, 'utf8') > MAX_INPUT_BYTES) throw new Error('plugin sandbox input exceeds 256 KiB');

  const startedAt = Date.now();
  return await new Promise<FuryPluginSandboxReceipt>((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--permission',
      '--max-old-space-size=' + String(input.plan.heapLimitMiB),
      entrypoint,
    ], {
      cwd: pluginRoot,
      env: minimalEnvironment(input.plan.pluginId, input.plan.pluginVersion),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let forcedOutcome: FuryPluginSandboxReceipt['outcome'] | undefined;
    let settled = false;

    const finish = (outcome: FuryPluginSandboxReceipt['outcome'], code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Math.max(0, Date.now() - startedAt);
      const stdoutDigest = stdout.byteLength ? sha256(stdout) : null;
      const stderrDigest = stderr.byteLength ? sha256(stderr) : null;
      let output: unknown;
      let finalOutcome = outcome;
      if (outcome === 'SUCCEEDED') {
        try {
          output = JSON.parse(stdout.toString('utf8')) as unknown;
        } catch {
          finalOutcome = 'OUTPUT_REJECTED';
        }
      }
      resolve(Object.freeze({
        format: FURY_PLUGIN_SANDBOX_RECEIPT_FORMAT,
        pluginId: input.plan.pluginId,
        pluginVersion: input.plan.pluginVersion,
        planDigestSha256: input.plan.planDigestSha256,
        outcome: finalOutcome,
        exitCode: code,
        signal,
        durationMs,
        stdoutBytes: stdout.byteLength,
        stdoutSha256: stdoutDigest,
        stderrBytes: stderr.byteLength,
        stderrSha256: stderrDigest,
        ...(finalOutcome === 'SUCCEEDED' ? { output } : {}),
        executionPerformed: true as const,
        networkAuthorized: false as const,
        filesystemWriteAuthorized: false as const,
        childProcessAuthorized: false as const,
        workerAuthorized: false as const,
        addonAuthorized: false as const,
        wasiAuthorized: false as const,
      }));
    };

    const timer = setTimeout(() => {
      forcedOutcome = 'TIMED_OUT';
      child.kill();
    }, input.plan.wallTimeoutMs);
    timer.unref();

    child.on('error', (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.stdout.on('data', (chunk: Buffer) => {
      if (forcedOutcome) return;
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.byteLength > MAX_STDOUT_BYTES) {
        forcedOutcome = 'OUTPUT_REJECTED';
        child.kill();
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (forcedOutcome) return;
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.byteLength > MAX_STDERR_BYTES) {
        forcedOutcome = 'OUTPUT_REJECTED';
        child.kill();
      }
    });

    child.on('close', (code, signal) => {
      if (forcedOutcome) {
        finish(forcedOutcome, code, signal);
        return;
      }
      finish(code === 0 ? 'SUCCEEDED' : 'FAILED', code, signal);
    });

    child.stdin.on('error', () => undefined);
    child.stdin.end(encodedInput);
  });
}
