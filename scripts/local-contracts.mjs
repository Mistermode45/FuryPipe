#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const targets = [
  'tests/mcp-http-node.test.ts',
  'tests/mcp-http.test.ts',
  'tests/mcp-modern.test.ts',
  'tests/hosted-mcp-conformance-security.test.ts',
  'tests/provider-transport-conformance.test.ts',
  'tests/provider-stream-transports-conformance.test.ts',
  'tests/provider-transports-http.test.ts',
  'tests/provider-transports-openai.test.ts',
  'tests/provider-transports-anthropic.test.ts',
  'tests/provider-transports-google.test.ts',
  'tests/fury-gateway-websocket-host.test.ts',
  'tests/fury-gateway-runtime-daemon.test.ts',
  'tests/fury-gateway-automation-phase5-final.test.ts',
  'tests/fury-gateway-automation-scheduler.test.ts',
  'tests/fury-gateway-automation-run-ledger.test.ts',
  'tests/openclaw-probe.test.ts',
  'tests/openclaw-adapter.test.ts',
  'tests/worker-auth.test.ts',
  'tests/beta-config.test.ts',
  'tests/beta-dashboard.test.ts',
  'tests/recovery-store.test.ts',
];

const outputDir = path.resolve(process.env.FURYPIPE_VALIDATION_OUTPUT_DIR?.trim() || 'artifacts/final-validation');
mkdirSync(outputDir, { recursive: true });
const result = spawnSync(process.execPath, [
  path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs'),
  'run',
  ...targets,
], {
  cwd: process.cwd(),
  stdio: 'inherit',
  windowsHide: true,
});
const evidence = {
  format: 'furypipe-final-local-contracts/v1',
  status: result.status === 0 ? 'PASS' : 'FAIL',
  generatedAt: new Date().toISOString(),
  source: { commit: process.env.FURYPIPE_SOURCE_COMMIT ?? 'local-head' },
  targets,
  exitCode: result.status,
  signal: result.signal,
  scope: {
    mcp: 'local stdio/http/modern/hosted-fixture security contract',
    provider: 'local HTTP/stream transport fixtures',
    gateway: 'local WebSocket/runtime/automation ledger',
    openclaw: 'adapter/probe local boundary only',
    durability: 'beta config and Recovery store tests',
  },
  limitations: [
    'third-party hosted MCP/OpenClaw and real provider credentials are not executed',
    'this suite does not imply production deployment or external account authorization',
  ],
};
writeFileSync(path.join(outputDir, 'local-contracts.json'), `${JSON.stringify(evidence, null, 2)}\n`);
if (result.status !== 0) process.exit(result.status ?? 1);
