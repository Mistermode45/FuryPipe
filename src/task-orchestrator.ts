import type { AgentFabricStageId } from './agent-fabric.js';
import {
  runAgent,
  type AgentMcpPlannedCall,
  type AgentMcpServerDefinition,
  type AgentRunResult,
  type AgentSkillDefinition,
  type AgentMemoryStore,
  type AgentStageExecutor,
  type AgentSubagentDefinition,
} from './agent-runtime.js';
import {
  prepareCapabilityRun,
  resolveFuryCapabilities,
  type CapabilityPluginActivation,
  type FuryCapabilityPlan,
  type FuryCapabilityResolveInput,
  type FuryCapabilityRunOptions,
} from './capability-router.js';
import {
  optimizeContext,
  type FuryContextItem,
  type FuryContextOptimizerInput,
  type FuryContextOptimizerPlan,
} from './context-optimizer.js';
import {
  injectFuryContext,
  renderFuryContextInjection,
} from './context-prompt-injection.js';
import {
  resolveFuryCatalog,
  type FuryCatalogResolution,
  type FuryCatalogResolverInput,
} from './capability-catalog-resolver.js';
import type { FuryInstructionPlan } from './instruction-fabric.js';
import type {
  FuryPromptCompileInput,
} from './fury-prompt.js';

export type FuryTaskContextOptions = Omit<FuryContextOptimizerInput, 'items'> & {
  readonly items?: readonly FuryContextItem[];
  /**
   * Inject the optimized included context into FuryPrompt.context.
   * Defaults to true.
   */
  readonly injectIncluded?: boolean;
};

export interface FuryTaskPrepareInput {
  readonly objective: string;
  readonly furyPrompt: FuryPromptCompileInput;
  /**
   * Capability Router input without objective. The top-level task objective is
   * authoritative and is always injected after this object is spread.
   */
  readonly capability: Omit<FuryCapabilityResolveInput, 'objective'>;
  /**
   * Optional trust-aware catalog resolution. This is advisory discovery only:
   * recommendations never become installed, connected, authorized, or selected
   * runtime capabilities merely by appearing here.
   */
  readonly catalog?: FuryCatalogResolverInput;
  readonly instruction?: FuryCapabilityRunOptions;
  readonly context?: FuryTaskContextOptions;
}

export interface FuryPreparedTask {
  readonly format: 'furypipe-prepared-task/v1';
  readonly objective: string;
  readonly capabilityPlan: FuryCapabilityPlan;
  /** Optional advisory catalog resolution. It never authorizes execution. */
  readonly catalogResolution?: FuryCatalogResolution;
  readonly instructionPlan: FuryInstructionPlan;
  readonly contextPlan: FuryContextOptimizerPlan;
  readonly furyPrompt: FuryPromptCompileInput;
  readonly skills: readonly AgentSkillDefinition[];
  /** Exact runtime MCP inventory used while capability routing built this task. */
  readonly mcpServers: readonly AgentMcpServerDefinition[];
  readonly autoInvokeSkillsByStage: Readonly<Partial<Record<AgentFabricStageId, readonly string[]>>>;
  readonly autoInvokeMcpByStage: Readonly<Partial<Record<AgentFabricStageId, readonly AgentMcpPlannedCall[]>>>;
  readonly pluginActivations: readonly CapabilityPluginActivation[];
  readonly qualityGates: readonly string[];
  readonly recommendedSecurityCritical: boolean;
  readonly contextInjected: boolean;
  /** UTF-8 bytes added to FuryPrompt.context by the orchestrator, including wrappers. */
  readonly injectedContextBytes: number;
}

const MAX_OBJECTIVE_CHARS = 64_000;

function objectiveText(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('task objective must be a string');
  const trimmed = value.trim();
  if (!trimmed) throw new Error('task objective must not be empty');
  if (trimmed.length > MAX_OBJECTIVE_CHARS || trimmed.includes('\0')) {
    throw new Error('task objective must be a bounded non-empty string');
  }
  return trimmed;
}

/**
 * Prepare one FuryPipe task without executing skills, MCP methods, subagents,
 * providers, filesystem writes, deployments, or external side effects.
 *
 * Resolution order:
 * 1. Optional Catalog Resolver (advisory recommendations only)
 * 2. Capability Router against the real registered runtime inventory
 * 3. Instruction Fabric through prepareCapabilityRun()
 * 4. Context Optimizer
 * 5. Safe data-only context injection into FuryPrompt
 */
