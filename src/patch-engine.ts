import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CodingRepository, CodingSandbox } from './coding-runtime.js';
import { CodingRuntimeError, discoverCodingRepository, isGeneratedCodingRepository, isGeneratedCodingSandbox } from './coding-runtime.js';

export const FURY_PATCH_PROPOSAL_FORMAT = 'furypipe-coding-patch-proposal/v1' as const;
export const FURY_PATCH_PERMIT_FORMAT = 'furypipe-coding-patch-permit/v1' as const;
export const FURY_PATCH_RECEIPT_FORMAT = 'furypipe-coding-patch-receipt/v1' as const;

export interface PatchFileProposal {
  readonly path: string;
  readonly expectedSha256: string;
  readonly replacement: string;
}

export interface PatchProposalFile {
  readonly path: string;
  readonly expectedSha256: string;
  readonly replacementSha256: string;
  readonly replacementBytes: number;
}

export interface PatchProposal {
  readonly format: typeof FURY_PATCH_PROPOSAL_FORMAT;
  readonly proposalId: string;
  readonly repositoryId: string;
  readonly baseSha: string;
  readonly files: readonly PatchProposalFile[];
  readonly maxFiles: number;
  readonly maxBytes: number;
  readonly binaryRejected: true;
  readonly proposalSha256: string;
  readonly executionAuthority: false;
}

export interface PatchPermit {
  readonly format: typeof FURY_PATCH_PERMIT_FORMAT;
  readonly permitId: string;
  readonly proposalSha256: string;
  readonly repositoryId: string;
  readonly baseSha: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly executionAuthority: false;
}

export interface PatchReceipt {
  readonly format: typeof FURY_PATCH_RECEIPT_FORMAT;
  readonly receiptId: string;
  readonly permitIdSha256: string;
  readonly proposalSha256: string;
  readonly repositoryId: string;
  readonly baseSha: string;
  readonly finalHeadSha?: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly outcome: 'succeeded' | 'failed' | 'outcome-unknown';
  readonly appliedFiles: number;
  readonly appliedBytes: number;
  readonly changedFileSha256: readonly string[];
  readonly verificationStatus: 'not-verified' | 'locally-verified';
  readonly errorCode?: 'stale-base' | 'stale-file' | 'binary-rejected' | 'conflict' | 'write-failed' | 'permit-invalid' | 'permit-expired' | 'permit-consumed';
  readonly executionAuthority: false;
}

export interface PatchRuntimeOptions {
  readonly repository: CodingRepository;
  readonly sandbox: CodingSandbox;
  readonly currentHeadSha: () => Promise<string>;
  readonly now?: () => number;
  readonly maxFiles?: number;
  readonly maxBytes?: number;
  readonly permitTtlMs?: number;
}

interface ProposalState {
  readonly repository: CodingRepository;
  readonly files: readonly PatchFileProposal[];
  readonly proposal: PatchProposal;
}

interface PermitState {
  readonly proposal: ProposalState;
  readonly issuedAt: number;
  readonly expiresAt: number;
  consumed: boolean;
}

const PROPOSAL_STATE = new WeakMap<object, ProposalState>();
const PERMIT_STATE = new WeakMap<object, PermitState>();
const SHA256 = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40,64}$/u;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function textBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function boundedText(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || textBytes(value) > maxBytes) {
    throw new CodingRuntimeError('invalid-input', label + ' is invalid or exceeds its bound');
  }
  return value;
}

function exactObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CodingRuntimeError('invalid-input', label + ' must be a plain object');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new CodingRuntimeError('invalid-input', label + ' must use a plain-object prototype');
  if (Object.getOwnPropertySymbols(value).length > 0) throw new CodingRuntimeError('invalid-input', label + ' must not contain symbols');
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const set = new Set(allowed);
  if (Object.keys(value).some((key) => !set.has(key))) throw new CodingRuntimeError('invalid-input', label + ' contains unsupported fields');
}

function safeSha(value: unknown, label: string): string {
  const result = boundedText(value, label, 64);
  if (!SHA.test(result)) throw new CodingRuntimeError('invalid-input', label + ' is not a Git SHA');
  return result;
}

function safeHash(value: unknown, label: string): string {
  const result = boundedText(value, label, 64);
  if (!SHA256.test(result)) throw new CodingRuntimeError('invalid-input', label + ' is not a SHA-256 digest');
  return result;
}

function timestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new CodingRuntimeError('invalid-input', label + ' must be a non-negative safe integer');
  return value;
}

function option(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) throw new CodingRuntimeError('invalid-input', label + ' must be between ' + min + ' and ' + max);
  return resolved;
}

function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return !decoded.includes('\ufffd');
  } catch {
    return false;
  }
}

export function isGeneratedPatchProposal(value: unknown): value is PatchProposal {
  return typeof value === 'object' && value !== null && PROPOSAL_STATE.has(value);
}

export function isGeneratedPatchPermit(value: unknown): value is PatchPermit {
  return typeof value === 'object' && value !== null && PERMIT_STATE.has(value);
}

