/** Applicability helpers for FuryPipe's production-safe model scope. */

import {
  isMisresolvedModelId,
  resolveVisionPricingEvidence,
  type FuryVisionPricingEvidence,
} from './gpt-model-profiles.js';
import {
  resolveRuntimeVisualModel,
  type ModelVisualResolution,
} from './model-fabric.js';
import { stripBracketedSegments } from './safe-string.js';

export type FuryPipeApplicabilityReason =
  | 'eligible'
  | 'unsupported_model'
  | 'vision_capability_unknown'
  | 'visual_profile_unverified'
  | 'text_only_model'
  | 'visual_pricing_unknown'
  | 'visual_profile_blocked'
  | 'unsupported_method'
  | 'unsupported_path'
  | 'empty_body';

export interface FuryPipeApplicabilityInput {
  readonly model?: string | null;
  readonly method?: string | null;
  readonly path?: string | null;
  readonly bodyBytes?: number | null;
}

/** Bracketed variant tags (e.g. `[1m]`) stripped before model matching so base and variant gate identically. */
function baseModelId(model: string): string {
  return stripBracketedSegments(model);
}

/** Dashboard runtime override; null = fall back to FURYPIPE_MODELS / automatic vision policy. */
let runtimeModelBases: readonly string[] | null = null;

/**
 * Human-readable zero-config policy seed.
 *
 * This is no longer FuryPipe's model catalog. It documents the current families
 * that the built-in capability resolver can classify without a provider catalog.
 * Provider-discovered vision models can also enter the Visual Engine without a
 * FuryPipe release. FURYPIPE_MODELS remains an explicit operator override.
 */
export const DEFAULT_MODEL_BASES = Object.freeze([
  'claude-fable-5',
  'gemini',
]);

export type FuryPipeVisualPolicy = 'auto' | 'max_savings' | 'safe_exact' | 'text_only';

let runtimeVisualPolicy: FuryPipeVisualPolicy | null = null;

export function setFuryPipeVisualPolicy(policy: FuryPipeVisualPolicy | null): void {
  runtimeVisualPolicy = policy;
}

/**
 * Global automatic visual policy.
 *
 * AUTO is evidence-first but practical: quality-verified and calibrated
 * reader profiles are transformed automatically. SAFE_EXACT accepts only
 * quality-verified profiles. MAX_SAVINGS admits every model whose image-input
 * capability is positively proven and whose image economics are known, while
 * downstream ExactGuard, profitability, image-count and byte-budget gates still
 * apply. TEXT_ONLY is a hard kill switch for visual transformation.
 */
export function getFuryPipeVisualPolicy(): FuryPipeVisualPolicy {
  if (runtimeVisualPolicy !== null) return runtimeVisualPolicy;
  if (typeof process === 'undefined') return 'auto';
  const raw = process.env?.FURYPIPE_VISUAL_POLICY?.trim().toLowerCase();
  if (raw === 'max_savings' || raw === 'safe_exact' || raw === 'text_only' || raw === 'auto') return raw;
  return 'auto';
}

function falsey(v: string): boolean {
  return /^(0|false|no|off|none)$/i.test(v.trim());
}

function rawModelScope(): string | undefined {
  return typeof process !== 'undefined' ? process.env?.FURYPIPE_MODELS : undefined;
}

/** True only when an operator deliberately supplied a non-empty model policy. */
function hasExplicitEnvironmentScope(): boolean {
  const raw = rawModelScope();
  return raw !== undefined && raw.trim().length > 0;
}

/** FURYPIPE_MODELS env / automatic policy seed, ignoring the runtime override.
 *
 * - unset or empty          → automatic vision-capable policy
 * - off/0/false/no/none     → compress nothing
 * - CSV model bases         → exactly those bases
 */
function envOrDefaultBases(): string[] {
  const raw = rawModelScope();
  if (raw === undefined) return [...DEFAULT_MODEL_BASES];
  const trimmed = raw.trim();
  if (!trimmed) return [...DEFAULT_MODEL_BASES];
  if (falsey(trimmed)) return [];
  return trimmed.split(',').map((model) => model.trim()).filter(Boolean);
}

function allowedModelBases(): string[] {
  if (runtimeModelBases !== null) return [...runtimeModelBases];
  return envOrDefaultBases();
}

/** Current effective operator-facing model scope. Dynamic catalog entries are separate. */
export function getAllowedModelBases(): string[] {
  return allowedModelBases();
}

