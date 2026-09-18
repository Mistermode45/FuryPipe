import { describe, expect, it } from 'vitest';
import {
  consumeMcpDirectExecutionPermit,
  createMcpDirectExecutionPermit,
  createMcpDirectLifecycle,
  isGeneratedMcpDirectExecutionPermit,
  isGeneratedMcpDirectLifecycleState,
  recordMcpDirectApproval,
  recordMcpDirectConnection,
  recordMcpDirectExecution,
  recordMcpDirectHealth,
  recordMcpDirectInventory,
  recordMcpDirectSelection,
  recordMcpDirectVerification,
  type McpDirectLifecycleState,
} from '../src/mcp-direct-governance.js';
import { assessMcpToolRisk } from '../src/mcp-tool-risk.js';

const sha = (char: string) => char.repeat(64);

function connected(trust: 'trusted' | 'untrusted' = 'trusted') {
  return recordMcpDirectConnection(createMcpDirectLifecycle({
    sourceId: 'local-proof',
    transport: 'stdio',
    endpointFingerprint: sha('a'),
    trust,
  }), {
    protocolEra: 'modern_2026',
    handshake: 'discover',
  });
}

function listed() {
  return recordMcpDirectInventory(connected(), [{
    name: 'echo',
    inputSchemaSha256: sha('b'),
    risk: assessMcpToolRisk({
      readOnlyHint: true,
      openWorldHint: false,
    }, 'trusted'),
  }]);
}

function approved(inputChar = 'd') {
  return recordMcpDirectApproval(recordMcpDirectSelection(listed(), 'echo'), {
    policyDecisionIdSha256: sha('e'),
    inputSha256: sha(inputChar),
    approvalKind: 'operator',
    approvedAt: 0,
    expiresAt: 60_000,
  });
}

