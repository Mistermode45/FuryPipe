import { writeFile } from 'node:fs/promises';
import { createRecoveryStore } from '../../src/core/recovery-store.js';
import { createMcpDirectDagPlan, executeMcpDirectDag } from '../../src/mcp-direct-dag-orchestration.js';

const input = JSON.parse(process.argv[2] ?? '{}') as { root: string; marker: string };
const quotas = {
  maxNodes: 4, maxEdges: 4, maxDepth: 4, maxFanIn: 4, maxFanOut: 4,
  maxPlanBytes: 16_384, maxNodeInputBytes: 1_024, maxAggregateOutputBytes: 4_096,
  maxWallClockMs: 10_000, maxConcurrentNodes: 1, maxRecoveryEvidence: 16,
} as const;
const plan = createMcpDirectDagPlan({
  formatVersion: 1,
  quotas,
  nodes: [{
    id: 'a', capability: 'capability:a', toolName: 'tool:a',
    riskClass: 'closed_world_read', dependencies: [], inputRefs: [],
  }],
});
const store = createRecoveryStore(input.root, {
  namespace: 'mcp-direct-dag',
  maxObjectBytes: 64 * 1024,
  maxTotalBytes: 512 * 1024,
  maxGlobalBytes: 1024 * 1024,
});
const result = await executeMcpDirectDag(plan, {
  recoveryStore: store,
  scopeSha256: '9'.repeat(64),
  runIdSha256: '8'.repeat(64),
  authorizeNode: async () => ({
    approvalId: 'opaque',
    permitId: 'opaque',
    expiresAt: Date.now() + 10_000,
  }),
  executeNode: async () => {
    await writeFile(input.marker, 'wire-call');
    return { outcome: 'succeeded', outputDigest: '7'.repeat(64), verified: true };
  },
});
console.log(JSON.stringify({ state: result.state }));
