export type ReleaseGateState =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'NOT_EXECUTED'
  | 'BLOCKED'
  | 'BLOCKED_BY_REPO_SETTING'
  | 'NOT_APPLICABLE';

export type ReleaseReadinessStatus = 'BLOCKED' | 'READY_FOR_RELEASE_DECISION';
export type ReleaseEvidenceOrigin = 'local' | 'github-actions' | 'github' | 'hosted' | 'provider';

export interface ReleaseGateProvenance {
  readonly sourceCommit: string;
  readonly observedAt: number;
  readonly origin: ReleaseEvidenceOrigin;
  /** Bounded immutable locator such as an Actions run/artifact ID or report path. */
  readonly reference: string;
}

export interface VerifiedReleaseGateEvidence extends ReleaseGateProvenance {
  readonly gateId: string;
}

export interface ReleaseGateEvidence {
  readonly id: string;
  readonly title: string;
  readonly state: ReleaseGateState;
  readonly required: boolean;
  readonly evidence?: readonly string[];
  readonly provenance?: ReleaseGateProvenance;
  readonly note?: string;
}

export interface ReleaseAuthorization {
  readonly mergeDefaultBranch: boolean;
  readonly createReleaseTag: boolean;
  readonly publishNpm: boolean;
  readonly deployProduction: boolean;
}

export interface ReleaseReadinessInput {
  readonly generatedAt: number;
  readonly sourceCommit: string;
  readonly packageVersion: string;
  readonly channel: 'rc' | 'stable';
  readonly performanceClaims: boolean;
  readonly gates: readonly ReleaseGateEvidence[];
  readonly authorization: ReleaseAuthorization;
}

export interface ReleaseBlocker {
  readonly gateId: string;
  readonly title: string;
  readonly state: ReleaseGateState;
  readonly reason: string;
}

export interface ReleaseReadinessReport {
  readonly format: 'furypipe-release-readiness/v2';
  readonly generatedAt: number;
  readonly sourceCommit: string;
  readonly packageVersion: string;
  readonly channel: 'rc' | 'stable';
  readonly status: ReleaseReadinessStatus;
  readonly blockers: readonly ReleaseBlocker[];
  readonly warnings: readonly string[];
  readonly verifiedRequiredGates: number;
  readonly requiredGates: number;
  readonly verifiedGateEvidence: readonly VerifiedReleaseGateEvidence[];
  readonly authorization: ReleaseAuthorization;
  readonly releaseActionsExecuted: false;
}

const SHA40 = /^[0-9a-f]{40}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const GATE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const RELEASE_EVIDENCE_ORIGINS: readonly ReleaseEvidenceOrigin[] = ['local', 'github-actions', 'github', 'hosted', 'provider'];
export const V5_RELEASE_GATE_REQUIREDNESS: Readonly<Record<string, boolean>> = Object.freeze({
  'ci.push': true,
  'ci.pr': true,
  'security.codeql': true,
  'security.secret-scan': true,
  'security.supply-chain': true,
  'security.license-compliance': true,
  'runtime.recovery': true,
  'runtime.mcp': true,
  'runtime.agent': true,
  'runtime.furyprompt': true,
  'runtime.learning': true,
  'runtime.web-studio': true,
  'runtime.control-room': true,
  'runtime.i18n': true,
  'docs.release': true,
  'repo.branch-policy': true,
  'release.provenance': true,
  'security.dependency-review': false,
  'benchmarks.provider': false,
});

export const V5_REQUIRED_RELEASE_GATE_IDS: readonly string[] = Object.freeze(
  Object.entries(V5_RELEASE_GATE_REQUIREDNESS).filter(([, required]) => required).map(([id]) => id),
);

export function getV5RequiredReleaseGateIds(requiredGateCount: number): readonly string[] | undefined {
  if (requiredGateCount === V5_REQUIRED_RELEASE_GATE_IDS.length) return V5_REQUIRED_RELEASE_GATE_IDS;
  if (requiredGateCount === V5_REQUIRED_RELEASE_GATE_IDS.length + 1) {
    return Object.freeze([...V5_REQUIRED_RELEASE_GATE_IDS, 'benchmarks.provider']);
  }
  return undefined;
}

