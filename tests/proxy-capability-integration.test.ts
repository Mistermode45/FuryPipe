import { afterEach, describe, expect, it } from 'vitest';

import { createProxy, type ProxyEvent } from '../src/core/proxy.js';
import { toTrackEvent } from '../src/core/tracker.js';
import type { ProxyCapabilityInstructionPlan } from '../src/proxy-capability-runtime.js';

function mockFetch(handler: (request: Request) => Promise<Response> | Response): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    return Promise.resolve(handler(request));
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

function captureEvent(): {
  readonly onRequest: (event: ProxyEvent) => void;
  readonly event: Promise<ProxyEvent>;
} {
  let resolve!: (event: ProxyEvent) => void;
  const event = new Promise<ProxyEvent>((done) => { resolve = done; });
  return { onRequest: resolve, event };
}

function okResponse(): Response {
  return new Response(JSON.stringify({
    id: 'msg_capability',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: { input_tokens: 10, output_tokens: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function plan(): ProxyCapabilityInstructionPlan {
  return {
    format: 'furypipe-proxy-capability-instructions/v1',
    blocks: [{
      kind: 'agent-skill',
      id: 'systematic-debugging',
      text: '<furypipe_active_skill name="systematic-debugging">Reproduce first. SECRET_SKILL_BODY_MARKER</furypipe_active_skill>',
    }],
    evidence: {
      format: 'furypipe-proxy-capability-evidence/v1',
      selectedSkillIds: ['systematic-debugging'],
      activatedSkills: [{
        format: 'furypipe-agent-skill-activation/v1',
        skillId: 'systematic-debugging',
        status: 'activated',
        instructionBytes: 42,
        instructionSha256: 'a'.repeat(64),
        executionAuthorized: false,
      }],
      blockedSkillIds: [],
      executionAuthorized: false,
    },
  };
}

const restore: Array<() => void> = [];
afterEach(() => {
  while (restore.length > 0) restore.pop()?.();
});

describe('live proxy Agent Skill instruction runtime', () => {
  it('applies a validated host plan and exposes activation evidence', async () => {
    let forwarded = '';
    restore.push(mockFetch(async (request) => {
      forwarded = await request.clone().text();
      return okResponse();
    }));
    const captured = captureEvent();
    let plannerCalls = 0;

    const proxy = createProxy({
      upstream: 'http://anthropic.test',
      humanOutputPolicy: false,
      capabilityPlanner: async () => {
        plannerCalls += 1;
        return plan();
      },
      transform: { compress: false },
      onRequest: captured.onRequest,
    });

    const response = await proxy(new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: 'Debug this regression.' }],
      }),
    }));
    await response.text();
    const event = await captured.event;

    expect(response.status).toBe(200);
    expect(plannerCalls).toBe(1);
    const forwardedJson = JSON.parse(forwarded) as {
      system?: string | Array<{ text?: string }>;
    };
    const systemText = typeof forwardedJson.system === 'string'
      ? forwardedJson.system
      : (forwardedJson.system ?? []).map((block) => block.text ?? '').join('\n');
    expect(systemText).toContain('<furypipe_active_skill name="systematic-debugging">');
    expect(event.capability).toEqual(plan().evidence);
    expect(event.capability?.executionAuthorized).toBe(false);
  });

  it.each([true, false])(
    'does not call the capability planner for exact-response probes when humanOutputPolicy=%s',
    async (humanOutputPolicy) => {
      let forwarded = '';
      restore.push(mockFetch(async (request) => {
        forwarded = await request.clone().text();
        return okResponse();
      }));
      let plannerCalls = 0;
      const proxy = createProxy({
        upstream: 'http://anthropic.test',
        humanOutputPolicy,
        capabilityPlanner: async () => {
          plannerCalls += 1;
          return plan();
        },
        transform: { compress: false },
      });

      const source = JSON.stringify({
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: 'Réponds exactement : FURYPIPE_SKILL_EXACT_OK' }],
      });
      const response = await proxy(new Request('http://localhost/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: source,
      }));
      await response.text();

      expect(response.status).toBe(200);
      expect(plannerCalls).toBe(0);
      expect(forwarded).not.toContain('furypipe_active_skill');
      expect(forwarded).not.toContain('furypipe_runtime_instruction');
      expect(JSON.parse(forwarded)).toEqual(JSON.parse(source));
    },
  );
