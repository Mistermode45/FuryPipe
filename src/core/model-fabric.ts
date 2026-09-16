import { isClaudeModel } from './claude-model-profiles.js';
import { hasGeminiMeasuredProfile, isGeminiModel } from './gemini-model-profiles.js';
import { stripBracketedSegments } from './safe-string.js';

export const MODEL_FABRIC_PROVIDERS = Object.freeze([
  'anthropic',
  'openai',
  'google',
  'xai',
  'mistral',
  'openrouter',
  'custom',
  'unknown',
] as const);

export type ModelFabricProvider = typeof MODEL_FABRIC_PROVIDERS[number];
export type ModelFabricLifecycle =
  | 'active'
  | 'preview'
  | 'experimental'
  | 'deprecated'
  | 'retired'
  | 'unknown';
export type ModelFabricCapability = 'yes' | 'no' | 'unknown';
export type ModelVisualProfileState =
  | 'calibrated'
  | 'quality_verified'
  | 'unprofiled'
  | 'degraded'
  | 'blocked'
  | 'not_applicable';
export type ModelVisualPolicy = 'auto' | 'max_savings' | 'safe_exact' | 'text_only';
export type ModelFabricEvidenceKind =
  | 'provider_api'
  | 'official_family_rule'
  | 'runtime_observation'
  | 'operator_override'
  | 'openrouter_catalog'
  | 'local_profile';

export interface ModelFabricEvidence {
  readonly kind: ModelFabricEvidenceKind;
  readonly source: string;
  readonly observedAt?: string;
}

export interface ModelFabricModalities {
  readonly textInput: ModelFabricCapability;
  readonly imageInput: ModelFabricCapability;
  readonly audioInput: ModelFabricCapability;
  readonly videoInput: ModelFabricCapability;
  readonly fileInput: ModelFabricCapability;
  readonly textOutput: ModelFabricCapability;
  readonly imageOutput: ModelFabricCapability;
  readonly audioOutput: ModelFabricCapability;
}

export interface ModelFabricCapabilities {
  readonly reasoning: ModelFabricCapability;
  readonly tools: ModelFabricCapability;
  readonly structuredOutput: ModelFabricCapability;
  readonly streaming: ModelFabricCapability;
}

export interface ModelFabricLimits {
  readonly contextTokens?: number;
  readonly outputTokens?: number;
  readonly maxImages?: number;
  readonly maxImageBytes?: number;
  readonly maxRequestBytes?: number;
}

export interface ModelFabricPricing {
  readonly inputUsdPerMillionTokens?: number;
  readonly cachedInputUsdPerMillionTokens?: number;
  readonly outputUsdPerMillionTokens?: number;
  readonly imageInputUsdPerMillionTokens?: number;
  readonly source?: string;
  readonly observedAt?: string;
}

export interface ModelFabricEntry {
  readonly provider: ModelFabricProvider;
  readonly id: string;
  readonly displayName: string;
  readonly aliases: readonly string[];
  readonly lifecycle: ModelFabricLifecycle;
  readonly modalities: ModelFabricModalities;
  readonly capabilities: ModelFabricCapabilities;
  readonly limits: ModelFabricLimits;
  readonly pricing?: ModelFabricPricing;
  readonly visual: {
    readonly profile: ModelVisualProfileState;
    readonly policy: ModelVisualPolicy;
  };
  readonly provenance: readonly ModelFabricEvidence[];
  readonly firstObservedAt?: string;
  readonly lastObservedAt?: string;
}

export interface ModelVisualResolution {
  readonly model: string;
  readonly provider: ModelFabricProvider;
  readonly imageInput: ModelFabricCapability;
  readonly profile: ModelVisualProfileState;
  readonly policy: ModelVisualPolicy;
  readonly mode: 'visual' | 'canary' | 'native';
  readonly reason:
    | 'quality_verified'
    | 'calibrated_profile'
    | 'vision_unprofiled_canary'
    | 'text_only'
    | 'unknown_capability'
    | 'blocked_profile'
    | 'operator_text_only';
  readonly evidence: readonly ModelFabricEvidence[];
}

export interface ModelFabricRegistry {
  upsert(entry: ModelFabricEntry): void;
  upsertMany(entries: readonly ModelFabricEntry[]): void;
  observe(model: string, providerHint?: ModelFabricProvider): ModelFabricEntry;
  get(model: string): ModelFabricEntry | undefined;
  list(): readonly ModelFabricEntry[];
  resolveVisual(model: string, providerHint?: ModelFabricProvider): ModelVisualResolution;
  clear(): void;
}

