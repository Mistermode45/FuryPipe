import {
  FURY_GATEWAY_COMMAND_FORMAT,
  type FuryGatewayCommandDefinition,
} from './gateway-command-authorization-node.js';

export const FURY_GATEWAY_CHANNEL_OBSERVABILITY_STATE_COMMAND_NAMES = Object.freeze([
  'channels.status',
] as const);

export type FuryGatewayChannelObservabilityStateCommandName =
  (typeof FURY_GATEWAY_CHANNEL_OBSERVABILITY_STATE_COMMAND_NAMES)[number];

export const FURY_GATEWAY_CHANNEL_OBSERVABILITY_COMMAND_DEFINITIONS =
  Object.freeze([
    Object.freeze({
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'channels.status',
      allowedRoles: Object.freeze(['operator'] as const),
      requiredScopes: Object.freeze(['channels.inspect'] as const),
      requiredPluginPermissions: Object.freeze([]),
      riskClass: 'inspect',
      requiresFreshApproval: false,
    }),
  ] satisfies readonly FuryGatewayCommandDefinition[]);
