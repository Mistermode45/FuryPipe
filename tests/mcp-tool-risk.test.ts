import { describe, expect, it } from 'vitest';
import { assessMcpToolRisk } from '../src/mcp-tool-risk.js';

describe('MCP 2026 tool risk policy', () => {
  it('applies the conservative MCP defaults when annotations are absent', () => {
    expect(assessMcpToolRisk(undefined, 'trusted')).toEqual({
      format: 'furypipe-mcp-tool-risk/v1',
      trust: 'trusted',
      resolvedHints: {
        readOnly: false,
        destructive: true,
        idempotent: false,
        openWorld: true,
      },
      riskClass: 'trusted_mutating_destructive',
      closedWorldReadCandidate: false,
      replayHint: 'unsafe_or_unknown',
      authorizationGranted: false,
      requiresPolicyGate: true,
    });
  });

  it('never grants authority from annotations supplied by an untrusted server', () => {
    const result = assessMcpToolRisk({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    }, 'untrusted');

    expect(result.riskClass).toBe('untrusted_unknown');
    expect(result.closedWorldReadCandidate).toBe(false);
    expect(result.replayHint).toBe('unsafe_or_unknown');
    expect(result.authorizationGranted).toBe(false);
  });

  it('admits a trusted closed-world read only as a later-policy candidate', () => {
    const result = assessMcpToolRisk({
      readOnlyHint: true,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    }, 'trusted');

    expect(result.riskClass).toBe('trusted_read_only_closed_world');
    expect(result.resolvedHints).toEqual({
      readOnly: true,
      destructive: 'not_applicable',
      idempotent: 'not_applicable',
      openWorld: false,
    });
    expect(result.closedWorldReadCandidate).toBe(true);
    expect(result.replayHint).toBe('trusted_read_only');
    expect(result.authorizationGranted).toBe(false);
    expect(result.requiresPolicyGate).toBe(true);
  });

  it('does not mark a trusted open-world read as the safest automatic candidate', () => {
    const result = assessMcpToolRisk({
      readOnlyHint: true,
      openWorldHint: true,
    }, 'trusted');

    expect(result.riskClass).toBe('trusted_read_only_open_world');
    expect(result.closedWorldReadCandidate).toBe(false);
    expect(result.authorizationGranted).toBe(false);
  });

  it('distinguishes additive and destructive trusted mutations', () => {
    const additive = assessMcpToolRisk({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    }, 'trusted');
    const destructive = assessMcpToolRisk({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    }, 'trusted');

    expect(additive.riskClass).toBe('trusted_mutating_additive');
    expect(additive.replayHint).toBe('trusted_idempotent_mutation');
    expect(additive.authorizationGranted).toBe(false);

    expect(destructive.riskClass).toBe('trusted_mutating_destructive');
    expect(destructive.replayHint).toBe('trusted_idempotent_mutation');
    expect(destructive.authorizationGranted).toBe(false);
  });
});
