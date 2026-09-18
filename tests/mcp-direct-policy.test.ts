import { describe, expect, it } from 'vitest';

import {
  createMcpDirectCatalogHandle,
  type McpDirectCatalogHandle,
} from '../src/mcp-direct-catalog.js';
import { digestMcpDirectJson } from '../src/mcp-direct-json.js';
import {
  createMcpDirectExecutionPermit,
  createMcpDirectLifecycle,
  recordMcpDirectConnection,
  recordMcpDirectInventory,
  recordMcpDirectSelection,
  type McpDirectLifecycleState,
} from '../src/mcp-direct-governance.js';
import {
  approveMcpDirectPolicyDecision,
  createMcpDirectOperatorApprovalIntent,
  createMcpDirectToolProposal,
  evaluateMcpDirectPolicy,
  isGeneratedMcpDirectPolicyDecision,
  isGeneratedMcpDirectToolProposal,
  resolveMcpDirectProposalArguments,
  type McpDirectPolicy,
} from '../src/mcp-direct-policy.js';
import { assessMcpToolRisk } from '../src/mcp-tool-risk.js';

const sha = (char: string) => char.repeat(64);
const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 1 },
  },
  required: ['query'],
  additionalProperties: false,
} as const;

function setup(options: {
  readonly trust?: 'trusted' | 'untrusted';
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint?: boolean;
  };
} = {}): { lifecycle: McpDirectLifecycleState; catalog: McpDirectCatalogHandle } {
  const trust = options.trust ?? 'trusted';
  const source = {
    sourceId: 'mcp-source',
    transport: 'stdio' as const,
    endpointFingerprint: sha('a'),
    trust,
  };
  const inputSchemaSha256 = digestMcpDirectJson(INPUT_SCHEMA);
  const catalog = createMcpDirectCatalogHandle(source, [{
    name: 'search',
    inputSchema: INPUT_SCHEMA,
    inputSchemaSha256,
  }]);
  const lifecycle = recordMcpDirectSelection(
    recordMcpDirectInventory(
      recordMcpDirectConnection(createMcpDirectLifecycle(source), {
        protocolEra: 'modern_2026',
        handshake: 'discover',
      }),
      [{
        name: 'search',
        inputSchemaSha256,
        risk: assessMcpToolRisk(
          options.annotations ?? { readOnlyHint: true, openWorldHint: false },
          trust,
        ),
      }],
    ),
    'search',
  );
  return { lifecycle, catalog };
}

function policy(options: {
  readonly auto?: boolean;
  readonly operator?: boolean;
} = {}): McpDirectPolicy {
  return {
    format: 'furypipe-mcp-direct-policy/v1',
    policyId: 'policy-main',
    governedPolicyAllowlist: options.auto === false
      ? []
      : [{ sourceId: 'mcp-source', endpointFingerprint: sha('a'), toolName: 'search' }],
    operatorApprovalAllowlist: options.operator === false
      ? []
      : [{ sourceId: 'mcp-source', endpointFingerprint: sha('a'), toolName: 'search' }],
  };
}

