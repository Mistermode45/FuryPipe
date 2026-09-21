import { createHash, randomUUID } from 'node:crypto';
import { access, constants, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { RecoveryHandle, RecoveryStore } from './core/recovery-store.js';

export const FURY_CODING_REPOSITORY_FORMAT = 'furypipe-coding-repository/v1' as const;
export const FURY_CODING_WORKTREE_FORMAT = 'furypipe-coding-worktree/v1' as const;
export const FURY_CODING_SANDBOX_FORMAT = 'furypipe-coding-sandbox/v1' as const;
export const FURY_CODING_PROCESS_PERMIT_FORMAT = 'furypipe-coding-process-permit/v1' as const;
export const FURY_CODING_PROCESS_RECEIPT_FORMAT = 'furypipe-coding-process-receipt/v1' as const;

export type CodingWorktreeStatus = 'creating' | 'ready' | 'cleanup-pending' | 'removed' | 'outcome-unknown';
export type CodingProcessOutcome = 'succeeded' | 'failed' | 'outcome-unknown';

export interface CodingRepository {
  readonly format: typeof FURY_CODING_REPOSITORY_FORMAT;
  readonly repositoryId: string;
  readonly rootPath: string;
  readonly gitPath: string;
  readonly readable: true;
  readonly writable: boolean;
  readonly discoveredAt: number;
  readonly executionAuthority: false;
}

export interface CodingWorktree {
  readonly format: typeof FURY_CODING_WORKTREE_FORMAT;
  readonly worktreeId: string;
  readonly repositoryId: string;
  readonly owner: string;
  readonly taskDigest: string;
  readonly baseSha: string;
  readonly branch?: string;
  readonly rootPath: string;
  readonly writableRoot: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly status: CodingWorktreeStatus;
  readonly headSha?: string;
  readonly resultCommitSha?: string;
  readonly diffSha256?: string;
  readonly executionAuthority: false;
}

export interface CodingSandboxPolicy {
  readonly policyId: string;
  readonly rootPath: string;
  readonly readRoots?: readonly string[];
  readonly writeRoots?: readonly string[];
  readonly environmentAllowlist?: readonly string[];
  readonly allowedCommands: readonly string[];
  readonly maxOutputBytes?: number;
  readonly maxProcesses?: number;
  readonly maxFileBytes?: number;
  readonly maxTimeoutMs?: number;
}

export interface CodingSandbox {
  readonly format: typeof FURY_CODING_SANDBOX_FORMAT;
  readonly policyId: string;
  readonly rootPath: string;
  readonly policySha256: string;
  resolveReadPath(pathValue: string): Promise<string>;
  resolveWritePath(pathValue: string): Promise<string>;
  readFile(pathValue: string): Promise<Uint8Array>;
  writeFile(pathValue: string, bytes: Uint8Array): Promise<void>;
  environment(extra?: Readonly<Record<string, string>>): Readonly<Record<string, string>>;
  readonly allowedCommands: readonly string[];
  limits: Readonly<{
    readonly maxOutputBytes: number;
    readonly maxProcesses: number;
    readonly maxFileBytes: number;
    readonly maxTimeoutMs: number;
  }>;
}

export interface ProcessExecutionRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly stdin?: string;
  readonly timeoutMs?: number;
}

export interface ProcessExecutionPermit {
  readonly format: typeof FURY_CODING_PROCESS_PERMIT_FORMAT;
  readonly permitId: string;
  readonly sandboxPolicySha256: string;
  readonly commandSha256: string;
  readonly cwdSha256: string;
  readonly requestSha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly executionAuthority: false;
}

export interface ProcessExecutionReceipt {
  readonly format: typeof FURY_CODING_PROCESS_RECEIPT_FORMAT;
  readonly receiptId: string;
  readonly permitIdSha256: string;
  readonly sandboxPolicySha256: string;
  readonly commandSha256: string;
  readonly cwdSha256: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly outcome: CodingProcessOutcome;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly outputTruncated: boolean;
  readonly verificationStatus: 'not-verified' | 'locally-verified';
  readonly errorCode?: 'invalid-permit' | 'expired' | 'timeout' | 'output-limit' | 'spawn-failed' | 'policy-denied';
  readonly executionAuthority: false;
}

