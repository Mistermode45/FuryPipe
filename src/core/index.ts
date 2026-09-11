export {
  getAllowedModelBases,
  getConfiguredModelBases,
  isPxpipeSupportedGptModel,
  isPxpipeSupportedModel,
  setAllowedModelBases,
  shouldTransformAnthropicMessages,
  type PxpipeApplicabilityInput,
  type PxpipeApplicabilityReason,
} from './applicability.js';
export {
  buildCountTokensBodies,
  buildBaselineCountTokensBody,
  buildCacheablePrefixCountTokensBody,
  countCacheControlMarkers,
  type CountTokensBodies,
} from './measurement.js';
export {
  transformAnthropicMessages,
  renderTextToImages,
  type PxpipeOptions,
  type PxpipeReason,
  type PxpipeTransformInput,
  type PxpipeTransformResult,
  type RenderTextToImagesOptions,
  type RenderedTextImage,
  type RenderTextToImagesResult,
} from './library.js';
export {
  transformRequest,
  type TransformInfo as PxpipeTransformInfo,
  type TransformOptions,
  type KeepSharpBlock,
  type RecoverableBlock,
} from './transform.js';
export { transformOpenAIChatCompletions, transformOpenAIResponses, resolveVisionCost, openAIVisionTokens } from './openai.js';
export { createProxy, type ProxyConfig, type ProxyEvent } from './proxy.js';
export {
  createProviderRouter,
  parseProviderRoute,
  assertProviderId,
  type ProviderProtocol,
  type ProviderRouteDefinition,
  type ProviderRouterConfig,
  type ProviderRouterInspection,
  type ParsedProviderRoute,
} from './provider-router.js';
export {
  computeActualInputEff,
  computeBaselineInputEff,
  CACHE_CREATE_RATE,
  CACHE_READ_RATE,
} from './baseline.js';
export {
  buildPrecisionManifest,
  detectProtectedSpans,
  exactGuardOptionsForMode,
  verifyPrecisionManifest,
  type ExactGuardOptions,
  type ExactGuardMode,
  type ExactGuardRule,
  type ExactnessClass,
  type PrecisionManifest,
  type PrecisionVerification,
  type ProtectedSpan,
  type RepresentationPolicy,
} from './exact-guard.js';
export {
  createRecoveryStore,
  type RecoveryHandle,
  type RecoveryMetadata,
  type RecoveryStore,
  type RecoveryStoreOptions,
  type RecoveryVerification,
  type RecoveryBackupSummary,
} from './recovery-store.js';
export {
  createContextIR,
  createContextIRBlock,
  verifyContextIR,
  verifyContextIRBlockText,
  type ContextIR,
  type ContextIRBlock,
  type ContextIRBlockInput,
  type ContextIRVerification,
  type IRCompressionEligibility,
  type IRExactnessClass,
  type IRSourceRole,
  type IRTrustLevel,
} from './context-ir.js';
export {
  appendInstructionEntry,
  createInstructionEntry,
  createInstructionLedger,
  validateInstructionLedger,
  type InstructionCategory,
  type InstructionEntry,
  type InstructionEntryInput,
  type InstructionLedger,
  type InstructionSourceRole,
  type LedgerValidation,
} from './instruction-ledger.js';
export {
  planCache,
  type CachePlan,
  type CachePlanSegment,
  type CacheProviderContract,
} from './cache-planner.js';
export {
  evaluatePolicy,
  type PolicyConstraints,
  type PolicyCostInputs,
  type PolicyDecision,
  type PolicyMode,
  type PolicyRequest,
  type PolicyStrategy,
} from './policy-engine.js';
export {
  evaluatePolicyFabric,
  type CircuitState,
  type PolicyFabricDecision,
  type PolicyFabricRequest,
  type PolicyFabricStrategy,
  type PolicyProviderState,
  type PolicyStrategyAssessment,
  type ProviderHealthStatus,
} from './policy-fabric.js';
export {
  createCompressionReceipt,
  verifyCompressionReceipt,
  type CompressionReceipt,
  type CompressionReceiptInput,
  type ReceiptConfidence,
} from './receipt.js';
export {
  classifyContent,
  type ClassifiedContent,
  type ClassifiedContentKind,
  type ClassifiedEligibility,
  type ClassifiedSensitivity,
  type ContentClassifierHints,
} from './content-classifier.js';
export {
  createRecoveryIndex,
  type RecoveryIndex,
  type RecoverySearchHit,
  type RecoverySearchOptions,
} from './source-retrieval.js';
export {
  compileDocument,
  type DocumentCompilation,
  type DocumentCompilerInput,
} from './document-compiler.js';
export {
  analyzeContextFabric,
  finalizeContextFabricAnalysis,
  type ContextFabricAnalysis,
} from './context-fabric.js';
