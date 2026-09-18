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
import {
  registerGeneratedMcpDirectExecutionReceipt,
  releaseMcpDirectExecutionReservation,
  reserveMcpDirectExecutionAttempt,
  settleMcpDirectExecutionAttempt,
  type McpDirectReplayIntent,
  type McpDirectReplayReason,
} from './mcp-direct-replay-internal.js';
import {
  abortMcpDirectDurablePreCallReservation,
  armMcpDirectDurableExecution,
  isGeneratedMcpDirectDurableReplayCoordinator,
  reserveMcpDirectDurableExecution,
  settleMcpDirectDurableExecution,
  type McpDirectDurableArmedEvidence,
  type McpDirectDurableReplayCoordinator,
  type McpDirectDurableReplayStatus,
  type McpDirectDurableReservation,
} from './mcp-direct-durable-replay-internal.js';

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
  readonly replayIntent?: McpDirectReplayIntent;
  readonly durableReplay?: McpDirectDurableReplayCoordinator;
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
  readonly replayKeySha256: string;
  readonly attempt: number;
  readonly replayed: boolean;
  readonly replayReason?: McpDirectReplayReason;
  readonly priorResultSha256?: string;
  readonly outputSchemaSha256?: string;
  readonly protocolVersion?: string;
  readonly executed: true;
  readonly succeeded: boolean;
  readonly verified: boolean;
  readonly verificationKind?: 'schema';
  readonly durableScopeSha256?: string;
  readonly durableAttempt?: number;
}

export interface McpDirectGovernedExecutionInternalResult {
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
  readonly replayKeySha256: string;
  readonly attempt: number;

  constructor(
    sourceId: string,
    toolName: string,
    permitIdSha256: string,
    replayKeySha256: string,
    attempt: number,
  ) {
    super('MCP tool call did not return a result; execution outcome is unknown and must not be retried automatically');
    this.name = 'McpDirectExecutionOutcomeUnknownError';
    this.sourceId = sourceId;
    this.toolName = toolName;
    this.permitIdSha256 = permitIdSha256;
    this.replayKeySha256 = replayKeySha256;
    this.attempt = attempt;
  }
}

export class McpDirectExecutionVerificationError extends Error {
  readonly code = 'MCP_DIRECT_EXECUTION_VERIFICATION_FAILED';
  readonly retrySafe = false;
  readonly executed = true;
  readonly succeeded = true;
  readonly verified = false;
  readonly sourceId: string;
  readonly toolName: string;
  readonly inputSha256: string;
  readonly resultSha256: string;
  readonly outputSchemaSha256: string;
  readonly replayKeySha256: string;
  readonly attempt: number;

  constructor(
    sourceId: string,
    toolName: string,
    inputSha256: string,
    resultSha256: string,
    outputSchemaSha256: string,
    replayKeySha256: string,
    attempt: number,
  ) {
    super('MCP tool returned a result that failed FuryPipe post-call verification; do not retry automatically');
    this.name = 'McpDirectExecutionVerificationError';
    this.sourceId = sourceId;
    this.toolName = toolName;
    this.inputSha256 = inputSha256;
    this.resultSha256 = resultSha256;
    this.outputSchemaSha256 = outputSchemaSha256;
    this.replayKeySha256 = replayKeySha256;
    this.attempt = attempt;
  }
}

export class McpDirectExecutionEvidenceError extends Error {
  readonly code = 'MCP_DIRECT_EXECUTION_EVIDENCE_FAILED';
  readonly retrySafe = false;
  readonly executed = true;
  readonly verified = false;
  readonly sourceId: string;
  readonly toolName: string;
  readonly inputSha256: string;
  readonly succeeded: boolean;
  readonly replayKeySha256: string;
  readonly attempt: number;

