import {
  FURY_GATEWAY_COMMAND_FORMAT,
  type FuryGatewayCommandDefinition,
} from './gateway-command-authorization-node.js';

export const FURY_GATEWAY_MODEL_EXECUTION_COMMAND_NAMES = Object.freeze([
  'conversation.model.execute',
] as const);

export type FuryGatewayModelExecutionCommandName =
  (typeof FURY_GATEWAY_MODEL_EXECUTION_COMMAND_NAMES)[number];

export const FURY_GATEWAY_MODEL_EXECUTION_COMMAND_DEFINITIONS =
  Object.freeze([
    Object.freeze({
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'conversation.model.execute',
      allowedRoles: Object.freeze(['operator'] as const),
      requiredScopes: Object.freeze([
        'conversations.write',
        'capability.provider-inference',
      ] as const),
      requiredPluginPermissions: Object.freeze(['provider-inference'] as const),
      riskClass: 'process',
      requiresFreshApproval: false,
    }),
  ] satisfies readonly FuryGatewayCommandDefinition[]);
