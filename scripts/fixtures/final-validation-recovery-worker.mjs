import { open, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRecoveryStore } from '../../dist/core/recovery-store.js';
import { createFuryGatewayAutomationDefinitionStore } from '../../dist/gateway-automation-definition-node.js';
import { createFuryGatewayAutomationRunLedger } from '../../dist/gateway-automation-run-ledger-node.js';
import { createFuryGatewayAutomationScheduler } from '../../dist/gateway-automation-scheduler-node.js';

const [root, mode, evidencePath] = process.argv.slice(2);
if (!root || !mode || !evidencePath) throw new Error('root, mode and evidence path are required');

async function durableWrite(path, value) {
  const file = await open(path, 'w', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

if (mode === 'durable-put-kill') {
  const value = 'final-validation-durable-state-v1';
  const store = createRecoveryStore(root, { namespace: 'final-crash' });
  const handle = await store.put(new TextEncoder().encode(value), {
    source: 'final-validation-crash-worker',
    version: 1,
  });
  await durableWrite(evidencePath, { mode, handle, valueSha256: digest(value) });
  process.kill(process.pid, 'SIGKILL');
}

if (mode === 'automation-armed-kill') {
  const store = createRecoveryStore(root, { namespace: 'final-automation' });
  const ledger = createFuryGatewayAutomationRunLedger({
    store,
    now: () => 1000,
    defaultClaimLeaseMs: 5000,
  });
  const pending = await ledger.registerTrigger({
    automationId: 'final-validation-restart',
    definitionRevision: 1,
    definitionSha256: 'a'.repeat(64),
    sourceKind: 'one-shot',
    occurrenceKey: 'one-shot:1000',
    scheduledFor: 1000,
  });
  const claim = await ledger.claim(pending.runIdSha256, 'final-validation-worker');
  const armed = await ledger.arm(claim, 1001);
  await durableWrite(evidencePath, {
    mode,
    runIdSha256: pending.runIdSha256,
    executionIdentitySha256: armed.executionIdentitySha256,
  });
  process.kill(process.pid, 'SIGKILL');
}

if (mode === 'automation-wake-kill') {
  const definitions = createFuryGatewayAutomationDefinitionStore({
    store: createRecoveryStore(root, { namespace: 'final-wake-definitions' }),
    now: () => 0,
  });
  await definitions.create({
    automationId: 'final-validation-wake',
    ownerPrincipalId: 'local-owner',
    workflowId: 'workflow.final-validation-wake',
    enabled: true,
    trigger: {
      kind: 'one-shot',
      at: 1000,
      misfirePolicy: 'run-once',
    },
    requestedScopes: ['automations.inspect'],
    requestedPluginPermissions: [],
    budgets: {
      maxWallTimeMs: 60_000,
      maxToolCalls: 5,
      maxProviderCalls: 2,
    },
  });
  const runs = createFuryGatewayAutomationRunLedger({
    store: createRecoveryStore(root, { namespace: 'final-wake-runs' }),
    now: () => 0,
    defaultClaimLeaseMs: 5_000,
  });
  const scheduler = createFuryGatewayAutomationScheduler({
    definitions,
    runs,
    now: () => 0,
  });
  const beforeKill = await scheduler.tick(
    'final-validation-wake',
    'before-kill',
    0,
  );
  await durableWrite(evidencePath, {
    mode,
    decision: beforeKill.decision,
    nextDueAt: beforeKill.nextDueAt,
  });
  process.kill(process.pid, 'SIGKILL');
}

throw new Error(`unknown worker mode: ${mode}`);