const origins = (...values: ReleaseEvidenceOrigin[]): readonly ReleaseEvidenceOrigin[] => Object.freeze(values);
export const V5_RELEASE_GATE_ALLOWED_ORIGINS: Readonly<Record<string, readonly ReleaseEvidenceOrigin[]>> = Object.freeze({
  'ci.push': origins('github-actions'),
  'ci.pr': origins('github-actions'),
  'security.codeql': origins('github-actions'),
  'security.secret-scan': origins('github-actions'),
  'security.supply-chain': origins('github-actions'),
  'security.license-compliance': origins('github-actions'),
  'security.dependency-review': origins('github-actions'),
  'repo.branch-policy': origins('github'),
  'release.provenance': origins('github-actions'),
  'runtime.mcp': origins('hosted'),
  'runtime.web-studio': origins('hosted'),
  'benchmarks.provider': origins('provider'),
});

export function isAllowedV5ReleaseGateOrigin(gateId: string, origin: ReleaseEvidenceOrigin): boolean {
  if (!Object.hasOwn(V5_RELEASE_GATE_REQUIREDNESS, gateId)) return false;
  const allowed = V5_RELEASE_GATE_ALLOWED_ORIGINS[gateId];
  return allowed === undefined || allowed.includes(origin);
}

function validateInput(input: ReleaseReadinessInput): void {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new RangeError('generatedAt must be a non-negative safe integer');
  }
  if (!SHA40.test(input.sourceCommit)) {
    throw new Error('sourceCommit must be a lowercase 40-character commit SHA');
  }
  if (!SEMVER.test(input.packageVersion)) {
    throw new Error('packageVersion must be a valid semver without a leading v');
  }
  if (input.channel !== 'rc' && input.channel !== 'stable') {
    throw new Error('release channel must be rc or stable');
  }
  if (!Array.isArray(input.gates) || input.gates.length === 0 || input.gates.length > 128) {
    throw new Error('release gates must contain between 1 and 128 entries');
  }

  const seen = new Set<string>();
  for (const gate of input.gates) {
    if (!GATE_ID.test(gate.id)) throw new Error(`invalid release gate id: ${gate.id}`);
    if (!gate.title || gate.title.length > 160) throw new Error(`release gate title is invalid: ${gate.id}`);
    if (seen.has(gate.id)) throw new Error(`duplicate release gate id: ${gate.id}`);
    seen.add(gate.id);
    if (gate.evidence !== undefined) {
      if (!Array.isArray(gate.evidence) || gate.evidence.length > 64
        || gate.evidence.some((item: unknown) => typeof item !== 'string' || item.length === 0 || item.length > 512 || item.includes('\0'))) {
        throw new Error(`release gate evidence is invalid: ${gate.id}`);
      }
    }
    if (gate.provenance !== undefined) {
      const provenance = gate.provenance;
      if (!provenance || typeof provenance !== 'object'
        || !SHA40.test(provenance.sourceCommit)
        || !Number.isSafeInteger(provenance.observedAt) || provenance.observedAt < 0
        || !RELEASE_EVIDENCE_ORIGINS.includes(provenance.origin)
        || typeof provenance.reference !== 'string' || provenance.reference.length === 0
        || provenance.reference.length > 512 || provenance.reference.includes('\0')) {
        throw new Error(`release gate provenance is invalid: ${gate.id}`);
      }
    }
    if (gate.note !== undefined && (gate.note.length === 0 || gate.note.length > 1024 || gate.note.includes('\0'))) {
      throw new Error(`release gate note is invalid: ${gate.id}`);
    }
  }
  for (const [id, required] of Object.entries(V5_RELEASE_GATE_REQUIREDNESS)) {
    const gate = input.gates.find((candidate) => candidate.id === id);
    if (!gate) throw new Error(`missing V5 release gate: ${id}`);
    if (gate.required !== required) throw new Error(`V5 release gate requiredness is fixed by contract: ${id}`);
  }
}

