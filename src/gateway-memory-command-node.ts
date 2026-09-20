import {
  FURY_GATEWAY_COMMAND_FORMAT,
  type FuryGatewayCommandDefinition,
} from './gateway-command-authorization-node.js';

export const FURY_GATEWAY_MEMORY_STATE_COMMAND_NAMES = Object.freeze([
  'memory.status',
] as const);

export const FURY_GATEWAY_MEMORY_EXECUTION_COMMAND_NAMES = Object.freeze([
  'memory.forget',
  'memory.purge',
] as const);

export const FURY_GATEWAY_MEMORY_COMMAND_NAMES = Object.freeze([
  ...FURY_GATEWAY_MEMORY_STATE_COMMAND_NAMES,
  ...FURY_GATEWAY_MEMORY_EXECUTION_COMMAND_NAMES,
] as const);

export type FuryGatewayMemoryStateCommandName =
  (typeof FURY_GATEWAY_MEMORY_STATE_COMMAND_NAMES)[number];

export type FuryGatewayMemoryExecutionCommandName =
  (typeof FURY_GATEWAY_MEMORY_EXECUTION_COMMAND_NAMES)[number];

export type FuryGatewayMemoryCommandName =
  (typeof FURY_GATEWAY_MEMORY_COMMAND_NAMES)[number];

const stateDefinitions = [
  Object.freeze({
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'memory.status',
    allowedRoles: Object.freeze(['operator'] as const),
    requiredScopes: Object.freeze(['memory.read'] as const),
    requiredPluginPermissions: Object.freeze([]),
    riskClass: 'inspect',
    requiresFreshApproval: false,
  }),
] satisfies readonly FuryGatewayCommandDefinition[];

const executionDefinitions = [
  Object.freeze({
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'memory.forget',
    allowedRoles: Object.freeze(['operator'] as const),
    requiredScopes: Object.freeze(['memory.write'] as const),
    requiredPluginPermissions: Object.freeze([]),
    riskClass: 'write',
    requiresFreshApproval: false,
  }),
  Object.freeze({
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'memory.purge',
    allowedRoles: Object.freeze(['operator'] as const),
    requiredScopes: Object.freeze(['memory.manage'] as const),
    requiredPluginPermissions: Object.freeze([]),
    riskClass: 'admin',
    requiresFreshApproval: false,
  }),
] satisfies readonly FuryGatewayCommandDefinition[];

export const FURY_GATEWAY_MEMORY_STATE_COMMAND_DEFINITIONS =
  Object.freeze(stateDefinitions);

export const FURY_GATEWAY_MEMORY_EXECUTION_COMMAND_DEFINITIONS =
  Object.freeze(executionDefinitions);

export const FURY_GATEWAY_MEMORY_COMMAND_DEFINITIONS =
  Object.freeze([
    ...stateDefinitions,
    ...executionDefinitions,
  ] satisfies readonly FuryGatewayCommandDefinition[]);
