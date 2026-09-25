// FuryProof — zero-trust evidence kernel.
//
// Agents and harnesses may *claim* anything ("tests pass"). A claim becomes
// VERIFIED only when the host has issued a signed receipt for the same
// subject with a passing outcome. Receipts are HMAC-signed with a key that
// only the host-side ledger holds, so an agent that fabricates a receipt JSON
// cannot make it verify. FuryJudge turns requirements × receipts × claims into
// ACCEPT / REWORK / REJECT / ESCALATE / UNPROVEN, and a proof bundle records
// the result with a deterministic digest.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { canonicalizeMcpDirectJson, digestMcpDirectJson } from './mcp-direct-json.js';

export const FURY_PROOF_RECEIPT_FORMAT = 'furypipe-proof-receipt/v1' as const;
export const FURY_PROOF_BUNDLE_FORMAT = 'furypipe-proof-bundle/v1' as const;

export const FURY_RECEIPT_KINDS = Object.freeze([
  'TOOL_RECEIPT',
  'AGENT_RECEIPT',
  'PATCH_RECEIPT',
  'TEST_RECEIPT',
  'BROWSER_RECEIPT',
  'MODEL_RECEIPT',
  'INTEGRATION_RECEIPT',
  'APPROVAL_RECEIPT',
] as const);
export type FuryReceiptKind = (typeof FURY_RECEIPT_KINDS)[number];

export type FuryReceiptOutcome = 'pass' | 'fail' | 'error' | 'unknown';
export type FuryEvidenceState = 'OBSERVED' | 'DERIVED' | 'CLAIMED' | 'VERIFIED';
export type FuryJudgeVerdict = 'ACCEPT' | 'REWORK' | 'REJECT' | 'ESCALATE' | 'UNPROVEN';

const MAX_TEXT = 512;
const MAX_DETAILS_BYTES = 16 * 1024;
const MAX_ITEMS = 4_096;
const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,255}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;

export interface FuryReceiptInput {
  readonly kind: FuryReceiptKind;
  /** Stable subject the receipt is about, e.g. `test:unit`, `req:AUTH-1`. */
  readonly subject: string;
  readonly outcome: FuryReceiptOutcome;
  /** What produced the observation: a host tool, never an agent's own text. */
  readonly producer: string;
  /** sha256 of the raw evidence (log, diff, screenshot…) kept elsewhere. */
  readonly evidenceDigest: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface FuryReceipt extends FuryReceiptInput {
  readonly format: typeof FURY_PROOF_RECEIPT_FORMAT;
  readonly receiptId: string;
  readonly observedAt: number;
  readonly signature: string;
}

export interface FuryClaim {
  readonly claimId: string;
  readonly subject: string;
  readonly statement: string;
  readonly claimedBy: string;
  readonly assertedOutcome: FuryReceiptOutcome;
}

export interface FuryResolvedClaim extends FuryClaim {
  readonly state: FuryEvidenceState;
  readonly supportingReceiptIds: readonly string[];
  readonly contradictingReceiptIds: readonly string[];
}

export interface FuryRequirementEvidence {
  readonly kind: FuryReceiptKind;
  readonly subject: string;
}

export interface FuryRequirement {
  readonly id: string;
  readonly level: 'MUST' | 'SHOULD';
  readonly description: string;
  readonly evidence: readonly FuryRequirementEvidence[];
}

export interface FuryPolicyViolation {
  readonly code: string;
  readonly subject: string;
}

export interface FuryRequirementResult {
  readonly id: string;
  readonly level: 'MUST' | 'SHOULD';
  readonly status: 'VERIFIED' | 'FAILED' | 'MISSING' | 'CONFLICTING';
  readonly receiptIds: readonly string[];
  readonly reasons: readonly string[];
}

export interface FuryJudgement {
  readonly verdict: FuryJudgeVerdict;
  readonly requirements: readonly FuryRequirementResult[];
  readonly claims: readonly FuryResolvedClaim[];
  readonly rejectedReceipts: readonly string[];
  readonly risks: readonly string[];
}

export interface FuryProofBundleInput {
  readonly taskId: string;
  readonly judgement: FuryJudgement;
  readonly receipts: readonly FuryReceipt[];
  readonly commandsExecuted: readonly string[];
  readonly filesModified: readonly string[];
  readonly uncertainty: readonly string[];
  readonly outputDigest: string;
}

export interface FuryProofBundle extends FuryProofBundleInput {
  readonly format: typeof FURY_PROOF_BUNDLE_FORMAT;
  readonly bundleDigest: string;
}

export interface FuryProofLedger {
  /** Host-side only: turn an observation made by a host tool into a signed receipt. */
  issue(input: FuryReceiptInput): FuryReceipt;
  /** True only for untampered receipts signed by this ledger. */
  verify(receipt: unknown): receipt is FuryReceipt;
  judge(input: {
    readonly requirements: readonly FuryRequirement[];
    readonly receipts: readonly unknown[];
    readonly claims?: readonly FuryClaim[];
    readonly policyViolations?: readonly FuryPolicyViolation[];
  }): FuryJudgement;
}

export class FuryProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FuryProofError';
  }
}

