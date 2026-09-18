import { fromJsonSchema } from '@modelcontextprotocol/client';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';

import {
  withMcpDirectFreshInventory,
  type McpDirectClientInfo,
  type McpDirectRuntimeConfig,
  type McpDirectSdkFactory,
  type McpDirectSdkListTool,
} from './mcp-direct-client-node-internal.js';
import {
  canonicalizeMcpDirectJson,
  digestMcpDirectJson,
} from './mcp-direct-json.js';
import {
  consumeMcpDirectExecutionPermit,
  createMcpDirectExecutionPermit,
  isGeneratedMcpDirectLifecycleState,
  recordMcpDirectExecution,
  recordMcpDirectVerification,
  type McpDirectLifecycleState,
} from './mcp-direct-governance.js';
import {
  isGeneratedMcpDirectToolProposal,
  resolveMcpDirectProposalArguments,
  type McpDirectToolProposal,
} from './mcp-direct-policy-internal.js';

const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const MAX_CALL_TIMEOUT_MS = 60_000;
const DEFAULT_PERMIT_TTL_MS = 30_000;
const MAX_PERMIT_TTL_MS = 60_000;
const DEFAULT_RESULT_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_BYTES = 16 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_SCHEMA_BYTES = 1024 * 1024;
const EXECUTION_ATTEMPTED = new WeakSet<object>();

export interface McpDirectGovernedExecutionInternalOptions {
  readonly clientInfo: McpDirectClientInfo;
  readonly connectTimeoutMs?: number;
  readonly listTimeoutMs?: number;
  readonly probeTimeoutMs?: number;
  readonly listMaxPages?: number;
  readonly callTimeoutMs?: number;
  readonly permitTtlMs?: number;
  readonly maxResultBytes?: number;
  readonly factory?: McpDirectSdkFactory;
  readonly now?: () => number;
}

export interface McpDirectExecutionReceipt {
  readonly format: 'furypipe-mcp-direct-execution-receipt/v1';
  readonly sourceId: string;
  readonly endpointFingerprint: string;
  readonly toolName: string;
  readonly inputSchemaSha256: string;
  readonly inputSha256: string;
  readonly policyDecisionIdSha256: string;
  readonly approvalKind: 'operator' | 'governed_policy';
  readonly permitIdSha256: string;
  readonly resultSha256: string;
  readonly protocolVersion?: string;
  readonly executed: true;
  readonly succeeded: boolean;
  readonly verified: boolean;
  readonly verificationKind?: 'schema';
}

export interface McpDirectGovernedExecutionResult {
  readonly lifecycle: McpDirectLifecycleState;
  readonly receipt: McpDirectExecutionReceipt;
  readonly result: unknown;
}

export class McpDirectExecutionOutcomeUnknownError extends Error {
  readonly code = 'MCP_DIRECT_EXECUTION_OUTCOME_UNKNOWN';
  readonly retrySafe = false;
  readonly sourceId: string;
  readonly toolName: string;
  readonly permitIdSha256: string;

  constructor(sourceId: string, toolName: string, permitIdSha256: string) {
    super('MCP tool call did not return a result; execution outcome is unknown and must not be retried automatically');
    this.name = 'McpDirectExecutionOutcomeUnknownError';
    this.sourceId = sourceId;
    this.toolName = toolName;
    this.permitIdSha256 = permitIdSha256;
  }
}

export class McpDirectExecutionVerificationError extends Error {
  readonly code = 'MCP_DIRECT_EXECUTION_VERIFICATION_FAILED';
  readonly retrySafe = false;
  readonly lifecycle: McpDirectLifecycleState;
  readonly resultSha256: string;

