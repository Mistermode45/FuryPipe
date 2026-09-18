export interface AgentSkillSelectionCandidate {
  readonly name: string;
  readonly description: string;
  readonly activationEligible: boolean;
}

export type AgentSkillSelectionReason =
  | 'explicit_user_activation'
  | 'description_relevance';

export interface SelectedAgentSkill {
  readonly name: string;
  readonly score: number;
  readonly reason: AgentSkillSelectionReason;
}

export interface BlockedAgentSkillSelection {
  readonly name: string;
  readonly reason: 'activation_not_eligible';
  readonly requestedExplicitly: boolean;
}

export interface AgentSkillSelectionPlan {
  readonly format: 'furypipe-agent-skill-selection/v1';
  readonly selected: readonly SelectedAgentSkill[];
  readonly blocked: readonly BlockedAgentSkillSelection[];
  readonly candidatesConsidered: number;
  readonly executionAuthorized: false;
}

export interface AgentSkillSelectionOptions {
  readonly maxActive?: number;
  readonly minRelevanceScore?: number;
}

const MAX_CANDIDATES = 2_000;
const DEFAULT_MAX_ACTIVE = 3;
const MAX_ACTIVE = 8;
const DEFAULT_MIN_SCORE = 2.25;
const MAX_OBJECTIVE_CHARS = 64_000;

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','by','for','from','in','is','it','of','on','or','that','the','this','to','with',
  'au','aux','avec','ce','ces','dans','de','des','du','en','et','est','la','le','les','ou','par','pour','sur','un','une',
  'je','j','tu','il','elle','nous','vous','ils','elles','mon','ma','mes','ton','ta','tes','son','sa','ses',
]);

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

function tokens(value: string): readonly string[] {
  const normalized = normalizeText(value);
  const matches = normalized.match(/[a-z0-9][a-z0-9._+-]{1,63}/gu) ?? [];
  return Object.freeze(matches.filter((token) => !STOPWORDS.has(token)));
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function boundedMaxActive(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_ACTIVE;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ACTIVE) {
    throw new RangeError(`maxActive must be between 1 and ${MAX_ACTIVE}`);
  }
  return value;
}

function boundedMinScore(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MIN_SCORE;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError('minRelevanceScore must be between 0 and 100');
  }
  return value;
}

function explicitSkillNames(objective: string, knownNames: ReadonlySet<string>): ReadonlySet<string> {
  const selected = new Set<string>();
  // Slash/dollar mentions are harness-level activation syntax. We only accept a
  // token if it resolves to an actually discovered skill name.
  const pattern = /(?:^|\s)(?:\$|\/)([a-z0-9]+(?:-[a-z0-9]+)*)\b/gu;
  for (const match of normalizeText(objective).matchAll(pattern)) {
    const name = match[1];
    if (name && knownNames.has(name)) selected.add(name);
  }
  return selected;
}

function descriptionScore(
  objectiveTokens: ReadonlySet<string>,
  candidateTokens: readonly string[],
  documentFrequency: ReadonlyMap<string, number>,
  candidateCount: number,
): number {
  let score = 0;
  const seen = new Set<string>();
  for (const token of candidateTokens) {
    if (seen.has(token) || !objectiveTokens.has(token)) continue;
    seen.add(token);
    const df = documentFrequency.get(token) ?? 0;
    const idf = Math.log((candidateCount + 1) / (df + 1)) + 1;
    score += idf;
  }
  return score;
}

/**
 * Select a small relevant instruction-skill set without executing anything.
 *
 * Descriptions are treated only as lexical metadata. They are never promoted
 * to instructions by this selector, so a malicious description cannot acquire
 * authority by matching the user's words.
 */
export function selectAgentSkillsForTask(
  objective: string,
  candidates: readonly AgentSkillSelectionCandidate[],
  options: AgentSkillSelectionOptions = {},
): AgentSkillSelectionPlan {
  if (typeof objective !== 'string' || !objective.trim() || objective.length > MAX_OBJECTIVE_CHARS || objective.includes('\0')) {
    throw new Error('Agent Skill selection requires a bounded non-empty objective');
  }
  if (!Array.isArray(candidates) || candidates.length > MAX_CANDIDATES) {
    throw new Error(`Agent Skill selection accepts at most ${MAX_CANDIDATES} candidates`);
  }

  const maxActive = boundedMaxActive(options.maxActive);
  const minScore = boundedMinScore(options.minRelevanceScore);
  const names = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object'
      || typeof candidate.name !== 'string'
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(candidate.name)
      || typeof candidate.description !== 'string'
      || !candidate.description.trim()
      || typeof candidate.activationEligible !== 'boolean'
      || names.has(candidate.name)) {
      throw new Error('Agent Skill selection candidates must use unique validated names/descriptions');
    }
    names.add(candidate.name);
  }

  const explicit = explicitSkillNames(objective, names);
  const objectiveTokenSet = new Set(tokens(objective));
  const candidateTokenMap = new Map<string, readonly string[]>();
  const df = new Map<string, number>();

  for (const candidate of candidates) {
    // Name contributes routing vocabulary alongside the description.
    const candidateTokens = unique([
      ...tokens(candidate.name.replaceAll('-', ' ')),
      ...tokens(candidate.description),
    ]);
    candidateTokenMap.set(candidate.name, candidateTokens);
    for (const token of new Set(candidateTokens)) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }

  const selected: SelectedAgentSkill[] = [];
  const blocked: BlockedAgentSkillSelection[] = [];

  for (const candidate of candidates) {
    const requestedExplicitly = explicit.has(candidate.name);
    if (!candidate.activationEligible) {
      if (requestedExplicitly) {
        blocked.push(Object.freeze({
          name: candidate.name,
          reason: 'activation_not_eligible',
          requestedExplicitly: true,
        }));
      }
      continue;
    }

    if (requestedExplicitly) {
      selected.push(Object.freeze({
        name: candidate.name,
        score: 1_000_000,
        reason: 'explicit_user_activation',
      }));
      continue;
    }

    const score = descriptionScore(
      objectiveTokenSet,
      candidateTokenMap.get(candidate.name) ?? [],
      df,
      Math.max(1, candidates.length),
    );
    if (score >= minScore) {
      selected.push(Object.freeze({
        name: candidate.name,
        score: Number(score.toFixed(6)),
        reason: 'description_relevance',
      }));
    }
  }

  selected.sort((a, b) =>
    Number(b.reason === 'explicit_user_activation') - Number(a.reason === 'explicit_user_activation')
    || b.score - a.score
    || a.name.localeCompare(b.name));

  blocked.sort((a, b) => a.name.localeCompare(b.name));

  return Object.freeze({
    format: 'furypipe-agent-skill-selection/v1',
    selected: Object.freeze(selected.slice(0, maxActive)),
    blocked: Object.freeze(blocked),
    candidatesConsidered: candidates.length,
    executionAuthorized: false,
  });
}
