import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  createFuryGatewayAutomationDefinitionStore,
} from '../src/gateway-automation-definition-node.js';
import {
  createFuryGatewayAutomationRunAdmissionCoordinator,
  isGeneratedFuryGatewayAutomationRunAdmissionCoordinator,
  isGeneratedFuryGatewayAutomationRunPermit,
} from '../src/gateway-automation-run-admission-node.js';
import {
  createFuryGatewayAutomationRunLedger,
} from '../src/gateway-automation-run-ledger-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
} from '../src/gateway-principal-node.js';
import {
  createFuryGatewaySessionCoordinator,
  type FuryGatewayScope,
} from '../src/gateway-session-node.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function root(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-automation-admission-'));
  tempDirs.push(dir);
  return dir;
}

function recovery(rootDir: string, namespace: string) {
  return createRecoveryStore(rootDir, {
    namespace,
    maxObjectBytes: 64 * 1024,
    maxTotalBytes: 16 * 1024 * 1024,
  });
}

function principalAssertion(
  principalId = 'principal:user-1',
  subject = 'user-1-local-account',
) {
  return {
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId,
    kind: 'human',
    issuer: 'local',
    subject,
    authenticationMethod: 'local-owner',
  } as const;
}

interface HarnessOptions {
  readonly enabled?: boolean;
  readonly sessionPrincipalId?: string;
  readonly sessionScopes?: readonly FuryGatewayScope[];
  readonly claimLeaseMs?: number;
  readonly permitTtlMs?: number;
  readonly requestedScopes?: readonly FuryGatewayScope[];
  readonly requestedPluginPermissions?: readonly ('provider-inference')[];
}

async function harness(options: HarnessOptions = {}) {
  const dir = root();
  let clock = 100_000;
  const ownerPrincipalId = 'principal:user-1';
  const requestedScopes = options.requestedScopes ?? [
    'automations.inspect',
    'capability.provider-inference',
  ];
  const requestedPluginPermissions =
    options.requestedPluginPermissions ?? ['provider-inference'];

  const definitions = createFuryGatewayAutomationDefinitionStore({
    store: recovery(dir, 'definitions'),
    now: () => clock,
  });
  const definition = await definitions.create({
    automationId: 'morning-brief',
    ownerPrincipalId,
    workflowId: 'workflow.morning-brief',
    enabled: options.enabled ?? true,
    trigger: {
      kind: 'one-shot',
      at: clock,
      misfirePolicy: 'run-once',
    },
    requestedScopes,
    requestedPluginPermissions,
    budgets: {
      maxWallTimeMs: 60_000,
      maxToolCalls: 8,
      maxProviderCalls: 3,
    },
  });

  const runs = createFuryGatewayAutomationRunLedger({
    store: recovery(dir, 'runs'),
    now: () => clock,
    defaultClaimLeaseMs: options.claimLeaseMs ?? 30_000,
    maxClaimLeaseMs: 5 * 60_000,
  });
  const run = await runs.registerTrigger({
    automationId: definition.definition.automationId,
    definitionRevision: definition.definition.revision,
    definitionSha256: definition.definitionSha256,
    sourceKind: 'one-shot',
    occurrenceKey: 'one-shot:' + clock,
    scheduledFor: clock,
  });
  const claim = await runs.claim(
    run.runIdSha256,
    'gateway-automation-host',
  );

  const sessionPrincipalId =
    options.sessionPrincipalId ?? ownerPrincipalId;
  const principalRegistry = createFuryGatewayPrincipalRegistry({
    now: () => clock,
    evidenceTtlMs: 5 * 60_000,
  });
  const principal = principalRegistry.recordAuthenticatedPrincipal(
    principalAssertion(
      sessionPrincipalId,
      sessionPrincipalId === ownerPrincipalId
        ? 'user-1-local-account'
        : 'user-2-local-account',
    ),
  );
  const sessions = createFuryGatewaySessionCoordinator({
    principalRegistry,
    gatewayInstanceId: 'gateway-automation-test',
    now: () => clock,
    defaultTtlMs: 60_000,
    maxTtlMs: 60_000,
    terminalRetentionMs: 30_000,
  });
  const session = sessions.issueSession({
    principal,
    role: 'operator',
    scopes: options.sessionScopes ?? [
      'automations.inspect',
      'automations.manage',
      'capability.provider-inference',
    ],
    binding: { kind: 'local-operator' },
  });

  const admission = createFuryGatewayAutomationRunAdmissionCoordinator({
    definitions,
    runs,
    now: () => clock,
    permitTtlMs: options.permitTtlMs ?? 20_000,
  });

  return {
    definitions,
    runs,
    definition,
    run,
    claim,
    principalRegistry,
    sessions,
    session,
    admission,
    get now() {
      return clock;
    },
    setNow(value: number) {
      clock = value;
    },
  };
}