  constructor(lifecycle: McpDirectLifecycleState, resultSha256: string) {
    super('MCP tool returned a result that failed FuryPipe post-call verification; do not retry automatically');
    this.name = 'McpDirectExecutionVerificationError';
    this.lifecycle = lifecycle;
    this.resultSha256 = resultSha256;
  }
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function assertApprovedBinding(
  config: McpDirectRuntimeConfig,
  lifecycle: McpDirectLifecycleState,
  proposal: McpDirectToolProposal,
): NonNullable<McpDirectLifecycleState['inventory']>[number] {
  if (!isGeneratedMcpDirectLifecycleState(lifecycle)) {
    throw new Error('MCP approved lifecycle must be process-local FuryPipe evidence');
  }
  if (!isGeneratedMcpDirectToolProposal(proposal)) {
    throw new Error('MCP tool proposal must be process-local FuryPipe evidence');
  }
  if (
    !lifecycle.connected
    || !lifecycle.healthy
    || !lifecycle.listed
    || !lifecycle.selected
    || !lifecycle.selectedTool
    || !lifecycle.inventory
    || !lifecycle.approved
    || !lifecycle.approval
    || lifecycle.executed
  ) {
    throw new Error('MCP execution requires an approved, unexecuted selected lifecycle');
  }
  if (
    config.source.sourceId !== lifecycle.source.sourceId
    || config.source.transport !== lifecycle.source.transport
    || config.source.endpointFingerprint !== lifecycle.source.endpointFingerprint
    || config.source.trust !== lifecycle.source.trust
    || proposal.sourceId !== lifecycle.source.sourceId
    || proposal.endpointFingerprint !== lifecycle.source.endpointFingerprint
    || proposal.toolName !== lifecycle.selectedTool
    || proposal.inputSha256 !== lifecycle.approval.inputSha256
  ) {
    throw new Error('MCP execution config/proposal is not bound to the approved lifecycle');
  }

  const selected = lifecycle.inventory.find(tool => tool.name === lifecycle.selectedTool);
  if (
    !selected
    || selected.inputSchemaSha256 !== proposal.inputSchemaSha256
    || selected.risk.riskClass !== proposal.riskClass
  ) {
    throw new Error('MCP approved selection does not match proposal schema/risk evidence');
  }
  return selected;
}

function cloneSchema(value: unknown, label: string): unknown {
  const canonical = canonicalizeMcpDirectJson(value, {
    maxBytes: MAX_SCHEMA_BYTES,
    maxDepth: MAX_JSON_DEPTH,
    label,
  });
  return JSON.parse(canonical) as unknown;
}

function buildFreshToolDefinition(tool: McpDirectSdkListTool): {
  readonly definition: Readonly<Record<string, unknown>>;
  readonly outputValidator?: ReturnType<typeof fromJsonSchema>;
} {
  if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string') {
    throw new Error('MCP fresh selected tool definition is invalid');
  }
  if (tool.inputSchema === undefined) {
    throw new Error('MCP fresh selected tool input schema is missing');
  }
  const inputSchema = cloneSchema(tool.inputSchema, 'MCP fresh tool input schema');
  const definition: Record<string, unknown> = {
    name: tool.name,
    inputSchema,
  };

  let outputValidator: ReturnType<typeof fromJsonSchema> | undefined;
  if (tool.outputSchema !== undefined) {
    const outputSchema = cloneSchema(tool.outputSchema, 'MCP fresh tool output schema');
    definition.outputSchema = outputSchema;
    try {
      outputValidator = fromJsonSchema(
        outputSchema as Parameters<typeof fromJsonSchema>[0],
        new AjvJsonSchemaValidator(),
      );
    } catch {
      throw new Error('MCP fresh tool output schema could not be compiled');
    }
  }

  return Object.freeze({
    definition: Object.freeze(definition),
    ...(outputValidator === undefined ? {} : { outputValidator }),
  });
}

function resultIsToolError(result: unknown): boolean {
  return typeof result === 'object'
    && result !== null
    && !Array.isArray(result)
    && (result as { readonly isError?: unknown }).isError === true;
}

