import { normalizeCapabilityCandidate } from './ecosystem/normalize.js';
import type { CapabilityCandidate } from './ecosystem/types.js';

export const FURY_TRUST_REPORT_FORMAT = 'furypipe-trust-report/v1' as const;
export const FURY_TRUST_POLICY_VERSION = 'furytrust-static-v1' as const;
export const MAX_STATIC_EVIDENCE_FILES = 128;
export const MAX_STATIC_EVIDENCE_FILE_BYTES = 65_536;
export const MAX_STATIC_EVIDENCE_TOTAL_BYTES = 524_288;

export type FuryTrustVerdict = 'TRUSTED' | 'AUDITED' | 'RESTRICTED' | 'QUARANTINED' | 'BLOCKED' | 'UNKNOWN';
export type TrustSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TrustFindingCategory = 'metadata' | 'permission' | 'static-pattern' | 'operator-review';
export type TrustConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type TrustApproval = 'SOURCE_PIN_REVIEW' | 'PROVENANCE_REVIEW' | 'LICENSE_REVIEW' | 'SECURITY_REVIEW' | 'OPERATOR_REVIEW' | 'RUNTIME_SANDBOX';

export interface StaticEvidenceFile {
  /** Relative path label only. Content is analyzed in memory and never copied into the report. */
  readonly path: string;
  readonly content: string;
}

export interface OperatorTrustReview {
  /** This is an operator assertion; authentication/authorization is outside this pure policy module. */
  readonly decision: 'APPROVE' | 'RESTRICT' | 'BLOCK';
  readonly reviewerId: string;
  readonly reviewedAt: string;
  readonly evidenceReference?: string;
}

export interface FuryTrustFinding {
  readonly code: string;
  readonly severity: TrustSeverity;
  readonly category: TrustFindingCategory;
  readonly evidencePath?: string;
  readonly count: number;
}

export interface TrustEvidenceReference {
  readonly kind: 'source-text' | 'provenance' | 'license' | 'operator-review';
  readonly reference: string;
}

export interface DeclaredCapabilityFlow {
  readonly id: string;
  /** Ordered candidate IDs for a caller-declared workflow path; this is not runtime telemetry. */
  readonly capabilityIds: readonly string[];
}

export interface ToxicFlowFinding {
  readonly flowId: string;
  readonly credentialSourceId: string;
  readonly networkSinkId: string;
  readonly path: readonly string[];
  readonly code: 'POTENTIAL_CREDENTIAL_TO_ARBITRARY_NETWORK';
  readonly severity: 'CRITICAL';
  readonly observedFlow: false;
}

export interface FuryTrustReport {
  readonly format: typeof FURY_TRUST_REPORT_FORMAT;
  readonly policyVersion: typeof FURY_TRUST_POLICY_VERSION;
  readonly candidateId: string;
  readonly integrationDecision: CapabilityCandidate['decision'];
  readonly verdict: FuryTrustVerdict;
  /** Heuristic static risk score, not a probability or a safety guarantee. Higher means more findings. */
  readonly riskScore: number;
  readonly confidence: TrustConfidence;
  readonly findings: readonly FuryTrustFinding[];
  readonly requiredApprovals: readonly TrustApproval[];
  readonly blockingReasons: readonly string[];
  readonly evidence: readonly TrustEvidenceReference[];
  readonly scannedFileCount: number;
  readonly scannedByteCount: number;
  readonly evidenceCoverage: 'NO_SOURCE_TEXT_SUPPLIED' | 'CALLER_SUPPLIED_TEXT_ONLY';
  readonly runtimeVerified: false;
  readonly executionAuthorized: false;
}

const GENERATED_TRUST_REPORTS = new WeakSet<object>();

/** True only for immutable reports emitted by this in-process policy evaluator. */
export function isGeneratedFuryTrustReport(value: unknown): value is FuryTrustReport {
  return value !== null && typeof value === 'object' && GENERATED_TRUST_REPORTS.has(value);
}

