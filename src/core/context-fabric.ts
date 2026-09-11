import type { ContentBlock, MessagesRequest, SystemField, ToolDef } from './types.js';
import { classifyContent, type ClassifiedContentKind, type ContentClassifierHints } from './content-classifier.js';
import { createContextIR, verifyContextIR, type ContextIR, type ContextIRBlockInput, type IRSourceRole } from './context-ir.js';
import {
  appendInstructionEntry,
  createInstructionLedger,
  validateInstructionLedger,
  type InstructionCategory,
  type InstructionLedger,
} from './instruction-ledger.js';
import { planCache, type CachePlan } from './cache-planner.js';
import { evaluatePolicy, type PolicyDecision, type PolicyMode, type PolicyStrategy } from './policy-engine.js';
import { evaluatePolicyFabric, type PolicyFabricDecision } from './policy-fabric.js';
import { resolveProviderFabric, type ProviderFabricDecision } from './provider-fabric.js';

/**
 * Safe, bounded diagnostics for one request's shared context pipeline.
 *
 * The IR and ledger are deliberately kept internal to this module. Their
 * content hashes are useful for integrity, but the public diagnostic only
 * exposes aggregate counts and opaque block IDs. Source plaintext never
 * crosses this boundary.
 */
export interface ContextFabricAnalysis {
  readonly format: 'furypipe-context-fabric-analysis/v1';
  readonly protocol: 'anthropic.messages';
  readonly requestId: string;
  readonly parsed: {
    readonly messageCount: number;
    readonly toolCount: number;
    readonly systemBlocks: number;
    readonly textBlocks: number;
    readonly nativeImageBlocks: number;
  };
  readonly classifier: {
    readonly blockCount: number;
    readonly kinds: Readonly<Record<ClassifiedContentKind, number>>;
    readonly sensitivity: Readonly<Record<'public' | 'internal' | 'confidential' | 'secret', number>>;
    readonly eligibility: Readonly<Record<'allow' | 'guarded' | 'deny', number>>;
  };
  readonly ir: {
    readonly blockCount: number;
    readonly verification: 'ok' | 'invalid';
    readonly opaqueBlockIds: readonly string[];
  };
  readonly ledger: {
    readonly entryCount: number;
    readonly activeEntryCount: number;
    readonly historicalEntryCount: number;
    readonly latestUserRequest: boolean;
    readonly verification: 'ok' | 'invalid';
  };
  readonly cache: Pick<CachePlan, 'format' | 'provider' | 'protocol' | 'mode' | 'orderedBlockIds' | 'requiresProviderContractTest' | 'reason'>;
  readonly policy: PolicyDecision;
  readonly policyFabric: PolicyFabricDecision;
  readonly providerFabric: ProviderFabricDecision;
  readonly strategy: {
    readonly planned: PolicyStrategy;
    readonly observed?: PolicyStrategy | 'externalize';
    readonly compressed?: boolean;
    readonly reason?: string;
  };
  readonly verification: {
    readonly phase: 'pre_transform' | 'post_transform';
    readonly ir: 'ok' | 'invalid';
    readonly ledger: 'ok' | 'invalid';
    readonly inputBytes?: number;
    readonly outputBytes?: number;
  };
}

interface FabricOptions {
  readonly requestId?: string;
  readonly mode?: PolicyMode;
  readonly providerAvailable?: boolean;
  readonly providerId?: string;
}

interface FabricSource {
  readonly text: string;
  readonly sourceRole: IRSourceRole;
  readonly sourceProviderShape: string;
  readonly source: string;
  readonly provenance: string;
  readonly logicalTurn: number;
  readonly classifierHints?: ContentClassifierHints;
  readonly cacheClass: 'stable' | 'semi_stable' | 'dynamic' | 'not_cacheable';
  readonly sideEffectClass: 'none' | 'idempotent' | 'non_idempotent' | 'unknown';
}

const KINDS: readonly ClassifiedContentKind[] = ['plain_text', 'json', 'code', 'log', 'tool_output', 'markdown'];
const SENSITIVITIES = ['public', 'internal', 'confidential', 'secret'] as const;
const ELIGIBILITIES = ['allow', 'guarded', 'deny'] as const;

function emptyCounts<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function addTextSource(sources: FabricSource[], source: FabricSource): void {
  if (source.text.length === 0) return;
  sources.push(source);
}

