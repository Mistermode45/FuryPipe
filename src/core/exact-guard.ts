import { createHash } from 'node:crypto';

/** Exactness classes used by the first FuryPipe protection pass. */
export type ExactnessClass =
  | 'secret'
  | 'auth_header'
  | 'jwt'
  | 'uuid'
  | 'sha1'
  | 'sha256'
  | 'sha512'
  | 'blake3'
  | 'ip'
  | 'host_port'
  | 'url'
  | 'path'
  | 'line_reference'
  | 'semver'
  | 'commit_sha'
  | 'code_symbol'
  | 'identifier'
  | 'string_literal'
  | 'numeric_literal'
  | 'command'
  | 'sql_identifier'
  | 'tool_call_id'
  | 'message_id'
  | 'timestamp'
  | 'currency_amount'
  | 'quantity'
  | 'error_code'
  | 'stacktrace_frame'
  | 'minecraft_uuid'
  | 'permission_node'
  | 'coordinate'
  | 'checksum'
  | 'email'
  | 'phone'
  | 'custom';

export type RepresentationPolicy = 'preserve_exact' | 'redact' | 'externalize';
export type ExactGuardMode = 'safe' | 'balanced' | 'coding-safe';

export interface ExactGuardRule {
  readonly id: string;
  readonly class: ExactnessClass;
  readonly pattern: RegExp;
  readonly priority?: number;
  readonly representationPolicy?: RepresentationPolicy;
}

export interface ExactGuardOptions {
  readonly rules?: readonly ExactGuardRule[];
  readonly includeLowConfidenceLiterals?: boolean;
  readonly representationPolicy?: RepresentationPolicy;
  /** Restrict built-in rules for a named safety profile; custom rules remain active. */
  readonly protectedClasses?: readonly ExactnessClass[];
}

export interface ProtectedSpan {
  /** UTF-16 offsets, matching String.prototype.slice and source text APIs. */
  readonly start: number;
  readonly end: number;
  readonly class: ExactnessClass;
  readonly ruleId: string;
  readonly valueHash: string;
  readonly representationPolicy: RepresentationPolicy;
  readonly transformedLocation?: string;
  readonly recoveryHandle?: string;
  readonly verificationStatus: 'verified' | 'unverified';
}

export interface PrecisionManifest {
  readonly format: 'furypipe-precision-manifest/v1';
  readonly guardVersion: '1';
  readonly hashAlgorithm: 'sha256';
  readonly sourceHash: string;
  readonly sourceByteLength: number;
  readonly spans: readonly ProtectedSpan[];
  readonly verificationStatus: 'verified' | 'unverified';
}

export interface PrecisionVerification {
  readonly ok: boolean;
  readonly sourceHashMatches: boolean;
  readonly checkedSpans: number;
  readonly invalidSpans: readonly number[];
  readonly reason?: string;
}

interface Candidate extends ProtectedSpan {
  readonly priority: number;
}