describe('Fury Gateway governed automation run admission', () => {
  it('revalidates current owner/session/scopes and mints a bounded process-local permit', async () => {
    const h = await harness();
    const result = await h.admission.admit(h.claim, {
      sessionCoordinator: h.sessions,
      session: h.session,
    });

    expect(result.decision.outcome).toBe('eligible');
    expect(result.decision.reason).toBe('eligible');
    expect(result.decision.executionAuthority).toBe(false);
    expect(result.decision.gatewayReason).toBe('eligible');

    const permit = result.permit;
    expect(permit).toBeDefined();
    expect(permit?.authority).toBe('automation-run-start-permit');
    expect(permit?.executionAuthority).toBe(true);
    expect(permit?.requiredScopes).toEqual([
      'automations.inspect',
      'automations.manage',
      'capability.provider-inference',
    ]);
    expect(permit?.requiredPluginPermissions).toEqual([
      'provider-inference',
    ]);
    expect(permit?.workflowId).toBe('workflow.morning-brief');
    expect(permit?.expiresAt).toBe(h.now + 20_000);
    expect(isGeneratedFuryGatewayAutomationRunPermit(permit)).toBe(true);
  });

  it('denies copied claim evidence before policy evaluation', async () => {
    const h = await harness();
    const result = await h.admission.admit(
      { ...h.claim },
      {
        sessionCoordinator: h.sessions,
        session: h.session,
      },
    );

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.reason).toBe('invalid-claim');
    expect(result.permit).toBeUndefined();
  });

  it('denies a fresh session for a different principal than the automation owner', async () => {
    const h = await harness({
      sessionPrincipalId: 'principal:user-2',
    });
    const result = await h.admission.admit(h.claim, {
      sessionCoordinator: h.sessions,
      session: h.session,
    });

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.reason).toBe('principal-mismatch');
  });

  it('reuses Gateway command admission and denies a missing capability scope', async () => {
    const h = await harness({
      sessionScopes: [
        'automations.inspect',
        'automations.manage',
      ],
    });
    const result = await h.admission.admit(h.claim, {
      sessionCoordinator: h.sessions,
      session: h.session,
    });

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.reason).toBe('gateway-admission-denied');
    expect(result.decision.gatewayReason).toBe('missing-scope');
    expect(result.decision.executionAuthority).toBe(false);
  });

  it('denies a run when the durable trigger points at an older definition revision', async () => {
    const h = await harness();
    await h.definitions.revise({
      automationId: 'morning-brief',
      expectedRevision: 1,
      reason: 'New policy revision after scheduling.',
    });

    const result = await h.admission.admit(h.claim, {
      sessionCoordinator: h.sessions,
      session: h.session,
    });

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.reason).toBe('definition-stale');
    expect(result.permit).toBeUndefined();
  });

  it('denies a disabled definition even when the run was manually registered against it', async () => {
    const h = await harness({ enabled: false });
    const result = await h.admission.admit(h.claim, {
      sessionCoordinator: h.sessions,
      session: h.session,
    });

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.reason).toBe('definition-disabled');
  });

  it('bounds permit lifetime by the claim lease even when permit TTL is longer', async () => {
    const h = await harness({
      claimLeaseMs: 5_000,
      permitTtlMs: 30_000,
    });
    const result = await h.admission.admit(h.claim, {
      sessionCoordinator: h.sessions,
      session: h.session,
    });

    expect(result.permit?.expiresAt).toBe(h.claim.leaseExpiresAt);
  });

  it('consumes an eligible permit once and returns data-only start evidence', async () => {
    const h = await harness();
    const result = await h.admission.admit(h.claim, {
      sessionCoordinator: h.sessions,
      session: h.session,
    });
    const permit = result.permit!;

    h.setNow(h.now + 1_000);
    const started = await h.admission.consume(permit);

    expect(started.runIdSha256).toBe(h.claim.runIdSha256);
    expect(started.workflowId).toBe('workflow.morning-brief');
    expect(started.authority).toBe('admitted-run-data-only');
    expect(started.executionAuthority).toBe(false);

    await expect(h.admission.consume(permit)).rejects.toMatchObject({
      name: 'FuryGatewayAutomationRunAdmissionError',
      code: 'permit-consumed',
    });
  });

  it('rejects copied permit objects as non-authoritative', async () => {
    const h = await harness();
    const result = await h.admission.admit(h.claim, {
      sessionCoordinator: h.sessions,
      session: h.session,
    });

    expect(
      isGeneratedFuryGatewayAutomationRunPermit({ ...result.permit! }),
    ).toBe(false);
    await expect(
      h.admission.consume({ ...result.permit! }),
    ).rejects.toMatchObject({
      code: 'invalid-permit',
    });
  });

  it('revalidates session status at consumption and fails closed after revocation', async () => {
    const h = await harness();
    const result = await h.admission.admit(h.claim, {
      sessionCoordinator: h.sessions,
      session: h.session,
    });
    const permit = result.permit!;

    expect(h.sessions.revokeSession(h.session.sessionId)).toBe(true);

    await expect(h.admission.consume(permit)).rejects.toMatchObject({
      code: 'permit-stale',
    });
  });

  it('revalidates the definition at consumption and rejects revision drift', async () => {
    const h = await harness();
    const result = await h.admission.admit(h.claim, {
      sessionCoordinator: h.sessions,
      session: h.session,
    });
    const permit = result.permit!;

    await h.definitions.revise({
      automationId: 'morning-brief',
      expectedRevision: 1,
      reason: 'Changed after permit minting.',
    });

    await expect(h.admission.consume(permit)).rejects.toMatchObject({
      code: 'permit-stale',
    });
  });

  it('rejects a permit after the claim has moved from claimed to armed', async () => {
    const h = await harness();
    const result = await h.admission.admit(h.claim, {
      sessionCoordinator: h.sessions,
      session: h.session,
    });
    const permit = result.permit!;

    h.setNow(h.now + 1_000);
    await h.runs.arm(h.claim);

    await expect(h.admission.consume(permit)).rejects.toMatchObject({
      code: 'permit-stale',
    });
  });

  it('rejects a permit at its exact expiry boundary', async () => {
    const h = await harness({
      claimLeaseMs: 5_000,
      permitTtlMs: 30_000,
    });
    const result = await h.admission.admit(h.claim, {
      sessionCoordinator: h.sessions,
      session: h.session,
    });
    const permit = result.permit!;

    h.setNow(permit.expiresAt);
    await expect(h.admission.consume(permit)).rejects.toMatchObject({
      code: 'permit-expired',
    });
  });

  it('rejects copied session leases as invalid authority inputs', async () => {
    const h = await harness();

    await expect(h.admission.admit(h.claim, {
      sessionCoordinator: h.sessions,
      session: { ...h.session },
    })).rejects.toMatchObject({
      name: 'FuryGatewayAutomationRunAdmissionError',
      code: 'invalid-authority',
    });
  });

  it('invalidates an already minted permit when the owner principal is revoked', async () => {
    const h = await harness();
    const result = await h.admission.admit(h.claim, {
      sessionCoordinator: h.sessions,
      session: h.session,
    });
    const permit = result.permit!;

    expect(
      h.principalRegistry.revokePrincipal(h.session.principalId),
    ).toBe(true);

    await expect(h.admission.consume(permit)).rejects.toMatchObject({
      code: 'permit-stale',
    });
  });

  it('marks only the generated coordinator as process-local admission authority', async () => {
    const h = await harness();

    expect(
      isGeneratedFuryGatewayAutomationRunAdmissionCoordinator(h.admission),
    ).toBe(true);
    expect(
      isGeneratedFuryGatewayAutomationRunAdmissionCoordinator({
        ...h.admission,
      }),
    ).toBe(false);
  });
});