export interface ProcessExecutionResult {
  readonly receipt: ProcessExecutionReceipt;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitWorktreeProvider {
  create(input: {
    readonly repository: CodingRepository;
    readonly rootPath: string;
    readonly baseSha: string;
    readonly branch?: string;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly headSha: string }>;
  remove(input: { readonly repository: CodingRepository; readonly rootPath: string; readonly signal?: AbortSignal }): Promise<void>;
}

export interface CodingWorktreeManagerOptions {
  readonly provider: GitWorktreeProvider;
  readonly recovery?: RecoveryStore;
  readonly now?: () => number;
  readonly maxWorktrees?: number;
}

export interface CodingWorktreeManager {
  create(input: {
    readonly repository: CodingRepository;
    readonly owner: string;
    readonly taskDigest: string;
    readonly baseSha: string;
    readonly branch?: string;
    readonly writableRoot: string;
  }): Promise<CodingWorktree>;
  cleanup(worktree: CodingWorktree): Promise<CodingWorktree>;
  inspect(worktree: CodingWorktree): CodingWorktree;
  list(): Promise<readonly CodingWorktree[]>;
}

export class CodingRuntimeError extends Error {
  readonly code:
    | 'invalid-input' | 'repository-invalid' | 'path-denied' | 'symlink-denied'
    | 'worktree-invalid' | 'worktree-limit' | 'worktree-provider-failed'
    | 'permit-invalid' | 'permit-expired' | 'permit-consumed' | 'policy-denied'
    | 'process-limit' | 'timeout' | 'output-limit' | 'spawn-failed';

  constructor(code: CodingRuntimeError['code'], message: string) {
    super(message);
    this.name = 'CodingRuntimeError';
    this.code = code;
  }
}

interface ProcessPermitState {
  readonly request: ProcessExecutionRequest;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly sandboxPolicySha256: string;
  readonly commandSha256: string;
  readonly cwdSha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly timeoutMs: number;
  consumed: boolean;
}

interface WorktreeState {
  readonly worktree: CodingWorktree;
  readonly repository: CodingRepository;
  readonly provider: GitWorktreeProvider;
  readonly recovery?: RecoveryStore;
  readonly persistence?: RecoveryHandle;
}

const WORKTREE_STATE = new WeakMap<object, WorktreeState>();
const PROCESS_PERMIT_STATE = new WeakMap<object, ProcessPermitState>();
const REPOSITORY_STATE = new WeakMap<object, CodingRepository>();
const SANDBOX_STATE = new WeakMap<object, CodingSandbox>();
const MAX_TEXT_BYTES = 4096;
const MAX_ARGS = 128;
const MAX_ARG_BYTES = 16 * 1024;
const DEFAULT_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_PROCESS_LIMIT = 1;
const DEFAULT_FILE_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const SHA = /^[0-9a-f]{40,64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_COMMAND = /^[A-Za-z0-9._-]{1,128}$/u;
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const SECRET_NAME = /(?:api[-_]?key|token|secret|password|passwd|credential|private[-_]?key|authorization|cookie)/iu;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function boundedString(value: unknown, label: string, max = MAX_TEXT_BYTES): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || bytes(value) > max) {
    throw new CodingRuntimeError('invalid-input', label + ' is invalid or exceeds its bound');
  }
  return value;
}

function boundedId(value: unknown, label: string): string {
  const text = boundedString(value, label, 128);
  if (!SAFE_ID.test(text)) throw new CodingRuntimeError('invalid-input', label + ' has unsupported characters');
  return text;
}

function exactObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CodingRuntimeError('invalid-input', label + ' must be a plain object');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new CodingRuntimeError('invalid-input', label + ' must use a plain-object prototype');
  if (Object.getOwnPropertySymbols(value).length > 0) throw new CodingRuntimeError('invalid-input', label + ' must not contain symbols');
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new CodingRuntimeError('invalid-input', label + ' must contain data properties');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const set = new Set(allowed);
  if (Object.keys(value).some((key) => !set.has(key))) throw new CodingRuntimeError('invalid-input', label + ' contains unsupported fields');
}

function safeSha(value: unknown, label: string): string {
  const text = boundedString(value, label, 64);
  if (!SHA.test(text)) throw new CodingRuntimeError('invalid-input', label + ' must be a SHA-256 or Git object SHA');
  return text;
}

function finiteTime(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new CodingRuntimeError('invalid-input', label + ' must be a non-negative safe integer');
  return value;
}

function optionNumber(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new CodingRuntimeError('invalid-input', label + ' must be between ' + min + ' and ' + max);
  return result;
}

function validateBranch(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const branch = boundedString(value, 'worktree branch', 256);
  if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,255}$/u.test(branch) || branch.includes('..') || branch.endsWith('/') || branch.includes('@{')) {
    throw new CodingRuntimeError('invalid-input', 'worktree branch is invalid');
  }
  return branch;
}

function pathIsAbsoluteOutside(value: string): boolean {
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\') || value.startsWith('//');
}

