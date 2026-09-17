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
  readonly mode: 'absent' | 'automatic' | 'explicit';
  readonly envValue?: string;
  readonly migratedLegacyDefault: boolean;
}

export type PersistedModelScopeMode = 'automatic' | 'explicit';

function normalizedList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (/^(?:0|false|no|off|none)$/iu.test(trimmed)) return [];
  return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
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
  const list = normalizedList(value);
  if (list === undefined) {
    return Object.freeze({ mode: 'absent', migratedLegacyDefault: false });
  }

  if (explicit === true) {
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
    mode: 'explicit',
    envValue: list.length === 0 ? 'off' : list.join(','),
    migratedLegacyDefault: false,
  });
}
