import { describe, expect, it } from 'vitest';
import {
  FURY_COMPACT_HUMAN_INSTRUCTION,
  resolveFuryHumanOutputPolicy,
} from '../src/human-output-policy.js';

describe('Fury human output policy', () => {
  it('defaults to compact human prose without becoming a response rewriter', () => {
    const result = resolveFuryHumanOutputPolicy({ objective: 'Explain the architecture.' });
    expect(result).toMatchObject({ mode: 'compact-human', reason: 'default_compact_human' });
    expect(result.instruction).toBe(FURY_COMPACT_HUMAN_INSTRUCTION);
    expect(result.instruction).toContain('Never apply terse prose to code');
    expect(result.instruction).toContain('exact-response');
  });

  it.each([
    'Respond exactly OK',
    'Réponds exactement : FURYPIPE_OK',
    'Return strictly the string PASS',
    'Sortie exacte demandée',
  ])('yields completely to exact output contracts: %s', (objective) => {
    expect(resolveFuryHumanOutputPolicy({ objective })).toEqual({
      mode: 'normal-clarity',
      reason: 'exact_output_contract',
    });
  });

  it('yields to structured output contracts', () => {
    expect(resolveFuryHumanOutputPolicy({ structuredOutput: true })).toEqual({
      mode: 'normal-clarity',
      reason: 'structured_output_contract',
    });
  });

  it.each([
    'Deploy to production now',
    'Delete the database permanently',
    'Signer un contrat',
    'Rembourser le client',
  ])('uses explicit prose for high-impact confirmation contexts: %s', (objective) => {
    expect(resolveFuryHumanOutputPolicy({ objective })).toEqual({
      mode: 'normal-clarity',
      reason: 'high_impact_clarity',
    });
  });

  it('supports a host kill switch', () => {
    expect(resolveFuryHumanOutputPolicy({ enabled: false })).toEqual({
      mode: 'disabled',
      reason: 'disabled_by_host',
    });
  });
});