const EMPTY_MODALITIES: ModelFabricModalities = Object.freeze({
  textInput: 'unknown',
  imageInput: 'unknown',
  audioInput: 'unknown',
  videoInput: 'unknown',
  fileInput: 'unknown',
  textOutput: 'unknown',
  imageOutput: 'unknown',
  audioOutput: 'unknown',
});

const EMPTY_CAPABILITIES: ModelFabricCapabilities = Object.freeze({
  reasoning: 'unknown',
  tools: 'unknown',
  structuredOutput: 'unknown',
  streaming: 'unknown',
});

const ID_MAX = 512;
const DISPLAY_MAX = 512;
const SOURCE_MAX = 1024;

function nowIso(): string {
  return new Date().toISOString();
}

function bounded(value: unknown, fallback = '', max = ID_MAX): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || trimmed.includes('\0')) return fallback;
  return trimmed;
}

function normalizeId(value: string): string {
  const stripped = stripBracketedSegments(value.trim().toLowerCase());
  return stripped.length > ID_MAX ? stripped.slice(0, ID_MAX) : stripped;
}

function unqualifiedModelId(value: string): string {
  const slash = value.lastIndexOf('/');
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function providerFromId(model: string): ModelFabricProvider {
  const full = normalizeId(model);
  const id = unqualifiedModelId(full);
  if (full.startsWith('openrouter/')) return 'openrouter';
  if (isClaudeModel(full)) return 'anthropic';
  if (isGeminiModel(full)) return 'google';
  if (/^grok-/u.test(id)) return 'xai';
  if (/^(?:mistral|ministral|magistral|pixtral|codestral|voxtral)-/u.test(id)) return 'mistral';
  if (/^(?:gpt-|chat-latest|o[134](?:-|$))/u.test(id)) return 'openai';
  return 'unknown';
}

function inferredModalities(model: string, provider: ModelFabricProvider): ModelFabricModalities {
  const id = unqualifiedModelId(normalizeId(model));
  let imageInput: ModelFabricCapability = 'unknown';
  let textInput: ModelFabricCapability = 'yes';
  let textOutput: ModelFabricCapability = 'yes';

  if (provider === 'anthropic') {
    // Current/recent Claude readers with documented multimodal support.
    // Match exact release shapes, not arbitrary "claude-*" names: for example
    // claude-fable-50 must remain unknown until provider metadata proves it.
    const knownClaudeVisionReader =
      /^claude-(?:fable|mythos|opus|sonnet)-5(?:-|$)/u.test(id)
      || /^claude-opus-4-(?:8|7|6|5)(?:-|$)/u.test(id)
      || /^claude-sonnet-4-(?:6|5)(?:-|$)/u.test(id)
      || /^claude-haiku-4-5(?:-|$)/u.test(id);
    imageInput = knownClaudeVisionReader ? 'yes' : 'unknown';
  } else if (provider === 'google') {
    // General Gemini families are multimodal; speech/transcription/TTS-only
    // endpoints are deliberately not promoted to visual compression by name.
    imageInput = /(?:tts|transcribe|translate)/u.test(id) ? 'unknown' : 'yes';
  } else if (provider === 'openai') {
    // OpenAI documents its current GPT generation as image-input capable. Older
    // or unrelated ids remain unknown instead of inheriting that claim.
    imageInput = /^(?:gpt-(?:5(?:\.|-|$)|6(?:\.|-|$))|chat-latest$|gpt-4o(?:-|$)|gpt-4\.1(?:-|$))/u.test(id)
      ? 'yes'
      : 'unknown';
  } else if (provider === 'xai') {
    // Grok 4.6 is explicitly documented as text+image input. Other xAI ids
    // should be upgraded from unknown only by the /v1/language-models catalog.
    imageInput = /^grok-4\.6(?:-|$)/u.test(id) ? 'yes' : 'unknown';
  } else if (provider === 'mistral') {
    imageInput = 'unknown';
  }

  if (/image|video|audio|tts|transcribe/u.test(id) && !/(?:gpt-|claude|gemini|grok|mistral|ministral|magistral)/u.test(id)) {
    textInput = 'unknown';
    textOutput = 'unknown';
  }

  return Object.freeze({
    ...EMPTY_MODALITIES,
    textInput,
    imageInput,
    textOutput,
  });
}

function inferredProfile(model: string, provider: ModelFabricProvider): ModelVisualProfileState {
  const id = unqualifiedModelId(normalizeId(model));

  // A provider/family capability rule proves that a model can SEE images; it
  // does not prove that it can recover dense FuryPipe pages accurately. Keep
  // quality verification model-specific so a newly released sibling cannot
  // silently inherit another reader's exact-recall claim.
  if (provider === 'anthropic') {
    if (/^claude-fable-5(?:-|$)/u.test(id)) return 'quality_verified';
    // Opus ids below have measured FuryPipe legible-reader geometry. Other
    // current Claude families are vision-capable but remain UNPROFILED until
    // FuryPipe records model-specific recall/calibration evidence.
    if (/^claude-opus-(?:5|4-(?:8|7|6|5))(?:-|$)/u.test(id)) return 'calibrated';
    return inferredModalities(id, provider).imageInput === 'no' ? 'not_applicable' : 'unprofiled';
  }
  if (provider === 'google') {
    return hasGeminiMeasuredProfile(id) ? 'quality_verified' : 'unprofiled';
  }
  if (provider === 'openai') {
    // Sol has a measured geometry but the existing pilot still recorded an
    // exact-identifier truncation, so it is calibrated rather than verified.
    if (/^gpt-5\.6-sol(?:-|$)/u.test(id)) return 'calibrated';
    return inferredModalities(id, provider).imageInput === 'no' ? 'not_applicable' : 'unprofiled';
  }
  if (provider === 'xai') {
    // Grok has measured geometry/economics, but its exact-recall battery is not
    // strong enough for a default quality-verified claim.
    if (/^grok-4\.[56](?:-|$)/u.test(id)) return 'calibrated';
    return 'unprofiled';
  }
  return 'unprofiled';
}

function normalizeAliases(values: readonly unknown[], id: string): readonly string[] {
  const set = new Set<string>();
  set.add(id);
  for (const raw of values) {
    const value = bounded(raw);
    if (!value) continue;
    set.add(normalizeId(value));
    if (set.size >= 64) break;
  }
  return Object.freeze([...set]);
}

function mergeCapability(a: ModelFabricCapability, b: ModelFabricCapability): ModelFabricCapability {
  if (b !== 'unknown') return b;
  return a;
}

function mergeEntry(existing: ModelFabricEntry, incoming: ModelFabricEntry): ModelFabricEntry {
  const modalities: ModelFabricModalities = Object.freeze({
    textInput: mergeCapability(existing.modalities.textInput, incoming.modalities.textInput),
    imageInput: mergeCapability(existing.modalities.imageInput, incoming.modalities.imageInput),
    audioInput: mergeCapability(existing.modalities.audioInput, incoming.modalities.audioInput),
    videoInput: mergeCapability(existing.modalities.videoInput, incoming.modalities.videoInput),
    fileInput: mergeCapability(existing.modalities.fileInput, incoming.modalities.fileInput),
    textOutput: mergeCapability(existing.modalities.textOutput, incoming.modalities.textOutput),
    imageOutput: mergeCapability(existing.modalities.imageOutput, incoming.modalities.imageOutput),
    audioOutput: mergeCapability(existing.modalities.audioOutput, incoming.modalities.audioOutput),
  });
  const capabilities: ModelFabricCapabilities = Object.freeze({
    reasoning: mergeCapability(existing.capabilities.reasoning, incoming.capabilities.reasoning),
    tools: mergeCapability(existing.capabilities.tools, incoming.capabilities.tools),
    structuredOutput: mergeCapability(existing.capabilities.structuredOutput, incoming.capabilities.structuredOutput),
    streaming: mergeCapability(existing.capabilities.streaming, incoming.capabilities.streaming),
  });

  const evidence = new Map<string, ModelFabricEvidence>();
  for (const item of [...existing.provenance, ...incoming.provenance]) {
    evidence.set(`${item.kind}\n${item.source}`, item);
  }

  return Object.freeze({
    provider: incoming.provider !== 'unknown' ? incoming.provider : existing.provider,
    id: existing.id,
    displayName: incoming.displayName || existing.displayName,
    aliases: normalizeAliases([...existing.aliases, ...incoming.aliases], existing.id),
    lifecycle: incoming.lifecycle !== 'unknown' ? incoming.lifecycle : existing.lifecycle,
    modalities,
    capabilities,
    limits: Object.freeze({ ...existing.limits, ...incoming.limits }),
    ...(existing.pricing === undefined && incoming.pricing === undefined
      ? {}
      : { pricing: Object.freeze({ ...(existing.pricing ?? {}), ...(incoming.pricing ?? {}) }) }),
    visual: Object.freeze({
      profile: incoming.visual.profile !== 'unprofiled' ? incoming.visual.profile : existing.visual.profile,
      policy: incoming.visual.policy !== 'auto' ? incoming.visual.policy : existing.visual.policy,
    }),
    provenance: Object.freeze([...evidence.values()].slice(-64)),
    firstObservedAt: existing.firstObservedAt ?? incoming.firstObservedAt,
    lastObservedAt: incoming.lastObservedAt ?? existing.lastObservedAt,
  });
}

function inferredEntry(model: string, providerHint?: ModelFabricProvider): ModelFabricEntry {
  const id = normalizeId(model);
  const provider = providerHint && providerHint !== 'unknown' ? providerHint : providerFromId(id);
  const modalities = inferredModalities(id, provider);
  return Object.freeze({
    provider,
    id,
    displayName: id,
    aliases: Object.freeze([id]),
    lifecycle: 'unknown',
    modalities,
    capabilities: EMPTY_CAPABILITIES,
    limits: Object.freeze({}),
    visual: Object.freeze({
      profile: modalities.imageInput === 'no' ? 'not_applicable' : inferredProfile(id, provider),
      policy: 'auto',
    }),
    provenance: Object.freeze([{
      kind: 'runtime_observation' as const,
      source: 'model id observed in FuryPipe runtime',
      observedAt: nowIso(),
    }]),
    firstObservedAt: nowIso(),
    lastObservedAt: nowIso(),
  });
}

function canonicalKey(model: string): string {
  return normalizeId(model);
}

export function createModelFabricRegistry(): ModelFabricRegistry {
  const entries = new Map<string, ModelFabricEntry>();
  const aliases = new Map<string, string>();

  const upsert = (entry: ModelFabricEntry): void => {
    if (!entry || typeof entry !== 'object') throw new TypeError('model fabric entry is required');
    const id = canonicalKey(entry.id);
    if (!id) throw new Error('model fabric entry id is invalid');
    const existing = entries.get(id);
    const normalized = Object.freeze({
      ...entry,
      id,
      displayName: bounded(entry.displayName, id, DISPLAY_MAX),
      aliases: normalizeAliases(entry.aliases ?? [], id),
      provenance: Object.freeze((entry.provenance ?? []).slice(-64).map((item) => Object.freeze({
        kind: item.kind,
        source: bounded(item.source, 'unknown', SOURCE_MAX),
        ...(item.observedAt === undefined ? {} : { observedAt: item.observedAt }),
      }))),
    }) as ModelFabricEntry;
    const merged = existing ? mergeEntry(existing, normalized) : normalized;
    entries.set(id, merged);
    for (const alias of merged.aliases) aliases.set(canonicalKey(alias), id);
  };

  return Object.freeze({
    upsert,
    upsertMany(incoming: readonly ModelFabricEntry[]): void {
      if (!Array.isArray(incoming) || incoming.length > 20_000) {
        throw new Error('model fabric catalog must be a bounded array');
      }
      for (const entry of incoming) upsert(entry);
    },
    observe(model: string, providerHint?: ModelFabricProvider): ModelFabricEntry {
      const id = canonicalKey(model);
      const existingId = aliases.get(id) ?? id;
      const existing = entries.get(existingId);
      const observed = inferredEntry(id, providerHint);
      if (existing) {
        upsert(Object.freeze({
          ...observed,
          id: existing.id,
          aliases: normalizeAliases([...existing.aliases, id], existing.id),
          firstObservedAt: existing.firstObservedAt,
        }));
        return entries.get(existing.id)!;
      }
      upsert(observed);
      return entries.get(observed.id)!;
    },
    get(model: string): ModelFabricEntry | undefined {
      const id = canonicalKey(model);
      return entries.get(aliases.get(id) ?? id);
    },
    list(): readonly ModelFabricEntry[] {
      return Object.freeze([...entries.values()].sort((a, b) =>
        a.provider.localeCompare(b.provider) || a.displayName.localeCompare(b.displayName)));
    },
    resolveVisual(model: string, providerHint?: ModelFabricProvider): ModelVisualResolution {
      const entry = this.get(model) ?? this.observe(model, providerHint);
      if (entry.visual.policy === 'text_only') {
        return Object.freeze({
          model: entry.id, provider: entry.provider, imageInput: entry.modalities.imageInput,
          profile: entry.visual.profile, policy: entry.visual.policy, mode: 'native',
          reason: 'operator_text_only', evidence: entry.provenance,
        });
      }
      if (entry.modalities.imageInput === 'no' || entry.visual.profile === 'not_applicable') {
        return Object.freeze({
          model: entry.id, provider: entry.provider, imageInput: entry.modalities.imageInput,
          profile: entry.visual.profile, policy: entry.visual.policy, mode: 'native',
          reason: 'text_only', evidence: entry.provenance,
        });
      }
      if (entry.visual.profile === 'blocked' || entry.visual.profile === 'degraded') {
        return Object.freeze({
          model: entry.id, provider: entry.provider, imageInput: entry.modalities.imageInput,
          profile: entry.visual.profile, policy: entry.visual.policy, mode: 'native',
          reason: 'blocked_profile', evidence: entry.provenance,
        });
      }
      if (entry.modalities.imageInput !== 'yes') {
        return Object.freeze({
          model: entry.id, provider: entry.provider, imageInput: entry.modalities.imageInput,
          profile: entry.visual.profile, policy: entry.visual.policy, mode: 'native',
          reason: 'unknown_capability', evidence: entry.provenance,
        });
      }
      if (entry.visual.profile === 'quality_verified') {
        return Object.freeze({
          model: entry.id, provider: entry.provider, imageInput: entry.modalities.imageInput,
          profile: entry.visual.profile, policy: entry.visual.policy, mode: 'visual',
          reason: 'quality_verified', evidence: entry.provenance,
        });
      }
      if (entry.visual.profile === 'calibrated') {
        return Object.freeze({
          model: entry.id, provider: entry.provider, imageInput: entry.modalities.imageInput,
          profile: entry.visual.profile, policy: entry.visual.policy,
          // Calibration proves geometry/cost behavior, not necessarily exact
          // recall. AUTO therefore keeps it in canary until a caller explicitly
          // selects MAX_SAVINGS or quality evidence promotes the profile.
          mode: entry.visual.policy === 'max_savings' ? 'visual' : 'canary',
          reason: 'calibrated_profile', evidence: entry.provenance,
        });
      }
      return Object.freeze({
        model: entry.id, provider: entry.provider, imageInput: entry.modalities.imageInput,
        profile: entry.visual.profile, policy: entry.visual.policy,
        mode: entry.visual.policy === 'max_savings' ? 'visual' : 'canary',
        reason: 'vision_unprofiled_canary', evidence: entry.provenance,
      });
    },
    clear(): void {
      entries.clear();
      aliases.clear();
    },
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringList(value: unknown): readonly string[] {
  const source = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return Object.freeze(source.flatMap((item) => {
    const normalized = bounded(item);
    return normalized ? [normalized] : [];
  }).slice(0, 64));
}

function boolCapability(value: unknown): ModelFabricCapability {
  return value === true ? 'yes' : value === false ? 'no' : 'unknown';
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function catalogEntry(input: {
  provider: ModelFabricProvider;
  id: string;
  displayName?: string;
  aliases?: readonly string[];
  lifecycle?: ModelFabricLifecycle;
  modalities?: Partial<ModelFabricModalities>;
  capabilities?: Partial<ModelFabricCapabilities>;
  limits?: ModelFabricLimits;
  pricing?: ModelFabricPricing;
  evidence: ModelFabricEvidence;
}): ModelFabricEntry {
  const inferred = inferredEntry(input.id, input.provider);
  return Object.freeze({
    ...inferred,
    provider: input.provider,
    id: normalizeId(input.id),
    displayName: bounded(input.displayName, input.id, DISPLAY_MAX),
    aliases: normalizeAliases(input.aliases ?? [], normalizeId(input.id)),
    lifecycle: input.lifecycle ?? inferred.lifecycle,
    modalities: Object.freeze({ ...inferred.modalities, ...(input.modalities ?? {}) }),
    capabilities: Object.freeze({ ...inferred.capabilities, ...(input.capabilities ?? {}) }),
    limits: Object.freeze({ ...(input.limits ?? {}) }),
    ...(input.pricing === undefined ? {} : { pricing: Object.freeze({ ...input.pricing }) }),
    visual: Object.freeze({
      profile: inferredProfile(input.id, input.provider),
      policy: 'auto' as const,
    }),
    provenance: Object.freeze([Object.freeze(input.evidence)]),
  });
}

export function normalizeAnthropicModelsPayload(payload: unknown, observedAt = nowIso()): readonly ModelFabricEntry[] {
  const root = record(payload);
  const data = root && Array.isArray(root.data) ? root.data : [];
  return Object.freeze(data.flatMap((raw) => {
    const item = record(raw);
    const id = bounded(item?.id);
    if (!id) return [];
    const capabilities = record(item?.capabilities);
    const thinking = record(capabilities?.thinking);
    const inputModalities = new Set(stringList(item?.input_modalities).map((value) => value.toLowerCase()));
    return [catalogEntry({
      provider: 'anthropic',
      id,
      displayName: bounded(item?.display_name, id, DISPLAY_MAX),
      lifecycle: 'active',
      ...(inputModalities.size === 0 ? {} : {
        modalities: {
          textInput: inputModalities.has('text') ? 'yes' : 'unknown',
          imageInput: inputModalities.has('image') ? 'yes' : 'no',
        },
      }),
      capabilities: {
        reasoning: boolCapability(thinking?.supported),
      },
      limits: Object.freeze({
        ...(numberField(item?.max_input_tokens) === undefined ? {} : { contextTokens: numberField(item?.max_input_tokens)! }),
        ...(numberField(item?.max_tokens) === undefined ? {} : { outputTokens: numberField(item?.max_tokens)! }),
      }),
      evidence: { kind: 'provider_api', source: 'Anthropic /v1/models', observedAt },
    })];
  }));
}

export function normalizeOpenAIModelsPayload(payload: unknown, observedAt = nowIso()): readonly ModelFabricEntry[] {
  const root = record(payload);
  const data = root && Array.isArray(root.data) ? root.data : [];
  return Object.freeze(data.flatMap((raw) => {
    const item = record(raw);
    const id = bounded(item?.id);
    if (!id) return [];
    return [catalogEntry({
      provider: 'openai',
      id,
      displayName: id,
      evidence: { kind: 'provider_api', source: 'OpenAI /v1/models', observedAt },
    })];
  }));
}

export function normalizeGeminiModelsPayload(payload: unknown, observedAt = nowIso()): readonly ModelFabricEntry[] {
  const root = record(payload);
  const models = root && Array.isArray(root.models) ? root.models : [];
  return Object.freeze(models.flatMap((raw) => {
    const item = record(raw);
    const rawName = bounded(item?.name);
    if (!rawName) return [];
    const id = rawName.replace(/^models\//u, '');
    return [catalogEntry({
      provider: 'google',
      id,
      displayName: bounded(item?.displayName, id, DISPLAY_MAX),
      aliases: stringList(item?.baseModelId),
      limits: Object.freeze({
        ...(numberField(item?.inputTokenLimit) === undefined ? {} : { contextTokens: numberField(item?.inputTokenLimit)! }),
        ...(numberField(item?.outputTokenLimit) === undefined ? {} : { outputTokens: numberField(item?.outputTokenLimit)! }),
      }),
      evidence: { kind: 'provider_api', source: 'Gemini models.list', observedAt },
    })];
  }));
}

export function normalizeXaiModelsPayload(payload: unknown, observedAt = nowIso()): readonly ModelFabricEntry[] {
  const root = record(payload);
  const models = root && Array.isArray(root.models)
    ? root.models
    : root && Array.isArray(root.data) ? root.data : [];
  return Object.freeze(models.flatMap((raw) => {
    const item = record(raw);
    const id = bounded(item?.id);
    if (!id) return [];
    const input = new Set(stringList(item?.input_modalities).map((value) => value.toLowerCase()));
    const output = new Set(stringList(item?.output_modalities).map((value) => value.toLowerCase()));
    return [catalogEntry({
      provider: 'xai',
      id,
      aliases: stringList(item?.aliases),
      modalities: {
        textInput: input.has('text') ? 'yes' : 'unknown',
        imageInput: input.has('image') ? 'yes' : input.size > 0 ? 'no' : 'unknown',
        audioInput: input.has('audio') ? 'yes' : input.size > 0 ? 'no' : 'unknown',
        videoInput: input.has('video') ? 'yes' : input.size > 0 ? 'no' : 'unknown',
        textOutput: output.has('text') ? 'yes' : output.size > 0 ? 'no' : 'unknown',
        imageOutput: output.has('image') ? 'yes' : output.size > 0 ? 'no' : 'unknown',
      },
      evidence: { kind: 'provider_api', source: 'xAI /v1/language-models', observedAt },
    })];
  }));
}

export function normalizeMistralModelsPayload(payload: unknown, observedAt = nowIso()): readonly ModelFabricEntry[] {
  const root = record(payload);
  const data = root && Array.isArray(root.data) ? root.data : Array.isArray(payload) ? payload : [];
  return Object.freeze(data.flatMap((raw) => {
    const item = record(raw);
    const id = bounded(item?.id);
    if (!id) return [];
    const caps = record(item?.capabilities);
    const archived = item?.archived === true;
    return [catalogEntry({
      provider: 'mistral',
      id,
      aliases: stringList(item?.aliases),
      lifecycle: archived ? 'retired' : 'active',
      modalities: {
        imageInput: boolCapability(caps?.vision),
      },
      capabilities: {
        tools: boolCapability(caps?.function_calling),
      },
      limits: Object.freeze({
        ...(numberField(item?.max_context_length) === undefined ? {} : { contextTokens: numberField(item?.max_context_length)! }),
      }),
      evidence: { kind: 'provider_api', source: 'Mistral /v1/models', observedAt },
    })];
  }));
}

export function normalizeOpenRouterModelsPayload(payload: unknown, observedAt = nowIso()): readonly ModelFabricEntry[] {
  const root = record(payload);
  const data = root && Array.isArray(root.data) ? root.data : [];
  return Object.freeze(data.flatMap((raw) => {
    const item = record(raw);
    const id = bounded(item?.id);
    if (!id) return [];
    const architecture = record(item?.architecture);
    const input = new Set(stringList(architecture?.input_modalities).map((value) => value.toLowerCase()));
    const output = new Set(stringList(architecture?.output_modalities).map((value) => value.toLowerCase()));
    return [catalogEntry({
      provider: 'openrouter',
      id,
      displayName: bounded(item?.name, id, DISPLAY_MAX),
      aliases: stringList(item?.canonical_slug),
      modalities: {
        textInput: input.has('text') ? 'yes' : input.size > 0 ? 'no' : 'unknown',
        imageInput: input.has('image') ? 'yes' : input.size > 0 ? 'no' : 'unknown',
        audioInput: input.has('audio') ? 'yes' : input.size > 0 ? 'no' : 'unknown',
        fileInput: input.has('file') ? 'yes' : input.size > 0 ? 'no' : 'unknown',
        textOutput: output.has('text') ? 'yes' : output.size > 0 ? 'no' : 'unknown',
        imageOutput: output.has('image') ? 'yes' : output.size > 0 ? 'no' : 'unknown',
        audioOutput: output.has('audio') ? 'yes' : output.size > 0 ? 'no' : 'unknown',
      },
      limits: Object.freeze({
        ...(numberField(item?.context_length) === undefined ? {} : { contextTokens: numberField(item?.context_length)! }),
      }),
      evidence: { kind: 'openrouter_catalog', source: 'OpenRouter /api/v1/models', observedAt },
    })];
  }));
}

export const RUNTIME_MODEL_FABRIC = createModelFabricRegistry();

export function observeRuntimeModel(model: string, providerHint?: ModelFabricProvider): ModelFabricEntry {
  return RUNTIME_MODEL_FABRIC.observe(model, providerHint);
}

export function registerRuntimeModelCatalog(entries: readonly ModelFabricEntry[]): void {
  RUNTIME_MODEL_FABRIC.upsertMany(entries);
}

export function inspectRuntimeModels(): readonly ModelFabricEntry[] {
  return RUNTIME_MODEL_FABRIC.list();
}

export function resolveRuntimeVisualModel(model: string, providerHint?: ModelFabricProvider): ModelVisualResolution {
  return RUNTIME_MODEL_FABRIC.resolveVisual(model, providerHint);
}

export function resetRuntimeModelFabricForTests(): void {
  RUNTIME_MODEL_FABRIC.clear();
}