function text(value: unknown, label: string, max = MAX_TEXT): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new FuryProofError(`${label} must be a bounded single-line string`);
  }
  return value;
}

function subject(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SUBJECT_PATTERN.test(value)) {
    throw new FuryProofError(`${label} is not a valid subject id`);
  }
  return value;
}

function kind(value: unknown): FuryReceiptKind {
  if (typeof value !== 'string' || !(FURY_RECEIPT_KINDS as readonly string[]).includes(value)) {
    throw new FuryProofError('receipt kind is unsupported');
  }
  return value as FuryReceiptKind;
}

function outcome(value: unknown): FuryReceiptOutcome {
  if (value !== 'pass' && value !== 'fail' && value !== 'error' && value !== 'unknown') {
    throw new FuryProofError('receipt outcome is unsupported');
  }
  return value;
}

function unsignedView(receipt: Omit<FuryReceipt, 'signature'>): Record<string, unknown> {
  return {
    format: receipt.format,
    receiptId: receipt.receiptId,
    kind: receipt.kind,
    subject: receipt.subject,
    outcome: receipt.outcome,
    producer: receipt.producer,
    evidenceDigest: receipt.evidenceDigest,
    observedAt: receipt.observedAt,
    details: receipt.details ?? {},
  };
}

function bounded<T>(items: readonly T[] | undefined, label: string): readonly T[] {
  if (items === undefined) return [];
  if (!Array.isArray(items) || items.length > MAX_ITEMS) {
    throw new FuryProofError(`${label} must be an array of at most ${MAX_ITEMS} items`);
  }
  return items;
}

