import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  FuryGatewayAutomationDefinitionError,
  createFuryGatewayAutomationDefinitionStore,
  isGeneratedFuryGatewayAutomationDefinitionStore,
} from '../src/gateway-automation-definition-node.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function root(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-automation-definition-'));
  tempDirs.push(dir);
  return dir;
}

function recovery(rootDir: string) {
  return createRecoveryStore(rootDir, {
    namespace: 'gateway-automations',
    maxObjectBytes: 64 * 1024,
    maxTotalBytes: 8 * 1024 * 1024,
  });
}

function definition(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    automationId: 'morning-brief',
    ownerPrincipalId: 'local-owner',
    workflowId: 'workflow.morning-brief',
    enabled: true,
    trigger: {
      kind: 'interval',
      everyMs: 60_000,
      startAt: 100_000,
      misfirePolicy: 'run-once',
    },
    requestedScopes: [
      'conversations.write',
      'automations.inspect',
      'capability.provider-inference',
    ],
    requestedPluginPermissions: ['provider-inference'],
    budgets: {
      maxWallTimeMs: 120_000,
      maxToolCalls: 10,
      maxProviderCalls: 4,
    },
    notificationPolicyKey: 'ops-notify',
    reason: 'Daily bounded brief.',
    ...overrides,
  };
}

