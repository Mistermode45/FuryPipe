import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { FuryMcpHubError, createFuryMcpHub, discoverFuryMcpSources, parseCodexMcpToml, redactFuryMcpArgs, redactFuryMcpUrl } from '../src/fury-mcp-hub.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const fixture = fileURLToPath(new URL('./fixtures/mcp-direct-stdio-server.mjs', import.meta.url));

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'furypipe-mcphub-'));
  roots.push(root);
  const project = join(root, 'p');
  const home = join(root, 'h');
  mkdirSync(join(project, '.vscode'), { recursive: true });
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(project, '.mcp.json'), JSON.stringify({ mcpServers: {
    fixture: { command: process.execPath, args: [fixture], env: { FIXTURE_TOKEN: 'super-secret-value' } },
    github: { type: 'http', url: 'https://user:pw@api.example.com/mcp?key=abc', headers: { Authorization: 'Bearer sk-live-123' } },
  } }));
  writeFileSync(join(project, '.vscode', 'mcp.json'), JSON.stringify({ servers: { local: { type: 'http', url: 'http://127.0.0.1:9/mcp' } } }));
  writeFileSync(join(project, 'opencode.json'), JSON.stringify({ mcp: { fs: { type: 'local', command: ['npx', '-y', 'server-fs', '--token', 'ghp_abcdefabcdefabcdefabcdefabcdefabcdef'] } } }));
  writeFileSync(join(home, '.codex', 'config.toml'), '[model]\nname = "x"\n\n[mcp_servers.docs]\ncommand = "docs-mcp"\nargs = ["--api-key=abc", "serve"]\n\n[mcp_servers.docs.env]\nDOCS_KEY = "v"\n');
  writeFileSync(join(home, '.claude.json'), '{ not json');
  let t = 5;
  const hub = createFuryMcpHub({ projectRoot: project, homeDir: home, stateDir: join(root, 'state'), now: () => t++ });
  return { root, project, home, hub };
}

describe('FuryMcpHub discovery', () => {
  it('reads every harness config and never exposes secrets', async () => {
    const { project, home } = setup();
    const { sources, configs } = await discoverFuryMcpSources({ projectRoot: project, homeDir: home });
    expect(sources.map((s) => s.sourceId).sort()).toEqual(['project-mcp.fixture', 'project-mcp.github', 'project-opencode.fs', 'project-vscode.local', 'user-codex.docs']);
    const text = JSON.stringify(sources);
    for (const secret of ['super-secret-value', 'sk-live-123', 'pw@', 'key=abc', 'ghp_', '--api-key=abc']) expect(text).not.toContain(secret);
    expect(sources.find((s) => s.name === 'github')).toMatchObject({ transport: 'streamable_http', locality: 'remote', url: 'https://api.example.com/mcp?[redacted]', headerNames: ['Authorization'] });
    expect(sources.find((s) => s.name === 'fixture')).toMatchObject({ transport: 'stdio', locality: 'local', envNames: ['FIXTURE_TOKEN'] });
    expect(sources.find((s) => s.name === 'local')?.locality).toBe('local');
    expect(sources.find((s) => s.name === 'docs')).toMatchObject({ command: 'docs-mcp', args: ['--api-key=[redacted]', 'serve'], envNames: ['DOCS_KEY'] });
    expect(configs.find((c) => c.origin === 'user-claude')?.status).toBe('invalid');
  });

  it('redacts secret-looking arguments and URL credentials', () => {
    expect(redactFuryMcpArgs(['--token', 'abc', '--password=x', 'sk-abc', 'plain'])).toEqual(['--token', '[redacted]', '--password=[redacted]', '[redacted]', 'plain']);
    expect(redactFuryMcpUrl('https://a:b@h.test/x?t=1#f')).toBe('https://h.test/x?[redacted]');
    expect(parseCodexMcpToml('[mcp_servers.r]\nurl = "https://r.test/mcp"\n')).toMatchObject([{ name: 'r', transport: 'streamable_http' }]);
  });
});