describe('direct MCP proposal, policy and approval governance', () => {
  it('keeps selected, arguments_validated, policy_evaluated and approved distinct', async () => {
    const { lifecycle, catalog } = setup();
    expect(lifecycle.selected).toBe(true);
    expect(lifecycle.approved).toBe(false);

    const proposal = await createMcpDirectToolProposal(lifecycle, catalog, { query: 'alpha' });
    expect(isGeneratedMcpDirectToolProposal(proposal)).toBe(true);
    expect(proposal.argumentsValidated).toBe(true);
    expect(proposal.inputSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(lifecycle.approved).toBe(false);

    const decision = evaluateMcpDirectPolicy(lifecycle, proposal, policy());
    expect(isGeneratedMcpDirectPolicyDecision(decision)).toBe(true);
    expect(decision.policyEvaluated).toBe(true);
    expect(decision.policySha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(decision.outcome).toBe('allow_governed_policy');
    expect(lifecycle.approved).toBe(false);

    const approved = approveMcpDirectPolicyDecision(
      lifecycle,
      proposal,
      decision,
      'governed_policy',
    );
    expect(approved.approved).toBe(true);
    expect(approved.approval).toMatchObject({
      approvalKind: 'governed_policy',
      approvedAt: expect.any(Number),
      expiresAt: expect.any(Number),
    });
    expect((approved.approval?.expiresAt ?? 0) - (approved.approval?.approvedAt ?? 0)).toBe(30_000);
    expect(approved.executed).toBe(false);
    expect(approved.succeeded).toBe(false);
    expect(approved.verified).toBe(false);
  });

  it('rejects arguments that fail the exact listed input schema', async () => {
    const { lifecycle, catalog } = setup();
    await expect(createMcpDirectToolProposal(
      lifecycle,
      catalog,
      { query: 42 },
    )).rejects.toThrow(/failed input schema validation/i);
  });

  it('normalizes omitted no-arg input to an exact empty object and rejects array arguments', async () => {
    const source = {
      sourceId: 'mcp-source',
      transport: 'stdio' as const,
      endpointFingerprint: sha('a'),
      trust: 'trusted' as const,
    };
    const noArgSchema = {
      type: 'object',
      additionalProperties: false,
    } as const;
    const inputSchemaSha256 = digestMcpDirectJson(noArgSchema);
    const catalog = createMcpDirectCatalogHandle(source, [{
      name: 'search',
      inputSchema: noArgSchema,
      inputSchemaSha256,
    }]);
    const lifecycle = recordMcpDirectSelection(
      recordMcpDirectInventory(
        recordMcpDirectConnection(createMcpDirectLifecycle(source), {
          protocolEra: 'modern_2026',
          handshake: 'discover',
        }),
        [{
          name: 'search',
          inputSchemaSha256,
          risk: assessMcpToolRisk({ readOnlyHint: true, openWorldHint: false }, 'trusted'),
        }],
      ),
      'search',
    );

    const proposal = await createMcpDirectToolProposal(lifecycle, catalog, undefined);
    expect(resolveMcpDirectProposalArguments(proposal)).toEqual({});
    await expect(createMcpDirectToolProposal(
      lifecycle,
      catalog,
      [],
    )).rejects.toThrow(/plain object/i);
  });

  it('isolates identical JSON Schema $id values across different tool catalogs', async () => {
    const make = (schema: Readonly<Record<string, unknown>>) => {
      const source = {
        sourceId: 'mcp-source',
        transport: 'stdio' as const,
        endpointFingerprint: sha('a'),
        trust: 'trusted' as const,
      };
      const inputSchemaSha256 = digestMcpDirectJson(schema);
      const catalog = createMcpDirectCatalogHandle(source, [{
        name: 'search',
        inputSchema: schema,
        inputSchemaSha256,
      }]);
      const lifecycle = recordMcpDirectSelection(
        recordMcpDirectInventory(
          recordMcpDirectConnection(createMcpDirectLifecycle(source), {
            protocolEra: 'modern_2026',
            handshake: 'discover',
          }),
          [{
            name: 'search',
            inputSchemaSha256,
            risk: assessMcpToolRisk({ readOnlyHint: true, openWorldHint: false }, 'trusted'),
          }],
        ),
        'search',
      );
      return { lifecycle, catalog };
    };

    const sharedId = 'urn:furypipe:test:shared-schema-id';
    const stringSchema = {
      $id: sharedId,
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    } as const;
    const integerSchema = {
      $id: sharedId,
      type: 'object',
      properties: { query: { type: 'integer' } },
      required: ['query'],
      additionalProperties: false,
    } as const;

    const first = make(stringSchema);
    await expect(createMcpDirectToolProposal(
      first.lifecycle,
      first.catalog,
      { query: 'alpha' },
    )).resolves.toMatchObject({ argumentsValidated: true });

    const second = make(integerSchema);
    await expect(createMcpDirectToolProposal(
      second.lifecycle,
      second.catalog,
      { query: 'alpha' },
    )).rejects.toThrow(/failed input schema validation/i);
    await expect(createMcpDirectToolProposal(
      second.lifecycle,
      second.catalog,
      { query: 42 },
    )).resolves.toMatchObject({ argumentsValidated: true });
  });

  it('rejects copied catalog handles before argument validation', async () => {
    const { lifecycle, catalog } = setup();
    const copied = { ...catalog } as McpDirectCatalogHandle;
    await expect(createMcpDirectToolProposal(
      lifecycle,
      copied,
      { query: 'alpha' },
    )).rejects.toThrow(/process-local/i);
  });

  it('keeps plaintext arguments out of proposal and policy evidence', async () => {
    const { lifecycle, catalog } = setup();
    const canary = 'MCP_ARGUMENT_SECRET_CANARY_91CA';
    const proposal = await createMcpDirectToolProposal(
      lifecycle,
      catalog,
      { query: canary },
    );
    const decision = evaluateMcpDirectPolicy(lifecycle, proposal, policy());
    const evidence = JSON.stringify({ proposal, decision });
    expect(evidence).not.toContain(canary);
    expect(evidence).not.toContain('"query"');
    expect(resolveMcpDirectProposalArguments(proposal)).toEqual({ query: canary });
  });

  it('auto-approves only an exact allowlisted trusted closed-world read', async () => {
    const { lifecycle, catalog } = setup({
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    const proposal = await createMcpDirectToolProposal(lifecycle, catalog, { query: 'alpha' });
    const decision = evaluateMcpDirectPolicy(lifecycle, proposal, policy());
    expect(decision).toMatchObject({
      outcome: 'allow_governed_policy',
      reason: 'trusted_closed_world_exact_allowlist',
      riskClass: 'trusted_read_only_closed_world',
    });
  });

  it('never turns untrusted annotations into governed-policy approval', async () => {
    const { lifecycle, catalog } = setup({
      trust: 'untrusted',
      annotations: { readOnlyHint: true, openWorldHint: false },
    });
    const proposal = await createMcpDirectToolProposal(lifecycle, catalog, { query: 'alpha' });
    const decision = evaluateMcpDirectPolicy(lifecycle, proposal, policy());
    expect(decision.riskClass).toBe('untrusted_unknown');
    expect(decision.outcome).toBe('require_operator');
    expect(() => approveMcpDirectPolicyDecision(
      lifecycle,
      proposal,
      decision,
      'governed_policy',
    )).toThrow(/not authorized/i);
  });

  it('requires operator approval for an allowlisted open-world read', async () => {
    const { lifecycle, catalog } = setup({
      annotations: { readOnlyHint: true, openWorldHint: true },
    });
    const proposal = await createMcpDirectToolProposal(lifecycle, catalog, { query: 'alpha' });
    const decision = evaluateMcpDirectPolicy(lifecycle, proposal, policy());
    expect(decision.riskClass).toBe('trusted_read_only_open_world');
    expect(decision.outcome).toBe('require_operator');
    const intent = createMcpDirectOperatorApprovalIntent(
      proposal,
      decision,
      { now: 10_000 },
    );
    const approved = approveMcpDirectPolicyDecision(
      lifecycle,
      proposal,
      decision,
      intent,
      10_001,
    );
    expect(approved.approval).toMatchObject({
      inputSha256: proposal.inputSha256,
      policyDecisionIdSha256: decision.policyDecisionIdSha256,
      approvalKind: 'operator',
      approvedAt: 10_001,
      expiresAt: 40_000,
    });
  });

  it('requires operator approval for mutating tools even when present in the governed allowlist', async () => {
    const { lifecycle, catalog } = setup({
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    const proposal = await createMcpDirectToolProposal(lifecycle, catalog, { query: 'alpha' });
    const decision = evaluateMcpDirectPolicy(lifecycle, proposal, policy());
    expect(decision.riskClass).toBe('trusted_mutating_additive');
    expect(decision.outcome).toBe('require_operator');
  });

  it('denies a proposal absent from both exact policy allowlists', async () => {
    const { lifecycle, catalog } = setup();
    const proposal = await createMcpDirectToolProposal(lifecycle, catalog, { query: 'alpha' });
    const decision = evaluateMcpDirectPolicy(
      lifecycle,
      proposal,
      policy({ auto: false, operator: false }),
    );
    expect(decision.outcome).toBe('deny');
    expect(() => createMcpDirectOperatorApprovalIntent(
      proposal,
      decision,
      { now: 10_000 },
    )).toThrow(/denied/i);
  });

  it('rejects copied proposal and decision objects as authority', async () => {
    const { lifecycle, catalog } = setup();
    const proposal = await createMcpDirectToolProposal(lifecycle, catalog, { query: 'alpha' });
    const copiedProposal = { ...proposal };
    expect(isGeneratedMcpDirectToolProposal(copiedProposal)).toBe(false);
    expect(() => evaluateMcpDirectPolicy(
      lifecycle,
      copiedProposal,
      policy(),
    )).toThrow(/process-local/i);

    const decision = evaluateMcpDirectPolicy(lifecycle, proposal, policy());
    const copiedDecision = { ...decision };
    expect(isGeneratedMcpDirectPolicyDecision(copiedDecision)).toBe(false);
    expect(() => approveMcpDirectPolicyDecision(
      lifecycle,
      proposal,
      copiedDecision,
      'governed_policy',
    )).toThrow(/process-local/i);
  });

  it('binds the eventual execution permit to the approved input digest', async () => {
    const { lifecycle, catalog } = setup();
    const proposal = await createMcpDirectToolProposal(lifecycle, catalog, { query: 'alpha' });
    const decision = evaluateMcpDirectPolicy(lifecycle, proposal, policy());
    const approved = approveMcpDirectPolicyDecision(
      lifecycle,
      proposal,
      decision,
      'governed_policy',
      1_000,
    );

    expect(() => createMcpDirectExecutionPermit(
      approved,
      digestMcpDirectJson({ query: 'substituted' }),
      { now: 1_001 },
    )).toThrow(/approved input digest/i);

    const permit = createMcpDirectExecutionPermit(
      approved,
      proposal.inputSha256,
      { now: 1_001 },
    );
    expect(permit.inputSha256).toBe(proposal.inputSha256);
  });

  it('rejects unknown policy fields and duplicate allowlist pairs', async () => {
    const { lifecycle, catalog } = setup();
    const proposal = await createMcpDirectToolProposal(lifecycle, catalog, { query: 'alpha' });

    expect(() => evaluateMcpDirectPolicy(lifecycle, proposal, {
      ...policy(),
      surprise: true,
    } as McpDirectPolicy)).toThrow(/unsupported fields/i);

    expect(() => evaluateMcpDirectPolicy(lifecycle, proposal, {
      ...policy(),
      governedPolicyAllowlist: [
        { sourceId: 'mcp-source', endpointFingerprint: sha('a'), toolName: 'search' },
        { sourceId: 'mcp-source', endpointFingerprint: sha('a'), toolName: 'search' },
      ],
    })).toThrow(/duplicate/i);
  });

  it('derives the same policy digest from semantically identical allowlists in different order', async () => {
    const { lifecycle, catalog } = setup();
    const proposal = await createMcpDirectToolProposal(lifecycle, catalog, { query: 'alpha' });

    const first = policy();
    const second: McpDirectPolicy = {
      ...first,
      governedPolicyAllowlist: [
        { sourceId: 'zzz', endpointFingerprint: sha('b'), toolName: 'other' },
        ...first.governedPolicyAllowlist,
      ],
      operatorApprovalAllowlist: [
        { sourceId: 'zzz', endpointFingerprint: sha('b'), toolName: 'other' },
        ...first.operatorApprovalAllowlist,
      ],
    };
    const third: McpDirectPolicy = {
      ...second,
      governedPolicyAllowlist: [...second.governedPolicyAllowlist].reverse(),
      operatorApprovalAllowlist: [...second.operatorApprovalAllowlist].reverse(),
    };

    const decisionTwo = evaluateMcpDirectPolicy(lifecycle, proposal, second);
    const decisionThree = evaluateMcpDirectPolicy(lifecycle, proposal, third);
    expect(decisionTwo.policySha256).toBe(decisionThree.policySha256);
    expect(decisionTwo.policyDecisionIdSha256).toBe(decisionThree.policyDecisionIdSha256);
  });

  it('does not let a reused sourceId authorize a different endpoint fingerprint', async () => {
    const { lifecycle, catalog } = setup();
    const proposal = await createMcpDirectToolProposal(lifecycle, catalog, { query: 'alpha' });
    const mismatched = {
      ...policy(),
      governedPolicyAllowlist: [{
        sourceId: 'mcp-source',
        endpointFingerprint: sha('f'),
        toolName: 'search',
      }],
      operatorApprovalAllowlist: [],
    };
    const decision = evaluateMcpDirectPolicy(lifecycle, proposal, mismatched);
    expect(decision.outcome).toBe('deny');
  });

  it('requires a fresh one-time process-local operator intent', async () => {
    const { lifecycle, catalog } = setup({
      annotations: { readOnlyHint: true, openWorldHint: true },
    });
    const proposal = await createMcpDirectToolProposal(lifecycle, catalog, { query: 'alpha' });
    const decision = evaluateMcpDirectPolicy(lifecycle, proposal, policy());

    expect(() => approveMcpDirectPolicyDecision(
      lifecycle,
      proposal,
      decision,
      'governed_policy',
      20_001,
    )).toThrow(/not authorized/i);

    const expired = createMcpDirectOperatorApprovalIntent(
      proposal,
      decision,
      { now: 20_000, expiresInMs: 10 },
    );
    expect(() => approveMcpDirectPolicyDecision(
      lifecycle,
      proposal,
      decision,
      expired,
      20_010,
    )).toThrow(/expired/i);

    const fresh = createMcpDirectOperatorApprovalIntent(
      proposal,
      decision,
      { now: 30_000, expiresInMs: 1_000 },
    );
    const approved = approveMcpDirectPolicyDecision(
      lifecycle,
      proposal,
      decision,
      fresh,
      30_001,
    );
    expect(approved.approval?.approvalKind).toBe('operator');
    expect(() => approveMcpDirectPolicyDecision(
      lifecycle,
      proposal,
      decision,
      fresh,
      30_002,
    )).toThrow(/already consumed/i);

    const copied = { ...createMcpDirectOperatorApprovalIntent(
      proposal,
      decision,
      { now: 40_000 },
    ) };
    expect(() => approveMcpDirectPolicyDecision(
      lifecycle,
      proposal,
      decision,
      copied,
      40_001,
    )).toThrow(/process-local explicit intent/i);
  });

  it('operator approval is impossible unless the exact source/endpoint/tool tuple is operator-allowlisted', async () => {
    const { lifecycle, catalog } = setup({
      annotations: { readOnlyHint: true, openWorldHint: true },
    });
    const proposal = await createMcpDirectToolProposal(lifecycle, catalog, { query: 'alpha' });
    const decision = evaluateMcpDirectPolicy(
      lifecycle,
      proposal,
      policy({ auto: false, operator: false }),
    );
    expect(decision.outcome).toBe('deny');
    expect(() => createMcpDirectOperatorApprovalIntent(
      proposal,
      decision,
      { now: 10_000 },
    )).toThrow(/denied/i);
  });
});