const SECRET_PATTERN = /(?:\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bAKIA[0-9A-Z]{16}\b|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{20,})/giu;
const REMOTE_SHELL_PATTERN = /(?:\b(?:curl|wget)\b[^\n|]{0,512}\|\s*(?:sh|bash|zsh)\b|\bInvoke-WebRequest\b[^\n|]{0,512}\|\s*iex\b)/giu;
const PROMPT_OVERRIDE_PATTERN = /(?:ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?)|reveal\s+(?:the\s+)?(?:system\s+)?prompt|exfiltrate\s+(?:secrets?|credentials?))/giu;
const DYNAMIC_EXECUTION_PATTERN = /(?:\beval\s*\(|\bnew\s+Function\s*\(|\b(?:exec|execSync|spawnSync)\s*\()/giu;
const OBFUSCATION_PATTERN = /(?:\batob\s*\([^\n]{0,256}\)\s*\)?\s*\(\s*\)|\bbase64\s+(?:--decode|-d)\b[^\n|]{0,256}\|\s*(?:sh|bash)\b|String\.fromCharCode\s*\()/giu;
const CREDENTIAL_READ_PATTERN = /(?:process\.env\.[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)|(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\b)/iu;
const OUTBOUND_NETWORK_PATTERN = /(?:\bfetch\s*\(|\bhttps?\.request\s*\(|\bcurl\s+|\baxios\.(?:get|post|put|request)\s*\()/iu;
const EXTERNAL_INSTRUCTION_FETCH_PATTERN = /(?:\b(?:fetch|curl|wget)\b[^\n]{0,512}\b(?:AGENTS\.md|CLAUDE\.md|instructions?\.md|system[-_]prompt))/giu;
const SUSPICIOUS_DOWNLOAD_PATTERN = /(?:\b(?:curl|wget)\b[^\n]{0,256}(?:\/tmp\/|%TEMP%|AppData\\Local\\Temp)|\bInvoke-WebRequest\b[^\n]{0,256}-OutFile)/giu;
const UNBOUNDED_COMMAND_PATTERN = /(?:\b(?:sh|bash|cmd|powershell)\s+(?:-c|\/c)\s*["']?\$\{|\b(?:exec|execSync)\s*\([^\n]{0,128}\$\{)/giu;
const PATH_SEGMENT = /^[^\u0000-\u001f\u007f]{1,128}$/u;
const ISO_REVIEW_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const SEVERITY_WEIGHT: Readonly<Record<TrustSeverity, number>> = Object.freeze({ INFO: 0, LOW: 5, MEDIUM: 15, HIGH: 35, CRITICAL: 60 });

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function boundedLabel(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  if (hasUnpairedSurrogate(value)) throw new Error(`${label} contains malformed Unicode`);
  const result = value.normalize('NFC').trim();
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/u.test(result)) throw new Error(`${label} is invalid`);
  SECRET_PATTERN.lastIndex = 0;
  const hasCredentialMaterial = SECRET_PATTERN.test(result);
  SECRET_PATTERN.lastIndex = 0;
  if (hasCredentialMaterial) throw new Error(`${label} must not contain credential-like material`);
  return result;
}

function evidencePath(value: unknown): string {
  const path = boundedLabel(value, 'static evidence path', 256).replace(/\\/gu, '/');
  if (path.startsWith('/') || /^[A-Za-z]:/u.test(path)) throw new Error('static evidence path must be relative');
  const segments = path.split('/');
  if (segments.some((segment) => !PATH_SEGMENT.test(segment) || segment === '.' || segment === '..')) {
    throw new Error('static evidence path contains an invalid segment');
  }
  return segments.join('/');
}

function countMatches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(text)) {
    count += 1;
    if (count >= 100) break;
  }
  pattern.lastIndex = 0;
  return count;
}

function validateEvidence(files: readonly StaticEvidenceFile[]): { files: readonly StaticEvidenceFile[]; bytes: number } {
  if (!Array.isArray(files) || files.length > MAX_STATIC_EVIDENCE_FILES) {
    throw new Error(`static evidence accepts at most ${MAX_STATIC_EVIDENCE_FILES} files`);
  }
  let totalBytes = 0;
  const paths = new Set<string>();
  const normalized = files.map((file, index) => {
    if (file === null || typeof file !== 'object' || Array.isArray(file)) throw new Error(`static evidence file ${index} is invalid`);
    const path = evidencePath(file.path);
    if (paths.has(path)) throw new Error('static evidence contains duplicate paths');
    paths.add(path);
    if (typeof file.content !== 'string') throw new Error(`static evidence content ${index} must be text`);
    if (hasUnpairedSurrogate(file.content)) throw new Error(`static evidence content ${index} contains malformed Unicode`);
    const bytes = new TextEncoder().encode(file.content).byteLength;
    if (bytes > MAX_STATIC_EVIDENCE_FILE_BYTES) throw new Error(`static evidence file ${index} exceeds its byte limit`);
    totalBytes += bytes;
    if (totalBytes > MAX_STATIC_EVIDENCE_TOTAL_BYTES) throw new Error('static evidence exceeds its aggregate byte limit');
    return Object.freeze({ path, content: file.content });
  });
  normalized.sort((a, b) => compareText(a.path, b.path));
  return { files: Object.freeze(normalized), bytes: totalBytes };
}

function finding(
  code: string,
  severity: TrustSeverity,
  category: TrustFindingCategory,
  count = 1,
  evidencePathValue?: string,
): FuryTrustFinding {
  return Object.freeze({ code, severity, category, count, ...(evidencePathValue ? { evidencePath: evidencePathValue } : {}) });
}

function scanText(path: string, text: string): FuryTrustFinding[] {
  const findings: FuryTrustFinding[] = [];
  const secretCount = countMatches(text, SECRET_PATTERN);
  if (secretCount) findings.push(finding('SECRET_EXPOSURE', 'CRITICAL', 'static-pattern', secretCount, path));
  const remoteShellCount = countMatches(text, REMOTE_SHELL_PATTERN);
  if (remoteShellCount) findings.push(finding('REMOTE_SCRIPT_TO_SHELL', 'CRITICAL', 'static-pattern', remoteShellCount, path));
  const exfiltrationCount = CREDENTIAL_READ_PATTERN.test(text) && OUTBOUND_NETWORK_PATTERN.test(text) ? 1 : 0;
  CREDENTIAL_READ_PATTERN.lastIndex = 0;
  OUTBOUND_NETWORK_PATTERN.lastIndex = 0;
  if (exfiltrationCount) findings.push(finding('CREDENTIAL_EXPORT', 'CRITICAL', 'static-pattern', 1, path));
  const promptCount = countMatches(text, PROMPT_OVERRIDE_PATTERN);
  if (promptCount) findings.push(finding('PROMPT_OVERRIDE_PATTERN', 'HIGH', 'static-pattern', promptCount, path));
  const dynamicCount = countMatches(text, DYNAMIC_EXECUTION_PATTERN);
  if (dynamicCount) findings.push(finding('DYNAMIC_CODE_EXECUTION', 'HIGH', 'static-pattern', dynamicCount, path));
  const obfuscationCount = countMatches(text, OBFUSCATION_PATTERN);
  if (obfuscationCount) findings.push(finding('OBFUSCATED_SCRIPT', 'HIGH', 'static-pattern', obfuscationCount, path));
  const instructionFetchCount = countMatches(text, EXTERNAL_INSTRUCTION_FETCH_PATTERN);
  if (instructionFetchCount) findings.push(finding('EXTERNAL_INSTRUCTION_FETCH', 'HIGH', 'static-pattern', instructionFetchCount, path));
  const suspiciousDownloadCount = countMatches(text, SUSPICIOUS_DOWNLOAD_PATTERN);
  if (suspiciousDownloadCount) findings.push(finding('SUSPICIOUS_DOWNLOAD', 'MEDIUM', 'static-pattern', suspiciousDownloadCount, path));
  const commandCount = countMatches(text, UNBOUNDED_COMMAND_PATTERN);
  if (commandCount) findings.push(finding('UNBOUNDED_COMMAND', 'HIGH', 'static-pattern', commandCount, path));
  return findings;
}

function permissionFindings(candidate: CapabilityCandidate): FuryTrustFinding[] {
  const findings: FuryTrustFinding[] = [];
  const p = candidate.permissions;
  if (p.network === 'arbitrary') findings.push(finding('ARBITRARY_NETWORK', 'HIGH', 'permission'));
  else if (p.network === 'restricted') findings.push(finding('RESTRICTED_NETWORK', 'MEDIUM', 'permission'));
  if (p.filesystem === 'write' || p.filesystem === 'arbitrary-write') findings.push(finding('FILESYSTEM_WRITE', 'HIGH', 'permission'));
  if (p.filesystem === 'delete') findings.push(finding('FILESYSTEM_DELETE', 'HIGH', 'permission'));
  if (p.subprocess === 'arbitrary') findings.push(finding('ARBITRARY_SUBPROCESS', 'HIGH', 'permission'));
  else if (p.subprocess === 'restricted') findings.push(finding('RESTRICTED_SUBPROCESS', 'MEDIUM', 'permission'));
  if (p.credentials === 'read' || p.credentials === 'manage') findings.push(finding('CREDENTIAL_READ', 'CRITICAL', 'permission'));
  if (p.credentials === 'use') findings.push(finding('CREDENTIAL_USE', 'HIGH', 'permission'));
  if (p.database === 'scoped-write' || p.database === 'admin') findings.push(finding('DATABASE_WRITE', 'HIGH', 'permission'));
  if (p.browser === 'interact') findings.push(finding('INTERACTIVE_BROWSER_PERMISSION', 'MEDIUM', 'permission'));
  if (p.provider === 'configure') findings.push(finding('PROVIDER_CONFIGURATION_PERMISSION', 'HIGH', 'permission'));
  if (p.cloud === 'scoped-write' || p.cloud === 'admin') findings.push(finding('CLOUD_MUTATION', 'HIGH', 'permission'));
  for (const write of p.externalWrites) {
    const severity: TrustSeverity = write === 'financial' || write === 'admin' ? 'CRITICAL' : 'HIGH';
    const code = write === 'financial' ? 'FINANCIAL_ACTION' : write === 'deploy' ? 'DEPLOY_ACTION' : `EXTERNAL_WRITE_${write.toUpperCase()}`;
    findings.push(finding(code, severity, 'permission'));
  }
  if (candidate.type === 'mcp' && (p.externalWrites.length > 0 || p.database === 'scoped-write' || p.database === 'admin')) {
    findings.push(finding('MCP_MUTATING_TOOL', 'HIGH', 'permission'));
  }
  if (candidate.type === 'mcp' && p.network === 'arbitrary' && p.externalWrites.length > 0) {
    findings.push(finding('MCP_UNSCOPED_TOOL', 'CRITICAL', 'permission'));
  }
  if ((p.credentials === 'read' || p.credentials === 'use' || p.credentials === 'manage') && p.network === 'arbitrary') {
    findings.push(finding('CREDENTIAL_EXPORT', 'CRITICAL', 'permission'));
  }
  return findings;
}

function metadataFindings(candidate: CapabilityCandidate): FuryTrustFinding[] {
  const findings: FuryTrustFinding[] = [];
  if (candidate.source.pinStatus === 'UNPINNED') findings.push(finding('UNPINNED_SOURCE', 'MEDIUM', 'metadata'));
  if (candidate.source.pinStatus === 'MUTABLE_SOURCE') findings.push(finding('MUTABLE_SOURCE', 'HIGH', 'metadata'));
  if (candidate.provenance.classification === 'UNKNOWN' || candidate.provenance.reviewStatus !== 'REVIEWED') {
    findings.push(finding('UNKNOWN_PROVENANCE', 'MEDIUM', 'metadata'));
  }
  if (candidate.license.status === 'MISSING') {
    findings.push(finding('MISSING_LICENSE', 'MEDIUM', 'metadata'));
  } else if (candidate.license.status === 'AMBIGUOUS') {
    findings.push(finding('AMBIGUOUS_LICENSE', 'MEDIUM', 'metadata'));
  } else if (candidate.license.status === 'UNKNOWN') {
    findings.push(finding('UNKNOWN_LICENSE', 'MEDIUM', 'metadata'));
  } else if (candidate.license.status === 'INCOMPATIBLE') {
    findings.push(finding('LICENSE_INCOMPATIBLE', 'HIGH', 'metadata'));
  }
  if (candidate.license.conflict) findings.push(finding('LICENSE_EVIDENCE_CONFLICT', 'HIGH', 'metadata'));
  if (candidate.provenance.classification === 'OFFICIAL' && !hasOfficialProofReference(candidate)) {
    findings.push(finding('OFFICIAL_CLAIM_MISSING_EVIDENCE', 'HIGH', 'metadata'));
  }
  if (candidate.maintenance.status === 'ARCHIVED') findings.push(finding('ARCHIVED_MAINTENANCE_STATE', 'MEDIUM', 'metadata'));
  return findings;
}

function hasOfficialProofReference(candidate: CapabilityCandidate): boolean {
  const sourceUrl = new URL(candidate.source.repositoryUrl ?? candidate.source.url);
  const sourceHost = sourceUrl.hostname.toLowerCase();
  const forgeHosts = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);
  const repoOwner = forgeHosts.has(sourceHost) ? sourceUrl.pathname.split('/').filter(Boolean)[0]?.toLowerCase() : undefined;
  return candidate.provenance.evidence.some((item) => {
    if (item.kind !== 'official-domain' && item.kind !== 'signed-release') return false;
    try {
      const reference = new URL(item.reference);
      if (reference.protocol !== 'https:' || reference.username || reference.password) return false;
      const evidenceHost = reference.hostname.toLowerCase();
      if (item.kind === 'official-domain') {
        // Require a host-boundary match; owner-name substring/label matches are trivially spoofable.
        if (reference.host.toLowerCase() === sourceUrl.host.toLowerCase()) {
          return repoOwner === undefined
            || reference.pathname.split('/').filter(Boolean)[0]?.toLowerCase() === repoOwner;
        }
        return !forgeHosts.has(sourceHost)
          && reference.port === sourceUrl.port
          && evidenceHost.endsWith(`.${sourceHost}`);
      }
      if (reference.host.toLowerCase() !== sourceUrl.host.toLowerCase()) return false;
      if (!repoOwner) return true;
      const sourcePath = sourceUrl.pathname.split('/').filter(Boolean).slice(0, 2).map((part) => part.toLowerCase());
      const evidencePath = reference.pathname.split('/').filter(Boolean).map((part) => part.toLowerCase());
      return sourcePath.length === 2 && sourcePath.every((part, index) => evidencePath[index] === part);
    } catch {
      return false;
    }
  });
}

function parseOperatorReview(value: OperatorTrustReview | undefined): OperatorTrustReview | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('operator trust review is invalid');
  const allowed = new Set(['decision', 'reviewerId', 'reviewedAt', 'evidenceReference']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error('operator trust review contains an unsupported field');
  if (!['APPROVE', 'RESTRICT', 'BLOCK'].includes(value.decision)) throw new Error('operator trust review decision is invalid');
  const reviewerId = boundedLabel(value.reviewerId, 'operator reviewerId', 128);
  const reviewedAtInput = boundedLabel(value.reviewedAt, 'operator reviewedAt', 40);
  if (!ISO_REVIEW_TIMESTAMP.test(reviewedAtInput)) throw new Error('operator reviewedAt must be an ISO date-time');
  const datePart = reviewedAtInput.slice(0, 10);
  const calendarDate = new Date(`${datePart}T00:00:00.000Z`);
  const clock = /T(\d{2}):(\d{2}):(\d{2})/u.exec(reviewedAtInput);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== datePart
    || !clock || Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3]) > 59) {
    throw new Error('operator reviewedAt contains an invalid date or time');
  }
  const timestamp = Date.parse(reviewedAtInput);
  if (!Number.isFinite(timestamp)) throw new Error('operator reviewedAt must be an ISO date-time');
  const evidenceReference = value.evidenceReference === undefined
    ? undefined
    : boundedLabel(value.evidenceReference, 'operator evidenceReference', 512);
  if (evidenceReference && SECRET_PATTERN.test(evidenceReference)) {
    SECRET_PATTERN.lastIndex = 0;
    throw new Error('operator evidence reference must not contain credential-like material');
  }
  SECRET_PATTERN.lastIndex = 0;
  return Object.freeze({
    decision: value.decision,
    reviewerId,
    reviewedAt: new Date(timestamp).toISOString(),
    ...(evidenceReference ? { evidenceReference } : {}),
  });
}

/** Static-only policy. It does not fetch, install, execute, authenticate an operator, or authorize runtime use. */
export function evaluateFuryTrust(
  candidateValue: CapabilityCandidate | unknown,
  evidenceFiles: readonly StaticEvidenceFile[] = [],
  operatorReviewValue?: OperatorTrustReview,
): FuryTrustReport {
  const candidate = normalizeCapabilityCandidate(candidateValue);
  const evidence = validateEvidence(evidenceFiles);
  const operatorReview = parseOperatorReview(operatorReviewValue);
  const findings: FuryTrustFinding[] = metadataFindings(candidate);
  findings.push(...permissionFindings(candidate));
  for (const file of evidence.files) findings.push(...scanText(file.path, file.content));
  findings.push(...scanText('metadata/description', [candidate.name, candidate.description, candidate.publisher ?? '', ...candidate.authors].join('\n')));
  if (evidence.files.length === 0) findings.push(finding('NO_STATIC_SOURCE_TEXT', 'MEDIUM', 'metadata'));
  if (operatorReview?.decision === 'BLOCK') findings.push(finding('OPERATOR_BLOCK', 'CRITICAL', 'operator-review'));
  if (operatorReview?.decision === 'RESTRICT') findings.push(finding('OPERATOR_RESTRICTION', 'HIGH', 'operator-review'));
  if (operatorReview?.decision === 'APPROVE') findings.push(finding('OPERATOR_APPROVAL_RECORDED', 'INFO', 'operator-review'));

  const unique = new Map<string, FuryTrustFinding>();
  for (const item of findings) {
    const key = `${item.code}:${item.evidencePath ?? ''}`;
    const current = unique.get(key);
    if (current) unique.set(key, finding(item.code, current.severity, current.category, current.count + item.count, item.evidencePath));
    else unique.set(key, item);
  }
  const stableFindings = [...unique.values()].sort((a, b) => compareText(a.code, b.code)
    || compareText(a.evidencePath ?? '', b.evidencePath ?? ''));
  const riskScore = Math.min(100, stableFindings.reduce((sum, item) => sum + SEVERITY_WEIGHT[item.severity] * item.count, 0));
  const hasStaticThreat = stableFindings.some((item) => item.category === 'static-pattern' && (item.severity === 'HIGH' || item.severity === 'CRITICAL'));
  const hasCriticalPermission = stableFindings.some((item) => item.category === 'permission' && item.severity === 'CRITICAL');
  const hasElevatedPermission = stableFindings.some((item) => item.category === 'permission' && item.severity !== 'INFO' && item.severity !== 'LOW');
  const metadataComplete = candidate.source.pinStatus === 'PINNED'
    && candidate.provenance.reviewStatus === 'REVIEWED'
    && candidate.provenance.classification !== 'UNKNOWN'
    && candidate.license.status === 'VERIFIED'
    && !candidate.license.conflict
    && (candidate.provenance.classification !== 'OFFICIAL' || hasOfficialProofReference(candidate))
    && evidence.files.length > 0;

  let verdict: FuryTrustVerdict;
  if (operatorReview?.decision === 'BLOCK') verdict = 'BLOCKED';
  else if (hasStaticThreat || hasCriticalPermission) verdict = 'QUARANTINED';
  else if (operatorReview?.decision === 'RESTRICT' || hasElevatedPermission
    || candidate.source.pinStatus !== 'PINNED' || candidate.license.status === 'INCOMPATIBLE') verdict = 'RESTRICTED';
  else if (!metadataComplete) verdict = 'UNKNOWN';
  else if (operatorReview?.decision === 'APPROVE'
    && (candidate.provenance.classification === 'FIRST_PARTY' || candidate.provenance.classification === 'OFFICIAL')
    && (candidate.provenance.classification !== 'OFFICIAL' || hasOfficialProofReference(candidate))) verdict = 'TRUSTED';
  else verdict = 'AUDITED';

  const requiredApprovals: TrustApproval[] = ['RUNTIME_SANDBOX'];
  if (candidate.source.pinStatus !== 'PINNED') requiredApprovals.push('SOURCE_PIN_REVIEW');
  if (candidate.provenance.reviewStatus !== 'REVIEWED' || candidate.provenance.classification === 'UNKNOWN'
    || (candidate.provenance.classification === 'OFFICIAL' && !hasOfficialProofReference(candidate))) {
    requiredApprovals.push('PROVENANCE_REVIEW');
  }
  if (candidate.license.status !== 'VERIFIED' || candidate.license.conflict) requiredApprovals.push('LICENSE_REVIEW');
  if (stableFindings.some((item) => item.category === 'static-pattern' && item.severity !== 'INFO' && item.severity !== 'LOW')
    || hasElevatedPermission) requiredApprovals.push('SECURITY_REVIEW');
  if (operatorReview?.decision !== 'APPROVE') requiredApprovals.push('OPERATOR_REVIEW');
  const blockingReasons = verdict === 'BLOCKED' || verdict === 'QUARANTINED'
    ? stableFindings.filter((item) => item.severity === 'CRITICAL'
      || (item.category === 'static-pattern' && item.severity === 'HIGH')).map((item) => item.code)
    : verdict === 'UNKNOWN'
      ? stableFindings.filter((item) => item.category === 'metadata').map((item) => item.code)
      : [];
  const confidence: TrustConfidence = metadataComplete && operatorReview?.decision === 'APPROVE'
    ? 'HIGH'
    : evidence.files.length > 0 && candidate.source.pinStatus === 'PINNED' && candidate.license.status === 'VERIFIED'
      ? 'MEDIUM'
      : 'LOW';
  const trustEvidence: TrustEvidenceReference[] = [
    ...evidence.files.map((file) => Object.freeze({ kind: 'source-text' as const, reference: file.path })),
    ...candidate.provenance.evidence.map((item) => Object.freeze({ kind: 'provenance' as const, reference: item.reference })),
    ...candidate.license.evidence.map((item) => Object.freeze({ kind: 'license' as const, reference: item.reference })),
    ...(operatorReview?.evidenceReference ? [Object.freeze({ kind: 'operator-review' as const, reference: operatorReview.evidenceReference })] : []),
  ];
  trustEvidence.sort((a, b) => compareText(`${a.kind}:${a.reference}`, `${b.kind}:${b.reference}`));

  const report: FuryTrustReport = Object.freeze({
    format: FURY_TRUST_REPORT_FORMAT,
    policyVersion: FURY_TRUST_POLICY_VERSION,
    candidateId: candidate.id,
    integrationDecision: candidate.decision,
    verdict,
    riskScore,
    confidence,
    findings: Object.freeze(stableFindings),
    requiredApprovals: Object.freeze(requiredApprovals),
    blockingReasons: Object.freeze([...new Set(blockingReasons)].sort(compareText)),
    evidence: Object.freeze(trustEvidence),
    scannedFileCount: evidence.files.length,
    scannedByteCount: evidence.bytes,
    evidenceCoverage: evidence.files.length ? 'CALLER_SUPPLIED_TEXT_ONLY' : 'NO_SOURCE_TEXT_SUPPLIED',
    runtimeVerified: false,
    executionAuthorized: false,
  });
  GENERATED_TRUST_REPORTS.add(report);
  return report;
}

/** Finds declared permission paths that could expose credentials; it does not claim data was transmitted. */
export function analyzeDeclaredCapabilityFlows(
  candidateValues: readonly (CapabilityCandidate | unknown)[],
  flows: readonly DeclaredCapabilityFlow[],
): readonly ToxicFlowFinding[] {
  if (!Array.isArray(candidateValues) || candidateValues.length > 5_000) throw new Error('flow analysis candidate limit exceeded');
  if (!Array.isArray(flows) || flows.length > 1_024) throw new Error('flow analysis flow limit exceeded');
  const candidates = candidateValues.map((candidate) => normalizeCapabilityCandidate(candidate));
  const byId = new Map<string, CapabilityCandidate>();
  for (const candidate of candidates) {
    if (byId.has(candidate.id)) throw new Error('flow analysis contains duplicate candidate identities');
    byId.set(candidate.id, candidate);
  }
  const seenFlowIds = new Set<string>();
  const results: ToxicFlowFinding[] = [];
  for (const [index, flow] of flows.entries()) {
    if (!flow || typeof flow !== 'object' || Array.isArray(flow)) throw new Error(`flow ${index} is invalid`);
    const flowKeys = Object.keys(flow);
    if (flowKeys.some((key) => key !== 'id' && key !== 'capabilityIds')) throw new Error(`flow ${index} contains an unsupported field`);
    const id = boundedLabel(flow.id, 'flow id', 96);
    if (!/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(id) || seenFlowIds.has(id)) throw new Error('flow id is invalid or duplicated');
    seenFlowIds.add(id);
    if (!Array.isArray(flow.capabilityIds) || flow.capabilityIds.length === 0 || flow.capabilityIds.length > 64) {
      throw new Error(`flow ${id} must contain between 1 and 64 capability IDs`);
    }
    const path = [...flow.capabilityIds];
    if (new Set(path).size !== path.length) throw new Error(`flow ${id} contains a repeated capability ID`);
    const nodes = path.map((candidateId) => {
      const candidate = byId.get(candidateId);
      if (!candidate) throw new Error(`flow ${id} references an unknown capability`);
      return candidate;
    });
    let credentialIndex = -1;
    for (let pathIndex = 0; pathIndex < nodes.length; pathIndex += 1) {
      const permissions = nodes[pathIndex]!.permissions;
      if (permissions.credentials === 'read' || permissions.credentials === 'use' || permissions.credentials === 'manage') {
        credentialIndex = pathIndex;
        break;
      }
    }
    if (credentialIndex < 0) continue;
    const sinkIndex = nodes.findIndex((candidate, pathIndex) =>
      pathIndex >= credentialIndex && candidate.permissions.network === 'arbitrary');
    if (sinkIndex < 0) continue;
    results.push(Object.freeze({
      flowId: id,
      credentialSourceId: nodes[credentialIndex]!.id,
      networkSinkId: nodes[sinkIndex]!.id,
      path: Object.freeze(path),
      code: 'POTENTIAL_CREDENTIAL_TO_ARBITRARY_NETWORK',
      severity: 'CRITICAL',
      observedFlow: false,
    }));
  }
  results.sort((a, b) => compareText(a.flowId, b.flowId)
    || compareText(a.credentialSourceId, b.credentialSourceId)
    || compareText(a.networkSinkId, b.networkSinkId));
  return Object.freeze(results);
}