async function validateStructuredOutput(
  result: unknown,
  validator: ReturnType<typeof fromJsonSchema> | undefined,
): Promise<boolean> {
  if (validator === undefined || resultIsToolError(result)) return true;
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return false;
  const record = result as { readonly structuredContent?: unknown };
  if (record.structuredContent === undefined) return false;
  try {
    const validation = await validator['~standard'].validate(record.structuredContent);
    return !validation.issues || validation.issues.length === 0;
  } catch {
    return false;
  }
}

export async function executeMcpDirectApprovedToolInternal(
  config: McpDirectRuntimeConfig,
  approvedLifecycle: McpDirectLifecycleState,
  proposal: McpDirectToolProposal,
  options: McpDirectGovernedExecutionInternalOptions,
): Promise<McpDirectGovernedExecutionResult> {
  const approvedSelected = assertApprovedBinding(config, approvedLifecycle, proposal);
  if (EXECUTION_ATTEMPTED.has(approvedLifecycle)) {
    throw new Error('MCP approved lifecycle was already used for an execution attempt');
  }

  const callTimeoutMs = boundedInteger(
    options.callTimeoutMs,
    DEFAULT_CALL_TIMEOUT_MS,
    100,
    MAX_CALL_TIMEOUT_MS,
    'MCP callTimeoutMs',
  );
  const permitTtlMs = boundedInteger(
    options.permitTtlMs,
    DEFAULT_PERMIT_TTL_MS,
    1,
    MAX_PERMIT_TTL_MS,
    'MCP permitTtlMs',
  );
  const maxResultBytes = boundedInteger(
    options.maxResultBytes,
    DEFAULT_RESULT_BYTES,
    1024,
    MAX_RESULT_BYTES,
    'MCP maxResultBytes',
  );

  const argumentsValue = resolveMcpDirectProposalArguments(proposal);
  if (
    !argumentsValue
    || typeof argumentsValue !== 'object'
    || Array.isArray(argumentsValue)
  ) {
    throw new Error('MCP validated proposal arguments are not an object');
  }
  const argumentsRecord = argumentsValue as Readonly<Record<string, unknown>>;
  const derivedInputSha256 = digestMcpDirectJson(argumentsRecord, {
    maxBytes: 1024 * 1024,
    maxDepth: MAX_JSON_DEPTH,
    label: 'MCP execution arguments',
  });
  if (derivedInputSha256 !== proposal.inputSha256) {
    throw new Error('MCP execution arguments no longer match the approved proposal digest');
  }

  return withMcpDirectFreshInventory(config, {
    clientInfo: options.clientInfo,
    ...(options.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: options.connectTimeoutMs }),
    ...(options.listTimeoutMs === undefined ? {} : { listTimeoutMs: options.listTimeoutMs }),
    ...(options.probeTimeoutMs === undefined ? {} : { probeTimeoutMs: options.probeTimeoutMs }),
    ...(options.listMaxPages === undefined ? {} : { listMaxPages: options.listMaxPages }),
    ...(options.factory === undefined ? {} : { factory: options.factory }),
  }, async fresh => {
    if (
      fresh.lifecycle.source.sourceId !== approvedLifecycle.source.sourceId
      || fresh.lifecycle.source.endpointFingerprint !== approvedLifecycle.source.endpointFingerprint
      || fresh.lifecycle.source.transport !== approvedLifecycle.source.transport
      || fresh.lifecycle.source.trust !== approvedLifecycle.source.trust
      || fresh.lifecycle.protocolEra !== approvedLifecycle.protocolEra
      || fresh.lifecycle.handshake !== approvedLifecycle.handshake
    ) {
      throw new Error('MCP fresh connection identity/protocol does not match approved lifecycle');
    }

    const freshSelected = fresh.lifecycle.inventory?.find(tool => tool.name === proposal.toolName);
    if (!freshSelected) {
      throw new Error('MCP approved tool is missing from fresh inventory');
    }
    if (
      freshSelected.inputSchemaSha256 !== approvedSelected.inputSchemaSha256
      || freshSelected.inputSchemaSha256 !== proposal.inputSchemaSha256
    ) {
      throw new Error('MCP selected tool input schema drifted after approval');
    }
    if (freshSelected.risk.riskClass !== proposal.riskClass) {
      throw new Error('MCP selected tool risk class drifted after approval');
    }

    const rawTool = fresh.tools.find(tool => tool.name === proposal.toolName);
    if (!rawTool) {
      throw new Error('MCP selected tool definition is missing from fresh inventory');
    }
    const prepared = buildFreshToolDefinition(rawTool);
    if (fresh.client.callTool === undefined) {
      throw new Error('MCP runtime client does not expose governed callTool capability');
    }

    // Critical no-replay transition. Re-check after async connect/list work so
    // concurrent invocations cannot both consume the same approved state.
    if (EXECUTION_ATTEMPTED.has(approvedLifecycle)) {
      throw new Error('MCP approved lifecycle was already used for an execution attempt');
    }
    EXECUTION_ATTEMPTED.add(approvedLifecycle);

    const now = options.now?.() ?? Date.now();
    const permit = createMcpDirectExecutionPermit(
      approvedLifecycle,
      proposal.inputSha256,
      { now, expiresInMs: permitTtlMs },
    );
    consumeMcpDirectExecutionPermit(
      approvedLifecycle,
      permit,
      proposal.inputSha256,
      now,
    );
    const permitIdSha256 = digestMcpDirectJson(permit.permitId, {
      maxBytes: 1024,
      maxDepth: 2,
      label: 'MCP execution permit id',
    });

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error('MCP tools/call timed out')),
      callTimeoutMs,
    );
    timeout.unref?.();

    let result: unknown;
    try {
      result = await fresh.client.callTool(
        {
          name: proposal.toolName,
          arguments: argumentsRecord,
        },
        {
          timeout: callTimeoutMs,
          signal: controller.signal,
          toolDefinition: prepared.definition,
        },
      );
    } catch {
      throw new McpDirectExecutionOutcomeUnknownError(
        approvedLifecycle.source.sourceId,
        proposal.toolName,
        permitIdSha256,
      );
    } finally {
      clearTimeout(timeout);
    }

    const resultSha256 = digestMcpDirectJson(result, {
      maxBytes: maxResultBytes,
      maxDepth: MAX_JSON_DEPTH,
      label: 'MCP tool result',
    });
    const isError = resultIsToolError(result);
    const executed = recordMcpDirectExecution(approvedLifecycle, {
      permit,
      resultSha256,
      isError,
    });

    if (!isError) {
      const outputValid = await validateStructuredOutput(result, prepared.outputValidator);
      if (!outputValid) {
        throw new McpDirectExecutionVerificationError(executed, resultSha256);
      }
    }

    const finalLifecycle = isError
      ? executed
      : recordMcpDirectVerification(executed, {
          resultSha256,
          verificationKind: 'schema',
        });

    const receipt: McpDirectExecutionReceipt = Object.freeze({
      format: 'furypipe-mcp-direct-execution-receipt/v1',
      sourceId: approvedLifecycle.source.sourceId,
      endpointFingerprint: approvedLifecycle.source.endpointFingerprint,
      toolName: proposal.toolName,
      inputSchemaSha256: proposal.inputSchemaSha256,
      inputSha256: proposal.inputSha256,
      policyDecisionIdSha256: approvedLifecycle.approval!.policyDecisionIdSha256,
      approvalKind: approvedLifecycle.approval!.approvalKind,
      permitIdSha256,
      resultSha256,
      ...(fresh.protocolVersion === undefined ? {} : { protocolVersion: fresh.protocolVersion }),
      executed: true,
      succeeded: !isError,
      verified: !isError,
      ...(!isError ? { verificationKind: 'schema' as const } : {}),
    });

    return Object.freeze({
      lifecycle: finalLifecycle,
      receipt,
      result,
    });
  });
}
