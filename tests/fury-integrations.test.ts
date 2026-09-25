import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFuryIntegrationRegistry, summarizeOpenApi } from '../src/fury-integrations.js';
import type { FuryMcpSourceView } from '../src/fury-mcp-hub.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const SPEC = {
  openapi: '3.1.0', info: { title: 'Billing' }, servers: [{ url: 'https://billing.example.com/v1' }],
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
  paths: { '/invoices': { get: { operationId: 'listInvoices' }, post: { operationId: 'createInvoice' } }, '/health': { get: {} } },
};

function project(manifest: unknown) {
  const root = mkdtempSync(join(tmpdir(), 'furypipe-integrations-'));
  roots.push(root);
  mkdirSync(join(root, '.furypipe'), { recursive: true });
  mkdirSync(join(root, 'api'));
  writeFileSync(join(root, 'api', 'billing.json'), JSON.stringify(SPEC));
  writeFileSync(join(root, 'api', 'status.json'), JSON.stringify({ swagger: '2.0', info: { title: 'Status' }, host: 'status.example.com', paths: { '/s': { get: {} } } }));
  if (manifest !== undefined) writeFileSync(join(root, '.furypipe', 'integrations.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  return root;
}

const mcp: FuryMcpSourceView = {
  sourceId: 'project-mcp.gh', name: 'gh', origin: 'project-mcp', configPath: '/p/.mcp.json', scope: 'project', transport: 'streamable_http', locality: 'remote',
  url: 'https://api.example.com/mcp', envNames: [], headerNames: ['Authorization'], enabled: true, trusted: false, defaultPolicy: 'ASK', toolPolicies: {},
};

describe('Integration registry', () => {
  it('summarises OpenAPI into operations with READ/WRITE capability and auth schemes', () => {
    const s = summarizeOpenApi(SPEC);
    expect(s).toMatchObject({ title: 'Billing', server: 'https://billing.example.com/v1', schemes: ['bearer:http/bearer'] });
    expect(s.operations).toEqual([
      { id: 'listInvoices', method: 'GET', path: '/invoices', capability: 'READ' },
      { id: 'createInvoice', method: 'POST', path: '/invoices', capability: 'WRITE' },
      { id: 'GET /health', method: 'GET', path: '/health', capability: 'READ' },
    ]);
    expect(() => summarizeOpenApi({ paths: {} })).toThrow(/OpenAPI/u);
  });

  it('merges MCP sources and the operator manifest with auth, permissions, trust and status', async () => {
    const root = project({ format: 'furypipe-integrations/v1', integrations: [
      { id: 'billing', kind: 'OPENAPI', spec: 'api/billing.json', credentialEnv: 'BILLING_TOKEN', trusted: true },
      { id: 'status', kind: 'OPENAPI', spec: 'api/status.json' },
      { id: 'deploys', kind: 'WEBHOOK_OUT', url: 'https://hooks.example.com/deploy', credentialEnv: ['HOOK_SECRET'] },
      { id: 'github-events', kind: 'WEBHOOK_IN', credentialEnv: 'GH_WEBHOOK_SECRET' },
      { id: 'anon-in', kind: 'WEBHOOK_IN' },
    ] });
    const reg = await buildFuryIntegrationRegistry({ projectRoot: root, mcp: [mcp], env: { HOOK_SECRET: 'x', GH_WEBHOOK_SECRET: 'y' } });
    expect(reg.manifest).toBe('loaded');
    const by = Object.fromEntries(reg.entries.map((e) => [e.id, e]));
    expect(by['mcp:project-mcp.gh']).toMatchObject({ kind: 'MCP', trust: 'untrusted', defaultDecision: 'ASK', auth: { credentialNames: ['Authorization'] }, capabilities: ['READ', 'WRITE', 'NETWORK', 'EXTERNAL_ACTION'] });
    expect(by['openapi:billing']).toMatchObject({ trust: 'trusted', status: 'needs-credentials', defaultDecision: 'ASK', auth: { schemes: ['bearer:http/bearer'], credentialNames: ['BILLING_TOKEN'] }, problems: ['credential not set: BILLING_TOKEN'] });
    expect(by['openapi:status']).toMatchObject({ endpoint: 'https://status.example.com', capabilities: ['READ', 'NETWORK'], defaultDecision: 'READ_ONLY', status: 'ready' });
    expect(by['webhook_out:deploys']).toMatchObject({ status: 'ready', capabilities: ['NETWORK', 'EXTERNAL_ACTION'] });
    expect(by['webhook_in:github-events']).toMatchObject({ status: 'ready', auth: { schemes: ['hmac-signature'] } });
    expect(by['webhook_in:anon-in']).toMatchObject({ status: 'invalid' });
    expect(JSON.stringify(reg)).not.toMatch(/"x"|"y"/u);
  });

  it.each([
    ['inline secret', { format: 'furypipe-integrations/v1', integrations: [{ id: 'a', kind: 'WEBHOOK_OUT', url: 'https://h.test/x', token: 'sk-live' }] }, /secret value/u],
    ['http webhook', { format: 'furypipe-integrations/v1', integrations: [{ id: 'a', kind: 'WEBHOOK_OUT', url: 'http://h.test/x' }] }, /https/u],
    ['spec escape', { format: 'furypipe-integrations/v1', integrations: [{ id: 'a', kind: 'OPENAPI', spec: '../../etc/x.json' }] }, /escapes/u],
    ['bad env name', { format: 'furypipe-integrations/v1', integrations: [{ id: 'a', kind: 'WEBHOOK_IN', credentialEnv: 'lower case' }] }, /environment variable names/u],
    ['mcp in manifest', { format: 'furypipe-integrations/v1', integrations: [{ id: 'a', kind: 'MCP' }] }, /MCP Hub/u],
    ['wrong format', { integrations: [] }, /format/u],
  ])('rejects a manifest with %s without losing MCP entries', async (_n, manifest, pattern) => {
    const reg = await buildFuryIntegrationRegistry({ projectRoot: project(manifest), mcp: [mcp], env: {} });
    expect(reg.manifest).toBe('invalid');
    expect(reg.manifestError).toMatch(pattern);
    expect(reg.entries.map((e) => e.id)).toEqual(['mcp:project-mcp.gh']);
  });

  it('reports absent and unparsable manifests', async () => {
    expect((await buildFuryIntegrationRegistry({ projectRoot: project(undefined) })).manifest).toBe('absent');
    expect(await buildFuryIntegrationRegistry({ projectRoot: project('{nope') })).toMatchObject({ manifest: 'invalid', manifestError: 'integrations.json is not valid JSON' });
  });
});
