import { describe, expect, it } from 'vitest';

import { resolveFuryCapabilityActivation } from '../src/capability-activation.js';
import { normalizeCapabilityCandidate } from '../src/ecosystem/normalize.js';
import { evaluateFuryTrust } from '../src/fury-trust.js';
import { scoreFuryCapability } from '../src/fury-score.js';
import { makeCapabilityCandidate } from './helpers/ecosystem-candidate.js';

function scoreCandidate(
  idChar: string,
  overrides: Parameters<typeof makeCapabilityCandidate>[0] = {},
) {
  const repository = `https://github.com/fury-example/activation-${idChar}`;
  const candidate = normalizeCapabilityCandidate(makeCapabilityCandidate({
    source: {
      kind: 'git',
      url: repository,
      repositoryUrl: repository,
      version: '1.0.0',
      commitSha: idChar.repeat(40),
    },
    decision: 'ADOPT',
    ...overrides,
  }));
  const trustReport = evaluateFuryTrust(
    candidate,
    [{ path: 'src/index.ts', content: 'export const value = 1;' }],
    {
      decision: 'APPROVE',
      reviewerId: 'activation-test',
      reviewedAt: '2026-09-13T00:00:00Z',
      evidenceReference: 'review:activation-test',
    },
  );
  return scoreFuryCapability({ candidate, trustReport, relevance: 1 });
}

describe('FuryPipe capability activation contract', () => {
  it('keeps a ranked catalog recommendation separate from registration, connection and approval', () => {
    const score = scoreCandidate('a');

    expect(resolveFuryCapabilityActivation({
      score,
      registered: false,
    })).toMatchObject({
      catalogDisposition: 'RECOMMENDED',
      registrationState: 'UNREGISTERED',
      connectionState: 'DISCONNECTED',
      approvalState: 'NOT_APPROVED',
      readinessState: 'NEEDS_REGISTRATION',
      readyForPolicyAuthorization: false,
      executionAuthorized: false,
    });

    expect(resolveFuryCapabilityActivation({
      score,
      registered: true,
    }).readinessState).toBe('NEEDS_CONNECTION');

    expect(resolveFuryCapabilityActivation({
      score,
      registered: true,
      connected: true,
    }).readinessState).toBe('NEEDS_APPROVAL');

    const ready = resolveFuryCapabilityActivation({
      score,
      registered: true,
      connected: true,
      approved: true,
    });
    expect(ready.readinessState).toBe('READY_FOR_POLICY_AUTHORIZATION');
    expect(ready.readyForPolicyAuthorization).toBe(true);
    expect(ready.executionAuthorized).toBe(false);
    expect(ready.blockers).toEqual(['policy-authorization-required']);
  });

  it('never makes reference-only or blocked scores ready for policy authorization', () => {
    const reference = scoreCandidate('b', { decision: 'REFERENCE_ONLY' });
    expect(resolveFuryCapabilityActivation({
      score: reference,
      registered: true,
      connected: true,
      approved: true,
    })).toMatchObject({
      catalogDisposition: 'REFERENCE_ONLY',
      readinessState: 'REFERENCE_ONLY',
      readyForPolicyAuthorization: false,
      executionAuthorized: false,
    });

    const blocked = scoreCandidate('c', {
      permissions: {
        network: 'arbitrary',
        filesystem: 'read',
        subprocess: 'none',
        credentials: 'manage',
        externalWrites: [],
        database: 'none',
        browser: 'none',
        provider: 'none',
        cloud: 'none',
      },
    });
    expect(resolveFuryCapabilityActivation({
      score: blocked,
      registered: true,
      connected: true,
      approved: true,
    })).toMatchObject({
      catalogDisposition: 'BLOCKED',
      readinessState: 'BLOCKED',
      readyForPolicyAuthorization: false,
      executionAuthorized: false,
    });
  });

  it('keeps restricted FuryScore results review-gated until explicit approval', () => {
    const restricted = scoreCandidate('d', {
      permissions: {
        network: 'restricted',
        filesystem: 'read',
        subprocess: 'none',
        credentials: 'none',
        externalWrites: [],
        database: 'none',
        browser: 'none',
        provider: 'none',
        cloud: 'none',
      },
    });
    expect(restricted.routingState).toBe('REVIEW_REQUIRED');

    expect(resolveFuryCapabilityActivation({
      score: restricted,
      registered: true,
      connected: true,
    }).readinessState).toBe('NEEDS_APPROVAL');

    const approved = resolveFuryCapabilityActivation({
      score: restricted,
      registered: true,
      connected: true,
      approved: true,
    });
    expect(approved.readinessState).toBe('READY_FOR_POLICY_AUTHORIZATION');
    expect(approved.executionAuthorized).toBe(false);
  });

  it('fails closed on impossible lifecycle claims', () => {
    const score = scoreCandidate('e');

    expect(() => resolveFuryCapabilityActivation({
      score,
      registered: false,
      connected: true,
    })).toThrow(/must first be registered/);

    expect(() => resolveFuryCapabilityActivation({
      score,
      registered: true,
      executed: true,
      executionReceiptId: 'receipt:too-early',
    })).toThrow(/must first be ready/);

    expect(() => resolveFuryCapabilityActivation({
      score,
      registered: true,
      connected: true,
      approved: true,
      verified: true,
      verificationEvidence: ['verify:test'],
    })).toThrow(/must first have an execution observation/);
  });

  it('requires bounded receipt and verification references for observed execution and verification', () => {
    const score = scoreCandidate('f');

    expect(() => resolveFuryCapabilityActivation({
      score,
      registered: true,
      connected: true,
      approved: true,
      executed: true,
    })).toThrow(/requires an executionReceiptId/);

    expect(() => resolveFuryCapabilityActivation({
      score,
      registered: true,
      connected: true,
      approved: true,
      executed: true,
      executionReceiptId: 'receipt:001',
      verified: true,
    })).toThrow(/requires verification evidence/);

    const result = resolveFuryCapabilityActivation({
      score,
      registered: true,
      connected: true,
      approved: true,
      executed: true,
      executionReceiptId: 'receipt:001',
      verified: true,
      verificationEvidence: ['verification:unit', 'verification:runtime-smoke'],
    });

    expect(result.executed).toBe(true);
    expect(result.executionReceiptId).toBe('receipt:001');
    expect(result.verified).toBe(true);
    expect(result.verificationEvidence).toEqual([
      'verification:unit',
      'verification:runtime-smoke',
    ]);
    expect(result.executionAuthorized).toBe(false);
  });
});