export function createFuryProofLedger(options: {
  readonly key?: Buffer;
  readonly now?: () => number;
} = {}): FuryProofLedger {
  const key = options.key ?? randomBytes(32);
  if (!Buffer.isBuffer(key) || key.length < 32) {
    throw new FuryProofError('ledger key must be at least 32 bytes');
  }
  const now = options.now ?? Date.now;

  function sign(view: Record<string, unknown>): string {
    return createHmac('sha256', key)
      .update(canonicalizeMcpDirectJson(view, { maxBytes: MAX_DETAILS_BYTES * 2, label: 'receipt' }), 'utf8')
      .digest('hex');
  }

  function verify(candidate: unknown): candidate is FuryReceipt {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const receipt = candidate as Partial<FuryReceipt>;
    if (receipt.format !== FURY_PROOF_RECEIPT_FORMAT || typeof receipt.signature !== 'string' || !HEX64.test(receipt.signature)) {
      return false;
    }
    let expected: string;
    try {
      expected = sign(unsignedView(receipt as FuryReceipt));
    } catch {
      return false;
    }
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(receipt.signature, 'hex'));
  }

  const api: FuryProofLedger = {
    issue(input: FuryReceiptInput): FuryReceipt {
      if (!input || typeof input !== 'object') throw new FuryProofError('receipt input is required');
      const details = input.details ?? {};
      const detailsBytes = Buffer.byteLength(canonicalizeMcpDirectJson(details, { maxBytes: MAX_DETAILS_BYTES, label: 'receipt details' }), 'utf8');
      if (detailsBytes > MAX_DETAILS_BYTES) throw new FuryProofError('receipt details exceed the byte bound');
      if (typeof input.evidenceDigest !== 'string' || !HEX64.test(input.evidenceDigest)) {
        throw new FuryProofError('evidenceDigest must be a lowercase sha256 hex digest');
      }
      const base = {
        format: FURY_PROOF_RECEIPT_FORMAT,
        receiptId: `rcpt_${randomUUID()}`,
        kind: kind(input.kind),
        subject: subject(input.subject, 'receipt subject'),
        outcome: outcome(input.outcome),
        producer: text(input.producer, 'receipt producer', 128),
        evidenceDigest: input.evidenceDigest,
        observedAt: now(),
        details: JSON.parse(JSON.stringify(details)) as Record<string, unknown>,
      };
      return Object.freeze({ ...base, signature: sign(unsignedView(base)) });
    },

    verify,

    judge(input) {
      const requirements = bounded(input.requirements, 'requirements');
      const rawReceipts = bounded(input.receipts, 'receipts');
      const claims = bounded(input.claims, 'claims');
      const violations = bounded(input.policyViolations, 'policyViolations');

      const accepted: FuryReceipt[] = [];
      const rejectedReceipts: string[] = [];
      for (const candidate of rawReceipts) {
        if (verify(candidate)) accepted.push(candidate);
        else {
          const id = (candidate as { receiptId?: unknown } | null)?.receiptId;
          rejectedReceipts.push(typeof id === 'string' ? id.slice(0, 128) : 'unidentified');
        }
      }

      const bySubject = new Map<string, FuryReceipt[]>();
      for (const receipt of accepted) {
        const key = `${receipt.kind}\u0000${receipt.subject}`;
        const list = bySubject.get(key) ?? [];
        list.push(receipt);
        bySubject.set(key, list);
      }

      const results: FuryRequirementResult[] = [];
      const ids = new Set<string>();
      for (const requirement of requirements) {
        const id = subject(requirement.id, 'requirement id');
        if (ids.has(id)) throw new FuryProofError(`duplicate requirement id ${id}`);
        ids.add(id);
        if (requirement.level !== 'MUST' && requirement.level !== 'SHOULD') {
          throw new FuryProofError('requirement level must be MUST or SHOULD');
        }
        const evidence = bounded(requirement.evidence, 'requirement evidence');
        if (evidence.length === 0) throw new FuryProofError(`requirement ${id} declares no evidence contract`);
        const receiptIds: string[] = [];
        const reasons: string[] = [];
        let failed = false;
        let missing = false;
        let conflicting = false;
        for (const need of evidence) {
          const list = bySubject.get(`${kind(need.kind)}\u0000${subject(need.subject, 'evidence subject')}`) ?? [];
          const passes = list.filter((r) => r.outcome === 'pass');
          const failures = list.filter((r) => r.outcome === 'fail' || r.outcome === 'error');
          receiptIds.push(...list.map((r) => r.receiptId));
          if (passes.length > 0 && failures.length > 0) {
            conflicting = true;
            reasons.push(`${need.kind} ${need.subject}: both passing and failing receipts`);
          } else if (failures.length > 0) {
            failed = true;
            reasons.push(`${need.kind} ${need.subject}: ${failures[0]!.outcome}`);
          } else if (passes.length === 0) {
            missing = true;
            reasons.push(`${need.kind} ${need.subject}: no verified passing receipt`);
          }
        }
        results.push(Object.freeze({
          id,
          level: requirement.level,
          status: conflicting ? 'CONFLICTING' : failed ? 'FAILED' : missing ? 'MISSING' : 'VERIFIED',
          receiptIds: Object.freeze(receiptIds),
          reasons: Object.freeze(reasons),
        }));
      }

      const resolvedClaims: FuryResolvedClaim[] = claims.map((claim) => {
        const s = subject(claim.subject, 'claim subject');
        const matching = accepted.filter((r) => r.subject === s);
        const supporting = matching.filter((r) => r.outcome === claim.assertedOutcome);
        const contradicting = matching.filter((r) => r.outcome !== claim.assertedOutcome && r.outcome !== 'unknown');
        // A claim is never self-verifying: VERIFIED requires a host-signed
        // receipt that agrees with it and none that contradicts it.
        const state: FuryEvidenceState = supporting.length > 0 && contradicting.length === 0 ? 'VERIFIED' : 'CLAIMED';
        return Object.freeze({
          claimId: text(claim.claimId, 'claimId', 128),
          subject: s,
          statement: text(claim.statement, 'claim statement'),
          claimedBy: text(claim.claimedBy, 'claimedBy', 128),
          assertedOutcome: outcome(claim.assertedOutcome),
          state,
          supportingReceiptIds: Object.freeze(supporting.map((r) => r.receiptId)),
          contradictingReceiptIds: Object.freeze(contradicting.map((r) => r.receiptId)),
        });
      });

      const must = results.filter((r) => r.level === 'MUST');
      const risks: string[] = [];
      for (const r of results.filter((x) => x.level === 'SHOULD' && x.status !== 'VERIFIED')) {
        risks.push(`SHOULD ${r.id} ${r.status}`);
      }
      for (const c of resolvedClaims.filter((x) => x.contradictingReceiptIds.length > 0)) {
        risks.push(`claim ${c.claimId} contradicted by receipts`);
      }
      if (rejectedReceipts.length > 0) risks.push(`${rejectedReceipts.length} receipt(s) failed signature verification`);

      let verdict: FuryJudgeVerdict;
      if (violations.length > 0) verdict = 'REJECT';
      else if (must.some((r) => r.status === 'CONFLICTING')) verdict = 'ESCALATE';
      else if (must.some((r) => r.status === 'FAILED')) verdict = 'REWORK';
      else if (must.length === 0 || must.some((r) => r.status === 'MISSING')) verdict = 'UNPROVEN';
      else verdict = 'ACCEPT';

      return Object.freeze({
        verdict,
        requirements: Object.freeze(results),
        claims: Object.freeze(resolvedClaims),
        rejectedReceipts: Object.freeze(rejectedReceipts),
        risks: Object.freeze(risks),
      });
    },
  };
  return Object.freeze(api);
}

export function sealFuryProofBundle(input: FuryProofBundleInput): FuryProofBundle {
  text(input.taskId, 'taskId', 128);
  if (typeof input.outputDigest !== 'string' || !HEX64.test(input.outputDigest)) {
    throw new FuryProofError('outputDigest must be a lowercase sha256 hex digest');
  }
  const body = {
    format: FURY_PROOF_BUNDLE_FORMAT,
    taskId: input.taskId,
    judgement: input.judgement,
    receipts: [...input.receipts].sort((a, b) => (a.receiptId < b.receiptId ? -1 : a.receiptId > b.receiptId ? 1 : 0)),
    commandsExecuted: [...bounded(input.commandsExecuted, 'commandsExecuted')],
    filesModified: [...bounded(input.filesModified, 'filesModified')].sort(),
    uncertainty: [...bounded(input.uncertainty, 'uncertainty')],
    outputDigest: input.outputDigest,
  };
  const bundleDigest = digestMcpDirectJson(body, { maxBytes: 8 * 1024 * 1024, label: 'proof bundle' });
  return Object.freeze({ ...(JSON.parse(JSON.stringify(body)) as Omit<FuryProofBundle, 'bundleDigest'>), bundleDigest });
}