const DEFAULT_RULES: readonly ExactGuardRule[] = [
  { id: 'auth-header', class: 'auth_header', priority: 120, pattern: /\b(?:authorization|proxy-authorization|x-api-key|api-key|cookie)\s*:\s*[^\r\n]+/gi },
  { id: 'secret-prefix', class: 'secret', priority: 118, pattern: /\b(?:sk-[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16})\b/g },
  { id: 'jwt', class: 'jwt', priority: 116, pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  { id: 'tool-call-id', class: 'tool_call_id', priority: 112, pattern: /\b(?:toolu|call|fc_call)_[A-Za-z0-9_-]{6,}\b/g },
  { id: 'message-id', class: 'message_id', priority: 111, pattern: /\b(?:msg|req|run|session|thread)_[A-Za-z0-9_-]{4,}\b/g },
  { id: 'minecraft-uuid', class: 'minecraft_uuid', priority: 110, pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  { id: 'uuid', class: 'uuid', priority: 109, pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi },
  { id: 'sha512', class: 'sha512', priority: 108, pattern: /\b[0-9a-f]{128}\b/gi },
  { id: 'sha256', class: 'sha256', priority: 107, pattern: /\b[0-9a-f]{64}\b/gi },
  { id: 'sha1', class: 'sha1', priority: 106, pattern: /\b[0-9a-f]{40}\b/gi },
  { id: 'blake3', class: 'blake3', priority: 105, pattern: /\bblake3(?:[:=])?[0-9a-f]{64}\b/gi },
  { id: 'checksum-etag', class: 'checksum', priority: 104, pattern: /\b(?:checksum|sha(?:1|256|512)|etag)\s*[:=]\s*["']?[0-9a-f]{8,128}["']?/gi },
  { id: 'url', class: 'url', priority: 100, pattern: /\b(?:https?|wss?|ftp):\/\/[^\s<>"']+/gi },
  { id: 'email', class: 'email', priority: 99, pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { id: 'ipv4', class: 'ip', priority: 98, pattern: /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g },
  { id: 'host-port', class: 'host_port', priority: 97, pattern: /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?\b/gi },
  { id: 'windows-path', class: 'path', priority: 96, pattern: /\b[A-Z]:\\[^\r\n<>"']+/g },
  { id: 'unix-path', class: 'path', priority: 95, pattern: /(?<![\w])\/(?:[^\s\0\/]+\/)+[^\s\0]+/g },
  { id: 'line-reference', class: 'line_reference', priority: 93, pattern: /\b(?:line|ln|col|column)\s*[:#]?\s*\d+(?:\s*[-:]\s*\d+)?\b/gi },
  { id: 'stacktrace-frame', class: 'stacktrace_frame', priority: 92, pattern: /\bat\s+[\w$./<>-]+\([^\r\n)]*:\d+(?::\d+)?\)/g },
  { id: 'semver', class: 'semver', priority: 91, pattern: /\bv?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/g },
  { id: 'currency', class: 'currency_amount', priority: 90, pattern: /(?:[$€£]\s?\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s?(?:USD|EUR|GBP|tokens?|ms|MiB|GiB)\b)/gi },
  { id: 'coordinate', class: 'coordinate', priority: 89, pattern: /\b[xyz]\s*[:=]\s*-?\d+(?:\.\d+)?\b/gi },
  { id: 'permission-node', class: 'permission_node', priority: 88, pattern: /\b[a-z0-9]+(?:\.[a-z0-9_-]+){2,}\b/gi },
  { id: 'command', class: 'command', priority: 87, pattern: /(?:(?<=^)|(?<=[>$#]\s))(?:sudo\s+)?(?:git|npm|pnpm|node|docker|curl|wget|chmod|kubectl|powershell|pwsh)\b[^\r\n]*/gim },
  { id: 'sql-identifier', class: 'sql_identifier', priority: 86, pattern: /\b(?:SELECT|FROM|WHERE|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+[A-Za-z_][A-Za-z0-9_.]*/gi },
  { id: 'error-code', class: 'error_code', priority: 85, pattern: /\b(?:E[A-Z][A-Z0-9_]{2,}|ERR_[A-Z0-9_]+|HTTP\s*[45]\d\d)\b/g },
];

const LOW_CONFIDENCE_RULES: readonly ExactGuardRule[] = [
  { id: 'string-literal', class: 'string_literal', priority: 30, pattern: /(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g },
  { id: 'numeric-literal', class: 'numeric_literal', priority: 20, pattern: /(?<![\w.])-?(?:0x[0-9a-f]+|\d+(?:\.\d+)?)(?![\w.])/gi },
];
const MAX_CUSTOM_RULES = 64;
const MAX_RULE_SOURCE_LENGTH = 512;
const MAX_GUARDED_TEXT_LENGTH = 4 * 1024 * 1024;

const BALANCED_CLASSES: readonly ExactnessClass[] = [
  'secret', 'auth_header', 'jwt', 'uuid', 'sha1', 'sha256', 'sha512', 'blake3',
  'commit_sha', 'tool_call_id', 'message_id', 'minecraft_uuid', 'checksum',
];

const CODING_SAFE_CLASSES: readonly ExactnessClass[] = [
  ...BALANCED_CLASSES,
  'url', 'path', 'line_reference', 'semver', 'code_symbol', 'identifier',
  'command', 'sql_identifier', 'error_code', 'stacktrace_frame',
  'permission_node', 'coordinate', 'email', 'phone', 'host_port', 'ip',
];

/** Resolve the built-in protection policy used before a lossy transform. */
export function exactGuardOptionsForMode(mode: ExactGuardMode): ExactGuardOptions {
  if (mode === 'safe') return {};
  return { protectedClasses: mode === 'balanced' ? BALANCED_CLASSES : CODING_SAFE_CLASSES };
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function asBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function candidatesFor(text: string, rules: readonly ExactGuardRule[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (const rule of rules) {
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
    const regex = new RegExp(rule.pattern.source, flags);
    for (const match of text.matchAll(regex)) {
      const value = match[0];
      const start = match.index;
      if (start === undefined || value.length === 0) continue;
      candidates.push({
        start,
        end: start + value.length,
        class: rule.class,
        ruleId: rule.id,
        valueHash: sha256(value),
        representationPolicy: rule.representationPolicy ?? 'preserve_exact',
        verificationStatus: 'verified',
        priority: rule.priority ?? 0,
      });
    }
  }
  return candidates;
}

function selectNonOverlapping(candidates: readonly Candidate[]): ProtectedSpan[] {
  const selected: Candidate[] = [];
  const ordered = [...candidates].sort((a, b) =>
    a.start - b.start || b.priority - a.priority || (b.end - b.start) - (a.end - a.start),
  );
  for (const candidate of ordered) {
    const overlap = selected.find((span) => candidate.start < span.end && candidate.end > span.start);
    if (!overlap) {
      selected.push(candidate);
      continue;
    }
    const candidateWins = candidate.priority > overlap.priority ||
      (candidate.priority === overlap.priority && candidate.end - candidate.start > overlap.end - overlap.start);
    if (candidateWins) {
      selected.splice(selected.indexOf(overlap), 1, candidate);
    }
  }
  return selected
    .sort((a, b) => a.start - b.start)
    .map(({ priority: _priority, ...span }) => span);
}

function validateCustomRules(rules: readonly ExactGuardRule[]): void {
  if (rules.length > MAX_CUSTOM_RULES) throw new RangeError('ExactGuard rules are limited to 64');
  for (const rule of rules) {
    if (!rule.id || rule.id.length > 64 || rule.pattern.source.length > MAX_RULE_SOURCE_LENGTH) {
      throw new RangeError('ExactGuard rule id/pattern is too large');
    }
    if (rule.pattern.flags.includes('g') === false && rule.pattern.flags.includes('y')) {
      throw new RangeError('ExactGuard sticky rules are not supported');
    }
  }
}

/** Detect exactness-sensitive spans without retaining their plaintext values. */
export function detectProtectedSpans(text: string, options: ExactGuardOptions = {}): readonly ProtectedSpan[] {
  if (text.length > MAX_GUARDED_TEXT_LENGTH) throw new RangeError('ExactGuard input exceeds the 4 MiB limit');
  validateCustomRules(options.rules ?? []);
  const allowed = options.protectedClasses ? new Set(options.protectedClasses) : undefined;
  const rules = [
    ...DEFAULT_RULES.filter((rule) => !allowed || allowed.has(rule.class)),
    ...(options.includeLowConfidenceLiterals
      ? LOW_CONFIDENCE_RULES.filter((rule) => !allowed || allowed.has(rule.class))
      : []),
    ...(options.rules ?? []),
  ];
  const defaultPolicy = options.representationPolicy ?? 'preserve_exact';
  return selectNonOverlapping(candidatesFor(text, rules)).map((span) => ({
    ...span,
    representationPolicy: span.representationPolicy === 'preserve_exact' ? defaultPolicy : span.representationPolicy,
  }));
}

/** Build a deterministic manifest for the original text. */
export function buildPrecisionManifest(text: string, options: ExactGuardOptions = {}): PrecisionManifest {
  const bytes = asBytes(text);
  return {
    format: 'furypipe-precision-manifest/v1',
    guardVersion: '1',
    hashAlgorithm: 'sha256',
    sourceHash: sha256(bytes),
    sourceByteLength: bytes.byteLength,
    spans: detectProtectedSpans(text, options),
    verificationStatus: 'verified',
  };
}

/** Verify that source bytes and every protected value still match a manifest. */
export function verifyPrecisionManifest(text: string, manifest: PrecisionManifest): PrecisionVerification {
  const sourceHashMatches = sha256(asBytes(text)) === manifest.sourceHash;
  const invalidSpans: number[] = [];
  for (let index = 0; index < manifest.spans.length; index++) {
    const span = manifest.spans[index];
    if (!span || span.start < 0 || span.end < span.start || span.end > text.length || sha256(text.slice(span.start, span.end)) !== span.valueHash) {
      invalidSpans.push(index);
    }
  }
  const ok = sourceHashMatches && invalidSpans.length === 0;
  return {
    ok,
    sourceHashMatches,
    checkedSpans: manifest.spans.length,
    invalidSpans,
    ...(ok ? {} : { reason: sourceHashMatches ? 'protected span mismatch' : 'source hash mismatch' }),
  };
}
