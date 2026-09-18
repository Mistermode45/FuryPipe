import { createRecoveryStore } from '../../src/core/recovery-store.js';
import {
  createMcpDirectDurableReplayCoordinatorInternal,
  reserveMcpDirectDurableExecution,
} from '../../src/mcp-direct-durable-replay-internal.js';

interface WorkerRequest {
  readonly root: string;
}

const request = JSON.parse(process.argv[2] ?? '') as WorkerRequest;
const store = createRecoveryStore(request.root, {
  namespace: 'mcp-m5-process-race',
});
const coordinator = createMcpDirectDurableReplayCoordinatorInternal({
  store,
  tenantId: 'tenant-m5-process-race',
  principalId: 'principal-m5-process-race',
});

try {
  const reservation = await reserveMcpDirectDurableExecution(
    coordinator,
    'a'.repeat(64),
    { now: 20_000, leaseMs: 30_000 },
  );
  process.stdout.write(JSON.stringify({
    ok: true,
    attempt: reservation.attempt,
    reservationIdSha256: reservation.reservationIdSha256,
  }) + '\n');
} catch (caught) {
  process.stdout.write(JSON.stringify({
    ok: false,
    code: caught && typeof caught === 'object' && 'code' in caught
      ? (caught as { code?: unknown }).code
      : 'unknown',
  }) + '\n');
  process.exitCode = 0;
}