function addContentSources(
  sources: FabricSource[],
  content: string | ContentBlock[],
  base: Omit<FabricSource, 'text' | 'sourceRole' | 'sourceProviderShape' | 'classifierHints'>,
  role: IRSourceRole,
  shape: string,
  hints: ContentClassifierHints,
): { textBlocks: number; nativeImageBlocks: number } {
  if (typeof content === 'string') {
    addTextSource(sources, { ...base, text: content, sourceRole: role, sourceProviderShape: shape, classifierHints: hints });
    return { textBlocks: content.length > 0 ? 1 : 0, nativeImageBlocks: 0 };
  }

  let textBlocks = 0;
  let nativeImageBlocks = 0;
  for (let index = 0; index < content.length; index += 1) {
    const block = content[index]!;
    if (block.type === 'text') {
      textBlocks += block.text.length > 0 ? 1 : 0;
      addTextSource(sources, {
        ...base,
        text: block.text,
        sourceRole: role,
        sourceProviderShape: shape,
        provenance: `${base.provenance}:block-${index}`,
        classifierHints: hints,
      });
    } else if (block.type === 'tool_result') {
      const nested = addContentSources(
        sources,
        block.content,
        { ...base, provenance: `${base.provenance}:tool-result-${index}` },
        'tool',
        'anthropic.tool_result',
        { role: 'tool' },
      );
      textBlocks += nested.textBlocks;
      nativeImageBlocks += nested.nativeImageBlocks;
    } else if (block.type === 'image') {
      nativeImageBlocks += 1;
    }
  }
  return { textBlocks, nativeImageBlocks };
}

function addSystemSources(sources: FabricSource[], system: SystemField | undefined): { systemBlocks: number; textBlocks: number; nativeImageBlocks: number } {
  if (system === undefined) return { systemBlocks: 0, textBlocks: 0, nativeImageBlocks: 0 };
  if (typeof system === 'string') {
    addTextSource(sources, {
      text: system,
      sourceRole: 'system',
      sourceProviderShape: 'anthropic.system',
      source: 'system',
      provenance: 'anthropic.system',
      logicalTurn: 0,
      classifierHints: { role: 'system' },
      cacheClass: 'stable',
      sideEffectClass: 'none',
    });
    return { systemBlocks: system.length > 0 ? 1 : 0, textBlocks: system.length > 0 ? 1 : 0, nativeImageBlocks: 0 };
  }

  let textBlocks = 0;
  let nativeImageBlocks = 0;
  for (let index = 0; index < system.length; index += 1) {
    const block = system[index]!;
    if (block.type === 'text') {
      textBlocks += block.text.length > 0 ? 1 : 0;
      addTextSource(sources, {
        text: block.text,
        sourceRole: 'system',
        sourceProviderShape: 'anthropic.system.text',
        source: 'system',
        provenance: `anthropic.system:block-${index}`,
        logicalTurn: 0,
        classifierHints: { role: 'system' },
        cacheClass: 'stable',
        sideEffectClass: 'none',
      });
    } else {
      nativeImageBlocks += 1;
    }
  }
  return { systemBlocks: system.length, textBlocks, nativeImageBlocks };
}

function addToolSources(sources: FabricSource[], tools: readonly ToolDef[] | undefined): number {
  if (!tools) return 0;
  for (let index = 0; index < tools.length; index += 1) {
    const tool = tools[index]!;
    const description = [tool.name, tool.description].filter((value): value is string => typeof value === 'string' && value.length > 0).join('\n');
    addTextSource(sources, {
      text: description,
      sourceRole: 'system',
      sourceProviderShape: 'anthropic.tool_definition',
      source: 'tools',
      provenance: `anthropic.tools:${index}`,
      logicalTurn: 0,
      classifierHints: { role: 'system', filename: `${tool.name}.json` },
      cacheClass: 'stable',
      sideEffectClass: 'none',
    });
  }
  return tools.length;
}

