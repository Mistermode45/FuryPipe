import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  FuryProofError,
  createFuryProofLedger,
  sealFuryProofBundle,
  type FuryReceipt,
  type FuryRequirement,
} from '../src/fury-proof.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function ledger() {
  let t = 1_000;
  return createFuryProofLedger({ key: randomBytes(32), now: () => (t += 1) });
}

const requirement = (overrides: Partial<FuryRequirement> = {}): FuryRequirement => ({
  id: 'req:auth-tests',
  level: 'MUST',
  description: 'Auth unit tests pass',
  evidence: [{ kind: 'TEST_RECEIPT', subject: 'test:auth' }],
  ...overrides,
});

describe('FuryProof ledger and judge', () => {
  it('accepts only when every MUST requirement has a verified passing receipt', () => {
    const proof = ledger();
    const pass = proof.issue({ kind: 'TEST_RECEIPT', subject: 'test:auth', outcome: 'pass', producer: 'host:vitest', evidenceDigest: digest('log') });
    expect(proof.verify(pass)).toBe(true);
    const judgement = proof.judge({ requirements: [requirement()], receipts: [pass] });
    expect(judgement.verdict).toBe('ACCEPT');
    expect(judgement.requirements[0]).toMatchObject({ status: 'VERIFIED', receiptIds: [pass.receiptId] });
  });

  it('keeps an agent "tests pass" claim CLAIMED and the task UNPROVEN without a receipt', () => {
    const proof = ledger();
    const judgement = proof.judge({
      requirements: [requirement()],
      receipts: [],
      claims: [{ claimId: 'c1', subject: 'test:auth', statement: 'tests pass', claimedBy: 'agent:coder', assertedOutcome: 'pass' }],
    });
    expect(judgement.verdict).toBe('UNPROVEN');
    expect(judgement.claims[0]?.state).toBe('CLAIMED');
  });

  it('rejects a forged receipt (agent-fabricated JSON, wrong key, or tampered field)', () => {
    const proof = ledger();
    const other = ledger();
    const real = proof.issue({ kind: 'TEST_RECEIPT', subject: 'test:auth', outcome: 'fail', producer: 'host:vitest', evidenceDigest: digest('fail log') });
    const tampered: FuryReceipt = { ...real, outcome: 'pass' };
    const foreign = other.issue({ kind: 'TEST_RECEIPT', subject: 'test:auth', outcome: 'pass', producer: 'host:vitest', evidenceDigest: digest('x') });
    const fabricated = { ...foreign, signature: '0'.repeat(64) };
    for (const fake of [tampered, foreign, fabricated, { receiptId: 'x' }, null, 'pass']) {
      expect(proof.verify(fake)).toBe(false);
    }
    const judgement = proof.judge({
      requirements: [requirement()],
      receipts: [tampered, foreign, fabricated],
      claims: [{ claimId: 'c1', subject: 'test:auth', statement: 'tests pass', claimedBy: 'agent:coder', assertedOutcome: 'pass' }],
    });
    expect(judgement.verdict).toBe('UNPROVEN');
    expect(judgement.rejectedReceipts).toHaveLength(3);
    expect(judgement.claims[0]?.state).toBe('CLAIMED');
    expect(judgement.risks.join(' ')).toContain('failed signature verification');
  });

  it('returns REWORK on a failing receipt, ESCALATE on conflicting receipts and REJECT on a policy violation', () => {
    const proof = ledger();
    const fail = proof.issue({ kind: 'TEST_RECEIPT', subject: 'test:auth', outcome: 'fail', producer: 'host:vitest', evidenceDigest: digest('f') });
    const pass = proof.issue({ kind: 'TEST_RECEIPT', subject: 'test:auth', outcome: 'pass', producer: 'host:vitest', evidenceDigest: digest('p') });
    expect(proof.judge({ requirements: [requirement()], receipts: [fail] }).verdict).toBe('REWORK');
    expect(proof.judge({ requirements: [requirement()], receipts: [fail, pass] }).verdict).toBe('ESCALATE');
    expect(proof.judge({
      requirements: [requirement()],
      receipts: [pass],
      policyViolations: [{ code: 'network-denied', subject: 'agent:coder' }],
    }).verdict).toBe('REJECT');
  });

  it('marks a claim VERIFIED only when a signed receipt agrees and none contradicts', () => {
    const proof = ledger();
    const pass = proof.issue({ kind: 'TEST_RECEIPT', subject: 'test:auth', outcome: 'pass', producer: 'host:vitest', evidenceDigest: digest('p') });
    const claim = { claimId: 'c1', subject: 'test:auth', statement: 'tests pass', claimedBy: 'agent:coder', assertedOutcome: 'pass' as const };
    expect(proof.judge({ requirements: [requirement()], receipts: [pass], claims: [claim] }).claims[0]?.state).toBe('VERIFIED');
    const fail = proof.issue({ kind: 'TEST_RECEIPT', subject: 'test:auth', outcome: 'fail', producer: 'host:vitest', evidenceDigest: digest('f') });
    const judged = proof.judge({ requirements: [requirement()], receipts: [pass, fail], claims: [claim] });
    expect(judged.claims[0]?.state).toBe('CLAIMED');
    expect(judged.claims[0]?.contradictingReceiptIds).toEqual([fail.receiptId]);
  });

  it('never accepts with zero MUST requirements and reports unmet SHOULD as a risk', () => {
    const proof = ledger();
    const judged = proof.judge({ requirements: [requirement({ level: 'SHOULD' })], receipts: [] });
    expect(judged.verdict).toBe('UNPROVEN');
    expect(judged.risks).toContain('SHOULD req:auth-tests MISSING');
  });

  it('fails closed on malformed inputs', () => {
    const proof = ledger();
    expect(() => proof.issue({ kind: 'TEST_RECEIPT', subject: 'bad subject', outcome: 'pass', producer: 'h', evidenceDigest: digest('x') })).toThrow(FuryProofError);
    expect(() => proof.issue({ kind: 'NOPE' as never, subject: 's', outcome: 'pass', producer: 'h', evidenceDigest: digest('x') })).toThrow(FuryProofError);
    expect(() => proof.issue({ kind: 'TEST_RECEIPT', subject: 's', outcome: 'pass', producer: 'h', evidenceDigest: 'ABC' })).toThrow(FuryProofError);
    expect(() => proof.issue({ kind: 'TEST_RECEIPT', subject: 's', outcome: 'pass', producer: 'h', evidenceDigest: digest('x'), details: { blob: 'x'.repeat(20_000) } })).toThrow();
    expect(() => proof.judge({ requirements: [requirement({ evidence: [] })], receipts: [] })).toThrow(/no evidence contract/u);
    expect(() => proof.judge({ requirements: [requirement(), requirement()], receipts: [] })).toThrow(/duplicate/u);
    expect(() => createFuryProofLedger({ key: Buffer.alloc(8) })).toThrow(FuryProofError);
  });

  it('seals a deterministic proof bundle independent of receipt order', () => {
    const proof = ledger();
    const a = proof.issue({ kind: 'TEST_RECEIPT', subject: 'test:auth', outcome: 'pass', producer: 'host:vitest', evidenceDigest: digest('a') });
    const b = proof.issue({ kind: 'PATCH_RECEIPT', subject: 'patch:1', outcome: 'pass', producer: 'host:git', evidenceDigest: digest('b') });
    const judgement = proof.judge({ requirements: [requirement()], receipts: [a, b] });
    const base = { taskId: 'task-1', judgement, commandsExecuted: ['pnpm test'], filesModified: ['src/b.ts', 'src/a.ts'], uncertainty: [], outputDigest: digest('out') };
    const one = sealFuryProofBundle({ ...base, receipts: [a, b] });
    const two = sealFuryProofBundle({ ...base, receipts: [b, a], filesModified: ['src/a.ts', 'src/b.ts'] });
    expect(one.bundleDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(one.bundleDigest).toBe(two.bundleDigest);
    expect(sealFuryProofBundle({ ...base, receipts: [a] }).bundleDigest).not.toBe(one.bundleDigest);
  });
});
