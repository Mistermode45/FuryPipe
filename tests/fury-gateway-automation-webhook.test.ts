import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  createFuryGatewayAutomationDefinitionStore,
} from '../src/gateway-automation-definition-node.js';
import {
  createFuryGatewayAutomationRunLedger,
} from '../src/gateway-automation-run-ledger-node.js';
import {
  FURY_GATEWAY_AUTOMATION_WEBHOOK_EVENT_FORMAT,
  FURY_GATEWAY_AUTOMATION_WEBHOOK_SOURCE_FORMAT,
  createFuryGatewayAutomationWebhookCoordinator,
  isGeneratedFuryGatewayAutomationWebhookCoordinator,
  signFuryGatewayAutomationWebhookRequest,
} from '../src/gateway-automation-webhook-node.js';
import {
  createFuryGatewayAutomationScheduler,
} from '../src/gateway-automation-scheduler-node.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function root(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-automation-webhook-'));
  tempDirs.push(dir);
  return dir;
}

function recovery(rootDir: string, namespace: string) {
  return createRecoveryStore(rootDir, {
    namespace,
    maxObjectBytes: 128 * 1024,
    maxTotalBytes: 16 * 1024 * 1024,
  });
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function harness(options: {
  readonly now?: number;
  readonly enabled?: boolean;
  readonly sourceId?: string;
  readonly secret?: Uint8Array;
  readonly replayWindowMs?: number;
  readonly maxFutureSkewMs?: number;
  readonly maxBodyBytes?: number;
  readonly allowedContentTypes?: readonly string[];
} = {}) {
  const dir = root();
  let clock = options.now ?? 1_000_000;
  const sourceId = options.sourceId ?? 'github-events';
  const secret = options.secret ?? new Uint8Array(32).fill(7);

  const definitions = createFuryGatewayAutomationDefinitionStore({
    store: recovery(dir, 'definitions'),
    now: () => clock,
  });
  const definition = await definitions.create({
    automationId: 'build-hook',
    ownerPrincipalId: 'principal:user-1',
    workflowId: 'workflow.build-hook',
    enabled: options.enabled ?? true,
    trigger: {
      kind: 'webhook',
      sourceId,
    },
    requestedScopes: ['automations.inspect'],
    requestedPluginPermissions: [],
    budgets: {
      maxWallTimeMs: 60_000,
      maxToolCalls: 4,
      maxProviderCalls: 2,
    },
  });

  const runs = createFuryGatewayAutomationRunLedger({
    store: recovery(dir, 'runs'),
    now: () => clock,
  });
  const webhookStore = recovery(dir, 'webhooks');
  const coordinator = createFuryGatewayAutomationWebhookCoordinator({
    definitions,
    runs,
    store: webhookStore,
    now: () => clock,
  });

  const source = coordinator.registerSource({
    format: FURY_GATEWAY_AUTOMATION_WEBHOOK_SOURCE_FORMAT,
    sourceId,
    secret,
    ...(options.replayWindowMs === undefined
      ? {}
      : { replayWindowMs: options.replayWindowMs }),
    ...(options.maxFutureSkewMs === undefined
      ? {}
      : { maxFutureSkewMs: options.maxFutureSkewMs }),
    ...(options.maxBodyBytes === undefined
      ? {}
      : { maxBodyBytes: options.maxBodyBytes }),
    ...(options.allowedContentTypes === undefined
      ? {}
      : { allowedContentTypes: options.allowedContentTypes }),
  });

  function request(overrides: Record<string, unknown> = {}) {
    const body = (overrides.body as Uint8Array | undefined)
      ?? new TextEncoder().encode('{"action":"build","ref":"main"}');
    const eventId = (overrides.eventId as string | undefined)
      ?? 'evt-build-0001';
    const signedAt = (overrides.signedAt as number | undefined)
      ?? clock;
    const requestSourceId = (overrides.sourceId as string | undefined)
      ?? sourceId;
    const signature = (overrides.signature as string | undefined)
      ?? signFuryGatewayAutomationWebhookRequest(secret, {
        sourceId: requestSourceId,
        eventId,
        signedAt,
        body,
      });
    return {
      automationId: 'build-hook',
      sourceId: requestSourceId,
      eventId,
      signedAt,
      contentType: 'application/json; charset=utf-8',
      body,
      signature,
      ...overrides,
    };
  }

  return {
    dir,
    secret,
    sourceId,
    source,
    definition,
    definitions,
    runs,
    webhookStore,
    coordinator,
    request,
    get now() {
      return clock;
    },
    setNow(value: number) {
      clock = value;
    },
  };
}

describe('Fury Gateway authenticated webhook ingress', () => {
  it('stores webhook trigger policy without persisting authentication secrets', async () => {
    const h = await harness();

    expect(h.definition.definition.trigger).toEqual({
      kind: 'webhook',
      sourceId: 'github-events',
    });
    expect(h.source.secretConfigured).toBe(true);
    expect(h.source.executionAuthority).toBe(false);
    expect(JSON.stringify(h.source)).not.toContain(
      Buffer.from(h.secret).toString('hex'),
    );

    const history = await h.definitions.history('build-hook');
    const serialized = JSON.stringify(history);
    expect(serialized).not.toContain('secret');
  });

  it('keeps webhook automations outside the clock scheduler', async () => {
    const h = await harness();
    const scheduler = createFuryGatewayAutomationScheduler({
      definitions: h.definitions,
      runs: h.runs,
      now: () => h.now,
    });

    const tick = await scheduler.tick(
      'build-hook',
      'gateway-instance-a',
    );

    expect(tick.decision).toBe('external-trigger-only');
    expect(tick.executionAuthority).toBe(false);
    expect(await h.runs.countRuns()).toBe(0);
  });

  it('authenticates a bounded HMAC request and creates exactly one pending logical run', async () => {
    const h = await harness();
    const req = h.request();

    const receipt = await h.coordinator.ingest(req as never);

    expect(receipt.authenticated).toBe(true);
    expect(receipt.replayProtected).toBe(true);
    expect(receipt.duplicate).toBe(false);
    expect(receipt.executionAuthority).toBe(false);
    expect(receipt.run.state).toBe('pending');
    expect(receipt.eventIdSha256).toBe(sha256(req.eventId));
    expect(receipt.bodySha256).toBe(sha256(req.body));
    expect(receipt.mediaType).toBe('application/json');
    expect(await h.runs.countRuns()).toBe(1);
    expect(await h.coordinator.acceptedEventCount()).toBe(1);
  });

  it('persists only digests/metadata, never raw body, event ID, signature or secret', async () => {
    const h = await harness();
    const bodyText = '{"private":"payload-must-not-persist"}';
    const body = new TextEncoder().encode(bodyText);
    const eventId = 'evt-private-raw-id';
    const req = h.request({ body, eventId });

    await h.coordinator.ingest(req as never);

    const handles = await h.webhookStore.list?.({
      metadata: {
        system: 'gateway-automation-webhook',
        recordType: 'event',
      },
      limit: 10,
    }) ?? [];
    expect(handles).toHaveLength(1);
    const stored = new TextDecoder().decode(
      await h.webhookStore.get(handles[0]!),
    );

    expect(stored).not.toContain(bodyText);
    expect(stored).not.toContain(eventId);
    expect(stored).not.toContain(req.signature);
    expect(stored).not.toContain(Buffer.from(h.secret).toString('hex'));
    expect(stored).toContain(sha256(body));
    expect(stored).toContain(sha256(eventId));
  });

  it('deduplicates an exact retry and never creates a second run', async () => {
    const h = await harness();
    const req = h.request();

    const first = await h.coordinator.ingest(req as never);
    const second = await h.coordinator.ingest(req as never);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.run.runIdSha256).toBe(first.run.runIdSha256);
    expect(await h.runs.countRuns()).toBe(1);
    expect(await h.coordinator.acceptedEventCount()).toBe(1);
  });

  it('rejects the same event ID with different authenticated payload evidence', async () => {
    const h = await harness();
    const first = h.request();
    await h.coordinator.ingest(first as never);

    const body = new TextEncoder().encode('{"action":"deploy"}');
    const second = h.request({
      body,
      eventId: first.eventId,
    });

    await expect(h.coordinator.ingest(second as never)).rejects.toMatchObject({
      name: 'FuryGatewayAutomationWebhookError',
      code: 'replay-conflict',
    });
    expect(await h.runs.countRuns()).toBe(1);
    expect(await h.coordinator.acceptedEventCount()).toBe(1);
  });

  it('rejects invalid or non-canonical signatures without durable side effects', async () => {
    const h = await harness();
    const req = h.request();

    for (const signature of [
      '0'.repeat(64),
      req.signature.toUpperCase(),
      req.signature.slice(0, 62),
    ]) {
      await expect(
        h.coordinator.ingest({
          ...req,
          signature,
        } as never),
      ).rejects.toMatchObject({
        code: 'invalid-signature',
      });
    }

    expect(await h.runs.countRuns()).toBe(0);
    expect(await h.coordinator.acceptedEventCount()).toBe(0);
  });

  it('enforces replay age and future skew before durable trigger creation', async () => {
    const h = await harness({
      now: 1_000_000,
      replayWindowMs: 60_000,
      maxFutureSkewMs: 5_000,
    });

    const oldSignedAt = h.now - 60_001;
    const old = h.request({ signedAt: oldSignedAt });
    await expect(h.coordinator.ingest(old as never)).rejects.toMatchObject({
      code: 'timestamp-too-old',
    });

    const futureSignedAt = h.now + 5_001;
    const future = h.request({
      eventId: 'evt-future',
      signedAt: futureSignedAt,
    });
    await expect(h.coordinator.ingest(future as never)).rejects.toMatchObject({
      code: 'timestamp-in-future',
    });

    expect(await h.runs.countRuns()).toBe(0);
  });

  it('enforces content-type allowlist and raw body byte bounds', async () => {
    const h = await harness({
      maxBodyBytes: 32,
      allowedContentTypes: ['application/json'],
    });

    const wrongTypeBody = new TextEncoder().encode('{}');
    const wrongType = h.request({
      body: wrongTypeBody,
      contentType: 'text/plain',
    });
    await expect(
      h.coordinator.ingest(wrongType as never),
    ).rejects.toMatchObject({
      code: 'unsupported-content-type',
    });

    const tooLargeBody = new Uint8Array(33).fill(65);
    const tooLarge = h.request({
      body: tooLargeBody,
      eventId: 'evt-too-large',
    });
    await expect(
      h.coordinator.ingest(tooLarge as never),
    ).rejects.toMatchObject({
      code: 'limit-exceeded',
    });

    expect(await h.runs.countRuns()).toBe(0);
  });

  it('fails closed when the route source does not match the durable definition', async () => {
    const h = await harness();
    const otherSecret = new Uint8Array(32).fill(9);
    h.coordinator.registerSource({
      format: FURY_GATEWAY_AUTOMATION_WEBHOOK_SOURCE_FORMAT,
      sourceId: 'other-source',
      secret: otherSecret,
    });
    const body = new TextEncoder().encode('{}');
    const signedAt = h.now;
    const req = {
      automationId: 'build-hook',
      sourceId: 'other-source',
      eventId: 'evt-other',
      signedAt,
      contentType: 'application/json',
      body,
      signature: signFuryGatewayAutomationWebhookRequest(otherSecret, {
        sourceId: 'other-source',
        eventId: 'evt-other',
        signedAt,
        body,
      }),
    };

    await expect(h.coordinator.ingest(req)).rejects.toMatchObject({
      code: 'trigger-mismatch',
    });
    expect(await h.runs.countRuns()).toBe(0);
  });

  it('fails closed when the target automation has been disabled', async () => {
    const h = await harness();
    await h.definitions.revise({
      automationId: 'build-hook',
      expectedRevision: 1,
      enabled: false,
    });
    const req = h.request();

    await expect(h.coordinator.ingest(req as never)).rejects.toMatchObject({
      code: 'definition-disabled',
    });
    expect(await h.runs.countRuns()).toBe(0);
  });

  it('survives coordinator restart and preserves one-run replay identity', async () => {
    const h = await harness();
    const req = h.request();
    const first = await h.coordinator.ingest(req as never);

    const restarted = createFuryGatewayAutomationWebhookCoordinator({
      definitions: h.definitions,
      runs: createFuryGatewayAutomationRunLedger({
        store: recovery(h.dir, 'runs'),
        now: () => h.now,
      }),
      store: recovery(h.dir, 'webhooks'),
      now: () => h.now,
    });
    restarted.registerSource({
      format: FURY_GATEWAY_AUTOMATION_WEBHOOK_SOURCE_FORMAT,
      sourceId: h.sourceId,
      secret: h.secret,
    });

    const recovered = await restarted.ingest(req as never);

    expect(recovered.duplicate).toBe(true);
    expect(recovered.run.runIdSha256).toBe(first.run.runIdSha256);
    expect(await restarted.acceptedEventCount()).toBe(1);
  });

  it('repairs a crash after durable event journaling but before run registration', async () => {
    const h = await harness();
    const body = new TextEncoder().encode('{"action":"repair"}');
    const eventId = 'evt-repair-window';
    const signedAt = h.now;
    const definition = h.definition;
    const record = {
      format: FURY_GATEWAY_AUTOMATION_WEBHOOK_EVENT_FORMAT,
      automationId: 'build-hook',
      sourceId: h.sourceId,
      definitionRevision: definition.definition.revision,
      definitionSha256: definition.definitionSha256,
      eventIdSha256: sha256(eventId),
      bodySha256: sha256(body),
      mediaType: 'application/json',
      signedAt,
      receivedAt: signedAt - 1,
      authority: 'authenticated-webhook-evidence-only',
      executionAuthority: false,
    } as const;
    await h.webhookStore.put(
      new TextEncoder().encode(JSON.stringify(record)),
      {
        system: 'gateway-automation-webhook',
        recordType: 'event',
        automationId: 'build-hook',
        sourceId: h.sourceId,
        eventIdSha256: record.eventIdSha256,
      },
    );
    expect(await h.runs.countRuns()).toBe(0);

    const req = h.request({
      body,
      eventId,
      signedAt,
    });
    const repaired = await h.coordinator.ingest(req as never);

    expect(repaired.duplicate).toBe(true);
    expect(repaired.run.state).toBe('pending');
    expect(await h.runs.countRuns()).toBe(1);
    expect(await h.coordinator.acceptedEventCount()).toBe(1);
  });

  it('rejects secret-bearing trigger fields because durable webhook schema is exact', async () => {
    const dir = root();
    const definitions = createFuryGatewayAutomationDefinitionStore({
      store: recovery(dir, 'definitions'),
      now: () => 1,
    });

    await expect(definitions.create({
      automationId: 'bad-hook',
      ownerPrincipalId: 'principal:user-1',
      workflowId: 'workflow.bad-hook',
      enabled: true,
      trigger: {
        kind: 'webhook',
        sourceId: 'github-events',
        secret: 'must-not-persist',
      },
      requestedScopes: ['automations.inspect'],
      requestedPluginPermissions: [],
      budgets: {
        maxWallTimeMs: 1_000,
        maxToolCalls: 0,
        maxProviderCalls: 0,
      },
    } as never)).rejects.toMatchObject({
      code: 'invalid-input',
    });
  });

  it('marks only the generated coordinator as the process-local webhook boundary', async () => {
    const h = await harness();

    expect(
      isGeneratedFuryGatewayAutomationWebhookCoordinator(h.coordinator),
    ).toBe(true);
    expect(
      isGeneratedFuryGatewayAutomationWebhookCoordinator({
        ...h.coordinator,
      }),
    ).toBe(false);
  });
});
