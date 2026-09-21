import {
  FURY_GATEWAY_COMMAND_FORMAT,
  type FuryGatewayCommandDefinition,
} from './gateway-command-authorization-node.js';

export const FURY_GATEWAY_AUTOMATION_OBSERVABILITY_STATE_COMMAND_NAMES =
  Object.freeze([
    'automations.status',
  ] as const);

export type FuryGatewayAutomationObservabilityStateCommandName =
  (typeof FURY_GATEWAY_AUTOMATION_OBSERVABILITY_STATE_COMMAND_NAMES)[number];

export const FURY_GATEWAY_AUTOMATION_OBSERVABILITY_COMMAND_DEFINITIONS =
  Object.freeze([
    Object.freeze({
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'automations.status',
      allowedRoles: Object.freeze(['operator'] as const),
      requiredScopes: Object.freeze(['automations.inspect'] as const),
      requiredPluginPermissions: Object.freeze([]),
      riskClass: 'inspect',
      requiresFreshApproval: false,
    }),
  ] satisfies readonly FuryGatewayCommandDefinition[]);