/** Configured policy seed, not a complete model catalog. */
export function getConfiguredModelBases(): string[] {
  return envOrDefaultBases();
}

/** Set the dashboard runtime override. Empty array = compress nothing; null = automatic/default policy. */
export function setAllowedModelBases(list: readonly string[] | null): void {
  runtimeModelBases = list === null ? null : list.map((s) => s.trim()).filter(Boolean);
}

/** Gateway/provider prefixes select an upstream, not a visual reader profile. */
function unqualifiedModelId(base: string): string | null {
  const slash = base.lastIndexOf('/');
  return slash >= 0 ? base.slice(slash + 1) : null;
}

function matchesExplicitScope(base: string): boolean {
  const unqualified = unqualifiedModelId(base);
  return allowedModelBases().some((entry) => {
    const target = entry.toLowerCase();
    const hit = (id: string): boolean => id === target || id.startsWith(`${target}-`);
    return hit(base) || (unqualified !== null && hit(unqualified));
  });
}

type FuryPipeModelEligibilityFailureReason = Exclude<
  Extract<
    FuryPipeApplicabilityReason,
    'eligible' | 'unsupported_model' | 'vision_capability_unknown' | 'visual_profile_unverified' | 'text_only_model' | 'visual_pricing_unknown' | 'visual_profile_blocked'
  >,
  'eligible'
>;

export type FuryPipeModelEligibility =
  | {
      readonly eligible: true;
      readonly reason: 'eligible';
      readonly resolution?: ModelVisualResolution;
      readonly pricingEvidence?: FuryVisionPricingEvidence;
      readonly source: 'operator_scope' | 'automatic_model_fabric';
    }
  | {
      readonly eligible: false;
      readonly reason: FuryPipeModelEligibilityFailureReason;
      readonly resolution?: ModelVisualResolution;
      readonly pricingEvidence?: FuryVisionPricingEvidence;
      readonly source: 'operator_scope' | 'automatic_model_fabric';
    };

/**
 * Resolve model eligibility without equating "unknown model name" with
 * "unsupported".  In automatic mode, the Model Fabric admits proven
 * vision-capable readers, including newly discovered provider models.  An
 * explicit FURYPIPE_MODELS/runtime override remains authoritative.
 */