function contained(root: string, target: string): boolean {
  const base = root.endsWith(sep) ? root : root + sep;
  return target === root || target.startsWith(base);
}

function rejectPathSyntax(value: string): void {
  if (value.includes('\0') || value.includes(':') || value.split(/[\\/]/u).some((part) => RESERVED_NAME.test(part))) {
    throw new CodingRuntimeError('path-denied', 'path contains a device, alternate-stream or reserved-name component');
  }
  if (pathIsAbsoluteOutside(value)) throw new CodingRuntimeError('path-denied', 'absolute, UNC or device paths are not allowed');
}

async function canonicalExistingRoot(rootPath: string, label: string): Promise<string> {
  try {
    const info = await stat(rootPath);
    if (!info.isDirectory()) throw new Error('not-directory');
    return await realpath(rootPath);
  } catch {
    throw new CodingRuntimeError('path-denied', label + ' must be an existing directory');
  }
}

async function ensureContainedPath(root: string, pathValue: string, mode: 'read' | 'write'): Promise<string> {
  rejectPathSyntax(pathValue);
  const candidate = resolve(root, pathValue);
  if (!contained(root, candidate)) throw new CodingRuntimeError('path-denied', 'path escapes sandbox root');
  const existing = await lstat(candidate).catch(() => undefined);
  if (existing?.isSymbolicLink()) throw new CodingRuntimeError('symlink-denied', 'symbolic-link paths are not allowed');
  const parent = await realpath(existing ? candidate : join(candidate, '..')).catch(() => undefined);
  if (!parent || !contained(root, parent)) throw new CodingRuntimeError('path-denied', 'path resolves outside sandbox root');
  if (existing?.isDirectory() && mode === 'read') return candidate;
  return candidate;
}

function redactedEnvironment(
  base: NodeJS.ProcessEnv,
  allowlist: readonly string[],
  extra: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const allowed = new Set(allowlist);
  const output: Record<string, string> = {};
  for (const name of allowed) {
    if (SECRET_NAME.test(name)) continue;
    const value = base[name];
    if (value !== undefined && value.length <= 8192 && !value.includes('\0') && !/[\r\n]/u.test(value)) output[name] = value;
  }
  const extraRecord = extra === undefined ? undefined : exactObject(extra, 'process environment');
  for (const [name, value] of Object.entries(extraRecord ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(name) || SECRET_NAME.test(name)) {
      throw new CodingRuntimeError('policy-denied', 'process environment contains a forbidden variable');
    }
    if (!allowed.has(name)) throw new CodingRuntimeError('policy-denied', 'process environment variable is outside the allowlist');
    const safeValue = boundedString(value, 'process environment value', 8192);
    output[name] = safeValue;
  }
  return Object.freeze(output);
}

function redactOutput(value: string, env: Readonly<Record<string, string>>): string {
  let result = value;
  for (const secret of Object.values(env)) {
    if (secret.length >= 4) result = result.split(secret).join('[redacted]');
  }
  return result;
}

