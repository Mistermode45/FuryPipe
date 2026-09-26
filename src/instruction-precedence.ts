export const FURY_INSTRUCTION_PRECEDENCE_FORMAT = 'furypipe-instruction-precedence/v1' as const;

export const FURY_INSTRUCTION_LAYERS = Object.freeze([
  'base',
  'user',
  'workspace',
  'project',
  'domain',
  'task',
  'skill',
  'security',
  'runtime',
] as const);

export type FuryInstructionLayer = typeof FURY_INSTRUCTION_LAYERS[number];
export type FuryInstructionDirectiveMode = 'set' | 'require' | 'deny' | 'append';

export interface FuryInstructionDirective {
  readonly layer: FuryInstructionLayer;
  readonly sourceId: string;
  readonly channel: string;
  readonly mode: FuryInstructionDirectiveMode;
  readonly value: string;
}

export interface FuryResolvedInstructionDirective extends FuryInstructionDirective {
  readonly precedence: number;
}

export interface FuryInstructionConflict {
  readonly channel: string;
  readonly layer: FuryInstructionLayer;
  readonly sourceIds: readonly string[];
  readonly values: readonly string[];
  readonly reason: 'same-precedence-incompatible';
}

export interface FuryInstructionOverride {
  readonly channel: string;
  readonly winnerSourceId: string;
  readonly winnerLayer: FuryInstructionLayer;
  readonly overriddenSourceIds: readonly string[];
}

export interface FuryInstructionPrecedencePlan {
  readonly format: typeof FURY_INSTRUCTION_PRECEDENCE_FORMAT;
  readonly order: readonly FuryInstructionLayer[];
  readonly effective: readonly FuryResolvedInstructionDirective[];
  readonly appended: readonly FuryResolvedInstructionDirective[];
  readonly conflicts: readonly FuryInstructionConflict[];
  readonly overrides: readonly FuryInstructionOverride[];
  readonly status: 'resolved' | 'conflict';
  readonly authority: 'instruction-resolution-only';
  readonly executionAuthority: false;
}

const MAX_DIRECTIVES = 512;
const MAX_SOURCE = 160;
const MAX_CHANNEL = 160;
const MAX_VALUE = 8_192;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+~-]*$/u;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function precedence(layer: FuryInstructionLayer): number {
  return FURY_INSTRUCTION_LAYERS.indexOf(layer);
}

function validateText(value: unknown, label: string, max: number, safeId = false): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || CONTROL.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  if (safeId && !SAFE_ID.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function normalizeDirective(input: FuryInstructionDirective): FuryResolvedInstructionDirective {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('instruction directive must be an object');
  }
  if (!(FURY_INSTRUCTION_LAYERS as readonly unknown[]).includes(input.layer)) {
    throw new TypeError('instruction directive layer is invalid');
  }
  if (!['set','require','deny','append'].includes(input.mode)) {
    throw new TypeError('instruction directive mode is invalid');
  }
  const sourceId = validateText(input.sourceId, 'instruction directive sourceId', MAX_SOURCE, true);
  const channel = validateText(input.channel, 'instruction directive channel', MAX_CHANNEL, true);
  const value = validateText(input.value, 'instruction directive value', MAX_VALUE);
  return Object.freeze({
    layer: input.layer,
    sourceId,
    channel,
    mode: input.mode,
    value,
    precedence: precedence(input.layer),
  });
}

function identity(item: FuryResolvedInstructionDirective): string {
  return `${item.channel}\u0000${item.mode}\u0000${item.value}\u0000${item.sourceId}`;
}

/**
 * Resolve structured instruction channels with explicit deterministic
 * precedence. Arbitrary natural-language instructions remain opaque data and
 * must be assigned an explicit channel by their owning layer before they can
 * participate in conflict resolution.
 *
 * Same-precedence incompatible scalar directives fail closed: no winner is
 * invented. Append directives compose in precedence/source order.
 */
export function resolveFuryInstructionPrecedence(
  directives: readonly FuryInstructionDirective[],
): FuryInstructionPrecedencePlan {
  if (!Array.isArray(directives) || directives.length > MAX_DIRECTIVES) {
    throw new RangeError('instruction directive list exceeds its bound');
  }

  const normalized = directives.map(normalizeDirective);
  const unique = new Map<string, FuryResolvedInstructionDirective>();
  for (const item of normalized) unique.set(identity(item), item);
  const values = [...unique.values()].sort((a,b) =>
    a.precedence-b.precedence
    || a.channel.localeCompare(b.channel)
    || a.sourceId.localeCompare(b.sourceId)
    || a.mode.localeCompare(b.mode)
    || a.value.localeCompare(b.value));

  const appended = Object.freeze(values.filter((item) => item.mode === 'append'));
  const scalars = values.filter((item) => item.mode !== 'append');
  const byChannel = new Map<string, FuryResolvedInstructionDirective[]>();
  for (const item of scalars) {
    const row = byChannel.get(item.channel) ?? [];
    row.push(item);
    byChannel.set(item.channel,row);
  }

  const effective: FuryResolvedInstructionDirective[] = [];
  const conflicts: FuryInstructionConflict[] = [];
  const overrides: FuryInstructionOverride[] = [];

  for (const [channel,row] of [...byChannel].sort(([a],[b])=>a.localeCompare(b))) {
    const max = Math.max(...row.map((item)=>item.precedence));
    const winners = row.filter((item)=>item.precedence===max);
    const semantic = new Map(winners.map((item)=>[`${item.mode}\u0000${item.value}`,item]));
    if (semantic.size > 1) {
      conflicts.push(Object.freeze({
        channel,
        layer: winners[0]!.layer,
        sourceIds: Object.freeze(winners.map((item)=>item.sourceId).sort()),
        values: Object.freeze([...new Set(winners.map((item)=>`${item.mode}:${item.value}`))].sort()),
        reason: 'same-precedence-incompatible' as const,
      }));
      continue;
    }
    const winner = [...semantic.values()][0]!;
    effective.push(winner);
    const overridden = row.filter((item)=>item.precedence<max);
    if (overridden.length) {
      overrides.push(Object.freeze({
        channel,
        winnerSourceId: winner.sourceId,
        winnerLayer: winner.layer,
        overriddenSourceIds: Object.freeze([...new Set(overridden.map((item)=>item.sourceId))].sort()),
      }));
    }
  }

  return Object.freeze({
    format: FURY_INSTRUCTION_PRECEDENCE_FORMAT,
    order: FURY_INSTRUCTION_LAYERS,
    effective: Object.freeze(effective.sort((a,b)=>a.channel.localeCompare(b.channel))),
    appended,
    conflicts: Object.freeze(conflicts),
    overrides: Object.freeze(overrides),
    status: conflicts.length ? 'conflict' as const : 'resolved' as const,
    authority: 'instruction-resolution-only' as const,
    executionAuthority: false as const,
  });
}