export function resolveFuryPipeModelEligibility(
  model: string | null | undefined,
): FuryPipeModelEligibility {
  if (typeof model !== 'string' || !model.trim()) {
    return Object.freeze({
      eligible: false,
      reason: 'unsupported_model',
      source: 'automatic_model_fabric',
    });
  }

  const base = baseModelId(model).toLowerCase();
  const visualPolicy = getFuryPipeVisualPolicy();

  if (visualPolicy === 'text_only') {
    return Object.freeze({
      eligible: false,
      reason: 'visual_profile_blocked',
      source: 'automatic_model_fabric',
      resolution: resolveRuntimeVisualModel(base),
    });
  }

  // A runtime dashboard override is always explicit, even when it is [].
  // A non-empty FURYPIPE_MODELS value is also explicit; "off" therefore stays
  // a hard kill switch instead of being bypassed by capability discovery.
  if (runtimeModelBases !== null || hasExplicitEnvironmentScope()) {
    const resolution = resolveRuntimeVisualModel(base);
    if (isMisresolvedModelId(base) || resolution.reason === 'blocked_profile') {
      return Object.freeze({
        eligible: false,
        reason: 'visual_profile_blocked',
        source: 'operator_scope',
        resolution,
      });
    }
    // A positive provider capability denial cannot be overridden into an
    // image request by a stale CSV. Unknown capability remains operator-forced
    // for backward compatibility, but proven text-only always fails closed.
    if (resolution.imageInput === 'no') {
      return Object.freeze({
        eligible: false,
        reason: 'text_only_model',
        source: 'operator_scope',
        resolution,
      });
    }
    const scoped = matchesExplicitScope(base);
    if (scoped) {
      return Object.freeze({
        eligible: true,
        reason: 'eligible',
        source: 'operator_scope',
        resolution,
      });
    }
    return Object.freeze({
      eligible: false,
      reason: 'unsupported_model',
      source: 'operator_scope',
      resolution,
    });
  }

  // Automatic mode is capability-driven but evidence-aware. Discovery proves
  // existence, capability metadata proves image input, and quality evidence
  // decides whether AUTO may transform. MAX_SAVINGS is the explicit broad mode
  // requested by operators who prefer coverage/savings over conservative
  // quality rollout; it still requires positively proven image input.
  const resolution = resolveRuntimeVisualModel(base);
  if (isMisresolvedModelId(base)) {
    return Object.freeze({
      eligible: false,
      reason: 'visual_profile_blocked',
      source: 'automatic_model_fabric',
      resolution,
    });
  }
  if (resolution.imageInput === 'no') {
    return Object.freeze({
      eligible: false,
      reason: 'text_only_model',
      source: 'automatic_model_fabric',
      resolution,
    });
  }
  if (resolution.imageInput !== 'yes' || resolution.mode === 'native') {
    return Object.freeze({
      eligible: false,
      reason: resolution.reason === 'blocked_profile' ? 'visual_profile_blocked' : 'vision_capability_unknown',
      source: 'automatic_model_fabric',
      resolution,
    });
  }

  const broadVisual = visualPolicy === 'max_savings';
  const qualityVerified = resolution.profile === 'quality_verified';
  const calibrated = resolution.profile === 'calibrated';
  const pricingEvidence = resolveVisionPricingEvidence(base);
  const canaryWithKnownEconomics = resolution.mode === 'canary' && pricingEvidence !== 'unknown';

  // AUTO is future-proof but still evidence-gated: a newly released model can
  // enter the Visual Engine when image input and provider-appropriate economics
  // are both proven, even before it has earned CALIBRATED/QUALITY_VERIFIED.
  // Such readers remain visibly UNPROFILED/CANARY in Model Fabric and downstream
  // ExactGuard, byte/image budgets and profitability gates still decide whether
  // a particular block is actually externalized.
  const policyAllowsProfile = visualPolicy === 'safe_exact'
    ? qualityVerified
    : visualPolicy === 'auto'
      ? (qualityVerified || calibrated || canaryWithKnownEconomics)
      : broadVisual;

  if (!policyAllowsProfile) {
    return Object.freeze({
      eligible: false,
      reason: resolution.imageInput === 'yes' ? 'visual_profile_unverified' : 'vision_capability_unknown',
      source: 'automatic_model_fabric',
      resolution,
      pricingEvidence,
    });
  }

  // Dynamic discovery can prove "accepts image input" before FuryPipe has a
  // provider-appropriate cost profile. AUTO/MAX_SAVINGS both remain native in
  // that case rather than fabricating another provider's image-token economics.
  if ((broadVisual || visualPolicy === 'auto') && pricingEvidence === 'unknown') {
    return Object.freeze({
      eligible: false,
      reason: 'visual_pricing_unknown',
      source: 'automatic_model_fabric',
      resolution,
      pricingEvidence,
    });
  }

  return Object.freeze({
    eligible: true,
    reason: 'eligible',
    source: 'automatic_model_fabric',
    resolution,
    pricingEvidence,
  });
}

/** True when FuryPipe may transform this Anthropic/OpenAI-compatible model. */
export function isFuryPipeSupportedModel(model: string | null | undefined): boolean {
  return resolveFuryPipeModelEligibility(model).eligible;
}

/** True when FuryPipe may transform this GPT/OpenAI-compatible model. */
export function isFuryPipeSupportedGptModel(model: string | null | undefined): boolean {
  return resolveFuryPipeModelEligibility(model).eligible;
}

/** Canonical Anthropic Messages paths that FuryPipe transforms. */
export function isAnthropicMessagesPath(pathname: string): boolean {
  return pathname === '/v1/messages'
    || pathname === '/anthropic/v1/messages'
    || pathname === '/anthropic/messages';
}

export function shouldTransformAnthropicMessages(
  input: FuryPipeApplicabilityInput,
): { eligible: boolean; reason: FuryPipeApplicabilityReason } {
  if (input.method !== undefined && input.method !== null && input.method.toUpperCase() !== 'POST') {
    return { eligible: false, reason: 'unsupported_method' };
  }
  if (input.path !== undefined && input.path !== null && !isAnthropicMessagesPath(input.path)) {
    return { eligible: false, reason: 'unsupported_path' };
  }
  if (input.bodyBytes !== undefined && input.bodyBytes !== null && input.bodyBytes <= 0) {
    return { eligible: false, reason: 'empty_body' };
  }
  const eligibility = resolveFuryPipeModelEligibility(input.model);
  return { eligible: eligibility.eligible, reason: eligibility.reason };
}
