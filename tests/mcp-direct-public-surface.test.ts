import { describe, expect, it } from 'vitest';

import * as FuryPipe from '../src/core/index.js';
import packageJson from '../package.json' with { type: 'json' };

describe('direct MCP supported public authority surface', () => {
  it('does not expose privileged lifecycle mutation helpers from the root API', () => {
    const root = FuryPipe as Record<string, unknown>;
    expect(root.recordMcpDirectApproval).toBeUndefined();
    expect(root.consumeMcpDirectExecutionPermit).toBeUndefined();
    expect(root.recordMcpDirectExecution).toBeUndefined();
    expect(root.recordMcpDirectVerification).toBeUndefined();
  });

  it('does not publish the raw governance module as a package subpath', () => {
    const exportsMap = packageJson.exports as Record<string, unknown>;
    expect(exportsMap['./mcp-direct-governance']).toBeUndefined();
    expect(exportsMap['./mcp-direct-client-node']).toBeDefined();
    expect(exportsMap['./mcp-direct-policy']).toBeDefined();
  });
});
