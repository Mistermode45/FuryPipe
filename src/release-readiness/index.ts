export type ReleaseGateState =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'NOT_EXECUTED'
  | 'BLOCKED'
  | 'BLOCKED_BY_REPO_SETTING'
  | 'NOT_APPLICABLE';

export type ReleaseReadinessStatus = 'BLOCKED' | 'READY_FOR_RELEASE_DECISION';

export interface ReleaseGateEvidence {
  readonly id: string;
  readonly title: string;
  readonly state: ReleaseGateState;
  readonly required: boolean;
  readonly evidence?: readonly string[];
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
  readonly format: 'furypipe-release-readiness/v1';
  readonly generatedAt: number;
  readonly sourceCommit: string;
  readonly packageVersion: string;
  readonly channel: 'rc' | 'stable';
  readonly status: ReleaseReadinessStatus;
  readonly blockers: readonly ReleaseBlocker[];
  readonly warnings: readonly string[];
  readonly verifiedRequiredGates: number;
  readonly requiredGates: number;
  readonly authorization: ReleaseAuthorization;
  readonly releaseActionsExecuted: false;
}

const SHA40 = /^[0-9a-f]{40}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const GATE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

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
        || gate.evidence.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 512 || item.includes('\0'))) {
        throw new Error(`release gate evidence is invalid: ${gate.id}`);
      }
    }
    if (gate.note !== undefined && (gate.note.length === 0 || gate.note.length > 1024 || gate.note.includes('\0'))) {
      throw new Error(`release gate note is invalid: ${gate.id}`);
    }
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

export function evaluateReleaseReadiness(input: ReleaseReadinessInput): ReleaseReadinessReport {
  validateInput(input);

  const effectiveGates = input.gates.map((gate) => {
    if (gate.id === 'benchmarks.provider' && input.performanceClaims && !gate.required) {
      return { ...gate, required: true };
    }
    return gate;
  });

  const blockers: ReleaseBlocker[] = effectiveGates
    .filter((gate) => gate.required && gate.state !== 'VERIFIED')
    .map((gate) => ({
      gateId: gate.id,
      title: gate.title,
      state: gate.state,
      reason: blockerReason(gate),
    }));

  const warnings: string[] = [];
  for (const gate of effectiveGates) {
    if (!gate.required && gate.state !== 'VERIFIED' && gate.state !== 'NOT_APPLICABLE') {
      warnings.push(`${gate.id}: ${gate.state}${gate.note ? ` — ${gate.note}` : ''}`);
    }
  }
  if (!input.performanceClaims) {
    const providerBench = effectiveGates.find((gate) => gate.id === 'benchmarks.provider');
    if (providerBench && providerBench.state !== 'VERIFIED') {
      warnings.push('Provider benchmark evidence is not verified; release notes must not make performance claims.');
    }
  }

  const required = effectiveGates.filter((gate) => gate.required);
  const verifiedRequired = required.filter((gate) => gate.state === 'VERIFIED');

  return Object.freeze({
    format: 'furypipe-release-readiness/v1',
    generatedAt: input.generatedAt,
    sourceCommit: input.sourceCommit,
    packageVersion: input.packageVersion,
    channel: input.channel,
    status: blockers.length === 0 ? 'READY_FOR_RELEASE_DECISION' : 'BLOCKED',
    blockers: Object.freeze(blockers),
    warnings: Object.freeze([...new Set(warnings)]),
    verifiedRequiredGates: verifiedRequired.length,
    requiredGates: required.length,
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

export function createV5ReleaseGates(states: V5ReleaseGateStates): readonly ReleaseGateEvidence[] {
  const required = (
    id: string,
    title: string,
    state: ReleaseGateState,
  ): ReleaseGateEvidence => ({ id, title, state, required: true });

  const optional = (
    id: string,
    title: string,
    state: ReleaseGateState,
    note?: string,
  ): ReleaseGateEvidence => ({ id, title, state, required: false, ...(note ? { note } : {}) });

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