function blockerReason(gate: ReleaseGateEvidence): string {
  switch (gate.state) {
    case 'PARTIAL':
      return 'required gate is only partially implemented or evidenced';
    case 'NOT_EXECUTED':
      return 'required gate has not been executed';
    case 'BLOCKED':
      return 'required gate is blocked';
    case 'BLOCKED_BY_REPO_SETTING':
      return 'required gate is blocked by a repository setting';
    case 'NOT_APPLICABLE':
      return 'required gate cannot be marked not applicable';
    case 'VERIFIED':
      return 'verified';
  }
}

function provenanceFailure(gate: ReleaseGateEvidence, sourceCommit: string, generatedAt: number): string | undefined {
  if (gate.state !== 'VERIFIED') return undefined;
  const provenance = gate.provenance;
  if (!provenance) return 'VERIFIED state has no source-bound evidence provenance';
  if (provenance.sourceCommit !== sourceCommit) return 'evidence source commit does not match the release source commit';
  if (provenance.observedAt > generatedAt) return 'evidence observation is later than the readiness report';
  const allowedOrigins = V5_RELEASE_GATE_ALLOWED_ORIGINS[gate.id];
  if (!isAllowedV5ReleaseGateOrigin(gate.id, provenance.origin)) {
    return `evidence origin must be one of: ${allowedOrigins?.join(', ') ?? 'the canonical V5 gate policy'}`;
  }
  return undefined;
}

export function evaluateReleaseReadiness(input: ReleaseReadinessInput): ReleaseReadinessReport {
  validateInput(input);

  const effectiveGates = input.gates.map((gate) => {
    if (gate.id === 'benchmarks.provider' && input.performanceClaims && !gate.required) {
      return { ...gate, required: true };
    }
    return gate;
  });

  const blockers: ReleaseBlocker[] = effectiveGates
    .filter((gate) => gate.required && (gate.state !== 'VERIFIED' || provenanceFailure(gate, input.sourceCommit, input.generatedAt) !== undefined))
    .map((gate) => ({
      gateId: gate.id,
      title: gate.title,
      state: gate.state,
      reason: gate.state === 'VERIFIED'
        ? provenanceFailure(gate, input.sourceCommit, input.generatedAt)!
        : blockerReason(gate),
    }));

  const warnings: string[] = [];
  for (const gate of effectiveGates) {
    const proofFailure = provenanceFailure(gate, input.sourceCommit, input.generatedAt);
    if (!gate.required && (gate.state !== 'VERIFIED' || proofFailure !== undefined) && gate.state !== 'NOT_APPLICABLE') {
      warnings.push(`${gate.id}: ${gate.state}${proofFailure ? ` — ${proofFailure}` : ''}${gate.note ? ` — ${gate.note}` : ''}`);
    }
  }
  if (!input.performanceClaims) {
    const providerBench = effectiveGates.find((gate) => gate.id === 'benchmarks.provider');
    if (providerBench && (providerBench.state !== 'VERIFIED'
      || provenanceFailure(providerBench, input.sourceCommit, input.generatedAt) !== undefined)) {
      warnings.push('Provider benchmark evidence is not verified; release notes must not make performance claims.');
    }
  }

  const required = effectiveGates.filter((gate) => gate.required);
  const verifiedGates = effectiveGates.filter((gate) => gate.state === 'VERIFIED'
    && provenanceFailure(gate, input.sourceCommit, input.generatedAt) === undefined);
  const verifiedRequired = verifiedGates.filter((gate) => gate.required);

  return Object.freeze({
    format: 'furypipe-release-readiness/v2',
    generatedAt: input.generatedAt,
    sourceCommit: input.sourceCommit,
    packageVersion: input.packageVersion,
    channel: input.channel,
    status: blockers.length === 0 ? 'READY_FOR_RELEASE_DECISION' : 'BLOCKED',
    blockers: Object.freeze(blockers),
    warnings: Object.freeze([...new Set(warnings)]),
    verifiedRequiredGates: verifiedRequired.length,
    requiredGates: required.length,
    verifiedGateEvidence: Object.freeze(verifiedGates.map((gate) => Object.freeze({
      gateId: gate.id,
      ...gate.provenance!,
    }))),
    authorization: Object.freeze({ ...input.authorization }),
    releaseActionsExecuted: false,
  });
}