function collectSources(request: MessagesRequest): {
  sources: FabricSource[];
  parsed: ContextFabricAnalysis['parsed'];
  latestUserText?: string;
  latestUserProvenance?: string;
  systemTexts: Array<{ text: string; provenance: string }>;
} {
  const sources: FabricSource[] = [];
  const system = addSystemSources(sources, request.system);
  const toolCount = addToolSources(sources, request.tools);
  let textBlocks = system.textBlocks;
  let nativeImageBlocks = system.nativeImageBlocks;
  let latestUserText: string | undefined;
  let latestUserProvenance: string | undefined;
  const systemTexts: Array<{ text: string; provenance: string }> = [];

  for (let messageIndex = 0; messageIndex < request.messages.length; messageIndex += 1) {
    const message = request.messages[messageIndex]!;
    const role: IRSourceRole = message.role;
    const content = message.content;
    const before = sources.length;
    const nested = addContentSources(
      sources,
      content,
      {
        source: `message-${messageIndex}`,
        provenance: `anthropic.messages:${messageIndex}`,
        logicalTurn: messageIndex + 1,
        cacheClass: messageIndex === 0 ? 'semi_stable' : 'dynamic',
        sideEffectClass: 'none',
      },
      role,
      role === 'assistant' ? 'anthropic.assistant' : 'anthropic.user',
      { role },
    );
    textBlocks += nested.textBlocks;
    nativeImageBlocks += nested.nativeImageBlocks;
    for (const source of sources.slice(before)) {
      if (source.sourceRole === 'system') systemTexts.push({ text: source.text, provenance: source.provenance });
      if (role === 'user' && source.sourceRole === 'user') {
        latestUserText = source.text;
        latestUserProvenance = source.provenance;
      }
    }
  }

  return {
    sources,
    parsed: {
      messageCount: request.messages.length,
      toolCount,
      systemBlocks: system.systemBlocks,
      textBlocks,
      nativeImageBlocks,
    },
    latestUserText,
    latestUserProvenance,
    systemTexts,
  };
}

function modeFromInput(mode: PolicyMode | undefined): PolicyMode {
  return mode ?? 'balanced';
}

function buildInstructionLedger(
  systemTexts: readonly { text: string; provenance: string }[],
  latestUserText: string | undefined,
  latestUserProvenance: string | undefined,
): InstructionLedger {
  let ledger = createInstructionLedger();
  for (const system of systemTexts) {
    ledger = appendInstructionEntry(ledger, {
      category: 'objective' satisfies InstructionCategory,
      sourceRole: 'system',
      scope: 'anthropic.messages',
      text: system.text,
      provenance: system.provenance,
      logicalTurn: 0,
      active: true,
      historical: false,
    });
  }
  if (latestUserText !== undefined) {
    ledger = appendInstructionEntry(ledger, {
      category: 'latest_user_request',
      sourceRole: 'user',
      scope: 'anthropic.messages',
      text: latestUserText,
      provenance: latestUserProvenance ?? 'anthropic.messages:user',
      logicalTurn: 1,
      active: true,
      historical: false,
    });
  }
  return ledger;
}

function policyCosts(ir: ContextIR): Parameters<typeof evaluatePolicy>[0]['costs'] {
  const regularInput = ir.blocks.reduce((sum, block) => sum + (block.tokenEstimate ?? 0), 0);
  const eligibleTokens = ir.blocks
    .filter((block) => block.compressionEligibility === 'allow')
    .reduce((sum, block) => sum + (block.tokenEstimate ?? 0), 0);
  return {
    // These are bounded token-unit estimates, not provider prices. The policy
    // remains explicitly `estimated` until a provider/model cost oracle exists.
    regularInput,
    cacheWrite: Math.ceil(regularInput * 0.01),
    cacheRead: Math.ceil(regularInput * 0.001),
    visualInput: Math.ceil(eligibleTokens * 0.35),
    retrieval: 0,
    localCompute: Math.max(1, Math.ceil(ir.blocks.length / 8)),
    retry: 0,
    output: 0,
  };
}