export async function prepareFuryTask(input: FuryTaskPrepareInput): Promise<FuryPreparedTask> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('task orchestrator input is required');
  }
  if (!input.furyPrompt || typeof input.furyPrompt !== 'object' || Array.isArray(input.furyPrompt)) {
    throw new TypeError('task orchestrator requires a FuryPrompt input');
  }
  if (!input.capability || typeof input.capability !== 'object' || Array.isArray(input.capability)) {
    throw new TypeError('task orchestrator requires capability input');
  }

  const objective = objectiveText(input.objective);
  const catalogResolution = input.catalog === undefined
    ? undefined
    : resolveFuryCatalog(input.catalog);
  const capabilityPlan = await resolveFuryCapabilities({
    ...input.capability,
    objective,
  });
  const prepared = prepareCapabilityRun(
    input.furyPrompt,
    capabilityPlan,
    input.instruction,
  );

  const contextInput = input.context ?? {};
  const {
    items = Object.freeze([]),
    injectIncluded = true,
    ...optimizerOptions
  } = contextInput;
  const contextPlan = optimizeContext({
    ...optimizerOptions,
    items,
  });

  const renderedContext = injectIncluded
    ? renderFuryContextInjection(contextPlan)
    : Object.freeze({ blocks: Object.freeze([]), bytes: 0 });
  const furyPrompt = injectIncluded
    ? injectFuryContext(prepared.furyPrompt, renderedContext)
    : prepared.furyPrompt;

  return Object.freeze({
    format: 'furypipe-prepared-task/v1',
    objective,
    capabilityPlan,
    ...(catalogResolution === undefined ? {} : { catalogResolution }),
    instructionPlan: prepared.instructionPlan,
    contextPlan,
    furyPrompt,
    skills: prepared.skills,
    mcpServers: Object.freeze([...(input.capability.runtimeMcpServers ?? [])]),
    autoInvokeSkillsByStage: prepared.autoInvokeSkillsByStage,
    autoInvokeMcpByStage: prepared.autoInvokeMcpByStage,
    pluginActivations: prepared.pluginActivations,
    qualityGates: prepared.qualityGates,
    recommendedSecurityCritical: prepared.recommendedSecurityCritical,
    contextInjected: injectIncluded && contextPlan.included.length > 0,
    injectedContextBytes: renderedContext.bytes,
  });
}


export interface FuryPreparedTaskExecutionOptions {
  /** Host stage executors remain explicit; preparing a task never grants execution authority. */
  readonly executors: Partial<Record<AgentFabricStageId, AgentStageExecutor>>;
  readonly contextBudgetTokens?: number;
  readonly allowWrites?: boolean;
  readonly allowedWritePaths?: readonly string[];
  readonly runId?: string;
  readonly subagents?: readonly AgentSubagentDefinition[];
  readonly maxSubagentConcurrency?: number;
  readonly memory?: AgentMemoryStore;
}

/**
 * Execute exactly the capabilities that were selected during prepareFuryTask().
 *
 * This is the governed bridge between planning and execution:
 * - the prepared task's skill definitions are the only skills exposed;
 * - autoInvokeSkillsByStage / autoInvokeMcpByStage are forwarded unchanged;
 * - the exact MCP inventory used during routing is forwarded unchanged;
 * - write access remains opt-in and runAgent() re-applies all stage/permission/
 *   health/network/evidence/budget gates;
 * - AgentRunResult.capabilityExecutions proves what actually ran. A selected
 *   capability that never executed has no receipt.
 */
export async function runPreparedFuryTask(
  prepared: FuryPreparedTask,
  options: FuryPreparedTaskExecutionOptions,
): Promise<AgentRunResult> {
  if (!prepared || typeof prepared !== 'object' || prepared.format !== 'furypipe-prepared-task/v1') {
    throw new TypeError('prepared FuryPipe task is required');
  }
  if (!options || typeof options !== 'object' || !options.executors || typeof options.executors !== 'object') {
    throw new TypeError('prepared FuryPipe task execution requires stage executors');
  }

  return runAgent({
    objective: prepared.objective,
    furyPrompt: prepared.furyPrompt,
    ...(options.contextBudgetTokens === undefined ? {} : { contextBudgetTokens: options.contextBudgetTokens }),
    ...(options.allowWrites === undefined ? {} : { allowWrites: options.allowWrites }),
    ...(options.allowedWritePaths === undefined ? {} : { allowedWritePaths: options.allowedWritePaths }),
    ...(options.runId === undefined ? {} : { runId: options.runId }),
    executors: options.executors,
    skills: prepared.skills,
    autoInvokeSkillsByStage: prepared.autoInvokeSkillsByStage,
    autoInvokeMcpByStage: prepared.autoInvokeMcpByStage,
    mcpServers: prepared.mcpServers,
    ...(options.subagents === undefined ? {} : { subagents: options.subagents }),
    ...(options.maxSubagentConcurrency === undefined ? {} : { maxSubagentConcurrency: options.maxSubagentConcurrency }),
    ...(options.memory === undefined ? {} : { memory: options.memory }),
  });
}


export interface FuryExecutedTask {
  readonly format: 'furypipe-executed-task/v1';
  readonly prepared: FuryPreparedTask;
  readonly run: AgentRunResult;
}

/**
 * Prepare and execute one task through the governed FuryPipe path.
 *
 * This convenience surface exists to make the product contract hard to misuse:
 * callers that intend execution should not stop at capability selection and then
 * accidentally report selected Skills/MCP as used. The returned run contains
 * capabilityExecutions receipts for callbacks that actually completed.
 */
export async function executeFuryTask(
  input: FuryTaskPrepareInput,
  options: FuryPreparedTaskExecutionOptions,
): Promise<FuryExecutedTask> {
  const prepared = await prepareFuryTask(input);
  const run = await runPreparedFuryTask(prepared, options);
  return Object.freeze({
    format: 'furypipe-executed-task/v1',
    prepared,
    run,
  });
}