describe('Fury Gateway durable automation definition store', () => {
  it('persists a strict definition and recovers it through a fresh store instance', async () => {
    const dir = root();
    const first = createFuryGatewayAutomationDefinitionStore({
      store: recovery(dir),
      now: () => 200_000,
    });

    const created = await first.create(definition() as never);
    expect(created.definition.revision).toBe(1);
    expect(created.definition.createdAt).toBe(200_000);
    expect(created.definition.executionAuthority).toBe(false);
    expect(created.definition.authority).toBe('automation-policy-data-only');
    expect(created.authority).toBe('observability-only');
    expect(created.definition.requestedScopes).toEqual([
      'automations.inspect',
      'capability.provider-inference',
      'conversations.write',
    ]);
    expect(created.definition.requestedPluginPermissions)
      .toEqual(['provider-inference']);
    expect(created.definitionSha256).toMatch(/^[0-9a-f]{64}$/u);

    const restarted = createFuryGatewayAutomationDefinitionStore({
      store: recovery(dir),
      now: () => 300_000,
    });
    const recovered = await restarted.inspect('morning-brief');

    expect(recovered).toEqual(created);
    expect(await restarted.countRecords()).toBe(1);
  });

  it('chains append-only revisions by exact prior durable digest', async () => {
    const dir = root();
    let now = 100;
    const store = createFuryGatewayAutomationDefinitionStore({
      store: recovery(dir),
      now: () => now,
    });

    const first = await store.create(definition({
      trigger: {
        kind: 'one-shot',
        at: 1_000,
        misfirePolicy: 'skip',
      },
    }) as never);

    now = 200;
    const second = await store.revise({
      automationId: 'morning-brief',
      expectedRevision: 1,
      enabled: false,
      reason: 'Temporarily disabled.',
    });

    expect(second.definition.revision).toBe(2);
    expect(second.definition.previousRevisionSha256)
      .toBe(first.definitionSha256);
    expect(second.definition.enabled).toBe(false);
    expect(second.definition.workflowId).toBe('workflow.morning-brief');
    expect(second.definition.createdAt).toBe(200);

    const history = await store.history('morning-brief');
    expect(history.map((entry) => entry.definition.revision)).toEqual([1, 2]);
    expect(history[1]?.definition.previousRevisionSha256)
      .toBe(history[0]?.definitionSha256);
  });

  it('rejects stale revisions and resolves a concurrent same-revision race to one winner', async () => {
    const dir = root();
    let clock = 1_000;
    const store = createFuryGatewayAutomationDefinitionStore({
      store: recovery(dir),
      now: () => ++clock,
    });
    await store.create(definition() as never);

    await expect(store.revise({
      automationId: 'morning-brief',
      expectedRevision: 99,
      enabled: false,
    })).rejects.toMatchObject({
      name: 'FuryGatewayAutomationDefinitionError',
      code: 'stale-revision',
    });

    const results = await Promise.allSettled([
      store.revise({
        automationId: 'morning-brief',
        expectedRevision: 1,
        workflowId: 'workflow.variant-a',
      }),
      store.revise({
        automationId: 'morning-brief',
        expectedRevision: 1,
        workflowId: 'workflow.variant-b',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      name: 'FuryGatewayAutomationDefinitionError',
      code: 'stale-revision',
    });

    const history = await store.history('morning-brief');
    expect(history).toHaveLength(2);
    expect(history[1]?.definition.revision).toBe(2);
  });

  it('rejects duplicate creation instead of treating durable dedupe as authority', async () => {
    const dir = root();
    const store = createFuryGatewayAutomationDefinitionStore({
      store: recovery(dir),
      now: () => 100,
    });
    await store.create(definition() as never);

    await expect(store.create(definition() as never)).rejects.toMatchObject({
      name: 'FuryGatewayAutomationDefinitionError',
      code: 'definition-conflict',
    });
  });

  it('rejects secret-like or executable fields because the schema is exact', async () => {
    const dir = root();
    const store = createFuryGatewayAutomationDefinitionStore({
      store: recovery(dir),
      now: () => 100,
    });

    await expect(store.create(definition({
      apiKey: 'must-never-persist',
    }) as never)).rejects.toBeInstanceOf(FuryGatewayAutomationDefinitionError);

    await expect(store.create(definition({
      trigger: {
        kind: 'one-shot',
        at: 1_000,
        misfirePolicy: 'skip',
        credential: 'must-never-persist',
      },
    }) as never)).rejects.toMatchObject({
      code: 'invalid-input',
    });

    await expect(store.create(definition({
      session: {
        sessionId: 'permanent-super-session',
      },
    }) as never)).rejects.toMatchObject({
      code: 'invalid-input',
    });

    expect(await store.countRecords()).toBe(0);
  });

  it('rejects control characters in reasons, including NUL, US and DEL', async () => {
    const store = createFuryGatewayAutomationDefinitionStore({
      store: recovery(root()),
      now: () => 200_000,
    });
    for (const bad of ['a\u0000b', 'tab\there', 'line\nbreak', 'unit\u001fsep', 'del\u007f']) {
      await expect(store.create(definition({ reason: bad }) as never)).rejects.toMatchObject({
        code: 'invalid-input',
      });
    }
    await expect(store.create(definition({ reason: 'Plain reason — accents é and emoji ✓.' }) as never))
      .resolves.toBeDefined();
    expect(await store.countRecords()).toBe(1);
  });

  it('validates initial trigger semantics and bounded budgets', async () => {
    const dir = root();
    const store = createFuryGatewayAutomationDefinitionStore({
      store: recovery(dir),
      now: () => 100,
    });

    for (const bad of [
      definition({
        trigger: {
          kind: 'interval',
          everyMs: 999,
          startAt: 100,
          misfirePolicy: 'run-once',
        },
      }),
      definition({
        trigger: {
          kind: 'interval',
          everyMs: 1_000,
          startAt: 200,
          endAt: 200,
          misfirePolicy: 'run-once',
        },
      }),
      definition({
        trigger: {
          kind: 'one-shot',
          at: -1,
          misfirePolicy: 'skip',
        },
      }),
      definition({
        trigger: {
          kind: 'one-shot',
          at: 1_000,
          misfirePolicy: 'run-all-missed',
        },
      }),
      definition({
        budgets: {
          maxWallTimeMs: 0,
          maxToolCalls: 1,
          maxProviderCalls: 1,
        },
      }),
    ]) {
      await expect(store.create(bad as never)).rejects.toMatchObject({
        code: 'invalid-input',
      });
    }

    expect(await store.countRecords()).toBe(0);
  });

  it('enforces revision bounds without mutating the prior valid revision', async () => {
    const dir = root();
    let now = 1;
    const store = createFuryGatewayAutomationDefinitionStore({
      store: recovery(dir),
      now: () => now++,
      maxRevisionsPerAutomation: 2,
    });
    await store.create(definition() as never);
    await store.revise({
      automationId: 'morning-brief',
      expectedRevision: 1,
      enabled: false,
    });

    await expect(store.revise({
      automationId: 'morning-brief',
      expectedRevision: 2,
      enabled: true,
    })).rejects.toMatchObject({
      code: 'limit-exceeded',
    });

    const latest = await store.inspect('morning-brief');
    expect(latest?.definition.revision).toBe(2);
    expect(latest?.definition.enabled).toBe(false);
  });

  it('detects broken durable lineage instead of silently repairing history', async () => {
    const dir = root();
    const raw = recovery(dir);
    const store = createFuryGatewayAutomationDefinitionStore({
      store: raw,
      now: () => 100,
    });
    await store.create(definition() as never);

    const corrupt = {
      format: 'furypipe-gateway-automation-definition/v1',
      automationId: 'morning-brief',
      revision: 2,
      ownerPrincipalId: 'local-owner',
      workflowId: 'workflow.morning-brief',
      enabled: true,
      trigger: {
        kind: 'one-shot',
        at: 2_000,
        misfirePolicy: 'skip',
      },
      requestedScopes: ['automations.inspect'],
      requestedPluginPermissions: [],
      budgets: {
        maxWallTimeMs: 1_000,
        maxToolCalls: 0,
        maxProviderCalls: 0,
      },
      createdAt: 200,
      previousRevisionSha256: '0'.repeat(64),
      authority: 'automation-policy-data-only',
      executionAuthority: false,
    };
    await raw.put(
      new TextEncoder().encode(JSON.stringify(corrupt)),
      {
        system: 'gateway-automation-definition',
        recordType: 'definition',
        automationId: 'morning-brief',
        revision: 2,
      },
    );

    await expect(store.inspect('morning-brief')).rejects.toMatchObject({
      name: 'FuryGatewayAutomationDefinitionError',
      code: 'definition-corrupt',
    });
  });

  it('marks only genuine generated stores as process-local store wrappers', () => {
    const dir = root();
    const generated = createFuryGatewayAutomationDefinitionStore({
      store: recovery(dir),
      now: () => 100,
    });

    expect(isGeneratedFuryGatewayAutomationDefinitionStore(generated)).toBe(true);
    expect(isGeneratedFuryGatewayAutomationDefinitionStore({ ...generated }))
      .toBe(false);
  });
});