export async function discoverCodingRepository(rootPath: string, now = Date.now): Promise<CodingRepository> {
  const root = await canonicalExistingRoot(rootPath, 'repository root');
  const gitPath = join(root, '.git');
  const gitInfo = await lstat(gitPath).catch(() => undefined);
  if (!gitInfo || (!gitInfo.isDirectory() && !gitInfo.isFile())) throw new CodingRuntimeError('repository-invalid', 'repository has no regular .git directory or gitfile');
  let readable = true;
  try {
    await access(root, constants.R_OK);
  } catch {
    readable = false;
  }
  if (!readable) throw new CodingRuntimeError('repository-invalid', 'repository is not readable');
  let writable = false;
  try {
    await access(root, constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  const discoveredAt = finiteTime(now(), 'repository clock');
  const repository = Object.freeze({
    format: FURY_CODING_REPOSITORY_FORMAT,
    repositoryId: 'repo_' + sha256(root).slice(0, 32),
    rootPath: root,
    gitPath,
    readable: true,
    writable,
    discoveredAt,
    executionAuthority: false,
  });
  REPOSITORY_STATE.set(repository, repository);
  return repository;
}

export function isGeneratedCodingRepository(value: unknown): value is CodingRepository {
  return typeof value === 'object' && value !== null && REPOSITORY_STATE.has(value);
}

function safePolicy(policy: CodingSandboxPolicy): CodingSandboxPolicy {
  const record = exactObject(policy, 'coding sandbox policy');
  exactKeys(record, ['policyId', 'rootPath', 'readRoots', 'writeRoots', 'environmentAllowlist', 'allowedCommands', 'maxOutputBytes', 'maxProcesses', 'maxFileBytes', 'maxTimeoutMs'], 'coding sandbox policy');
  const policyId = boundedId(record.policyId, 'coding sandbox policy ID');
  const rootPath = boundedString(record.rootPath, 'coding sandbox root');
  if (!Array.isArray(record.allowedCommands) || record.allowedCommands.length < 1 || record.allowedCommands.length > 64 || record.allowedCommands.some((_, index) => !Object.prototype.hasOwnProperty.call(record.allowedCommands as readonly unknown[], index))) throw new CodingRuntimeError('invalid-input', 'sandbox allowedCommands is invalid');
  const allowedCommands = record.allowedCommands.map((command) => {
    const normalized = boundedString(command, 'sandbox command', 128);
    if (!SAFE_COMMAND.test(normalized)) throw new CodingRuntimeError('invalid-input', 'sandbox command must be a bare executable name');
    return normalized.toLowerCase();
  });
  if (new Set(allowedCommands).size !== allowedCommands.length) throw new CodingRuntimeError('invalid-input', 'sandbox commands must be unique');
  const roots = (value: unknown, label: string): readonly string[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 64 || value.some((_, index) => !Object.prototype.hasOwnProperty.call(value, index))) throw new CodingRuntimeError('invalid-input', label + ' is invalid');
    return Object.freeze(value.map((entry) => boundedString(entry, label + ' entry', 4096)));
  };
  const environmentAllowlist = record.environmentAllowlist === undefined
    ? Object.freeze(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'NODE_ENV'])
    : roots(record.environmentAllowlist, 'sandbox environmentAllowlist');
  return Object.freeze({
    policyId,
    rootPath,
    ...(roots(record.readRoots, 'sandbox readRoots') === undefined ? {} : { readRoots: roots(record.readRoots, 'sandbox readRoots') }),
    ...(roots(record.writeRoots, 'sandbox writeRoots') === undefined ? {} : { writeRoots: roots(record.writeRoots, 'sandbox writeRoots') }),
    environmentAllowlist,
    allowedCommands: Object.freeze(allowedCommands),
    maxOutputBytes: optionNumber(record.maxOutputBytes as number | undefined, DEFAULT_OUTPUT_BYTES, 1024, 64 * 1024 * 1024, 'maxOutputBytes'),
    maxProcesses: optionNumber(record.maxProcesses as number | undefined, DEFAULT_PROCESS_LIMIT, 1, 32, 'maxProcesses'),
    maxFileBytes: optionNumber(record.maxFileBytes as number | undefined, DEFAULT_FILE_BYTES, 1, 256 * 1024 * 1024, 'maxFileBytes'),
    maxTimeoutMs: optionNumber(record.maxTimeoutMs as number | undefined, DEFAULT_TIMEOUT_MS, 1, 15 * 60_000, 'maxTimeoutMs'),
  });
}

export async function createCodingSandbox(policyInput: CodingSandboxPolicy): Promise<CodingSandbox> {
  const policy = safePolicy(policyInput);
  const root = await canonicalExistingRoot(policy.rootPath, 'sandbox root');
  const policySha256 = sha256(JSON.stringify({ ...policy, rootPath: root }));
  const readRoots = Object.freeze((policy.readRoots ?? ['.']).map((value) => resolve(root, value)));
  const writeRoots = Object.freeze((policy.writeRoots ?? []).map((value) => resolve(root, value)));
  if (readRoots.some((value) => !contained(root, value)) || writeRoots.some((value) => !contained(root, value))) throw new CodingRuntimeError('path-denied', 'sandbox policy root escapes sandbox');
  const sandboxPath = async (value: string, mode: 'read' | 'write'): Promise<string> => {
    const candidate = await ensureContainedPath(root, value, mode);
    const roots = mode === 'read' ? readRoots : writeRoots;
    if (!roots.some((allowed) => contained(allowed, candidate))) throw new CodingRuntimeError('path-denied', 'path is outside the sandbox policy allowlist');
    return candidate;
  };
  const sandbox = Object.freeze({
    format: FURY_CODING_SANDBOX_FORMAT,
    policyId: policy.policyId,
    rootPath: root,
    policySha256,
    resolveReadPath(pathValue: string): Promise<string> { return sandboxPath(pathValue, 'read'); },
    resolveWritePath(pathValue: string): Promise<string> { return sandboxPath(pathValue, 'write'); },
    async readFile(pathValue: string): Promise<Uint8Array> {
      const path = await sandboxPath(pathValue, 'read');
      const info = await stat(path);
      if (!info.isFile() || info.size > policy.maxFileBytes!) throw new CodingRuntimeError('path-denied', 'sandbox read exceeds file policy');
      return new Uint8Array(await readFile(path));
    },
    async writeFile(pathValue: string, data: Uint8Array): Promise<void> {
      if (data.byteLength > policy.maxFileBytes!) throw new CodingRuntimeError('path-denied', 'sandbox write exceeds file policy');
      const path = await sandboxPath(pathValue, 'write');
      await writeFile(path, data, { flag: 'wx', mode: 0o600 });
    },
    environment(extra?: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
      return redactedEnvironment(process.env, policy.environmentAllowlist!, extra);
    },
    allowedCommands: policy.allowedCommands,
    limits: Object.freeze({
      maxOutputBytes: policy.maxOutputBytes!,
      maxProcesses: policy.maxProcesses!,
      maxFileBytes: policy.maxFileBytes!,
      maxTimeoutMs: policy.maxTimeoutMs!,
    }),
  });
  SANDBOX_STATE.set(sandbox, sandbox);
  return sandbox;
}

