import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  createMcpDirectDagPlan,
  executeMcpDirectDag,
  type McpDirectDagNode,
  type McpDirectDagPlan,
} from '../src/mcp-direct-dag-orchestration.js';

const quotas = {
  maxNodes: 16,
  maxEdges: 32,
  maxDepth: 8,
  maxFanIn: 8,
  maxFanOut: 8,
  maxPlanBytes: 32_768,
  maxNodeInputBytes: 4_096,
  maxAggregateOutputBytes: 16_384,
  maxWallClockMs: 30_000,
  maxConcurrentNodes: 4,
  maxRecoveryEvidence: 64,
} as const;

function node(id: string, dependencies: string[] = [], extra: Partial<McpDirectDagNode> = {}): McpDirectDagNode {
  return {
    id,
    capability: `capability:${id}`,
    toolName: `tool:${id}`,
    riskClass: 'closed_world_read',
    dependencies,
    inputRefs: [],
    ...extra,
  };
}

function plan(nodes: McpDirectDagNode[], overrides: Partial<typeof quotas> = {}): McpDirectDagPlan {
  return createMcpDirectDagPlan({ formatVersion: 1, nodes, quotas: { ...quotas, ...overrides } });
}

describe('MCP direct multi-call DAG orchestration', () => {
  it('creates deterministic content-addressed identity and deterministic topology', () => {
    const a = plan([node('b', ['a']), node('a')]);
    const b = plan([node('a'), node('b', ['a'])]);
    expect(a.digest).toBe(b.digest);
    expect(a.topologicalOrder).toEqual(['a', 'b']);
    expect(a.nodes.map((entry) => entry.nodeId)).toEqual(b.nodes.map((entry) => entry.nodeId));
  });

  it.each([
    [['a', 'b'], 'cycle'],
    [['a', 'a'], 'self-edge'],
  ])('rejects %s topology', (_ids, _label) => {
    const invalid = _label === 'cycle'
      ? [node('a', ['b']), node('b', ['a'])]
      : [node('a', ['a'])];
    expect(() => plan(invalid)).toThrow(/cycle|self-edge/i);
  });

  it('rejects duplicate edges, missing dependencies, and duplicate node ids', () => {
    expect(() => plan([node('a'), node('b', ['a', 'a'])])).toThrow(/duplicate edge/i);
    expect(() => plan([node('a'), node('b', ['missing'])])).toThrow(/dependency/i);
    expect(() => plan([node('a'), node('a')])).toThrow(/duplicate node/i);
  });

  it('enforces bounded graph quotas before execution', () => {
    expect(() => plan([node('a'), node('b'), node('c')], { maxNodes: 2 })).toThrow(/node quota/i);
    expect(() => plan([node('a'), node('b', ['a']), node('c', ['b'])], { maxDepth: 2 })).toThrow(/depth quota/i);
    expect(() => plan([node('a'), node('b', ['a']), node('c', ['a'])], { maxFanOut: 1 })).toThrow(/fan-out quota/i);
    expect(() => plan([node('a', [], { inputBytes: 10_000 })], { maxNodeInputBytes: 1_000 })).toThrow(/input quota/i);
    expect(() => plan([
      node('a', [], { outputBytes: 800 }),
      node('b', [], { outputBytes: 400 }),
    ], { maxAggregateOutputBytes: 1_000 })).toThrow(/aggregate output quota/i);
  });

  it('accepts only exact dependency output references', () => {
    expect(() => plan([
      node('a'),
      node('b', ['a'], { inputRefs: [{ name: 'value', nodeId: 'a', output: 'result' }] }),
    ])).not.toThrow();
    expect(() => plan([
      node('a'),
      node('b', ['a'], { inputRefs: [{ name: 'value', nodeId: 'a', output: 'missing' }] }),
    ])).toThrow(/output reference/i);
  });

  it('rejects mutable ambient inputs and ungoverned open-world nodes', () => {
    expect(() => plan([node('a', [], { ambientInput: 'env' as never })])).toThrow(/ambient/i);
    expect(() => plan([node('a', [], { riskClass: 'open_world' })])).toThrow(/open-world/i);
  });

  it('executes independent nodes and releases dependents only after verified outputs', async () => {
    const dag = plan([
      node('c', ['a', 'b'], { inputRefs: [
        { name: 'aResult', nodeId: 'a', output: 'result' },
        { name: 'bResult', nodeId: 'b', output: 'result' },
      ] }),
      node('a'),
      node('b'),
    ]);
    const order: string[] = [];
    const authorize = vi.fn(async (entry: McpDirectDagNode) => ({
      approvalId: `approval-${entry.id}`,
      permitId: `permit-${entry.id}`,
      expiresAt: Date.now() + 30_000,
    }));
    const execute = vi.fn(async (entry: McpDirectDagNode) => {
      order.push(entry.id);
      return { outcome: 'succeeded' as const, outputDigest: `digest-${entry.id}`, verified: true };
    });
    const result = await executeMcpDirectDag(dag, {
      authorizeNode: authorize,
      executeNode: execute,
    });
    expect(result.state).toBe('succeeded');
    expect(order.indexOf('c')).toBeGreaterThan(order.indexOf('a'));
    expect(order.indexOf('c')).toBeGreaterThan(order.indexOf('b'));
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('never transfers predecessor authority or output into a permit', async () => {
    const dag = plan([node('a'), node('b', ['a'], {
      inputRefs: [{ name: 'input', nodeId: 'a', output: 'result' }],
    })]);
    const received: unknown[] = [];
    await executeMcpDirectDag(dag, {
      authorizeNode: async (entry, context) => {
        received.push({ entry, context });
        return { approvalId: 'fresh', permitId: 'fresh', expiresAt: Date.now() + 30_000 };
      },
      executeNode: async (entry, authority, context) => {
        expect(authority.permitId).toBe('fresh');
        expect(context.inputs).not.toHaveProperty('permitId');
        return { outcome: 'succeeded', outputDigest: `digest-${entry.id}`, verified: true };
      },
    });
    expect(received).toHaveLength(2);
    expect(received[1]).not.toEqual(received[0]);
  });

  it('blocks descendants after failure and never reports partial execution as DAG success', async () => {
    const dag = plan([node('a'), node('b', ['a'])]);
    const execute = vi.fn(async (entry: McpDirectDagNode) => ({
      outcome: entry.id === 'a' ? 'tool_error' as const : 'succeeded' as const,
      outputDigest: `digest-${entry.id}`,
      verified: entry.id !== 'a',
    }));
    const result = await executeMcpDirectDag(dag, {
      authorizeNode: async () => ({ approvalId: 'a', permitId: 'p', expiresAt: Date.now() + 30_000 }),
      executeNode: execute,
    });
    expect(result.state).toBe('failed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.nodes.b?.state).toBe('blocked');
  });

  it('blocks descendants after unknown or verification failure', async () => {
    for (const outcome of ['unknown', 'verification_failed'] as const) {
      const dag = plan([node('a'), node('b', ['a'])]);
      const result = await executeMcpDirectDag(dag, {
        authorizeNode: async () => ({ approvalId: 'a', permitId: 'p', expiresAt: Date.now() + 30_000 }),
        executeNode: async () => ({ outcome, outputDigest: 'x', verified: false }),
      });
      expect(result.state).not.toBe('succeeded');
      expect(result.nodes.b?.state).toBe('blocked');
    }
  });

  it('fails closed when permit is expired before admission and makes no wire call', async () => {
    const execute = vi.fn();
    const result = await executeMcpDirectDag(plan([node('a')]), {
      now: () => 10,
      authorizeNode: async () => ({ approvalId: 'a', permitId: 'p', expiresAt: 9 }),
      executeNode: execute,
    });
    expect(result.state).toBe('expired');
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not auto-retry, replay, or resume an incomplete node', async () => {
    const execute = vi.fn(async () => ({ outcome: 'unknown' as const, verified: false }));
    const result = await executeMcpDirectDag(plan([node('a')]), {
      authorizeNode: async () => ({ approvalId: 'a', permitId: 'p', expiresAt: Date.now() + 30_000 }),
      executeNode: execute,
    });
    expect(result.retryable).toBe(false);
    expect(result.state).toBe('unknown');
  });

  it('cancellation never lies about a node already sent to the remote', async () => {
    const result = await executeMcpDirectDag(plan([node('a')]), {
      authorizeNode: async () => ({ approvalId: 'a', permitId: 'p', expiresAt: Date.now() + 30_000 }),
      executeNode: async () => ({ outcome: 'unknown', verified: false, wireCallStarted: true }),
      signal: AbortSignal.abort(),
    });
    expect(result.state).toBe('cancelled');
    expect(result.nodes.a?.wireCallStarted).toBe(false);
  });
});

describe('M6 durable admission boundary', () => {
  it('uses atomic RecoveryStore admission to prevent duplicate node execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-m6-dag-'));
    const store = createRecoveryStore(root, {
      namespace: 'mcp-direct-dag',
      maxObjectBytes: 64 * 1024,
      maxTotalBytes: 512 * 1024,
      maxGlobalBytes: 1024 * 1024,
    });
    const dag = plan([node('a')]);
    const scopeSha256 = 'a'.repeat(64);
    const runIdSha256 = 'b'.repeat(64);
    let wireCalls = 0;
    const options = () => ({
      recoveryStore: store,
      scopeSha256,
      runIdSha256,
      authorizeNode: async () => ({ approvalId: 'fresh-a', permitId: 'fresh-p', expiresAt: Date.now() + 30_000 }),
      executeNode: async () => {
        wireCalls += 1;
        return { outcome: 'succeeded' as const, outputDigest: 'c'.repeat(64), verified: true };
      },
    });
    try {
      const first = await executeMcpDirectDag(dag, options());
      const second = await executeMcpDirectDag(dag, options());
      expect(first.state).toBe('succeeded');
      expect(second.state).toBe('unknown');
      expect(second.nodes.a?.errorCode).toBe('durability-failed-before-execution');
      expect(wireCalls).toBe(1);
      const records = await store.list?.({ metadata: {
        system: 'mcp-direct-dag',
        scopeSha256,
        runIdSha256,
        planDigest: dag.digest,
      }});
      expect(records).toHaveLength(2);
      const serialized = JSON.stringify(records);
      expect(serialized).not.toContain('fresh-a');
      expect(serialized).not.toContain('fresh-p');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serializes concurrent schedulers at the node admission boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-m6-dag-race-'));
    const store = createRecoveryStore(root, {
      namespace: 'mcp-direct-dag',
      maxObjectBytes: 64 * 1024,
      maxTotalBytes: 512 * 1024,
      maxGlobalBytes: 1024 * 1024,
    });
    const dag = plan([node('a')]);
    let wireCalls = 0;
    const makeOptions = () => ({
      recoveryStore: store,
      scopeSha256: 'd'.repeat(64),
      runIdSha256: 'e'.repeat(64),
      authorizeNode: async () => ({ approvalId: 'fresh', permitId: 'permit', expiresAt: Date.now() + 30_000 }),
      executeNode: async () => {
        wireCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { outcome: 'succeeded' as const, outputDigest: 'f'.repeat(64), verified: true };
      },
    });
    try {
      const [one, two] = await Promise.all([
        executeMcpDirectDag(dag, makeOptions()),
        executeMcpDirectDag(dag, makeOptions()),
      ]);
      expect([one.state, two.state].sort()).toEqual(['succeeded', 'unknown']);
      expect(wireCalls).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('M6 real MCP v2 integration', () => {
  it('executes a diamond A/B -> C through fresh M1-M5 authority for every node', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-m6-real-mcp-'));
    const fixturePath = fileURLToPath(new URL('./fixtures/mcp-direct-execution-stdio-server.mjs', import.meta.url));
    const store = createRecoveryStore(root, {
      namespace: 'mcp-direct-dag',
      maxObjectBytes: 64 * 1024,
      maxTotalBytes: 2 * 1024 * 1024,
      maxGlobalBytes: 4 * 1024 * 1024,
    });
    const dag = plan([
      node('c', ['a', 'b'], { inputRefs: [
        { name: 'a', nodeId: 'a', output: 'result' },
        { name: 'b', nodeId: 'b', output: 'result' },
      ] }),
      node('a'),
      node('b'),
    ]);
    const freshAuthorities: string[] = [];
    const governedByNode = new Map<string, {
      readonly config: McpDirectRuntimeConfig;
      readonly proposal: Awaited<ReturnType<typeof createMcpDirectToolProposal>>;
      readonly approved: Awaited<ReturnType<typeof approveMcpDirectPolicyDecision>>;
    }>();
    try {
      const result = await executeMcpDirectDag(dag, {
        recoveryStore: store,
        scopeSha256: '1'.repeat(64),
        runIdSha256: '2'.repeat(64),
        authorizeNode: async (entry) => {
          freshAuthorities.push(entry.id);
          const counterPath = join(root, `${entry.id}.counter`);
          const provisional: McpDirectRuntimeConfig = {
            source: {
              sourceId: `m6-${entry.id}`,
              transport: 'stdio',
              endpointFingerprint: '0'.repeat(64),
              trust: 'trusted',
            },
            command: process.execPath,
            args: [fixturePath, counterPath],
            maxBufferBytes: 1024 * 1024,
          };
          const config: McpDirectRuntimeConfig = {
            ...provisional,
            source: {
              ...provisional.source,
              endpointFingerprint: deriveMcpDirectEndpointFingerprint(provisional),
            },
          };
          const inventory = await probeMcpDirectInventory(config, {
            clientInfo: { name: 'furypipe-m6-dag', version: '1.0.0' },
            connectTimeoutMs: 10_000,
            listTimeoutMs: 10_000,
            probeTimeoutMs: 2_000,
          });
          const selected = selectMcpDirectTool(inventory.lifecycle, 'governed-echo');
          const proposal = await createMcpDirectToolProposal(selected, inventory.catalog, { message: entry.id });
          const policy = {
            format: 'furypipe-mcp-direct-policy/v1' as const,
            policyId: `m6-policy-${entry.id}`,
            governedPolicyAllowlist: [{
              sourceId: selected.source.sourceId,
              endpointFingerprint: selected.source.endpointFingerprint,
              toolName: 'governed-echo',
            }],
            operatorApprovalAllowlist: [],
          };
          const decision = evaluateMcpDirectPolicy(selected, proposal, policy);
          const approved = approveMcpDirectPolicyDecision(selected, proposal, decision, 'governed_policy');
          governedByNode.set(entry.id, {
            config,
            proposal,
            approved,
          });
          return {
            approvalId: entry.nodeId,
            permitId: entry.nodeId,
            expiresAt: Date.now() + 30_000,
          };
        },
        executeNode: async (entry) => {
          const governed = governedByNode.get(entry.id);
          if (!governed) throw new Error('fresh governed node material missing');
          const executed = await executeMcpDirectApprovedTool(
            governed.config,
            governed.approved,
            governed.proposal,
            {
              clientInfo: { name: 'furypipe-m6-dag', version: '1.0.0' },
              callTimeoutMs: 10_000,
            },
          );
          return {
            outcome: 'succeeded',
            outputDigest: createHash('sha256').update(JSON.stringify(executed.result)).digest('hex'),
            verified: executed.receipt.verified,
          };
        },
      });
      expect(result.state, JSON.stringify(result)).toBe('succeeded');
      expect(freshAuthorities).toEqual(['a', 'b', 'c']);
      expect(Object.values(result.nodes).every((entry) => entry.verified)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('M6 OS process recovery boundary', () => {
  it('admits one node across two real OS schedulers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-m6-dag-os-'));
    const worker = fileURLToPath(new URL('./fixtures/mcp-direct-dag-race-worker.ts', import.meta.url));
    const tsx = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const run = (marker: string) => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [tsx, worker, JSON.stringify({ root, marker })], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.on('data', (chunk: string) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
    });
    try {
      await Promise.all([
        run(join(root, 'wire-a')),
        run(join(root, 'wire-b')),
      ]);
      const files = await readdir(root);
      expect(files.filter((file) => file.startsWith('wire-'))).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