  constructor(
    sourceId: string,
    toolName: string,
    inputSha256: string,
    succeeded: boolean,
    replayKeySha256: string,
    attempt: number,
  ) {
    super('MCP tool returned a result that could not be recorded safely; do not retry automatically');
    this.name = 'McpDirectExecutionEvidenceError';
    this.sourceId = sourceId;
    this.toolName = toolName;
    this.inputSha256 = inputSha256;
    this.succeeded = succeeded;
    this.replayKeySha256 = replayKeySha256;
    this.attempt = attempt;
  }
}

export class McpDirectExecutionDurabilityError extends Error {
  readonly code = 'MCP_DIRECT_EXECUTION_DURABILITY_FAILED';
  readonly retrySafe = false;
  readonly executed = true;
  readonly verified: boolean;
  readonly sourceId: string;
  readonly toolName: string;
  readonly inputSha256: string;
  readonly resultSha256: string;
  readonly succeeded: boolean;
  readonly replayKeySha256: string;
  readonly attempt: number;

  constructor(
    sourceId: string,
    toolName: string,
    inputSha256: string,
    resultSha256: string,
    succeeded: boolean,
    verified: boolean,
    replayKeySha256: string,
    attempt: number,
  ) {
    super('MCP tool returned a known result but durable execution evidence could not be committed; do not retry automatically');
    this.name = 'McpDirectExecutionDurabilityError';
    this.sourceId = sourceId;
    this.toolName = toolName;
    this.inputSha256 = inputSha256;
    this.resultSha256 = resultSha256;
    this.succeeded = succeeded;
    this.verified = verified;
    this.replayKeySha256 = replayKeySha256;
    this.attempt = attempt;
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
  readonly outputSchemaSha256?: string;
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
  let outputSchemaSha256: string | undefined;
  if (tool.outputSchema !== undefined) {
    const outputSchema = cloneSchema(tool.outputSchema, 'MCP fresh tool output schema');
    outputSchemaSha256 = digestMcpDirectJson(outputSchema, {
      maxBytes: MAX_SCHEMA_BYTES,
      maxDepth: MAX_JSON_DEPTH,
      label: 'MCP fresh tool output schema',
    });
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
    ...(outputSchemaSha256 === undefined ? {} : { outputSchemaSha256 }),
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
): Promise<McpDirectGovernedExecutionInternalResult> {
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

    const now = options.now?.() ?? Date.now();
    const permit = createMcpDirectExecutionPermit(
      approvedLifecycle,
      proposal.inputSha256,
      { now, expiresInMs: permitTtlMs },
    );

    // M4 duplicate/replay reservation is process-local and synchronous. It
    // blocks a second fresh M1→M2 approval for the same exact execution key
    // unless a short-lived process-local replay intent is supplied.
    const replayReservation = reserveMcpDirectExecutionAttempt(
      approvedLifecycle,
      proposal,
      options.replayIntent,
      now,
    );

    let durableReservation: McpDirectDurableReservation | undefined;
    if (options.durableReplay !== undefined) {
      if (!isGeneratedMcpDirectDurableReplayCoordinator(options.durableReplay)) {
        releaseMcpDirectExecutionReservation(replayReservation);
        throw new Error('MCP durable replay coordinator must be process-local FuryPipe evidence');
      }
      try {
        durableReservation = await reserveMcpDirectDurableExecution(
          options.durableReplay,
          replayReservation.replayKeySha256,
          {
            now,
            ...(replayReservation.replayed
              ? {
                  replay: {
                    priorAttempt: replayReservation.attempt - 1,
                    priorResultSha256: replayReservation.priorResultSha256!,
                    reason: replayReservation.reason!,
                  },
                }
              : {}),
          },
        );
      } catch (error) {
        releaseMcpDirectExecutionReservation(replayReservation);
        throw error;
      }
      if (
        durableReservation.attempt !== replayReservation.attempt
        || durableReservation.replayed !== replayReservation.replayed
      ) {
        await abortMcpDirectDurablePreCallReservation(
          options.durableReplay,
          durableReservation,
        ).catch(() => undefined);
        releaseMcpDirectExecutionReservation(replayReservation);
        throw new Error('MCP durable replay attempt does not match process-local replay governance');
      }
    }

    if (EXECUTION_ATTEMPTED.has(approvedLifecycle)) {
      if (durableReservation !== undefined && options.durableReplay !== undefined) {
        await abortMcpDirectDurablePreCallReservation(
          options.durableReplay,
          durableReservation,
        ).catch(() => undefined);
      }
      releaseMcpDirectExecutionReservation(replayReservation);
      throw new Error('MCP approved lifecycle was already used for an execution attempt');
    }

    try {
      consumeMcpDirectExecutionPermit(
        approvedLifecycle,
        permit,
        proposal.inputSha256,
        now,
      );
    } catch (error) {
      if (durableReservation !== undefined && options.durableReplay !== undefined) {
        await abortMcpDirectDurablePreCallReservation(
          options.durableReplay,
          durableReservation,
        ).catch(() => undefined);
      }
      releaseMcpDirectExecutionReservation(replayReservation);
      throw error;
    }

    let durableArmed: McpDirectDurableArmedEvidence | undefined;
    if (durableReservation !== undefined && options.durableReplay !== undefined) {
      try {
        durableArmed = await armMcpDirectDurableExecution(
          options.durableReplay,
          durableReservation,
          options.now?.() ?? Date.now(),
        );
      } catch (error) {
        await abortMcpDirectDurablePreCallReservation(
          options.durableReplay,
          durableReservation,
        ).catch(() => undefined);
        releaseMcpDirectExecutionReservation(replayReservation);
        throw error;
      }
    }

    EXECUTION_ATTEMPTED.add(approvedLifecycle);

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
      const failedAt = options.now?.() ?? Date.now();
      settleMcpDirectExecutionAttempt(
        replayReservation,
        'unknown',
        { now: failedAt },
      );
      if (durableArmed !== undefined && options.durableReplay !== undefined) {
        await settleMcpDirectDurableExecution(
          options.durableReplay,
          durableArmed,
          'unknown',
          { now: failedAt },
        ).catch(() => undefined);
      }
      throw new McpDirectExecutionOutcomeUnknownError(
        approvedLifecycle.source.sourceId,
        proposal.toolName,
        permitIdSha256,
        replayReservation.replayKeySha256,
        replayReservation.attempt,
      );
    } finally {
      clearTimeout(timeout);
    }

    const isError = resultIsToolError(result);
    let resultSha256: string;
    try {
      resultSha256 = digestMcpDirectJson(result, {
        maxBytes: maxResultBytes,
        maxDepth: MAX_JSON_DEPTH,
        label: 'MCP tool result',
      });
    } catch {
      // The remote tool returned, so execution is known even when the raw
      // result is too large/non-JSON to persist as digest evidence.
      recordMcpDirectExecution(approvedLifecycle, {
        permit,
        isError,
      });
      const evidenceFailedAt = options.now?.() ?? Date.now();
      settleMcpDirectExecutionAttempt(
        replayReservation,
        'evidence_failed',
        {
          succeeded: !isError,
          now: evidenceFailedAt,
        },
      );
      if (durableArmed !== undefined && options.durableReplay !== undefined) {
        await settleMcpDirectDurableExecution(
          options.durableReplay,
          durableArmed,
          'evidence_failed',
          {
            succeeded: !isError,
            now: evidenceFailedAt,
          },
        ).catch(() => undefined);
      }
      throw new McpDirectExecutionEvidenceError(
        approvedLifecycle.source.sourceId,
        proposal.toolName,
        proposal.inputSha256,
        !isError,
        replayReservation.replayKeySha256,
        replayReservation.attempt,
      );
    }
    const executed = recordMcpDirectExecution(approvedLifecycle, {
      permit,
      resultSha256,
      isError,
    });

    let finalLifecycle = executed;
    let verified = false;
    if (
      !isError
      && prepared.outputValidator !== undefined
      && prepared.outputSchemaSha256 !== undefined
    ) {
      const outputValid = await validateStructuredOutput(result, prepared.outputValidator);
      if (!outputValid) {
        const verificationFailedAt = options.now?.() ?? Date.now();
        settleMcpDirectExecutionAttempt(
          replayReservation,
          'verification_failed',
          {
            resultSha256,
            succeeded: true,
            now: verificationFailedAt,
          },
        );
        if (durableArmed !== undefined && options.durableReplay !== undefined) {
          await settleMcpDirectDurableExecution(
            options.durableReplay,
            durableArmed,
            'verification_failed',
            {
              resultSha256,
              succeeded: true,
              now: verificationFailedAt,
            },
          ).catch(() => undefined);
        }
        throw new McpDirectExecutionVerificationError(
          approvedLifecycle.source.sourceId,
          proposal.toolName,
          proposal.inputSha256,
          resultSha256,
          prepared.outputSchemaSha256,
          replayReservation.replayKeySha256,
          replayReservation.attempt,
        );
      }
      finalLifecycle = recordMcpDirectVerification(executed, {
        resultSha256,
        verificationKind: 'schema',
        schemaSha256: prepared.outputSchemaSha256,
      });
      verified = true;
    }

    let durableTerminal: McpDirectDurableReplayStatus | undefined;
    const terminalAt = options.now?.() ?? Date.now();
    if (durableArmed !== undefined && options.durableReplay !== undefined) {
      try {
        durableTerminal = await settleMcpDirectDurableExecution(
          options.durableReplay,
          durableArmed,
          isError ? 'tool_error' : 'succeeded',
          {
            resultSha256,
            succeeded: !isError,
            now: terminalAt,
          },
        );
      } catch {
        throw new McpDirectExecutionDurabilityError(
          approvedLifecycle.source.sourceId,
          proposal.toolName,
          proposal.inputSha256,
          resultSha256,
          !isError,
          verified,
          replayReservation.replayKeySha256,
          replayReservation.attempt,
        );
      }
      if (
        durableTerminal.state !== 'terminal'
        || durableTerminal.attempt !== replayReservation.attempt
        || durableTerminal.resultSha256 !== resultSha256
        || durableTerminal.outcome !== (isError ? 'tool_error' : 'succeeded')
      ) {
        throw new McpDirectExecutionDurabilityError(
          approvedLifecycle.source.sourceId,
          proposal.toolName,
          proposal.inputSha256,
          resultSha256,
          !isError,
          verified,
          replayReservation.replayKeySha256,
          replayReservation.attempt,
        );
      }
    }

    settleMcpDirectExecutionAttempt(
      replayReservation,
      isError ? 'tool_error' : 'succeeded',
      {
        resultSha256,
        succeeded: !isError,
        now: terminalAt,
      },
    );

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
      replayKeySha256: replayReservation.replayKeySha256,
      attempt: replayReservation.attempt,
      replayed: replayReservation.replayed,
      ...(replayReservation.reason === undefined
        ? {}
        : { replayReason: replayReservation.reason }),
      ...(replayReservation.priorResultSha256 === undefined
        ? {}
        : { priorResultSha256: replayReservation.priorResultSha256 }),
      ...(prepared.outputSchemaSha256 === undefined
        ? {}
        : { outputSchemaSha256: prepared.outputSchemaSha256 }),
      ...(fresh.protocolVersion === undefined ? {} : { protocolVersion: fresh.protocolVersion }),
      executed: true,
      succeeded: !isError,
      verified,
      ...(verified ? { verificationKind: 'schema' as const } : {}),
      ...(durableTerminal === undefined || options.durableReplay === undefined
        ? {}
        : {
            durableScopeSha256: options.durableReplay.scopeSha256,
            durableAttempt: durableTerminal.attempt,
          }),
    });

    registerGeneratedMcpDirectExecutionReceipt(receipt, replayReservation);

    return Object.freeze({
      lifecycle: finalLifecycle,
      receipt,
      result,
    });
  }, {
    // A close failure after a returned tool result must never erase successful
    // execution evidence and invite a duplicate retry.
    suppressCloseErrorAfterUse: true,
  });
}