import {
  observeAnthropicMcpRuntime,
  type AnthropicMcpObservation,
  type ExposedMcpTool,
} from './mcp-observed-runtime.js';
import {
  assessMcpToolRisk,
  type McpToolRiskAssessment,
  type McpToolTrust,
} from './mcp-tool-risk.js';

export type McpToolTrustResolver = (tool: ExposedMcpTool) => McpToolTrust;

export interface ProxyMcpToolPolicyEvidence {
  readonly toolName: string;
  readonly serverId?: string;
  readonly toolId?: string;
  readonly assessment: McpToolRiskAssessment;
}

export interface ProxyMcpRuntimeEvidence {
  readonly format: 'furypipe-proxy-mcp-evidence/v1';
  readonly observation: AnthropicMcpObservation;
  readonly tools: readonly ProxyMcpToolPolicyEvidence[];
  readonly executedByFuryPipe: false;
  readonly authorizationGranted: false;
}

/**
 * Build passive MCP evidence from an Anthropic request.
 *
 * This function does not connect to an MCP server and does not execute a tool.
 * Trust defaults to untrusted when no host resolver is supplied.
 */
export async function inspectAnthropicMcpEvidence(
  body: Uint8Array | string,
  trustResolver?: McpToolTrustResolver,
): Promise<ProxyMcpRuntimeEvidence> {
  const observation = await observeAnthropicMcpRuntime(body);
  const tools = observation.exposedTools.map((tool) => {
    const trust = trustResolver?.(tool) ?? 'untrusted';
    const assessment = assessMcpToolRisk(tool.annotations, trust);
    return Object.freeze({
      toolName: tool.name,
      ...(tool.serverId === undefined ? {} : { serverId: tool.serverId }),
      ...(tool.toolId === undefined ? {} : { toolId: tool.toolId }),
      assessment,
    });
  });

  return Object.freeze({
    format: 'furypipe-proxy-mcp-evidence/v1',
    observation,
    tools: Object.freeze(tools),
    executedByFuryPipe: false,
    authorizationGranted: false,
  });
}
