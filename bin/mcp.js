#!/usr/bin/env node
import('../dist/mcp.js').catch((err) => {
  console.error('[furypipe-mcp] failed to start:', err);
  process.exit(1);
});

