export type FuryHumanOutputMode = 'compact-human' | 'normal-clarity';

export interface FuryHumanOutputPolicyInput {
  readonly objective?: string;
  /** True when the caller/provider contract requires machine-structured output. */
  readonly structuredOutput?: boolean;
  /** Explicit caller override; defaults to enabled. */
  readonly enabled?: boolean;
}

export interface FuryHumanOutputPolicyDecision {
  readonly mode: FuryHumanOutputMode | 'disabled';
  readonly reason:
    | 'default_compact_human'
    | 'exact_output_contract'
    | 'structured_output_contract'
    | 'high_impact_clarity'
    | 'disabled_by_host';
  /** Stable model-facing instruction. Never applied as a response post-processor. */
  readonly instruction?: string;
}

/**
 * FuryPipe-native compact communication policy.
 *
 * This is deliberately not a copy of any third-party Caveman prompt. The
 * runtime uses the general product principle: compress human prose while
 * preserving clarity and machine fidelity.
 */
export const FURY_COMPACT_HUMAN_INSTRUCTION = [
  'For human-facing natural-language prose, prefer compact, information-dense wording and omit filler.',
  'Never apply terse prose to code, diffs, patches, shell commands, JSON/JSON-RPC, schemas, protocol payloads, tool calls/results, citations, identifiers, or other machine-sensitive content.',
  'An exact-response or structured-output contract overrides this style completely.',
  'Use normal explicit prose for security warnings, irreversible/high-impact confirmations, or any sequence where terse fragments could create ambiguity.',
].join(' ');

const EXACT_OUTPUT = /(?:\brespond|\breply|\breturn|\boutput|\br[eé]ponds?|\brenvoie|\bretourne|\bsors?)\s+(?:exactly|strictly|uniquement|exactement|strictement)\b|\bexact\s+(?:response|output|string|text)\b|\btexte\s+exact\b|\bsortie\s+exacte\b/iu;

const HIGH_IMPACT = /\b(?:delete|remove permanently|destroy|drop database|deploy(?:ment)?\s+(?:to\s+)?production|publish|release|send money|transfer funds|pay(?:ment)?|refund|sign contract|legal commitment|supprimer d[eé]finitivement|d[eé]ployer?\s+(?:en\s+)?production|publier|payer|rembourser|virer des fonds|signer(?:\s+un)?\s+contrat)\b/iu;

function boundedObjective(value: string | undefined): string {
  if (value === undefined) return '';
  return value.slice(0, 64_000);
}

export function resolveFuryHumanOutputPolicy(
  input: FuryHumanOutputPolicyInput = {},
): FuryHumanOutputPolicyDecision {
  if (input.enabled === false) {
    return Object.freeze({ mode: 'disabled', reason: 'disabled_by_host' });
  }
  if (input.structuredOutput === true) {
    return Object.freeze({ mode: 'normal-clarity', reason: 'structured_output_contract' });
  }

  const objective = boundedObjective(input.objective);
  if (objective && EXACT_OUTPUT.test(objective)) {
    return Object.freeze({ mode: 'normal-clarity', reason: 'exact_output_contract' });
  }
  if (objective && HIGH_IMPACT.test(objective)) {
    return Object.freeze({ mode: 'normal-clarity', reason: 'high_impact_clarity' });
  }

  return Object.freeze({
    mode: 'compact-human',
    reason: 'default_compact_human',
    instruction: FURY_COMPACT_HUMAN_INSTRUCTION,
  });
}