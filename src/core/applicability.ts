/** Applicability helpers for FuryPipe's production-safe model scope. */

import { isMisresolvedModelId } from './gpt-model-profiles.js';
import {
  resolveRuntimeVisualModel,
  type ModelVisualResolution,
} from './model-fabric.js';
import { stripBracketedSegments } from './safe-string.js';

export type FuryPipeApplicabilityReason =
  | 'eligible'
  | 'unsupported_model'
  | 'vision_capability_unknown'
  | 'text_only_model'
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
  'claude',
  'gemini',
  'gpt-5',
  'gpt-6',
  'grok-4.6',
]);

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

export interface FuryPipeModelEligibility {
  readonly eligible: boolean;
  readonly reason: Extract<
    FuryPipeApplicabilityReason,
    'eligible' | 'unsupported_model' | 'vision_capability_unknown' | 'text_only_model' | 'visual_profile_blocked'
  >;
  readonly resolution?: ModelVisualResolution;
  readonly source: 'operator_scope' | 'automatic_model_fabric';
}

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

  // A runtime dashboard override is always explicit, even when it is [].
  // A non-empty FURYPIPE_MODELS value is also explicit; "off" therefore stays
  // a hard kill switch instead of being bypassed by capability discovery.
  if (runtimeModelBases !== null || hasExplicitEnvironmentScope()) {
    if (isMisresolvedModelId(base)) {
      return Object.freeze({
        eligible: false,
        reason: 'visual_profile_blocked',
        source: 'operator_scope',
      });
    }
    return Object.freeze({
      eligible: matchesExplicitScope(base),
      reason: matchesExplicitScope(base) ? 'eligible' : 'unsupported_model',
      source: 'operator_scope',
    });
  }

  // Automatic mode is capability-driven.  A provider/model family can be new
  // to this FuryPipe release and still enter CANARY when image input is proven.
  // ExactGuard/profitability/wire budgets remain downstream release blockers.
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
  return Object.freeze({
    eligible: true,
    reason: 'eligible',
    source: 'automatic_model_fabric',
    resolution,
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
