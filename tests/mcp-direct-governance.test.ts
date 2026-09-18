import { describe, expect, it } from 'vitest';
import {
  createMcpDirectExecutionPermit,
  createMcpDirectLifecycle,
  recordMcpDirectApproval,
  recordMcpDirectConnection,
  recordMcpDirectExecution,
  recordMcpDirectHealth,
  recordMcpDirectInventory,
  recordMcpDirectSelection,
  recordMcpDirectVerification,
} from '../src/mcp-direct-governance.js';
import { assessMcpToolRisk } from '../src/mcp-tool-risk.js';

const sha = (char: string) => char.repeat(64);

function connected() {
  return recordMcpDirectConnection(createMcpDirectLifecycle({
    sourceId: 'local-proof',
    transport: 'stdio',
    endpointFingerprint: sha('a'),
    trust: 'trusted',
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

  it('cannot select an unlisted tool', () => {
    expect(() => recordMcpDirectSelection(listed(), 'missing')).toThrow(/not present/i);
  });

  it('requires explicit policy approval before an execution permit exists', () => {
    const selected = recordMcpDirectSelection(listed(), 'echo');
    expect(() => createMcpDirectExecutionPermit(selected, sha('d'))).toThrow(/approved/i);

    const approved = recordMcpDirectApproval(selected, {
      policyDecisionIdSha256: sha('e'),
      approvalKind: 'operator',
    });
    const permit = createMcpDirectExecutionPermit(approved, sha('d'));
    expect(approved.approved).toBe(true);
    expect(approved.executed).toBe(false);
    expect(permit.toolName).toBe('echo');
    expect(permit.inputSha256).toBe(sha('d'));
  });

  it('keeps executed, succeeded and verified distinct', () => {
    const selected = recordMcpDirectSelection(listed(), 'echo');
    const approved = recordMcpDirectApproval(selected, {
      policyDecisionIdSha256: sha('f'),
      approvalKind: 'governed_policy',
    });
    const permit = createMcpDirectExecutionPermit(approved, sha('1'));

    const executed = recordMcpDirectExecution(approved, {
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
    });
    expect(verified.verified).toBe(true);
  });

  it('records a failed call as executed but not succeeded or verified', () => {
    const selected = recordMcpDirectSelection(listed(), 'echo');
    const approved = recordMcpDirectApproval(selected, {
      policyDecisionIdSha256: sha('3'),
      approvalKind: 'operator',
    });
    const permit = createMcpDirectExecutionPermit(approved, sha('4'));
    const failed = recordMcpDirectExecution(approved, {
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

  it('rejects a permit rebound to another source', () => {
    const selected = recordMcpDirectSelection(listed(), 'echo');
    const approved = recordMcpDirectApproval(selected, {
      policyDecisionIdSha256: sha('6'),
      approvalKind: 'operator',
    });
    const permit = createMcpDirectExecutionPermit(approved, sha('7'));

    expect(() => recordMcpDirectExecution(approved, {
      permit: { ...permit, sourceId: 'other-source' },
      resultSha256: sha('8'),
      isError: false,
    })).toThrow(/does not match/i);
  });
});
