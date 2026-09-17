/**
 * Persistent model-scope migration helpers.
 *
 * FuryPipe <=0.15 persisted the old built-in default as if it were an operator
 * allowlist. Model Fabric uses automatic capability discovery by default, so
 * carrying that legacy value forward would silently disable newly calibrated
 * readers (for example Claude Opus 5). New writes are explicitly marked so a
 * user's deliberate scope is never broadened by this migration.
 */

export const LEGACY_DEFAULT_MODEL_SCOPE = Object.freeze([
  'claude-fable-5',
  'gemini',
] as const);

export interface PersistedModelScopeResolution {
  readonly mode: 'absent' | 'automatic' | 'explicit' | 'off';
  readonly envValue?: string;
  readonly migratedLegacyDefault: boolean;
}

export type PersistedModelScopeMode = 'automatic' | 'explicit' | 'off';
export type ModelScopeSource = 'automatic_default' | 'config' | 'environment' | 'runtime_override';

export interface EffectiveModelScope {
  readonly mode: 'automatic' | 'explicit' | 'off';
  readonly source: ModelScopeSource;
  readonly effectiveModels: readonly string[];
}

export const MODEL_SCOPE_MAX_ENTRIES = 64;
export const MODEL_SCOPE_MAX_ENTRY_LENGTH = 160;

function boundedList(list: string[]): string[] | undefined {
  if (list.length > MODEL_SCOPE_MAX_ENTRIES) return undefined;
  if (list.some((item) => item.length === 0
    || item.length > MODEL_SCOPE_MAX_ENTRY_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(item))) return undefined;
  return list;
}

function normalizedList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    if (value.some((item) => typeof item !== 'string')) return undefined;
    return boundedList(value.map((item) => item.trim()).filter(Boolean));
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (/^(?:0|false|no|off|none)$/iu.test(trimmed)) return [];
  return boundedList(trimmed.split(',').map((item) => item.trim()).filter(Boolean));
}

/** Parse a dashboard/environment-style CSV and reject oversized operator input. */
export function parseModelScopeList(value: string): string[] {
  const list = normalizedList(value);
  if (list === undefined) {
    throw new RangeError(`model scope must contain at most ${MODEL_SCOPE_MAX_ENTRIES} entries of ${MODEL_SCOPE_MAX_ENTRY_LENGTH} characters`);
  }
  return list;
}

export function normalizeModelScopeEntry(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > MODEL_SCOPE_MAX_ENTRY_LENGTH
    || normalized.includes(',') || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new RangeError(`model scope entry must be 1-${MODEL_SCOPE_MAX_ENTRY_LENGTH} characters without commas or control characters`);
  }
  return normalized;
}

function sameScope(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].map((item) => item.toLowerCase()).sort();
  const right = [...b].map((item) => item.toLowerCase()).sort();
  return left.every((item, index) => item === right[index]);
}

/**
 * Resolve persisted config into the environment contract.
 *
 * explicit=true is written by current FuryPipe whenever the operator edits
 * the scope. Unmarked legacy values equal to the historical built-in default
 * migrate to automatic discovery. Every other unmarked value is preserved as
 * explicit because surprising broadening is worse than retaining a custom
 * historical scope.
 */
export function resolvePersistedModelScope(
  value: unknown,
  explicit: unknown,
  mode?: unknown,
): PersistedModelScopeResolution {
  if (mode === 'automatic') {
    return Object.freeze({ mode: 'automatic', migratedLegacyDefault: false });
  }
  if (mode === 'off') {
    return Object.freeze({ mode: 'off', envValue: 'off', migratedLegacyDefault: false });
  }
  if (mode === 'explicit' && explicit !== undefined && explicit !== true && explicit !== false) {
    return Object.freeze({ mode: 'off', envValue: 'off', migratedLegacyDefault: false });
  }
  if (mode !== undefined && mode !== 'automatic' && mode !== 'explicit' && mode !== 'off') {
    return Object.freeze({ mode: 'off', envValue: 'off', migratedLegacyDefault: false });
  }
  const list = normalizedList(value);
  if (list === undefined) {
    if (value !== undefined || mode === 'explicit') {
      return Object.freeze({ mode: 'off', envValue: 'off', migratedLegacyDefault: false });
    }
    return Object.freeze({ mode: 'absent', migratedLegacyDefault: false });
  }

  if (explicit === true) {
    if (list.length === 0) {
      return Object.freeze({ mode: 'off', envValue: 'off', migratedLegacyDefault: false });
    }
    return Object.freeze({
      mode: 'explicit',
      envValue: list.length === 0 ? 'off' : list.join(','),
      migratedLegacyDefault: false,
    });
  }

  if (sameScope(list, LEGACY_DEFAULT_MODEL_SCOPE)) {
    return Object.freeze({ mode: 'automatic', migratedLegacyDefault: true });
  }

  return Object.freeze({
    mode: list.length === 0 ? 'off' : 'explicit',
    envValue: list.length === 0 ? 'off' : list.join(','),
    migratedLegacyDefault: false,
  });
}

/**
 * Resolve the operator-facing scope without mutating process.env. This is the
 * shared precedence contract used by diagnostics and the runtime host:
 * environment > persisted config > automatic Model Fabric default.
 * An empty environment value is treated as absent for compatibility; the
 * explicit values off/0/false/no/none remain a hard kill switch.
 */
export function resolveEffectiveModelScope(input: {
  readonly envValue?: string;
  readonly persisted?: {
    readonly models?: unknown;
    readonly modelScopeExplicit?: unknown;
    readonly modelScopeMode?: unknown;
  };
  readonly automaticModels: readonly string[];
}): EffectiveModelScope {
  const env = normalizedList(input.envValue);
  if (input.envValue !== undefined && input.envValue.trim() !== '') {
    if (env === undefined) {
      return Object.freeze({ mode: 'off', source: 'environment', effectiveModels: Object.freeze([]) });
    }
    return Object.freeze({
      mode: env.length === 0 ? 'off' : 'explicit',
      source: 'environment',
      effectiveModels: Object.freeze(env),
    });
  }

  const persisted = input.persisted === undefined
    ? Object.freeze({ mode: 'absent' as const, migratedLegacyDefault: false })
    : resolvePersistedModelScope(
        input.persisted.models,
        input.persisted.modelScopeExplicit,
        input.persisted.modelScopeMode,
      );
  if (persisted.mode === 'explicit') {
    return Object.freeze({
      mode: 'explicit',
      source: 'config',
      effectiveModels: Object.freeze((persisted.envValue ?? '').split(',').map((model) => model.trim()).filter(Boolean)),
    });
  }
  if (persisted.mode === 'off') {
    return Object.freeze({ mode: 'off', source: 'config', effectiveModels: Object.freeze([]) });
  }
  return Object.freeze({
    mode: 'automatic',
    source: 'automatic_default',
    effectiveModels: Object.freeze([...input.automaticModels]),
  });
}