describe('direct MCP governance lifecycle', () => {
  it('keeps configured, connected, healthy, listed and trusted distinct', () => {
    const configured = createMcpDirectLifecycle({
      sourceId: 'remote',
      transport: 'streamable_http',
      endpointFingerprint: sha('c'),
      trust: 'untrusted',
    });
    expect(configured).toMatchObject({
      configured: true,
      connected: false,
      healthy: false,
      listed: false,
      trusted: false,
      selected: false,
      approved: false,
      executed: false,
      succeeded: false,
      verified: false,
    });

    const connection = recordMcpDirectConnection(configured, {
      protocolEra: 'modern_2026',
      handshake: 'discover',
    });
    expect(connection.connected).toBe(true);
    expect(connection.healthy).toBe(false);
    expect(connection.listed).toBe(false);
    expect(connection.trusted).toBe(false);
  });

  it('rejects forged lifecycle state objects', () => {
    const forged = { ...connected() } as McpDirectLifecycleState;
    expect(isGeneratedMcpDirectLifecycleState(forged)).toBe(false);
    expect(() => recordMcpDirectHealth(forged, 'list_tools_success')).toThrow(/process-local/i);
  });

  it('rejects legacy ping as modern MCP 2026 health evidence', () => {
    expect(() => recordMcpDirectHealth(connected(), 'legacy_ping_success')).toThrow(/legacy ping/i);
  });

  it('uses successful tools/list as health evidence without granting approval', () => {
    const state = listed();
    expect(state.healthy).toBe(true);
    expect(state.healthEvidence).toBe('list_tools_success');
    expect(state.listed).toBe(true);
    expect(state.selected).toBe(false);
    expect(state.approved).toBe(false);
    expect(state.executed).toBe(false);
  });

  it('rejects risk evidence whose trust is not bound to the source', () => {
    expect(() => recordMcpDirectInventory(connected('untrusted'), [{
      name: 'echo',
      inputSchemaSha256: sha('b'),
      risk: assessMcpToolRisk({ readOnlyHint: true, openWorldHint: false }, 'trusted'),
    }])).toThrow(/source-bound/i);
  });

  it('cannot select an unlisted tool', () => {
    expect(() => recordMcpDirectSelection(listed(), 'missing')).toThrow(/not present/i);
  });

  it('requires explicit policy approval before an execution permit exists', () => {
    const selected = recordMcpDirectSelection(listed(), 'echo');
    expect(() => createMcpDirectExecutionPermit(selected, sha('d'), { now: 1_000 })).toThrow(/approved/i);

    const state = recordMcpDirectApproval(selected, {
      policyDecisionIdSha256: sha('e'),
      inputSha256: sha('d'),
      approvalKind: 'operator',
      approvedAt: 0,
      expiresAt: 60_000,
    });
    const permit = createMcpDirectExecutionPermit(state, sha('d'), { now: 1_000 });
    expect(isGeneratedMcpDirectExecutionPermit(permit)).toBe(true);
    expect(permit).toMatchObject({
      format: 'furypipe-mcp-execution-permit/v1',
      sourceId: 'local-proof',
      endpointFingerprint: sha('a'),
      toolName: 'echo',
      inputSchemaSha256: sha('b'),
      inputSha256: sha('d'),
      policyDecisionIdSha256: sha('e'),
      approvalKind: 'operator',
      issuedAt: 1_000,
      expiresAt: 31_000,
    });
  });

  it('cannot mint a fresh permit from stale approval evidence', () => {
    const selected = recordMcpDirectSelection(listed(), 'echo');
    const state = recordMcpDirectApproval(selected, {
      policyDecisionIdSha256: sha('e'),
      inputSha256: sha('d'),
      approvalKind: 'operator',
      approvedAt: 1_000,
      expiresAt: 2_000,
    });
    expect(() => createMcpDirectExecutionPermit(
      state,
      sha('d'),
      { now: 2_000 },
    )).toThrow(/approval is expired/i);
  });

  it('caps permit expiry at the approval freshness boundary', () => {
    const selected = recordMcpDirectSelection(listed(), 'echo');
    const state = recordMcpDirectApproval(selected, {
      policyDecisionIdSha256: sha('e'),
      inputSha256: sha('d'),
      approvalKind: 'operator',
      approvedAt: 1_000,
      expiresAt: 1_500,
    });
    const permit = createMcpDirectExecutionPermit(
      state,
      sha('d'),
      { now: 1_400, expiresInMs: 30_000 },
    );
    expect(permit.expiresAt).toBe(1_500);
  });

  it('rejects copied or forged permits', () => {
    const state = approved();
    const permit = createMcpDirectExecutionPermit(state, sha('d'), { now: 1_000 });
    const copy = { ...permit };
    expect(isGeneratedMcpDirectExecutionPermit(copy)).toBe(false);
    expect(() => consumeMcpDirectExecutionPermit(state, copy, sha('d'), 1_001)).toThrow(/process-local/i);
  });

  it('binds approval to the exact input digest before a permit can exist', () => {
    const state = approved();
    expect(() => createMcpDirectExecutionPermit(state, sha('9'), { now: 1_000 }))
      .toThrow(/approved input digest/i);
  });

  it('binds a permit to endpoint, tool schema, input and policy evidence', () => {
    const state = approved();
    const permit = createMcpDirectExecutionPermit(state, sha('d'), { now: 1_000 });

    expect(() => consumeMcpDirectExecutionPermit(state, permit, sha('9'), 1_001)).toThrow(/does not match/i);
    expect(() => consumeMcpDirectExecutionPermit(state, permit, sha('d'), 31_000)).toThrow(/expired/i);
  });

  it('consumes permits exactly once before any execution receipt', () => {
    const state = approved();
    const permit = createMcpDirectExecutionPermit(state, sha('d'), { now: 1_000 });

    expect(() => recordMcpDirectExecution(state, {
      permit,
      resultSha256: sha('2'),
      isError: false,
    })).toThrow(/consumed before/i);

    consumeMcpDirectExecutionPermit(state, permit, sha('d'), 1_001);
    expect(() => consumeMcpDirectExecutionPermit(state, permit, sha('d'), 1_002)).toThrow(/already consumed/i);

    const executed = recordMcpDirectExecution(state, {
      permit,
      resultSha256: sha('2'),
      isError: false,
    });
    expect(executed.executed).toBe(true);
    expect(executed.succeeded).toBe(true);
    expect(executed.verified).toBe(false);
    expect(() => recordMcpDirectExecution(state, {
      permit,
      resultSha256: sha('2'),
      isError: false,
    })).toThrow(/already has an execution record/i);
  });

  it('keeps executed, succeeded and verified distinct', () => {
    const state = approved('1');
    const permit = createMcpDirectExecutionPermit(state, sha('1'), { now: 2_000 });
    consumeMcpDirectExecutionPermit(state, permit, sha('1'), 2_001);

    const executed = recordMcpDirectExecution(state, {
      permit,
      resultSha256: sha('2'),
      isError: false,
    });
    expect(executed.executed).toBe(true);
    expect(executed.succeeded).toBe(true);
    expect(executed.verified).toBe(false);

    const verified = recordMcpDirectVerification(executed, {
      resultSha256: sha('2'),
      verificationKind: 'schema',
      schemaSha256: sha('9'),
    });
    expect(verified.verified).toBe(true);
  });

  it('refuses to claim schema verification without the exact schema digest', () => {
    const state = approved('a');
    const permit = createMcpDirectExecutionPermit(state, sha('a'), { now: 3_500 });
    consumeMcpDirectExecutionPermit(state, permit, sha('a'), 3_501);
    const executed = recordMcpDirectExecution(state, {
      permit,
      resultSha256: sha('b'),
      isError: false,
    });

    expect(() => recordMcpDirectVerification(executed, {
      resultSha256: sha('b'),
      verificationKind: 'schema',
    })).toThrow(/schema SHA-256/i);
  });

  it('records a failed call as executed but not succeeded or verified', () => {
    const state = approved('4');
    const permit = createMcpDirectExecutionPermit(state, sha('4'), { now: 3_000 });
    consumeMcpDirectExecutionPermit(state, permit, sha('4'), 3_001);
    const failed = recordMcpDirectExecution(state, {
      permit,
      resultSha256: sha('5'),
      isError: true,
    });

    expect(failed.executed).toBe(true);
    expect(failed.succeeded).toBe(false);
    expect(failed.verified).toBe(false);
    expect(() => recordMcpDirectVerification(failed, {
      resultSha256: sha('5'),
      verificationKind: 'operator',
    })).toThrow(/successfully/i);
  });

  it('requires execution result evidence to match verification evidence exactly', () => {
    const state = approved('6');
    const permit = createMcpDirectExecutionPermit(state, sha('6'), { now: 4_000 });
    consumeMcpDirectExecutionPermit(state, permit, sha('6'), 4_001);
    const executed = recordMcpDirectExecution(state, {
      permit,
      resultSha256: sha('7'),
      isError: false,
    });

    expect(() => recordMcpDirectVerification(executed, {
      resultSha256: sha('8'),
      verificationKind: 'schema',
      schemaSha256: sha('9'),
    })).toThrow(/does not match/i);
  });
});