export interface V5ReleaseGateStates {
  readonly ciPush: ReleaseGateState;
  readonly ciPr: ReleaseGateState;
  readonly codeql: ReleaseGateState;
  readonly secretScan: ReleaseGateState;
  readonly supplyChain: ReleaseGateState;
  readonly licenseCompliance: ReleaseGateState;
  readonly recovery: ReleaseGateState;
  readonly mcp: ReleaseGateState;
  readonly agentRuntime: ReleaseGateState;
  readonly furyPrompt: ReleaseGateState;
  readonly learning: ReleaseGateState;
  readonly webStudio: ReleaseGateState;
  readonly controlRoom: ReleaseGateState;
  readonly i18n: ReleaseGateState;
  readonly documentation: ReleaseGateState;
  readonly branchPolicy: ReleaseGateState;
  readonly provenance: ReleaseGateState;
  readonly dependencyReview: ReleaseGateState;
  readonly providerBenchmarks: ReleaseGateState;
}

export function createV5ReleaseGates(
  states: V5ReleaseGateStates,
  provenanceByGate: Readonly<Partial<Record<string, ReleaseGateProvenance>>> = {},
): readonly ReleaseGateEvidence[] {
  const provenance = (id: string): ReleaseGateProvenance | undefined => provenanceByGate[id];
  const required = (
    id: string,
    title: string,
    state: ReleaseGateState,
  ): ReleaseGateEvidence => ({ id, title, state, required: true, ...(provenance(id) ? { provenance: provenance(id) } : {}) });

  const optional = (
    id: string,
    title: string,
    state: ReleaseGateState,
    note?: string,
  ): ReleaseGateEvidence => ({ id, title, state, required: false,
    ...(provenance(id) ? { provenance: provenance(id) } : {}), ...(note ? { note } : {}) });

  return Object.freeze([
    required('ci.push', 'Cross-platform CI push matrix', states.ciPush),
    required('ci.pr', 'Cross-platform CI pull-request matrix', states.ciPr),
    required('security.codeql', 'CodeQL', states.codeql),
    required('security.secret-scan', 'Secret scanning', states.secretScan),
    required('security.supply-chain', 'Supply-chain gates and SBOM', states.supplyChain),
    required('security.license-compliance', 'Cross-platform license compliance', states.licenseCompliance),
    required('runtime.recovery', 'Recovery production guarantees', states.recovery),
    required('runtime.mcp', 'MCP production/runtime conformance', states.mcp),
    required('runtime.agent', 'Agent runtime', states.agentRuntime),
    required('runtime.furyprompt', 'FuryPrompt runtime wiring', states.furyPrompt),
    required('runtime.learning', 'Learning/knowledge runtime', states.learning),
    required('runtime.web-studio', 'Web/Figma Studio release scope', states.webStudio),
    required('runtime.control-room', 'Control Room release scope', states.controlRoom),
    required('runtime.i18n', 'i18n release scope', states.i18n),
    required('docs.release', 'Release documentation and compatibility matrix', states.documentation),
    required('repo.branch-policy', 'Protected integration/release branch policy', states.branchPolicy),
    required('release.provenance', 'Release provenance/attestation path', states.provenance),
    optional(
      'security.dependency-review',
      'GitHub Dependency Review',
      states.dependencyReview,
      'Optional only while frozen dependency audit/SBOM remain required; repository setting should still be enabled before stable release when available.',
    ),
    optional('benchmarks.provider', 'Comparable provider benchmarks', states.providerBenchmarks),
  ]);
}