export function isGeneratedCodingSandbox(value: unknown): value is CodingSandbox {
  return typeof value === 'object' && value !== null && SANDBOX_STATE.has(value);
}

export function isGeneratedProcessExecutionPermit(value: unknown): value is ProcessExecutionPermit {
  return typeof value === 'object' && value !== null && PROCESS_PERMIT_STATE.has(value);
}

export function isGeneratedCodingWorktree(value: unknown): value is CodingWorktree {
  return typeof value === 'object' && value !== null && WORKTREE_STATE.has(value);
}

function worktreeSnapshot(state: WorktreeState): CodingWorktree {
  return state.worktree;
}

function validateWorktree(worktree: CodingWorktree): CodingWorktree {
  if (!WORKTREE_STATE.has(worktree as unknown as object)) throw new CodingRuntimeError('worktree-invalid', 'worktree is not process-local evidence');
  const record = exactObject(worktree, 'coding worktree');
  exactKeys(record, ['format', 'worktreeId', 'repositoryId', 'owner', 'taskDigest', 'baseSha', 'branch', 'rootPath', 'writableRoot', 'createdAt', 'updatedAt', 'status', 'headSha', 'resultCommitSha', 'diffSha256', 'executionAuthority'], 'coding worktree');
  if (record.format !== FURY_CODING_WORKTREE_FORMAT || record.executionAuthority !== false) throw new CodingRuntimeError('worktree-invalid', 'coding worktree evidence is invalid');
  return worktree;
}

async function persistWorktree(state: WorktreeState): Promise<WorktreeState> {
  if (!state.recovery) return state;
  const bytesValue = new TextEncoder().encode(JSON.stringify(state.worktree));
  const metadata = {
    contentType: 'application/vnd.furypipe.coding-worktree+json',
    worktreeId: state.worktree.worktreeId,
    revision: state.worktree.updatedAt,
  };
  const handle = state.recovery.putBounded
    ? await state.recovery.putBounded(bytesValue, metadata, { metadata: { contentType: metadata.contentType, worktreeId: state.worktree.worktreeId }, maxMatches: 1024 })
    : await state.recovery.put(bytesValue, metadata);
  if (state.persistence) await state.recovery.delete(state.persistence).catch(() => false);
  return Object.freeze({ ...state, persistence: handle });
}

