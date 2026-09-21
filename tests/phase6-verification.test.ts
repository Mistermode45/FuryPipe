import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCodingProcessRuntime, createCodingSandbox } from '../src/coding-runtime.js';
import { createVerificationCoordinator } from '../src/phase6-verification.js';

describe('Phase 6 verification coordinator', () => {
  it('distinguishes process success from verification acceptance and never retries unknown outcomes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-phase6-verification-'));
    try {
      const sandbox = await createCodingSandbox({
        policyId: 'verification-test',
        rootPath: root,
        readRoots: ['.'],
        writeRoots: ['.'],
        allowedCommands: ['node'],
        maxTimeoutMs: 2000,
      });
      const processRuntime = createCodingProcessRuntime({ sandbox });
      let executions = 0;
      const coordinator = createVerificationCoordinator({
        authorize: (request) => processRuntime.authorize(request),
        execute: async (permit) => {
          executions += 1;
          return processRuntime.execute(permit);
        },
      });
      const receipts = await coordinator.run([
        {
          caseId: 'exit-only',
          classification: 'unit',
          request: { command: 'node', args: ['-e', 'process.stdout.write("phase6")'], cwd: '.' },
          requiredStdoutMarker: 'phase6',
        },
        {
          caseId: 'explicit-acceptance',
          classification: 'integration',
          request: { command: 'node', args: ['-e', 'process.stdout.write("phase6")'], cwd: '.' },
          accept: (result) => result.stdout === 'phase6',
        },
        {
          caseId: 'outcome-unknown',
          classification: 'e2e',
          request: { command: 'node', args: ['-e', 'setTimeout(() => {}, 1000)'], cwd: '.', timeoutMs: 20 },
        },
      ]);

      expect(receipts).toHaveLength(3);
      expect(receipts[0]).toMatchObject({ lifecycle: 'passed', passed: true, verificationAccepted: false, reason: 'output-marker' });
      expect(receipts[1]).toMatchObject({ lifecycle: 'accepted', passed: true, verificationAccepted: true, reason: 'explicit-verifier' });
      expect(receipts[2]).toMatchObject({ lifecycle: 'outcome-unknown', passed: false, verificationAccepted: false, reason: 'outcome-unknown' });
      expect(executions).toBe(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects duplicate case IDs before creating an ambiguous evidence sequence', async () => {
    const coordinator = createVerificationCoordinator({
      authorize: async () => { throw new Error('must not authorize'); },
      execute: async () => { throw new Error('must not execute'); },
    });
    const request = { command: 'node', args: [], cwd: '.' } as const;
    await expect(coordinator.run([
      { caseId: 'duplicate', classification: 'unit', request },
      { caseId: 'duplicate', classification: 'unit', request },
    ])).rejects.toThrow(/unique/i);
  });
});
