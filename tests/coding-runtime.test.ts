import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CodingRuntimeError,
  createCodingProcessRuntime,
  createCodingSandbox,
  createCodingWorktreeManager,
  discoverCodingRepository,
  isGeneratedCodingWorktree,
  type CodingRepository,
  type GitWorktreeProvider,
} from '../src/coding-runtime.js';
import {
  createPatchEngine,
  discoverPatchRepository,
  isGeneratedPatchPermit,
  type PatchFileProposal,
} from '../src/patch-engine.js';

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function fixture(): Promise<{ readonly root: string; readonly repository: CodingRepository }> {
  const root = await mkdtemp(join(tmpdir(), 'furypipe-coding-runtime-'));
  await mkdir(join(root, '.git'));
  const repository = await discoverCodingRepository(root);
  return { root, repository };
}

describe('Phase 6 coding runtime', () => {
  it('rejects traversal, device syntax, symlink syntax, and non-allowlisted commands', async () => {
    const { root } = await fixture();
    try {
      const sandbox = await createCodingSandbox({
        policyId: 'sandbox-test',
        rootPath: root,
        readRoots: ['.'],
        writeRoots: ['.'],
        allowedCommands: ['node'],
        maxOutputBytes: 1024,
      });
      await expect(sandbox.resolveReadPath('../outside.txt')).rejects.toThrow(/sandbox root|path/i);
      await expect(sandbox.resolveReadPath('NUL')).rejects.toThrow(/reserved|device/i);
      await expect(sandbox.resolveReadPath('file.txt:secret')).rejects.toThrow(/device|alternate/i);

      const process = createCodingProcessRuntime({ sandbox });
      expect(() => createCodingProcessRuntime({ sandbox: { ...sandbox } })).toThrow(/process-local sandbox/i);
      await expect(process.authorize({
        command: 'cmd',
        args: ['/c', 'echo', 'bad'],
        cwd: '.',
      })).rejects.toThrow(/allowlisted/i);
      await expect(process.authorize({
        command: 'node',
        args: [],
        cwd: '.',
        unsupported: true,
      } as never)).rejects.toThrow(/unsupported fields/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('executes only bounded shell-free commands and redacts environment values', async () => {
    const { root } = await fixture();
    try {
      const sandbox = await createCodingSandbox({
        policyId: 'sandbox-process',
        rootPath: root,
        readRoots: ['.'],
        writeRoots: ['.'],
        environmentAllowlist: ['PATH', 'NODE_ENV', 'TEST_VALUE'],
        allowedCommands: ['node'],
        maxOutputBytes: 1024,
        maxTimeoutMs: 2000,
      });
      const process = createCodingProcessRuntime({ sandbox });
      const permit = await process.authorize({
        command: process.execPath ? 'node' : 'node',
        args: ['-e', 'process.stdout.write(process.env.TEST_VALUE)'],
        cwd: '.',
        environment: { TEST_VALUE: 'do-not-leak' },
      });
      expect(isGeneratedPatchPermit(permit)).toBe(false);
      const result = await process.execute(permit);
      expect(result.receipt).toMatchObject({
        outcome: 'succeeded',
        verificationStatus: 'not-verified',
      });
      expect(result.stdout).toBe('[redacted]');
      expect(result.receipt.stdoutSha256).toBe(sha256('[redacted]'));
      await expect(process.execute(permit)).rejects.toThrow(/already consumed/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks timeout and output overflow as outcome-unknown', async () => {
    const { root } = await fixture();
    try {
      const sandbox = await createCodingSandbox({
        policyId: 'sandbox-bounds',
        rootPath: root,
        readRoots: ['.'],
        writeRoots: ['.'],
        allowedCommands: ['node'],
        maxOutputBytes: 1024,
        maxTimeoutMs: 2000,
      });
      const process = createCodingProcessRuntime({ sandbox });
      const timeoutPermit = await process.authorize({
        command: 'node',
        args: ['-e', 'setTimeout(() => {}, 1000)'],
        cwd: '.',
        timeoutMs: 20,
      });
      const timeout = await process.execute(timeoutPermit);
      expect(timeout.receipt.outcome).toBe('outcome-unknown');
      expect(timeout.receipt.errorCode).toBe('timeout');

      const outputPermit = await process.authorize({
        command: 'node',
        args: ['-e', 'process.stdout.write("x".repeat(10000))'],
        cwd: '.',
      });
      const output = await process.execute(outputPermit);
      expect(output.receipt.outcome).toBe('outcome-unknown');
      expect(output.receipt.errorCode).toBe('output-limit');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('creates isolated worktree evidence and preserves provider repository identity', async () => {
    const { root, repository } = await fixture();
    const writableRoot = await mkdtemp(join(tmpdir(), 'furypipe-worktrees-'));
    const calls: string[] = [];
    const provider: GitWorktreeProvider = {
      async create(input) {
        calls.push(input.repository.rootPath);
        await mkdir(input.rootPath);
        return { headSha: input.baseSha };
      },
      async remove(input) {
        calls.push('remove:' + input.repository.rootPath);
        await rm(input.rootPath, { recursive: true, force: true });
      },
    };
    try {
      const manager = createCodingWorktreeManager({ provider });
      const worktree = await manager.create({
        repository,
        owner: 'operator-1',
        taskDigest: 'b'.repeat(64),
        baseSha: 'c'.repeat(40),
        branch: 'codex/phase6-test',
        writableRoot,
      });
      expect(isGeneratedCodingWorktree(worktree)).toBe(true);
      expect(worktree.status).toBe('ready');
      expect(calls[0]).toBe(repository.rootPath);
      expect(() => manager.inspect({ ...worktree })).toThrow(/process-local/i);
      await expect(manager.create({
        repository: { ...repository },
        owner: 'operator-1',
        taskDigest: 'b'.repeat(64),
        baseSha: 'c'.repeat(40),
        writableRoot,
      })).rejects.toThrow(/repository capability/i);
      const cleaned = await manager.cleanup(worktree);
      expect(cleaned.status).toBe('removed');
      expect(calls[1]).toBe('remove:' + repository.rootPath);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(writableRoot, { recursive: true, force: true });
    }
  });

  it('applies only exact-base, exact-file, text-only patch proposals', async () => {
    const { root } = await fixture();
    try {
      const repository = await discoverPatchRepository(root);
      const filePath = join(root, 'source.ts');
      await writeFile(filePath, 'export const value = 1;\n');
      const sandbox = await createCodingSandbox({
        policyId: 'sandbox-patch',
        rootPath: root,
        readRoots: ['.'],
        writeRoots: ['.'],
        allowedCommands: ['node'],
      });
      let head = 'd'.repeat(40);
      const engine = createPatchEngine({
        repository,
        sandbox,
        currentHeadSha: async () => head,
      });
      const file: PatchFileProposal = {
        path: 'source.ts',
        expectedSha256: sha256(await readFile(filePath)),
        replacement: 'export const value = 2;\n',
      };
      const proposal = await engine.propose([file], head);
      const permit = await engine.authorize(proposal);
      expect(isGeneratedPatchPermit(permit)).toBe(true);
      const receipt = await engine.apply(permit);
      expect(receipt).toMatchObject({
        outcome: 'succeeded',
        appliedFiles: 1,
        verificationStatus: 'locally-verified',
      });
      expect(await readFile(filePath, 'utf8')).toBe('export const value = 2;\n');
      await expect(engine.apply(permit)).rejects.toThrow(/already consumed/i);

      const concurrentPath = join(root, 'concurrent.ts');
      await writeFile(concurrentPath, 'export const concurrent = 1;\n');
      let conflictHeadReads = 0;
      const conflictEngine = createPatchEngine({
        repository,
        sandbox,
        currentHeadSha: async () => { conflictHeadReads += 1; return conflictHeadReads === 1 ? head : 'e'.repeat(40); },
      });
      const conflictProposal = await conflictEngine.propose([{
        path: 'concurrent.ts',
        expectedSha256: sha256(await readFile(concurrentPath)),
        replacement: 'export const concurrent = 2;\n',
      }], head);
      const conflictReceipt = await conflictEngine.apply(await conflictEngine.authorize(conflictProposal));
      expect(conflictReceipt).toMatchObject({ outcome: 'outcome-unknown', errorCode: 'conflict', appliedFiles: 1 });

      const staleFilePath = join(root, 'stale.ts');
      await writeFile(staleFilePath, 'export const stale = 1;\n');
      const staleFileProposal = await engine.propose([{
        path: 'stale.ts',
        expectedSha256: sha256(await readFile(staleFilePath)),
        replacement: 'export const stale = 2;\n',
      }], head);
      await writeFile(staleFilePath, 'export const stale = 9;\n');
      const staleFileReceipt = await engine.apply(await engine.authorize(staleFileProposal));
      expect(staleFileReceipt).toMatchObject({ outcome: 'failed', errorCode: 'stale-file' });

      const staleProposal = await engine.propose([{
        ...file,
        expectedSha256: sha256(await readFile(filePath)),
        replacement: 'export const value = 3;\n',
      }], head);
      head = 'e'.repeat(40);
      const staleReceipt = await engine.apply(await engine.authorize(staleProposal));
      expect(staleReceipt).toMatchObject({ outcome: 'failed', errorCode: 'stale-base' });

      const binaryPath = join(root, 'binary.bin');
      await writeFile(binaryPath, Buffer.from([0, 1, 2]));
      const binaryProposal = await engine.propose([{
        path: 'binary.bin',
        expectedSha256: sha256(new Uint8Array([0, 1, 2])),
        replacement: 'text',
      }], head);
      const binaryReceipt = await engine.apply(await engine.authorize(binaryProposal));
      expect(binaryReceipt.errorCode).toBe('binary-rejected');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a copied repository capability at patch boundary', async () => {
    const { root } = await fixture();
    try {
      const repository = await discoverPatchRepository(root);
      const sandbox = await createCodingSandbox({
        policyId: 'sandbox-copy',
        rootPath: root,
        writeRoots: ['.'],
        readRoots: ['.'],
        allowedCommands: ['node'],
      });
      expect(() => createPatchEngine({
        repository: { ...repository },
        sandbox,
        currentHeadSha: async () => 'a'.repeat(40),
      })).toThrow(/process-local/i);
      expect(() => createPatchEngine({
        repository,
        sandbox: { ...sandbox },
        currentHeadSha: async () => 'a'.repeat(40),
      })).toThrow(/process-local sandbox/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
