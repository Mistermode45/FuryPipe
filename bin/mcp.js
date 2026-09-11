#!/usr/bin/env node
import { createRecoveryStore } from '../dist/core/recovery-store.js';
import { runMcpStdio } from '../dist/mcp.js';

const root = process.env.FURYPIPE_RECOVERY_ROOT?.trim() || `${process.cwd()}/.furypipe/recovery`;
const store = createRecoveryStore(root, { namespace: process.env.FURYPIPE_TENANT?.trim() || 'default' });
runMcpStdio(store).catch((err) => {
  console.error('[furypipe-mcp] failed to start:', err);
  process.exit(1);
});