/** Build the shared, non-mutating analysis before the lossy transform runs. */
export function analyzeContextFabric(request: MessagesRequest, options: FabricOptions = {}): ContextFabricAnalysis {
  const collected = collectSources(request);
  const requestId = options.requestId ?? 'fabric-runtime';
  const irInputs: ContextIRBlockInput[] = [];
  const kindCounts = emptyCounts(KINDS);
  const sensitivityCounts = emptyCounts(SENSITIVITIES);
  const eligibilityCounts = emptyCounts(ELIGIBILITIES);

  for (const source of collected.sources) {
    const classification = classifyContent(source.text, source.classifierHints);
    kindCounts[classification.kind] += 1;
    sensitivityCounts[classification.sensitivity] += 1;
    eligibilityCounts[classification.compressionEligibility] += 1;
    const exactnessClass = classification.sensitivity === 'secret'
      ? 'BYTE_EXACT_REQUIRED'
      : classification.compressionEligibility === 'allow' ? 'LOSSY_ALLOWED' : 'TOKEN_EXACT_REQUIRED';
    irInputs.push({
      sourceRole: source.sourceRole,
      sourceProviderShape: source.sourceProviderShape,
      semanticType: classification.kind,
      trustLevel: source.sourceRole === 'system' ? 'SYSTEM_TRUSTED'
        : source.sourceRole === 'user' ? 'USER_AUTHORED'
          : source.sourceRole === 'tool' ? 'TOOL_UNTRUSTED_CONTENT' : 'GENERATED_DERIVED',
      provenance: source.provenance,
      tokenEstimate: classification.tokenEstimate,
      exactnessClass,
      volatilityClass: source.cacheClass === 'dynamic' ? 'dynamic' : source.cacheClass === 'semi_stable' ? 'semi_stable' : 'stable',
      cacheClass: source.cacheClass,
      sideEffectClass: source.sideEffectClass,
      sensitivityClass: classification.sensitivity,
      compressionEligibility: classification.compressionEligibility,
      dependencies: [],
      references: [],
      createdAt: new Date().toISOString(),
      logicalTurn: source.logicalTurn,
      lineage: [source.source, source.provenance],
      text: source.text,
    });
  }

  const ir = createContextIR(requestId, irInputs);
  const irVerification = verifyContextIR(ir);
  const ledger = buildInstructionLedger(collected.systemTexts, collected.latestUserText, collected.latestUserProvenance);
  const ledgerVerification = validateInstructionLedger(ledger);
  const cache = planCache(ir.blocks, {
    provider: 'anthropic',
    protocol: 'messages',
    minTokens: 1024,
    granularity: 'prefix',
    strictOrdering: true,
    explicitMarkers: true,
  });
  const costs = policyCosts(ir);
  const policy = evaluatePolicy({
    mode: modeFromInput(options.mode),
    blocks: ir.blocks,
    costs,
    providerAvailable: options.providerAvailable,
  });
  const policyFabric = evaluatePolicyFabric({
    provider: 'anthropic',
    mode: modeFromInput(options.mode),
    blocks: ir.blocks,
    costs,
    providerState: { status: 'unknown', circuit: 'closed' },
  });
  const providerFabric = resolveProviderFabric({
    providerId: options.providerId ?? 'anthropic',
    model: request.model,
    protocol: 'anthropic',
  });
  return {
    format: 'furypipe-context-fabric-analysis/v1',
    protocol: 'anthropic.messages',
    requestId,
    parsed: collected.parsed,
    classifier: {
      blockCount: collected.sources.length,
      kinds: kindCounts,
      sensitivity: sensitivityCounts,
      eligibility: eligibilityCounts,
    },
    ir: {
      blockCount: ir.blocks.length,
      verification: irVerification.ok ? 'ok' : 'invalid',
      opaqueBlockIds: ir.blocks.map((block) => block.id),
    },
    ledger: {
      entryCount: ledger.entries.length,
      activeEntryCount: ledger.entries.filter((entry) => entry.active).length,
      historicalEntryCount: ledger.entries.filter((entry) => entry.historical).length,
      latestUserRequest: ledger.latestUserTurnId !== undefined,
      verification: ledgerVerification.ok ? 'ok' : 'invalid',
    },
    cache: {
      format: cache.format,
      provider: cache.provider,
      protocol: cache.protocol,
      mode: cache.mode,
      orderedBlockIds: cache.orderedBlockIds,
      requiresProviderContractTest: cache.requiresProviderContractTest,
      reason: cache.reason,
    },
    policy,
    policyFabric,
    providerFabric,
    strategy: { planned: policy.strategy },
    verification: {
      phase: 'pre_transform',
      ir: irVerification.ok ? 'ok' : 'invalid',
      ledger: ledgerVerification.ok ? 'ok' : 'invalid',
    },
  };
}

/** Attach the observed transform outcome without exposing request content. */
export function finalizeContextFabricAnalysis(
  analysis: ContextFabricAnalysis,
  inputBytes: number,
  outputBytes: number,
  compressed: boolean,
  reason: string | undefined,
): ContextFabricAnalysis {
  // The current Anthropic path only applies the lossy renderer; it does not
  // have a separate native-cache executor. An uncompressed body is therefore
  // observed as raw, even when the planner recommends native cache.
  const observed: PolicyStrategy | 'externalize' = reason?.startsWith('exact_guard (externalize')
    ? 'externalize'
    : compressed ? 'guarded-lossy' : 'raw';
  return {
    ...analysis,
    strategy: { ...analysis.strategy, observed, compressed, ...(reason ? { reason } : {}) },
    verification: {
      phase: 'post_transform',
      ir: analysis.ir.verification,
      ledger: analysis.ledger.verification,
      inputBytes,
      outputBytes,
    },
  };
}