export function createCodingWorktreeManager(options: CodingWorktreeManagerOptions): CodingWorktreeManager {
  if (!options || typeof options.provider !== 'object') throw new CodingRuntimeError('invalid-input', 'worktree provider is required');
  const now = options.now ?? Date.now;
  const maxWorktrees = optionNumber(options.maxWorktrees, 32, 1, 1024, 'maxWorktrees');
  const states = new Map<string, WorktreeState>();
  const update = async (state: WorktreeState, patch: Partial<CodingWorktree>): Promise<WorktreeState> => {
    const worktree = Object.freeze({ ...state.worktree, ...patch, updatedAt: finiteTime(now(), 'worktree clock') });
    const next = Object.freeze({ ...state, worktree });
    const persisted = await persistWorktree(next);
    states.set(worktree.worktreeId, persisted);
    WORKTREE_STATE.set(worktree, persisted);
    return persisted;
  };
  return Object.freeze({
    async create(input: {
      readonly repository: CodingRepository;
      readonly owner: string;
      readonly taskDigest: string;
      readonly baseSha: string;
      readonly branch?: string;
      readonly writableRoot: string;
    }): Promise<CodingWorktree> {
      const repository = input.repository;
      if (!isGeneratedCodingRepository(repository) || repository.format !== FURY_CODING_REPOSITORY_FORMAT || repository.executionAuthority !== false) throw new CodingRuntimeError('repository-invalid', 'repository capability is invalid');
      const owner = boundedId(input.owner, 'worktree owner');
      const taskDigest = safeSha(input.taskDigest, 'worktree task digest');
      const baseSha = safeSha(input.baseSha, 'worktree base SHA');
      const branch = validateBranch(input.branch);
      const writableRoot = await canonicalExistingRoot(input.writableRoot, 'worktree writable root');
      if (states.size >= maxWorktrees) throw new CodingRuntimeError('worktree-limit', 'worktree limit reached');
      const worktreeId = 'wt_' + randomUUID();
      const rootPath = join(writableRoot, worktreeId);
      if (!contained(writableRoot, rootPath)) throw new CodingRuntimeError('path-denied', 'worktree path escapes writable root');
      const initial = Object.freeze({
        format: FURY_CODING_WORKTREE_FORMAT,
        worktreeId, repositoryId: repository.repositoryId, owner, taskDigest, baseSha,
        ...(branch === undefined ? {} : { branch }),
        rootPath, writableRoot, createdAt: finiteTime(now(), 'worktree clock'),
        updatedAt: finiteTime(now(), 'worktree clock'), status: 'creating' as const,
        executionAuthority: false as const,
      });
      const state: WorktreeState = { worktree: initial, repository, provider: options.provider, recovery: options.recovery };
      states.set(worktreeId, state);
      let created: { readonly headSha: string };
      try {
        created = await options.provider.create({ repository, rootPath, baseSha, ...(branch === undefined ? {} : { branch }) });
      } catch (error) {
        states.delete(worktreeId);
        throw new CodingRuntimeError('worktree-provider-failed', 'worktree provider could not create the isolated checkout: ' + (error instanceof Error ? error.message : 'unknown'));
      }
      if (!SHA.test(created.headSha) || created.headSha !== baseSha) throw new CodingRuntimeError('worktree-provider-failed', 'worktree provider did not materialize the requested base SHA');
      const ready = await update(state, { status: 'ready', headSha: created.headSha });
      return worktreeSnapshot(ready);
    },
    async cleanup(worktree: CodingWorktree): Promise<CodingWorktree> {
      validateWorktree(worktree);
      const state = states.get(worktree.worktreeId);
      if (!state || state.worktree !== worktree) throw new CodingRuntimeError('worktree-invalid', 'worktree is not owned by this manager');
      if (state.worktree.status === 'removed') return state.worktree;
      try {
        await state.provider.remove({ repository: state.repository, rootPath: state.worktree.rootPath });
        const removed = await update(state, { status: 'removed' });
        states.set(state.worktree.worktreeId, removed);
        return removed.worktree;
      } catch {
        const pending = await update(state, { status: 'cleanup-pending' });
        return pending.worktree;
      }
    },
    inspect(worktree: CodingWorktree): CodingWorktree {
      validateWorktree(worktree);
      const state = states.get(worktree.worktreeId);
      if (!state || state.worktree !== worktree) throw new CodingRuntimeError('worktree-invalid', 'worktree is not owned by this manager');
      return state.worktree;
    },
    async list(): Promise<readonly CodingWorktree[]> {
      const values = [...states.values()].map((state) => state.worktree);
      if (!options.recovery?.list) return Object.freeze(values);
      const manifests = await options.recovery.list({ metadata: { contentType: 'application/vnd.furypipe.coding-worktree+json' }, limit: maxWorktrees * 8 });
      const latest = new Map<string, CodingWorktree>();
      for (const manifest of manifests) {
        try {
          const decoded = JSON.parse(new TextDecoder().decode(await options.recovery.get(manifest))) as CodingWorktree;
          if (decoded.format !== FURY_CODING_WORKTREE_FORMAT || typeof decoded.worktreeId !== 'string') continue;
          const old = latest.get(decoded.worktreeId);
          if (!old || decoded.updatedAt > old.updatedAt) latest.set(decoded.worktreeId, decoded);
        } catch {
          // Corrupt evidence is ignored for listing and never promoted to authority.
        }
      }
      return Object.freeze([...new Map([...latest, ...values.map((value) => [value.worktreeId, value] as const)]).values()]);
    },
  });
}

