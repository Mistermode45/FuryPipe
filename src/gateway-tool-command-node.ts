import {
  FURY_GATEWAY_COMMAND_FORMAT,
  type FuryGatewayCommandDefinition,
} from './gateway-command-authorization-node.js';

export const FURY_GATEWAY_TOOL_STATE_COMMAND_NAMES = Object.freeze([
  'tools.sources.inspect',
  'tools.discard',
] as const);

export const FURY_GATEWAY_TOOL_EXECUTION_COMMAND_NAMES = Object.freeze([
  'tools.source.inspect.stdio',
  'tools.source.inspect.http',
  'tools.propose.stdio',
  'tools.propose.http',
  'tools.approve',
  'tools.execute.stdio',
  'tools.execute.http',
] as const);

export const FURY_GATEWAY_TOOL_COMMAND_NAMES = Object.freeze([
  ...FURY_GATEWAY_TOOL_STATE_COMMAND_NAMES,
  ...FURY_GATEWAY_TOOL_EXECUTION_COMMAND_NAMES,
] as const);

export type FuryGatewayToolStateCommandName =
  (typeof FURY_GATEWAY_TOOL_STATE_COMMAND_NAMES)[number];
export type FuryGatewayToolExecutionCommandName =
  (typeof FURY_GATEWAY_TOOL_EXECUTION_COMMAND_NAMES)[number];
export type FuryGatewayToolCommandName =
  (typeof FURY_GATEWAY_TOOL_COMMAND_NAMES)[number];

const stateDefinitions = [
  Object.freeze({
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'tools.sources.inspect',
    allowedRoles: Object.freeze(['operator'] as const),
    requiredScopes: Object.freeze(['mcp.inspect'] as const),
    requiredPluginPermissions: Object.freeze([]),
    riskClass: 'inspect',
    requiresFreshApproval: false,
  }),
  Object.freeze({
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'tools.discard',
    allowedRoles: Object.freeze(['operator'] as const),
    requiredScopes: Object.freeze(['mcp.manage'] as const),
    requiredPluginPermissions: Object.freeze([]),
    riskClass: 'write',
    requiresFreshApproval: false,
  }),
] satisfies readonly FuryGatewayCommandDefinition[];

const executionDefinitions = [
  Object.freeze({
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'tools.source.inspect.stdio',
    allowedRoles: Object.freeze(['operator'] as const),
    requiredScopes: Object.freeze([
      'mcp.inspect',
      'capability.process',
    ] as const),
    requiredPluginPermissions: Object.freeze(['process'] as const),
    riskClass: 'read',
    requiresFreshApproval: false,
  }),
  Object.freeze({
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'tools.source.inspect.http',
    allowedRoles: Object.freeze(['operator'] as const),
    requiredScopes: Object.freeze([
      'mcp.inspect',
      'capability.network',
    ] as const),
    requiredPluginPermissions: Object.freeze(['network'] as const),
    riskClass: 'read',
    requiresFreshApproval: false,
  }),
  Object.freeze({
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'tools.propose.stdio',
    allowedRoles: Object.freeze(['operator'] as const),
    requiredScopes: Object.freeze([
      'mcp.inspect',
      'capability.process',
    ] as const),
    requiredPluginPermissions: Object.freeze(['process'] as const),
    riskClass: 'read',
    requiresFreshApproval: false,
  }),
  Object.freeze({
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'tools.propose.http',
    allowedRoles: Object.freeze(['operator'] as const),
    requiredScopes: Object.freeze([
      'mcp.inspect',
      'capability.network',
    ] as const),
    requiredPluginPermissions: Object.freeze(['network'] as const),
    riskClass: 'read',
    requiresFreshApproval: false,
  }),
  Object.freeze({
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'tools.approve',
    allowedRoles: Object.freeze(['operator'] as const),
    requiredScopes: Object.freeze(['mcp.manage'] as const),
    requiredPluginPermissions: Object.freeze([]),
    riskClass: 'write',
    // Fresh human intent is created inside MCP Direct from this explicit
    // command. Gateway admission itself still grants no MCP authority.
    requiresFreshApproval: false,
  }),
  Object.freeze({
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'tools.execute.stdio',
    allowedRoles: Object.freeze(['operator'] as const),
    requiredScopes: Object.freeze([
      'mcp.manage',
      'capability.process',
    ] as const),
    requiredPluginPermissions: Object.freeze(['process'] as const),
    riskClass: 'process',
    requiresFreshApproval: false,
  }),
  Object.freeze({
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'tools.execute.http',
    allowedRoles: Object.freeze(['operator'] as const),
    requiredScopes: Object.freeze([
      'mcp.manage',
      'capability.network',
    ] as const),
    requiredPluginPermissions: Object.freeze(['network'] as const),
    riskClass: 'process',
    requiresFreshApproval: false,
  }),
] satisfies readonly FuryGatewayCommandDefinition[];

export const FURY_GATEWAY_TOOL_STATE_COMMAND_DEFINITIONS =
  Object.freeze(stateDefinitions);
export const FURY_GATEWAY_TOOL_EXECUTION_COMMAND_DEFINITIONS =
  Object.freeze(executionDefinitions);
export const FURY_GATEWAY_TOOL_COMMAND_DEFINITIONS =
  Object.freeze([
    ...stateDefinitions,
    ...executionDefinitions,
  ] satisfies readonly FuryGatewayCommandDefinition[]);
