import { describe, expect, it } from 'vitest';

import {
  FURY_GATEWAY_TOOL_COMMAND_DEFINITIONS,
  FURY_GATEWAY_TOOL_COMMAND_NAMES,
  FURY_GATEWAY_TOOL_EXECUTION_COMMAND_DEFINITIONS,
  FURY_GATEWAY_TOOL_EXECUTION_COMMAND_NAMES,
  FURY_GATEWAY_TOOL_STATE_COMMAND_DEFINITIONS,
  FURY_GATEWAY_TOOL_STATE_COMMAND_NAMES,
} from '../src/gateway-tool-command-node.js';

describe('Gateway governed tool command definitions', () => {
  it('keeps state-only and capability-executing command allowlists disjoint', () => {
    expect(FURY_GATEWAY_TOOL_STATE_COMMAND_NAMES).toEqual([
      'tools.sources.inspect',
      'tools.discard',
    ]);
    expect(FURY_GATEWAY_TOOL_EXECUTION_COMMAND_NAMES).toEqual([
      'tools.source.inspect.stdio',
      'tools.source.inspect.http',
      'tools.propose.stdio',
      'tools.propose.http',
      'tools.approve',
      'tools.execute.stdio',
      'tools.execute.http',
    ]);
    expect(new Set(FURY_GATEWAY_TOOL_COMMAND_NAMES).size)
      .toBe(FURY_GATEWAY_TOOL_COMMAND_NAMES.length);
    for (const name of FURY_GATEWAY_TOOL_STATE_COMMAND_NAMES) {
      expect(FURY_GATEWAY_TOOL_EXECUTION_COMMAND_NAMES).not.toContain(name);
    }
  });

  it('keeps state-only commands free of capability plugin permissions', () => {
    for (const definition of FURY_GATEWAY_TOOL_STATE_COMMAND_DEFINITIONS) {
      expect(definition.allowedRoles).toEqual(['operator']);
      expect(definition.requiredPluginPermissions).toEqual([]);
      expect(definition.requiresFreshApproval).toBe(false);
    }
    expect(FURY_GATEWAY_TOOL_STATE_COMMAND_DEFINITIONS[0]).toMatchObject({
      name: 'tools.sources.inspect',
      requiredScopes: ['mcp.inspect'],
      riskClass: 'inspect',
    });
    expect(FURY_GATEWAY_TOOL_STATE_COMMAND_DEFINITIONS[1]).toMatchObject({
      name: 'tools.discard',
      requiredScopes: ['mcp.manage'],
      riskClass: 'write',
    });
  });

  it('requires process only for stdio and network only for HTTP operations', () => {
    const byName = new Map(
      FURY_GATEWAY_TOOL_EXECUTION_COMMAND_DEFINITIONS
        .map((definition) => [definition.name, definition]),
    );

    for (const name of [
      'tools.source.inspect.stdio',
      'tools.propose.stdio',
      'tools.execute.stdio',
    ]) {
      const definition = byName.get(name)!;
      expect(definition.requiredScopes).toContain('capability.process');
      expect(definition.requiredScopes).not.toContain('capability.network');
      expect(definition.requiredPluginPermissions).toEqual(['process']);
    }

    for (const name of [
      'tools.source.inspect.http',
      'tools.propose.http',
      'tools.execute.http',
    ]) {
      const definition = byName.get(name)!;
      expect(definition.requiredScopes).toContain('capability.network');
      expect(definition.requiredScopes).not.toContain('capability.process');
      expect(definition.requiredPluginPermissions).toEqual(['network']);
    }
  });

  it('separates inventory/proposal inspection from approval/execution management', () => {
    const byName = new Map(
      FURY_GATEWAY_TOOL_COMMAND_DEFINITIONS
        .map((definition) => [definition.name, definition]),
    );

    for (const name of [
      'tools.source.inspect.stdio',
      'tools.source.inspect.http',
      'tools.propose.stdio',
      'tools.propose.http',
    ]) {
      expect(byName.get(name)?.requiredScopes).toContain('mcp.inspect');
      expect(byName.get(name)?.requiredScopes).not.toContain('mcp.manage');
    }

    for (const name of [
      'tools.approve',
      'tools.execute.stdio',
      'tools.execute.http',
      'tools.discard',
    ]) {
      expect(byName.get(name)?.requiredScopes).toContain('mcp.manage');
    }
  });

  it('does not let Gateway admission impersonate MCP operator approval', () => {
    const approve = FURY_GATEWAY_TOOL_COMMAND_DEFINITIONS
      .find((definition) => definition.name === 'tools.approve')!;
    expect(approve).toMatchObject({
      requiredScopes: ['mcp.manage'],
      requiredPluginPermissions: [],
      riskClass: 'write',
      requiresFreshApproval: false,
    });

    // The explicit command is only the user action boundary. The process-local
    // MCP operator intent is still created by the governed tool bridge.
    expect(approve.name).toBe('tools.approve');
  });
});
