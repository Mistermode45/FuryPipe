import { fileURLToPath } from 'node:url';

import {
  deriveMcpDirectEndpointFingerprint,
  probeMcpDirectInventory,
  type McpDirectRuntimeConfig,
} from '../../src/mcp-direct-client-node.js';
import {
  createMcpDirectExecutionPermit,
  consumeMcpDirectExecutionPermit,
} from '../../src/mcp-direct-governance.js';
import {
  approveMcpDirectPolicyDecision,
  createMcpDirectToolProposal,
  evaluateMcpDirectPolicy,
  selectMcpDirectTool,
  type McpDirectPolicy,
} from '../../src/mcp-direct-policy.js';
import {
  reserveMcpDirectExecutionAttempt,
} from '../../src/mcp-direct-replay-internal.js';
import {
  armMcpDirectDurableExecution,
  createMcpDirectDurableReplayCoordinatorInternal,
  reserveMcpDirectDurableExecution,
} from '../../src/mcp-direct-durable-replay-internal.js';
import { createRecoveryStore } from '../../src/core/recovery-store.js';

interface WorkerRequest {
  readonly root: string;
  readonly counterPath: string;
}

const request = JSON.parse(process.argv[2] ?? '') as WorkerRequest;
const serverPath = fileURLToPath(
  new URL('./mcp-direct-execution-stdio-server.mjs', import.meta.url),
);

const provisional: McpDirectRuntimeConfig = {
  source: {
    sourceId: 'm5-restart-stdio-fixture',
    transport: 'stdio',
    endpointFingerprint: '0'.repeat(64),
    trust: 'trusted',
  },
  command: process.execPath,
  args: [serverPath, request.counterPath],
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
  clientInfo: { name: 'furypipe-m5-crash-worker', version: '1.0.0' },
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

const now = Date.now();
const permit = createMcpDirectExecutionPermit(
  approved,
  proposal.inputSha256,
  { now, expiresInMs: 30_000 },
);
const replayReservation = reserveMcpDirectExecutionAttempt(
  approved,
  proposal,
  undefined,
  now,
);
const store = createRecoveryStore(request.root, {
  namespace: 'mcp-m5-restart',
});
const coordinator = createMcpDirectDurableReplayCoordinatorInternal({
  store,
  tenantId: 'tenant-m5-restart',
  principalId: 'principal-m5-restart',
});
const durableReservation = await reserveMcpDirectDurableExecution(
  coordinator,
  replayReservation.replayKeySha256,
  { now, leaseMs: 30_000 },
);
consumeMcpDirectExecutionPermit(
  approved,
  permit,
  proposal.inputSha256,
  now,
);
const armed = await armMcpDirectDurableExecution(
  coordinator,
  durableReservation,
  now + 1,
);

await new Promise<void>((resolveWrite, rejectWrite) => {
  process.stdout.write(JSON.stringify({
    replayKeySha256: replayReservation.replayKeySha256,
    scopeSha256: coordinator.scopeSha256,
    armedRecordSha256: armed.armedRecordSha256,
    attempt: armed.attempt,
  }) + '\n', (error) => {
    if (error) rejectWrite(error);
    else resolveWrite();
  });
});

process.kill(process.pid, 'SIGKILL');
