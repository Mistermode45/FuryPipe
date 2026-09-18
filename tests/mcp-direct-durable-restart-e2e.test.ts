import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  deriveMcpDirectEndpointFingerprint,
  probeMcpDirectInventory,
  type McpDirectRuntimeConfig,
} from '../src/mcp-direct-client-node.js';
import {
  executeMcpDirectApprovedTool,
} from '../src/mcp-direct-executor-node.js';
import {
  createMcpDirectDurableReplayCoordinator,
  inspectMcpDirectDurableReplayStatus,
} from '../src/mcp-direct-durable-replay-node.js';
import {
  approveMcpDirectPolicyDecision,
  createMcpDirectToolProposal,
  evaluateMcpDirectPolicy,
  selectMcpDirectTool,
  type McpDirectPolicy,
} from '../src/mcp-direct-policy.js';
import { resetMcpDirectReplayStateForTests } from '../src/mcp-direct-replay-internal.js';

interface CrashWorkerResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runCrashWorker(
  root: string,
  counterPath: string,
): Promise<CrashWorkerResult> {
  const worker = fileURLToPath(
    new URL('./fixtures/mcp-direct-durable-armed-crash-worker.ts', import.meta.url),
  );
  const tsx = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const child = spawn(
    process.execPath,
    [tsx, worker, JSON.stringify({ root, counterPath })],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const [code] = await once(child, 'close') as [number | null, NodeJS.Signals | null];
  return {
    code: code ?? -1,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

async function runReservationRaceWorker(root: string): Promise<{ readonly ok: boolean; readonly code?: string }> {
  const worker = fileURLToPath(
    new URL('./fixtures/mcp-direct-durable-reservation-race-worker.ts', import.meta.url),
  );
  const tsx = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const child = spawn(
    process.execPath,
    [tsx, worker, JSON.stringify({ root })],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const [code] = await once(child, 'close') as [number | null, NodeJS.Signals | null];
  expect(code).toBe(0);
  expect(stderr.trim()).toBe('');
  return JSON.parse(stdout.trim()) as { readonly ok: boolean; readonly code?: string };
}

function config(counterPath: string): McpDirectRuntimeConfig {
  const serverPath = fileURLToPath(
    new URL('./fixtures/mcp-direct-execution-stdio-server.mjs', import.meta.url),
  );
  const provisional: McpDirectRuntimeConfig = {
    source: {
      sourceId: 'm5-restart-stdio-fixture',
      transport: 'stdio',
      endpointFingerprint: '0'.repeat(64),
      trust: 'trusted',
    },
    command: process.execPath,
    args: [serverPath, counterPath],
    maxBufferBytes: 1024 * 1024,
  };
  return {
    ...provisional,
    source: {
      ...provisional.source,
      endpointFingerprint: deriveMcpDirectEndpointFingerprint(provisional),
    },
  };
}

async function approvedFlow(runtime: McpDirectRuntimeConfig) {
  const inventory = await probeMcpDirectInventory(runtime, {
    clientInfo: { name: 'furypipe-m5-restart-parent', version: '1.0.0' },
    connectTimeoutMs: 10_000,
    listTimeoutMs: 10_000,
    probeTimeoutMs: 2_000,
  });
  const selected = selectMcpDirectTool(inventory.lifecycle, 'governed-echo');
  const proposal = await createMcpDirectToolProposal(
    selected,
    inventory.catalog,
    { message: 'M5_CRASH_RESTART_E2E' },
  );
  const policy: McpDirectPolicy = {
    format: 'furypipe-mcp-direct-policy/v1',
    policyId: 'm5-crash-restart-policy',
    governedPolicyAllowlist: [{
      sourceId: selected.source.sourceId,
      endpointFingerprint: selected.source.endpointFingerprint,
      toolName: 'governed-echo',
    }],
    operatorApprovalAllowlist: [],
  };
  const decision = evaluateMcpDirectPolicy(selected, proposal, policy);
  const approved = approveMcpDirectPolicyDecision(
    selected,
    proposal,
    decision,
    'governed_policy',
  );
  return { approved, proposal };
}

describe('Direct MCP M5 real process restart', () => {
  it('blocks a second real v2 stdio call after a process dies with durable armed evidence', async () => {
    resetMcpDirectReplayStateForTests();
    const root = await mkdtemp(join(tmpdir(), 'furypipe-m5-real-restart-'));
    const counterPath = join(root, 'tool-calls.txt');
    try {
      const crashed = await runCrashWorker(root, counterPath);
      expect(crashed.code).not.toBe(0);
      expect(crashed.stderr).toBe('');

      const workerEvidence = JSON.parse(crashed.stdout) as {
        readonly replayKeySha256: string;
        readonly scopeSha256: string;
        readonly armedRecordSha256: string;
        readonly attempt: number;
      };
      expect(workerEvidence).toMatchObject({
        replayKeySha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        scopeSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        armedRecordSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        attempt: 1,
      });

      const store = createRecoveryStore(root, {
        namespace: 'mcp-m5-restart',
      });
      const coordinator = createMcpDirectDurableReplayCoordinator({
        store,
        tenantId: 'tenant-m5-restart',
        principalId: 'principal-m5-restart',
      });
      expect(coordinator.scopeSha256).toBe(workerEvidence.scopeSha256);
      await expect(inspectMcpDirectDurableReplayStatus(
        coordinator,
        workerEvidence.replayKeySha256,
      )).resolves.toMatchObject({
        state: 'armed',
        attempt: 1,
        replayed: false,
      });

      const runtime = config(counterPath);
      const flow = await approvedFlow(runtime);

      await expect(executeMcpDirectApprovedTool(
        runtime,
        flow.approved,
        flow.proposal,
        {
          clientInfo: { name: 'furypipe-m5-restart-parent', version: '1.0.0' },
          connectTimeoutMs: 10_000,
          listTimeoutMs: 10_000,
          callTimeoutMs: 10_000,
          probeTimeoutMs: 2_000,
          durableReplay: coordinator,
        },
      )).rejects.toMatchObject({
        name: 'McpDirectDurableReplayError',
        code: 'durable-state-conflict',
        retrySafe: false,
      });

      let calls = 0;
      try {
        const raw = (await readFile(counterPath, 'utf8')).trim();
        calls = raw === '' ? 0 : Number.parseInt(raw, 10);
      } catch (caught) {
        if ((caught as NodeJS.ErrnoException).code !== 'ENOENT') throw caught;
      }
      expect(calls).toBe(0);

      await expect(inspectMcpDirectDurableReplayStatus(
        coordinator,
        workerEvidence.replayKeySha256,
      )).resolves.toMatchObject({
        state: 'armed',
        attempt: 1,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 45_000);
});
