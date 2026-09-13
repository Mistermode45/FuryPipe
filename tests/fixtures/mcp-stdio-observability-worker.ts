import { createRecoveryStore } from '../../src/core/recovery-store.js';
import {
  getProductionMcpStdioRuntimeEvidence,
  runModernMcpStdio,
} from '../../src/mcp-modern.js';

const [root, tenant = 'stdio-e2e'] = process.argv.slice(2);
if (!root) {
  process.stderr.write('FURYPIPE_STDIO_E2E_ERROR missing recovery root\n');
  process.exit(2);
}

const store = createRecoveryStore(root, { namespace: tenant });
const handle = runModernMcpStdio(store);
const deadline = Date.now() + 10_000;

const timer = setInterval(() => {
  const evidence = getProductionMcpStdioRuntimeEvidence(handle);
  if (evidence?.completedExchanges && evidence.completedExchanges > 0) {
    clearInterval(timer);
    process.stderr.write(`FURYPIPE_STDIO_EVIDENCE ${JSON.stringify(evidence)}\n`);
    void handle.close().finally(() => process.exit(0));
    return;
  }
  if (Date.now() >= deadline) {
    clearInterval(timer);
    process.stderr.write('FURYPIPE_STDIO_E2E_ERROR timed out waiting for exchange\n');
    void handle.close().finally(() => process.exit(3));
  }
}, 10);
timer.unref?.();
