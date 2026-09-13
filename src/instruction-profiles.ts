import type {
  FuryPromptCompileInput,
  FuryPromptSection,
  FuryPromptSectionValue,
  FuryPromptSections,
} from './fury-prompt.js';

export const FURY_INSTRUCTION_PROFILE_IDS = Object.freeze([
  'karpathy-coding-discipline',
  'spec-driven-development',
  'systematic-debugging',
  'codebase-audit-discipline',
  'ui-design-discipline',
  'product-marketing-context-discipline',
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


const SPEC_DRIVEN_DEVELOPMENT: FuryInstructionProfile = Object.freeze({
  id: 'spec-driven-development',
  name: 'Spec-driven development',
  version: '1.0.0',
  source: Object.freeze({
    repository: 'https://github.com/github/spec-kit',
    commitSha: 'd848fb4e18f44640ad6b42e60a280551ee90cdce',
    sourcePath: 'README.md',
    licenseStatus: 'VERIFIED',
    decision: 'ADAPT',
  }),
  additions: Object.freeze({
    intent: Object.freeze([
      'Treat the requested behavior and acceptance criteria as the stable source of truth; implementation details may change but must remain traceable to that intent.',
    ]),
    plan: Object.freeze([
      'Before implementation, separate specification, architecture/technical plan, and executable task breakdown; do not collapse these into one unreviewed coding step.',
      'Record material assumptions, dependencies, risks, and non-functional requirements before changing production code.',
    ]),
    constraints: Object.freeze([
      'Do not treat generated code as the source of truth when it conflicts with an explicit specification or acceptance criterion.',
      'When existing code and requested behavior conflict, identify the conflict explicitly and update the specification/evidence trail rather than silently choosing one.',
    ]),
    outputContract: Object.freeze([
      'Keep specification decisions, implementation tasks, and verification evidence distinguishable so another agent or maintainer can resume the work without reconstructing hidden context.',
    ]),
    acceptanceCriteria: Object.freeze([
      'Every implementation task must map to at least one observable acceptance criterion or required non-functional property.',
    ]),
    verification: Object.freeze([
      'Verify the built behavior against the specification and acceptance criteria, then report any unmet criterion as a blocker instead of declaring completion.',
    ]),
  }),
});


const SYSTEMATIC_DEBUGGING: FuryInstructionProfile = Object.freeze({
  id: 'systematic-debugging',
  name: 'Systematic root-cause debugging',
  version: '1.0.0',
  source: Object.freeze({
    repository: 'https://github.com/obra/superpowers',
    commitSha: 'b36e0829c6d0140e93cfef2ca599b1b07d4a7797',
    sourcePath: 'skills/systematic-debugging/SKILL.md',
    licenseStatus: 'VERIFIED',
    decision: 'ADAPT',
  }),
  additions: Object.freeze({
    intent: Object.freeze([
      'Treat a bug, failing test, crash, performance regression, build failure, or unexpected behavior as an investigation problem before treating it as an implementation problem.',
    ]),
    plan: Object.freeze([
      'Reproduce the failure and collect concrete evidence before proposing a fix; trace relevant data/configuration across component boundaries until the failing boundary or originating value is identified.',
      'Compare the broken path with a known-working path, state one falsifiable root-cause hypothesis, and test the smallest possible change that can confirm or reject it.',
    ]),
    constraints: Object.freeze([
      'Do not stack speculative fixes, change multiple variables at once, or patch a downstream symptom when the upstream cause is still unknown.',
      'If repeated fix attempts reveal unrelated failures or growing cross-component coupling, stop adding patches and reassess whether the architecture or contract is the actual problem.',
    ]),
    acceptanceCriteria: Object.freeze([
      'The final change addresses an evidenced root cause and remains scoped to the failure being fixed.',
    ]),
    verification: Object.freeze([
      'Before claiming resolution, demonstrate the original failure with a regression test or reproducible check, show that the check now passes, and run the relevant surrounding regression suite.',
    ]),
  }),
});

const CODEBASE_AUDIT_DISCIPLINE: FuryInstructionProfile = Object.freeze({
  id: 'codebase-audit-discipline',
  name: 'Evidence-first codebase audit discipline',
  version: '1.0.0',
  source: Object.freeze({
    repository: 'https://github.com/ksimback/tech-debt-skill',
    commitSha: '5a15c1ca4a929b2759461c218478de391a8bda0f',
    sourcePath: 'SKILL.md',
    licenseStatus: 'DECLARED_MIT_NO_ROOT_LICENSE_FILE',
    decision: 'ADAPT',
  }),
  additions: Object.freeze({
    intent: Object.freeze([
      'Build a concrete architectural mental model of the repository before judging code quality or proposing remediation.',
    ]),
    context: Object.freeze([
      'Use manifests, architecture documentation, module boundaries, entry points, dependency relationships, recent churn and critical paths as audit evidence when those sources are available.',
    ]),
    plan: Object.freeze([
      'Orient first, then inspect architecture/contracts/tests/dependencies/performance/error handling/security/documentation, and rank only findings supported by repository evidence.',
    ]),
    constraints: Object.freeze([
      'Do not pad categories with generic best-practice findings; every concrete claim must identify the supporting file, line/range, command output, or other reproducible repository evidence.',
      'Distinguish confirmed debt from suspicious patterns that are intentional or insufficiently understood, and prefer scoped remediation over rewrite recommendations.',
    ]),
    outputContract: Object.freeze([
      'Separate confirmed findings, prioritized remediation, quick wins, plausible false positives or intentionally retained patterns, and open questions that require maintainer context.',
    ]),
    verification: Object.freeze([
      'Before finalizing an audit, re-check high-severity findings against surrounding code and tests so a locally unusual pattern is not mislabeled as debt without context.',
    ]),
  }),
});


const UI_DESIGN_DISCIPLINE: FuryInstructionProfile = Object.freeze({
  id: 'ui-design-discipline',
  name: 'Production UI design discipline',
  version: '1.0.0',
  source: Object.freeze({
    repository: 'https://github.com/Nutlope/hallmark',
    commitSha: '13ac0ec7e148655948100b6396439e481361d690',
    sourcePath: 'skills/hallmark/SKILL.md',
    licenseStatus: 'VERIFIED',
    decision: 'ADAPT',
  }),
  additions: Object.freeze({
    intent: Object.freeze([
      'Treat UI work as a scoped design-system change: understand the existing product conventions before introducing new visual structure, tokens, interactions or components.',
    ]),
    context: Object.freeze([
      'Before designing in an existing project, inspect the established framework, typography, palette/tokens, spacing, component ownership, responsive conventions and motion patterns when available.',
    ]),
    constraints: Object.freeze([
      'Preserve existing routes, component ownership, product copy intent and design-system contracts unless the requested scope explicitly authorizes broader replacement.',
      'Do not fabricate metrics, testimonials, customer logos, case-study claims or other proof content to make a layout look complete; represent missing proof as unknown or request real evidence.',
      'Learn from visual references at the level of hierarchy, rhythm, component archetypes and design principles rather than producing a pixel-faithful copy of a third-party design.',
    ]),
    plan: Object.freeze([
      'Choose the page or component scope first, then define hierarchy, tokens, interaction states, responsive behavior and accessibility before polishing visual details.',
    ]),
    acceptanceCriteria: Object.freeze([
      'Interactive UI exposes appropriate hover, focus-visible, active, disabled and task-relevant loading/error/success states, and the requested experience remains usable at narrow and wide viewports.',
    ]),
    verification: Object.freeze([
      'Review the result for responsive overflow, readable hierarchy, keyboard focus, contrast, state completeness, invented content and accidental divergence from the project design system before declaring the UI complete.',
    ]),
  }),
});

const PRODUCT_MARKETING_CONTEXT_DISCIPLINE: FuryInstructionProfile = Object.freeze({
  id: 'product-marketing-context-discipline',
  name: 'Evidence-grounded product marketing context',
  version: '1.0.0',
  source: Object.freeze({
    repository: 'https://github.com/coreyhaines31/marketingskills',
    commitSha: '5b2c0007766c6a1cf1d53fd8fc73e979e0821022',
    sourcePath: 'skills/product-marketing/SKILL.md',
    licenseStatus: 'VERIFIED',
    decision: 'ADAPT',
  }),
  additions: Object.freeze({
    intent: Object.freeze([
      'Establish reusable product, audience, positioning, voice and proof context before producing downstream marketing strategy or copy.',
    ]),
    context: Object.freeze([
      'Ground product claims in supplied material or repository evidence, and keep target audience, jobs-to-be-done, pains, alternatives, differentiation, objections, customer language, brand voice, proof points and conversion goals distinguishable.',
    ]),
    constraints: Object.freeze([
      'Do not invent customer quotes, performance metrics, customer counts, logos, pricing, competitive facts or proof points; mark missing evidence as unknown and keep hypotheses separate from facts.',
      'Prefer exact customer or stakeholder language when it is supplied, while preserving source attribution and avoiding unsupported polishing that changes the meaning.',
    ]),
    plan: Object.freeze([
      'Resolve foundational product and audience context first, identify evidence gaps and contradictions, then apply only the marketing tactic or channel-specific method required by the task.',
    ]),
    outputContract: Object.freeze([
      'Separate known product facts, target audience, positioning/differentiation, customer language, brand voice, proof, goals, assumptions and unresolved questions so the context can be reused without silently converting assumptions into facts.',
    ]),
    verification: Object.freeze([
      'Before publishing a marketing deliverable, trace factual claims and proof points back to provided evidence and flag any claim that still requires confirmation.',
    ]),
  }),
});

export const FURY_INSTRUCTION_PROFILES: Readonly<Record<FuryInstructionProfileId, FuryInstructionProfile>> =
  Object.freeze({
    'karpathy-coding-discipline': KARPATHY_CODING_DISCIPLINE,
    'spec-driven-development': SPEC_DRIVEN_DEVELOPMENT,
    'systematic-debugging': SYSTEMATIC_DEBUGGING,
    'codebase-audit-discipline': CODEBASE_AUDIT_DISCIPLINE,
    'ui-design-discipline': UI_DESIGN_DISCIPLINE,
    'product-marketing-context-discipline': PRODUCT_MARKETING_CONTEXT_DISCIPLINE,
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
  if (!Array.isArray(profileIds) || profileIds.length > 32) {
    throw new Error('instruction profile list is invalid');
  }
  const unique = new Set<FuryInstructionProfileId>();
  let sections = input.sections;
  for (const rawProfileId of profileIds as readonly unknown[]) {
    if (typeof rawProfileId !== 'string'
      || !FURY_INSTRUCTION_PROFILE_IDS.includes(rawProfileId as FuryInstructionProfileId)) {
      throw new Error(`unknown FuryPipe instruction profile: ${String(rawProfileId)}`);
    }
    const profileId = rawProfileId as FuryInstructionProfileId;
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

export type FuryInstructionWorkload =
  | 'general-engineering'
  | 'feature-development'
  | 'bugfix'
  | 'codebase-audit'
  | 'production-hardening'
  | 'ui-development'
  | 'marketing'
  | 'research';

function profileSet(
  ...ids: FuryInstructionProfileId[]
): readonly FuryInstructionProfileId[] {
  return Object.freeze(ids);
}

const RECOMMENDED_PROFILES_BY_WORKLOAD: Readonly<
  Record<FuryInstructionWorkload, readonly FuryInstructionProfileId[]>
> = Object.freeze({
  'general-engineering': profileSet('karpathy-coding-discipline'),
  'feature-development': profileSet('karpathy-coding-discipline', 'spec-driven-development'),
  bugfix: profileSet('karpathy-coding-discipline', 'systematic-debugging'),
  'codebase-audit': profileSet('codebase-audit-discipline'),
  'production-hardening': profileSet(
    'karpathy-coding-discipline',
    'spec-driven-development',
    'systematic-debugging',
    'codebase-audit-discipline',
  ),
  'ui-development': profileSet(
    'karpathy-coding-discipline',
    'spec-driven-development',
    'ui-design-discipline',
  ),
  marketing: profileSet('product-marketing-context-discipline'),
  research: profileSet(),
});

export function recommendInstructionProfiles(
  workload: FuryInstructionWorkload,
): readonly FuryInstructionProfileId[] {
  const profiles = RECOMMENDED_PROFILES_BY_WORKLOAD[workload];
  if (profiles === undefined) {
    throw new Error(`unknown FuryPipe instruction workload: ${String(workload)}`);
  }
  return Object.freeze([...profiles]);
}