export async function discoverPatchRepository(rootPath: string): Promise<CodingRepository> {
  return discoverCodingRepository(rootPath);
}

async function atomicWrite(path: string, content: Uint8Array): Promise<void> {
  const temporary = join(dirname(path), '.' + randomUUID() + '.furypipe-patch.tmp');
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export function createPatchEngine(options: PatchRuntimeOptions): {
  propose(files: readonly PatchFileProposal[], baseSha: string): Promise<PatchProposal>;
  authorize(proposal: PatchProposal, ttlMs?: number): Promise<PatchPermit>;
  apply(permit: PatchPermit): Promise<PatchReceipt>;
} {
  if (!isGeneratedCodingRepository(options.repository)) throw new CodingRuntimeError('repository-invalid', 'patch engine needs process-local repository evidence');
  if (!isGeneratedCodingSandbox(options.sandbox)) throw new CodingRuntimeError('path-denied', 'patch engine needs process-local sandbox evidence');
  const repository = options.repository;
  const maxFiles = option(options.maxFiles, 32, 1, 256, 'patch maxFiles');
  const maxBytes = option(options.maxBytes, 4 * 1024 * 1024, 1, 64 * 1024 * 1024, 'patch maxBytes');
  const permitTtlMs = option(options.permitTtlMs, 30_000, 1, 60_000, 'patch permit TTL');
  const now = options.now ?? Date.now;
  const currentTime = (): number => timestamp(now(), 'patch clock');

  return Object.freeze({
    async propose(files: readonly PatchFileProposal[], baseShaInput: string): Promise<PatchProposal> {
      const baseSha = safeSha(baseShaInput, 'patch base SHA');
      if (!Array.isArray(files) || files.length === 0 || files.length > maxFiles || files.some((_, index) => !Object.prototype.hasOwnProperty.call(files, index))) throw new CodingRuntimeError('invalid-input', 'patch file count is outside its bound');
      let totalBytes = 0;
      const normalized = files.map((file, index) => {
        const record = exactObject(file, 'patch file ' + index);
        exactKeys(record, ['path', 'expectedSha256', 'replacement'], 'patch file');
        const path = boundedText(file.path, 'patch file path', 4096);
        if (pathIsAbsolute(path)) throw new CodingRuntimeError('path-denied', 'patch path must be relative');
        const expectedSha256 = safeHash(file.expectedSha256, 'patch expected hash');
        const replacement = boundedText(file.replacement, 'patch replacement', maxBytes);
        totalBytes += textBytes(replacement);
        if (totalBytes > maxBytes) throw new CodingRuntimeError('invalid-input', 'patch byte bound exceeded');
        return Object.freeze({ path, expectedSha256, replacement });
      });
      const seen = new Set<string>();
      for (const file of normalized) {
        if (seen.has(file.path)) throw new CodingRuntimeError('invalid-input', 'patch contains duplicate paths');
        seen.add(file.path);
      }
      const publicFiles = Object.freeze(normalized.map((file) => Object.freeze({
        path: file.path,
        expectedSha256: file.expectedSha256,
        replacementSha256: sha256(file.replacement),
        replacementBytes: textBytes(file.replacement),
      })));
      const core = { repositoryId: repository.repositoryId, baseSha, files: publicFiles, maxFiles, maxBytes, binaryRejected: true as const };
      const proposal = Object.freeze({
        format: FURY_PATCH_PROPOSAL_FORMAT,
        proposalId: 'ppr_' + randomUUID(),
        ...core,
        proposalSha256: sha256(JSON.stringify(core)),
        executionAuthority: false as const,
      });
      PROPOSAL_STATE.set(proposal, Object.freeze({ repository, files: Object.freeze(normalized), proposal }));
      return proposal;
    },
    async authorize(proposal: PatchProposal, ttlMs = permitTtlMs): Promise<PatchPermit> {
      const state = PROPOSAL_STATE.get(proposal as unknown as object);
      if (!state || state.repository !== repository) throw new CodingRuntimeError('permit-invalid', 'patch proposal is not bound to this repository');
      const ttl = option(ttlMs, permitTtlMs, 1, permitTtlMs, 'patch permit TTL');
      const issuedAt = currentTime();
      const expiresAt = issuedAt + ttl;
      const permit = Object.freeze({
        format: FURY_PATCH_PERMIT_FORMAT,
        permitId: 'pmt_' + randomUUID(),
        proposalSha256: state.proposal.proposalSha256,
        repositoryId: repository.repositoryId,
        baseSha: state.proposal.baseSha,
        issuedAt, expiresAt,
        executionAuthority: false as const,
      });
      PERMIT_STATE.set(permit, { proposal: state, issuedAt, expiresAt, consumed: false });
      return permit;
    },
    async apply(permit: PatchPermit): Promise<PatchReceipt> {
      const state = PERMIT_STATE.get(permit as unknown as object);
      if (!state) throw new CodingRuntimeError('permit-invalid', 'patch permit is not process-local evidence');
      if (state.consumed) throw new CodingRuntimeError('permit-consumed', 'patch permit was already consumed');
      state.consumed = true;
      if (currentTime() > state.expiresAt) throw new CodingRuntimeError('permit-expired', 'patch permit has expired');
      const startedAt = currentTime();
      const common = {
        format: FURY_PATCH_RECEIPT_FORMAT,
        receiptId: 'prc_' + randomUUID(),
        permitIdSha256: sha256('permit:' + permit.permitId),
        proposalSha256: state.proposal.proposal.proposalSha256,
        repositoryId: repository.repositoryId,
        baseSha: state.proposal.proposal.baseSha,
        startedAt,
        executionAuthority: false as const,
      };
      const finish = (input: Omit<PatchReceipt, keyof typeof common>): PatchReceipt => Object.freeze({ ...common, ...input });
      let head: string;
      try {
        head = await options.currentHeadSha();
      } catch {
        return finish({ finishedAt: currentTime(), outcome: 'failed', appliedFiles: 0, appliedBytes: 0, changedFileSha256: Object.freeze([]), verificationStatus: 'not-verified', errorCode: 'stale-base' });
      }
      if (head !== state.proposal.proposal.baseSha) {
        return finish({ finishedAt: currentTime(), outcome: 'failed', appliedFiles: 0, appliedBytes: 0, changedFileSha256: Object.freeze([]), verificationStatus: 'not-verified', errorCode: 'stale-base', finalHeadSha: head });
      }
      const targets: { readonly path: string; readonly absolute: string; readonly replacement: Uint8Array; readonly expectedSha256: string }[] = [];
      let replacementBytes = 0;
      try {
        for (const file of state.proposal.files) {
          const absolute = await options.sandbox.resolveWritePath(file.path);
          const original = await options.sandbox.readFile(file.path);
          if (!isText(original)) {
            return finish({ finishedAt: currentTime(), outcome: 'failed', appliedFiles: 0, appliedBytes: 0, changedFileSha256: Object.freeze([]), verificationStatus: 'not-verified', errorCode: 'binary-rejected' });
          }
          if (sha256(original) !== file.expectedSha256) {
            return finish({ finishedAt: currentTime(), outcome: 'failed', appliedFiles: 0, appliedBytes: 0, changedFileSha256: Object.freeze([]), verificationStatus: 'not-verified', errorCode: 'stale-file' });
          }
          const replacement = new TextEncoder().encode(file.replacement);
          replacementBytes += replacement.byteLength;
          if (replacementBytes > state.proposal.proposal.maxBytes) throw new CodingRuntimeError('invalid-input', 'patch byte bound exceeded');
          targets.push(Object.freeze({ path: file.path, absolute, replacement, expectedSha256: file.expectedSha256 }));
        }
      } catch (error) {
        if (error instanceof CodingRuntimeError && error.code === 'path-denied') throw error;
        return finish({ finishedAt: currentTime(), outcome: 'failed', appliedFiles: 0, appliedBytes: 0, changedFileSha256: Object.freeze([]), verificationStatus: 'not-verified', errorCode: 'conflict' });
      }
      let appliedFiles = 0;
      let appliedBytes = 0;
      const changed = new Array<string>();
      try {
        for (const target of targets) {
          const current = new Uint8Array(await readFile(target.absolute));
          if (sha256(current) !== target.expectedSha256) {
            return finish({ finishedAt: currentTime(), outcome: appliedFiles === 0 ? 'failed' : 'outcome-unknown', appliedFiles, appliedBytes, changedFileSha256: Object.freeze(changed), verificationStatus: 'not-verified', errorCode: 'conflict' });
          }
          await atomicWrite(target.absolute, target.replacement);
          appliedFiles += 1;
          appliedBytes += target.replacement.byteLength;
          changed.push(sha256(target.replacement));
        }
      } catch {
        return finish({ finishedAt: currentTime(), outcome: appliedFiles === 0 ? 'failed' : 'outcome-unknown', appliedFiles, appliedBytes, changedFileSha256: Object.freeze(changed), verificationStatus: 'not-verified', errorCode: 'write-failed' });
      }
      const finalHead = await options.currentHeadSha().catch(() => undefined);
      if (finalHead === undefined || finalHead !== state.proposal.proposal.baseSha) {
        return finish({
          finishedAt: currentTime(),
          outcome: 'outcome-unknown',
          appliedFiles,
          appliedBytes,
          changedFileSha256: Object.freeze(changed),
          verificationStatus: 'not-verified',
          errorCode: 'conflict',
          ...(finalHead === undefined ? {} : { finalHeadSha: finalHead }),
        });
      }
      return finish({
        finishedAt: currentTime(),
        outcome: 'succeeded',
        appliedFiles,
        appliedBytes,
        changedFileSha256: Object.freeze(changed),
        verificationStatus: 'locally-verified',
        ...(finalHead === undefined ? {} : { finalHeadSha: finalHead }),
      });
    },
  });
}

function pathIsAbsolute(value: string): boolean {
  return value.startsWith('/') || value.startsWith('\\\\') || value.startsWith('//') || /^[A-Za-z]:[\\/]/u.test(value);
}