export function createNodeGitWorktreeProvider(): GitWorktreeProvider {
  const run = (args: readonly string[], cwd: string, signal?: AbortSignal): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> => new Promise((resolvePromise, reject) => {
    const child = spawn('git', [...args], { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const abort = (): void => { child.kill(); };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8').slice(0, 1024 * 1024); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8').slice(0, 1024 * 1024); });
    child.once('error', (error) => { if (!settled) { settled = true; reject(error); } });
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (settled) return;
      settled = true;
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
  return Object.freeze({
    async create(input: {
      readonly repository: CodingRepository;
      readonly rootPath: string;
      readonly baseSha: string;
      readonly branch?: string;
      readonly signal?: AbortSignal;
    }): Promise<{ readonly headSha: string }> {
      const args = input.branch === undefined
        ? ['worktree', 'add', '--detach', input.rootPath, input.baseSha]
        : ['worktree', 'add', '-b', input.branch, input.rootPath, input.baseSha];
      const result = await run(args, input.repository.rootPath, input.signal);
      if (result.code !== 0) throw new Error('git worktree add failed');
      const head = await run(['rev-parse', 'HEAD'], input.rootPath, input.signal);
      if (head.code !== 0 || !SHA.test(head.stdout.trim())) throw new Error('git worktree HEAD verification failed');
      return Object.freeze({ headSha: head.stdout.trim() });
    },
    async remove(input: {
      readonly repository: CodingRepository;
      readonly rootPath: string;
      readonly signal?: AbortSignal;
    }): Promise<void> {
      const result = await run(['worktree', 'remove', '--force', input.rootPath], input.repository.rootPath, input.signal);
      if (result.code !== 0) throw new Error('git worktree remove failed');
    },
  });
}

function commandDigest(command: string, args: readonly string[], cwd: string): string {
  return sha256(JSON.stringify({ command, args, cwd }));
}

export function createCodingProcessRuntime(options: {
  readonly sandbox: CodingSandbox;
  readonly now?: () => number;
}): {
  authorize(request: ProcessExecutionRequest, ttlMs?: number): Promise<ProcessExecutionPermit>;
  execute(permit: ProcessExecutionPermit, options?: { readonly signal?: AbortSignal }): Promise<ProcessExecutionResult>;
} {
  if (!isGeneratedCodingSandbox(options.sandbox)) throw new CodingRuntimeError('path-denied', 'process runtime needs process-local sandbox evidence');
  const now = options.now ?? Date.now;
  let running = 0;
  const permitPolicy = options.sandbox.policySha256;
  const at = (): number => finiteTime(now(), 'process clock');
  return Object.freeze({
    async authorize(request: ProcessExecutionRequest, ttlMs = 30_000): Promise<ProcessExecutionPermit> {
      const record = exactObject(request, 'process execution request');
      exactKeys(record, ['command', 'args', 'cwd', 'environment', 'stdin', 'timeoutMs'], 'process execution request');
      const command = boundedString(request.command, 'process command', 128);
      if (!SAFE_COMMAND.test(command)) throw new CodingRuntimeError('policy-denied', 'process command must be a bare executable name');
      if (!options.sandbox.limits || !command) throw new CodingRuntimeError('policy-denied', 'sandbox is not executable');
      const commandAllowed = command.toLowerCase();
      if (!options.sandbox.allowedCommands.includes(commandAllowed)) throw new CodingRuntimeError('policy-denied', 'process command is not allowlisted');
      const args = request.args;
      if (!Array.isArray(args) || args.length > MAX_ARGS || args.some((arg, index) => !Object.prototype.hasOwnProperty.call(args, index) || typeof arg !== 'string' || bytes(arg) > MAX_ARG_BYTES || arg.includes('\0'))) throw new CodingRuntimeError('invalid-input', 'process arguments are invalid');
      if (request.stdin !== undefined) boundedString(request.stdin, 'process stdin', options.sandbox.limits.maxFileBytes);
      const cwd = await options.sandbox.resolveReadPath(request.cwd);
      const env = options.sandbox.environment(request.environment);
      const timeoutMs = optionNumber(request.timeoutMs, options.sandbox.limits.maxTimeoutMs, 1, options.sandbox.limits.maxTimeoutMs, 'process timeout');
      const issuedAt = at();
      const expiresAt = issuedAt + optionNumber(ttlMs, 30_000, 1, 60_000, 'process permit TTL');
      const commandSha256 = commandDigest(command, args, cwd);
      const cwdSha256 = sha256(cwd);
      const requestSha256 = sha256(JSON.stringify({ command, args, cwd, environmentNames: Object.keys(env).sort(), stdinBytes: request.stdin === undefined ? 0 : bytes(request.stdin), timeoutMs }));
      const permit = Object.freeze({
        format: FURY_CODING_PROCESS_PERMIT_FORMAT,
        permitId: 'cpm_' + randomUUID(),
        sandboxPolicySha256: permitPolicy,
        commandSha256, cwdSha256, requestSha256, issuedAt, expiresAt,
        executionAuthority: false as const,
      });
      PROCESS_PERMIT_STATE.set(permit, {
        request, command, args: Object.freeze([...args]), cwd, env, sandboxPolicySha256: permitPolicy,
        commandSha256, cwdSha256, issuedAt, expiresAt, timeoutMs, consumed: false,
      });
      return permit;
    },
    async execute(permit: ProcessExecutionPermit, invokeOptions = {}): Promise<ProcessExecutionResult> {
      const state = PROCESS_PERMIT_STATE.get(permit as unknown as object);
      if (!state) throw new CodingRuntimeError('permit-invalid', 'process permit is not process-local evidence');
      if (state.consumed) throw new CodingRuntimeError('permit-consumed', 'process permit was already consumed');
      if (at() > state.expiresAt) { state.consumed = true; throw new CodingRuntimeError('permit-expired', 'process permit has expired'); }
      if (running >= options.sandbox.limits.maxProcesses) throw new CodingRuntimeError('process-limit', 'sandbox process limit reached');
      state.consumed = true;
      running += 1;
      const startedAt = at();
      let childStarted = false;
      let timedOut = false;
      let outputTruncated = false;
      let stdout = '';
      let stderr = '';
      let exitCode: number | undefined;
      let signal: string | undefined;
      let childProcess: ReturnType<typeof spawn> | undefined;
      const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
        const current = target === 'stdout' ? stdout : stderr;
        const remaining = options.sandbox.limits.maxOutputBytes - bytes(stdout) - bytes(stderr);
        if (remaining <= 0) { outputTruncated = true; childProcess?.kill(); return; }
        const text = chunk.toString('utf8');
        const clipped = Buffer.byteLength(text, 'utf8') > remaining ? Buffer.from(text).subarray(0, remaining).toString('utf8') : text;
        if (target === 'stdout') stdout += clipped; else stderr += clipped;
        if (clipped.length < text.length) { outputTruncated = true; childProcess?.kill(); }
        void current;
      };
      const result = await new Promise<{ readonly started: boolean; readonly error?: Error }>((resolvePromise) => {
        const child = spawn(state.command, [...state.args], {
          cwd: state.cwd,
          env: state.env,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        childProcess = child;
        let settled = false;
        const settle = (value: { readonly started: boolean; readonly error?: Error }): void => {
          if (settled) return;
          settled = true;
          resolvePromise(value);
        };
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, state.timeoutMs);
        timer.unref();
        const abort = (): void => { timedOut = true; child.kill(); };
        invokeOptions.signal?.addEventListener('abort', abort, { once: true });
        child.once('spawn', () => { childStarted = true; if (state.request.stdin !== undefined) child.stdin.write(state.request.stdin); child.stdin.end(); });
        child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
        child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
        child.once('error', (error) => { clearTimeout(timer); invokeOptions.signal?.removeEventListener('abort', abort); settle({ started: childStarted, error }); });
        child.once('close', (code, closedSignal) => {
          clearTimeout(timer);
          invokeOptions.signal?.removeEventListener('abort', abort);
          exitCode = code === null ? undefined : code;
          signal = closedSignal ?? undefined;
          settle({ started: childStarted });
        });
      });
      running -= 1;
      const redactedStdout = redactOutput(stdout, state.env);
      const redactedStderr = redactOutput(stderr, state.env);
      const outcome: CodingProcessOutcome = !result.started
        ? 'failed'
        : timedOut || outputTruncated
          ? 'outcome-unknown'
          : exitCode === 0
            ? 'succeeded'
            : 'failed';
      const errorCode = !result.started
        ? 'spawn-failed'
        : timedOut
          ? 'timeout'
          : outputTruncated
            ? 'output-limit'
            : undefined;
      const receipt = Object.freeze({
        format: FURY_CODING_PROCESS_RECEIPT_FORMAT,
        receiptId: 'cpr_' + randomUUID(),
        permitIdSha256: sha256('permit:' + permit.permitId),
        sandboxPolicySha256: state.sandboxPolicySha256,
        commandSha256: state.commandSha256,
        cwdSha256: state.cwdSha256,
        startedAt, finishedAt: at(), outcome,
        ...(exitCode === undefined ? {} : { exitCode }),
        ...(signal === undefined ? {} : { signal }),
        stdoutSha256: sha256(redactedStdout),
        stderrSha256: sha256(redactedStderr),
        stdoutBytes: bytes(redactedStdout),
        stderrBytes: bytes(redactedStderr),
        outputTruncated,
        verificationStatus: 'not-verified' as const,
        ...(errorCode === undefined ? {} : { errorCode }),
        executionAuthority: false as const,
      });
      return Object.freeze({ receipt, stdout: redactedStdout, stderr: redactedStderr });
    },
  });
}
