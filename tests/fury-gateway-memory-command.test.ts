import { describe, expect, it } from 'vitest';

import {
  FURY_GATEWAY_MEMORY_COMMAND_DEFINITIONS,
  FURY_GATEWAY_MEMORY_COMMAND_NAMES,
  FURY_GATEWAY_MEMORY_EXECUTION_COMMAND_DEFINITIONS,
  FURY_GATEWAY_MEMORY_EXECUTION_COMMAND_NAMES,
  FURY_GATEWAY_MEMORY_STATE_COMMAND_DEFINITIONS,
  FURY_GATEWAY_MEMORY_STATE_COMMAND_NAMES,
} from '../src/gateway-memory-command-node.js';

describe('Gateway memory command governance', () => {
  it('keeps state and durable mutation commands explicitly separated', () => {
    expect(FURY_GATEWAY_MEMORY_STATE_COMMAND_NAMES).toEqual([
      'memory.status',
    ]);
    expect(FURY_GATEWAY_MEMORY_EXECUTION_COMMAND_NAMES).toEqual([
      'memory.forget',
      'memory.purge',
    ]);
    expect(FURY_GATEWAY_MEMORY_COMMAND_NAMES).toEqual([
      'memory.status',
      'memory.forget',
      'memory.purge',
    ]);
  });

  it('requires the narrow memory scope for each operation and no provider/tool capability', () => {
    const status = FURY_GATEWAY_MEMORY_STATE_COMMAND_DEFINITIONS[0]!;
    const forget = FURY_GATEWAY_MEMORY_EXECUTION_COMMAND_DEFINITIONS[0]!;
    const purge = FURY_GATEWAY_MEMORY_EXECUTION_COMMAND_DEFINITIONS[1]!;

    expect(status).toMatchObject({
      name: 'memory.status',
      allowedRoles: ['operator'],
      requiredScopes: ['memory.read'],
      requiredPluginPermissions: [],
      riskClass: 'inspect',
      requiresFreshApproval: false,
    });
    expect(forget).toMatchObject({
      name: 'memory.forget',
      allowedRoles: ['operator'],
      requiredScopes: ['memory.write'],
      requiredPluginPermissions: [],
      riskClass: 'write',
      requiresFreshApproval: false,
    });
    expect(purge).toMatchObject({
      name: 'memory.purge',
      allowedRoles: ['operator'],
      requiredScopes: ['memory.manage'],
      requiredPluginPermissions: [],
      riskClass: 'admin',
      requiresFreshApproval: false,
    });

    for (const definition of FURY_GATEWAY_MEMORY_COMMAND_DEFINITIONS) {
      expect(definition.requiredScopes).not.toContain('capability.provider-inference');
      expect(definition.requiredScopes).not.toContain('capability.network');
      expect(definition.requiredScopes).not.toContain('capability.process');
      expect(definition.requiredPluginPermissions).toEqual([]);
    }
  });
});