describe('FuryMcpHub policy and health', () => {
  it('decides per tool: explicit policy, source default, disabled source and READ_ONLY from a trusted probe', async () => {
    const { hub } = setup();
    expect(await hub.decide('project-mcp.fixture', 'inventory-proof')).toEqual({ decision: 'ASK', reason: 'source default' });
    expect((await hub.decide('nope', 'x')).decision).toBe('DENY');
    await hub.setToolPolicy('project-mcp.fixture', 'inventory-proof', 'READ_ONLY');
    expect((await hub.decide('project-mcp.fixture', 'inventory-proof')).reason).toMatch(/trusted source/u);
    await hub.setTrusted('project-mcp.fixture', true);
    expect((await hub.decide('project-mcp.fixture', 'inventory-proof')).reason).toMatch(/not seen/u);

    const probed = await hub.probe('project-mcp.fixture');
    expect(probed.health).toMatchObject({ ok: true, toolCount: 1, tools: [{ name: 'inventory-proof', readOnly: true }] });
    expect(await hub.decide('project-mcp.fixture', 'inventory-proof')).toEqual({ decision: 'ALLOW', reason: 'READ_ONLY (tool policy): probed read-only' });

    await hub.setToolPolicy('project-mcp.fixture', 'inventory-proof', 'DENY');
    expect((await hub.decide('project-mcp.fixture', 'inventory-proof')).decision).toBe('DENY');
    await hub.setToolPolicy('project-mcp.fixture', 'inventory-proof', null);
    await hub.setDefaultPolicy('project-mcp.fixture', 'ALLOW');
    expect((await hub.decide('project-mcp.fixture', 'other')).decision).toBe('ALLOW');
    await hub.setEnabled('project-mcp.fixture', false);
    expect(await hub.decide('project-mcp.fixture', 'other')).toEqual({ decision: 'DENY', reason: 'source disabled' });
    await expect(hub.setDefaultPolicy('project-mcp.fixture', 'MAYBE' as never)).rejects.toThrow(FuryMcpHubError);
  }, 30_000);

  it('adds project MCP sources disabled and untrusted, without accepting embedded secrets', async () => {
    const { hub, project } = setup();
    const local = await hub.addProjectSource({ name: 'studio-local', transport: 'stdio', command: 'node', args: ['server.mjs'] });
    expect(local).toMatchObject({
      sourceId: 'project-furypipe.studio-local',
      origin: 'project-furypipe',
      enabled: false,
      trusted: false,
      defaultPolicy: 'ASK',
      transport: 'stdio',
    });
    const written = JSON.parse(readFileSync(join(project, '.furypipe', 'mcp.json'), 'utf8'));
    expect(written.mcpServers['studio-local']).toEqual({ command: 'node', args: ['server.mjs'] });

    const remote = await hub.addProjectSource({ name: 'docs', transport: 'streamable_http', url: 'https://mcp.example.com/v1' });
    expect(remote).toMatchObject({ enabled: false, trusted: false, locality: 'remote' });

    await expect(hub.addProjectSource({ name: 'secret', transport: 'stdio', command: 'tool', args: ['--api-key=abc'] })).rejects.toThrow(/secret-looking/u);
    await expect(hub.addProjectSource({ name: 'unsafe', transport: 'streamable_http', url: 'http://example.com/mcp' })).rejects.toThrow(/HTTPS/u);
    await expect(hub.addProjectSource({ name: 'query', transport: 'streamable_http', url: 'https://mcp.example.com/mcp?token=x' })).rejects.toThrow(/query strings/u);
  });

  it('refuses remote probes without allowRemote and records failures honestly', async () => {
    const { root, project, home } = setup();
    const seen: unknown[] = [];
    const hub = createFuryMcpHub({ projectRoot: project, homeDir: home, stateDir: join(root, 's2'), probe: async (c) => { seen.push(c); throw new Error('connect ECONNREFUSED'); } });
    await expect(hub.probe('project-mcp.github')).rejects.toThrow(/allowRemote/u);
    const remote = await hub.probe('project-mcp.github', { allowRemote: true });
    expect(remote.health).toMatchObject({ ok: false, error: 'connect ECONNREFUSED' });
    // The configured Authorization header and URL credentials are never sent.
    expect(JSON.stringify(seen[0])).not.toContain('sk-live-123');
    expect(seen[0]).toMatchObject({ allowedHosts: ['api.example.com'] });
    expect(JSON.stringify(seen[0])).not.toContain('headers');
    await expect(hub.probe('project-opencode.fs')).rejects.toThrow(/mark the source trusted/u);
    await hub.setTrusted('project-opencode.fs', true);
    await hub.probe('project-opencode.fs');
    expect(JSON.stringify(seen[1])).not.toContain('super-secret-value');
  });
});
