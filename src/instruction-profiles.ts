import type {
  FuryPromptCompileInput,
  FuryPromptSection,
  FuryPromptSectionValue,
  FuryPromptSections,
} from './fury-prompt.js';

export const FURY_INSTRUCTION_PROFILE_IDS = Object.freeze([
  'karpathy-coding-discipline',
] as const);

export type FuryInstructionProfileId = typeof FURY_INSTRUCTION_PROFILE_IDS[number];

export interface FuryInstructionProfileSource {
  readonly repository: string;
  readonly commitSha: string;
  readonly sourcePath: string;
  readonly licenseStatus: 'DECLARED_MIT_NO_ROOT_LICENSE_FILE' | 'VERIFIED';
  readonly decision: 'ADAPT';
}

export interface FuryInstructionProfile {
  readonly id: FuryInstructionProfileId;
  readonly name: string;
  readonly version: string;
  readonly source: FuryInstructionProfileSource;
  readonly additions: Readonly<Partial<Record<FuryPromptSection, readonly string[]>>>;
}

export interface AppliedInstructionProfiles {
  readonly input: FuryPromptCompileInput;
  readonly appliedProfiles: readonly FuryInstructionProfileId[];
}

const SECTION_KEYS = new Set<FuryPromptSection>([
  'intent',
  'role',
  'objective',
  'context',
  'inputs',
  'constraints',
  'task',
  'plan',
  'tools',
  'skills',
  'mcp',
  'subagents',
  'outputContract',
  'acceptanceCriteria',
  'verification',
]);

const KARPATHY_CODING_DISCIPLINE: FuryInstructionProfile = Object.freeze({
  id: 'karpathy-coding-discipline',
  name: 'Karpathy-inspired coding discipline',
  version: '1.0.0',
  source: Object.freeze({
    repository: 'https://github.com/multica-ai/andrej-karpathy-skills',
    commitSha: '2c606141936f1eeef17fa3043a72095b4765b9c2',
    sourcePath: 'CLAUDE.md',
    licenseStatus: 'DECLARED_MIT_NO_ROOT_LICENSE_FILE',
    decision: 'ADAPT',
  }),
  additions: Object.freeze({
    constraints: Object.freeze([
      'Do not silently invent assumptions for ambiguous requirements; expose material uncertainty or conflicting interpretations before committing to a design.',
      'Prefer the smallest implementation that satisfies the requested behavior; avoid speculative abstractions, options, dependencies, or adjacent refactors.',
      'Keep the diff scoped to the requested change and remove only dead code created by that change unless broader cleanup is explicitly requested.',
    ]),
    plan: Object.freeze([
      'Define observable success criteria before implementation and map each implementation step to a concrete verification check.',
    ]),
    acceptanceCriteria: Object.freeze([
      'Every changed line should be explainable by the requested outcome or by a regression/safety requirement needed to preserve it.',
    ]),
    verification: Object.freeze([
      'For bugs or validation changes, prove the failure mode with a regression test or equivalent reproducible evidence before claiming the fix is complete.',
    ]),
  }),
});

export const FURY_INSTRUCTION_PROFILES: Readonly<Record<FuryInstructionProfileId, FuryInstructionProfile>> =
  Object.freeze({
    'karpathy-coding-discipline': KARPATHY_CODING_DISCIPLINE,
  });

function normalizeValues(value: FuryPromptSectionValue | undefined): string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : [...value];
}

function appendUnique(existing: readonly string[], additions: readonly string[]): readonly string[] {
  const seen = new Set(existing);
  const merged = [...existing];
  for (const value of additions) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }
  return Object.freeze(merged);
}

function applyOne(
  sections: FuryPromptSections,
  profile: FuryInstructionProfile,
): FuryPromptSections {
  const next: Record<string, FuryPromptSectionValue | undefined> = { ...sections };
  for (const [key, additions] of Object.entries(profile.additions)) {
    if (!SECTION_KEYS.has(key as FuryPromptSection) || additions === undefined) continue;
    const section = key as FuryPromptSection;
    next[section] = appendUnique(
      normalizeValues(next[section]),
      additions,
    );
  }
  return Object.freeze(next) as FuryPromptSections;
}

export function applyInstructionProfiles(
  input: FuryPromptCompileInput,
  profileIds: readonly FuryInstructionProfileId[],
): AppliedInstructionProfiles {
  if (!input || typeof input !== 'object' || !input.sections || typeof input.sections !== 'object') {
    throw new TypeError('instruction profiles require a valid FuryPrompt input');
  }
  if (!Array.isArray(profileIds) || profileIds.length > FURY_INSTRUCTION_PROFILE_IDS.length) {
    throw new Error('instruction profile list is invalid');
  }
  const unique = new Set<FuryInstructionProfileId>();
  let sections = input.sections;
  for (const profileId of profileIds) {
    if (!FURY_INSTRUCTION_PROFILE_IDS.includes(profileId)) {
      throw new Error(`unknown FuryPipe instruction profile: ${String(profileId)}`);
    }
    if (unique.has(profileId)) throw new Error(`duplicate FuryPipe instruction profile: ${profileId}`);
    unique.add(profileId);
    sections = applyOne(sections, FURY_INSTRUCTION_PROFILES[profileId]);
  }

  return Object.freeze({
    input: Object.freeze({
      ...input,
      sections,
    }),
    appliedProfiles: Object.freeze([...unique]),
  });
}

export function inspectInstructionProfiles(): readonly FuryInstructionProfile[] {
  return Object.freeze(FURY_INSTRUCTION_PROFILE_IDS.map((id) => FURY_INSTRUCTION_PROFILES[id]));
}
