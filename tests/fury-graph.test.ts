import { cpSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compileFuryContextCapsule, FuryContextError } from '../src/fury-context-compiler.js';
import { planFuryDispatch, type FuryRuntimeBinding } from '../src/fury-dispatcher.js';
import {
  createGraphifyProvider,
  createNativeGraphProvider,
  furyBlastRadius,
  furyScopeCoupling,
  loadFuryGraph,
  planGraphifyLifecycle,
} from '../src/fury-graph.js';
import { compileFuryIr } from '../src/fury-ir.js';

const FIXTURE = join(__dirname, 'fixtures', 'graphify-0.9.67');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Copy the real Graphify fixture and align source mtimes with its manifest. */
function freshProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'furypipe-graph-'));
  dirs.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, 'graphify-out', 'manifest.json'), 'utf8')) as Record<string, { mtime: number }>;
  for (const [file, meta] of Object.entries(manifest)) utimesSync(join(dir, file), meta.mtime - 10, meta.mtime - 10);
  return dir;
}

describe('FuryGraph Graphify provider (real graphify 0.9.67 output)', () => {
  it('loads nodes/edges with confidence tags and reports outputs', async () => {
    const root = freshProject();
    const { graph, detections } = await loadFuryGraph(root);
    expect(detections[0]).toMatchObject({ provider: 'graphify', available: true });
    expect(graph.provider).toBe('graphify');
    expect(graph.nodes.filter((n) => n.kind === 'file').map((n) => n.file).sort()).toEqual([
      'src/auth/login.ts', 'src/auth/session.ts', 'src/ui/button.ts', 'src/ui/login-form.ts', 'tests/login.test.ts',
    ]);
    expect(new Set(graph.edges.map((e) => e.confidence))).toEqual(new Set(['EXTRACTED']));
    expect(graph.outputs).toMatchObject({ 'graph.json': 'graphify-out/graph.json', 'GRAPH_REPORT.md': 'graphify-out/GRAPH_REPORT.md' });
    expect(graph.stale).toBe(false);
  });

  it('matches `graphify affected session.ts` for the blast radius', async () => {
    const { graph } = await loadFuryGraph(freshProject());
    // Oracle from the real CLI: login.ts, login-form.ts, login.test.ts.
    expect(furyBlastRadius(graph, ['src/auth/session.ts'], 2)).toEqual({
      changed: ['src/auth/session.ts'],
      affected: ['src/auth/login.ts', 'src/ui/login-form.ts', 'tests/login.test.ts'],
      affectedTests: ['tests/login.test.ts'],
    });
    expect(furyBlastRadius(graph, ['src/auth/session.ts'], 1).affected).toEqual(['src/auth/login.ts']);
    expect(furyBlastRadius(graph, ['../etc/passwd', '/abs']).changed).toEqual([]);
  });

  it('detects stale graphs when a source changes after the manifest', async () => {
    const root = freshProject();
    writeFileSync(join(root, 'src', 'ui', 'button.ts'), 'export const x = 1;\n');
    const { graph } = await loadFuryGraph(root);
    expect(graph.stale).toBe(true);
    expect(graph.staleFiles).toEqual(['src/ui/button.ts']);
  });

  it('falls back to the native provider when Graphify output is absent', async () => {
    const root = freshProject();
    rmSync(join(root, 'graphify-out'), { recursive: true });
    const { graph, detections } = await loadFuryGraph(root);
    expect(detections.map((d) => [d.provider, d.available])).toEqual([['graphify', false], ['native-codegraph', true]]);
    expect(graph.provider).toBe('native-codegraph');
    expect(furyBlastRadius(graph, ['src/auth/session.ts']).affected).toContain('src/auth/login.ts');
  });

  it('recommends explicit Graphify refresh after relevant code changes without granting authority', async () => {
    const root = freshProject();
    const loaded = await loadFuryGraph(root);
    const plan = planGraphifyLifecycle({
      ...loaded,
      changedFiles: ['src/auth/login.ts', 'README.md', '../outside.ts'],
    });
    expect(plan).toMatchObject({
      action: 'RECOMMEND_REFRESH',
      relevantChangedFiles: ['src/auth/login.ts'],
      executionAuthorized: false,
    });
    expect(plan.changedFiles).toEqual(['README.md', 'src/auth/login.ts']);
  });

  it('keeps native fallback explicit when Graphify output is unavailable', async () => {
    const root = freshProject();
    rmSync(join(root, 'graphify-out'), { recursive: true });
    const loaded = await loadFuryGraph(root);
    expect(planGraphifyLifecycle({ ...loaded, changedFiles: ['src/auth/login.ts'] })).toMatchObject({
      provider: 'native-codegraph',
      action: 'USE_NATIVE_FALLBACK',
      executionAuthorized: false,
    });
  });

  it('rejects malformed graph files', async () => {
    const root = freshProject();
    writeFileSync(join(root, 'graphify-out', 'graph.json'), '{"nodes": 1}');
    await expect(createGraphifyProvider().load(root)).rejects.toThrow(/nodes\/links/u);
    expect(() => createGraphifyProvider({ outDir: '../x' })).toThrow();
    expect((await createNativeGraphProvider().detect(root)).available).toBe(true);
  });
});

describe('Graph-aware dispatch and context capsule', () => {
  const caps = { READ: 'ALLOW', WRITE: 'ALLOW', EXECUTE: 'ASK', NETWORK: 'DENY', EXTERNAL_ACTION: 'DENY' } as const;
  const ir = () => compileFuryIr({
    format: 'furypipe-ir/v1', intent: 'Harden login and restyle buttons.', must: ['keep login(user, password) signature'], mustNot: ['log passwords'],
    capabilities: caps, privacy: 'cloud-allowed',
    budget: { maxCostUsd: 10, maxTokens: 1_000_000, maxWallTimeMs: 3_600_000, maxAgents: 4, maxRetries: 1, maxCloudCalls: 50, maxToolCalls: 500 },
    successPredicates: [{ id: 'tests', level: 'MUST', description: 'login tests pass', evidence: [{ kind: 'TEST_RECEIPT', subject: 'test:login' }] }],
    humanGates: [],
    tasks: [
      { id: 'auth', role: 'implementer', description: 'harden auth', dependsOn: [], capabilities: ['READ', 'WRITE'], writeScopes: ['src/auth/**'] },
      { id: 'form', role: 'implementer', description: 'login form', dependsOn: [], capabilities: ['READ', 'WRITE'], writeScopes: ['src/ui/login-form.ts'] },
      { id: 'tests', role: 'tester', description: 'tests', dependsOn: [], capabilities: ['READ', 'WRITE'], writeScopes: ['tests/**'] },
    ],
    rollbackPolicy: 'revert-worktree',
  });
  const bindings: FuryRuntimeBinding[] = [
    { id: 'a', harnessId: 'claude-code', provider: 'anthropic', model: 'm1', locality: 'cloud', available: true, scores: { coding: 0.9 }, estimatedCostUsdPerTask: 0.1 },
    { id: 'b', harnessId: 'codex', provider: 'openai', model: 'm2', locality: 'cloud', available: true, scores: { coding: 0.8 }, estimatedCostUsdPerTask: 0.1 },
  ];

  it('serializes writers whose scopes are coupled in the graph, keeps others parallel', async () => {
    const { graph } = await loadFuryGraph(freshProject());
    expect(furyScopeCoupling(graph, ['src/auth/**'], ['src/ui/login-form.ts'])).toBeGreaterThan(0);
    expect(furyScopeCoupling(graph, ['src/ui/button.ts'], ['src/auth/**'])).toBe(0);
    const blind = planFuryDispatch({ ir: ir(), candidates: bindings, mode: 'PARALLEL' });
    const aware = planFuryDispatch({ ir: ir(), candidates: bindings, mode: 'PARALLEL', coupling: (x, y) => furyScopeCoupling(graph, x, y) });
    const g = (plan: typeof blind, id: string) => plan.assignments.find((a) => a.taskId === id)!.group;
    expect(g(blind, 'auth')).toBe(g(blind, 'form'));
    expect(g(aware, 'auth')).not.toBe(g(aware, 'form'));
    expect(aware.reasons.join(' ')).toContain('graph coupling');
  });

  it('pins MUST constraints, ranks blast-radius files first and records reasons and digests', async () => {
    const root = freshProject();
    const { graph } = await loadFuryGraph(root);
    const file = (p: string, priority = 10) => ({ source: p, kind: 'file' as const, content: readFileSync(join(root, p), 'utf8'), priority });
    const candidates = [file('src/ui/button.ts'), file('src/auth/session.ts'), file('tests/login.test.ts'), file('src/auth/login.ts'),
      { source: 'memory:old', kind: 'memory' as const, content: 'stale note', priority: 90, expiresAt: 1 }];
    const capsule = compileFuryContextCapsule({ ir: ir(), taskId: 'auth', candidates, budgetBytes: 650, graph, changedFiles: ['src/auth/session.ts'], now: 1_000 });
    const sources = capsule.entries.map((e) => e.source);
    expect(sources.slice(0, 5)).toEqual(['ir:intent', 'ir:must[0]', 'ir:mustNot[0]', 'ir:predicate:tests', 'ir:task:auth']);
    expect(sources).toContain('src/auth/session.ts');
    expect(sources.indexOf('src/auth/session.ts')).toBeLessThan(sources.indexOf('src/auth/login.ts'));
    expect(capsule.omitted.find((o) => o.source === 'memory:old')?.reason).toBe('expired');
    expect(capsule.usedBytes).toBeLessThanOrEqual(650);
    expect(capsule.omitted.find((o) => o.source === 'src/ui/button.ts')?.reason).toMatch(/over budget/u);
    expect(capsule.usedBytes).toBeLessThan(capsule.candidateBytes);
    for (const e of capsule.entries) expect(e.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(capsule.entries.find((e) => e.source === 'src/auth/session.ts')?.reason).toContain('changed file');
    expect(capsule.entries.find((e) => e.source === 'src/auth/login.ts')?.reason).toMatch(/direct import neighbour of the change; same folder as the change/u);
  });

  it('refuses to drop a MUST constraint when the budget is too small', () => {
    expect(() => compileFuryContextCapsule({ ir: ir(), taskId: 'auth', candidates: [], budgetBytes: 40 })).toThrow(FuryContextError);
    expect(() => compileFuryContextCapsule({ ir: ir(), taskId: 'nope', candidates: [], budgetBytes: 4000 })).toThrow(/not in the contract/u);
  });
});

describe('Predicted vs actual impact (master §47.5)', () => {
  it('flags unexpected changes and requires tests around the actual blast radius', async () => {
    const { furyImpactDelta, furyImpactRequirements } = await import('../src/fury-graph.js');
    const { createFuryProofLedger } = await import('../src/fury-proof.js');
    const { graph } = await loadFuryGraph(freshProject());
    const delta = furyImpactDelta(graph, {
      plannedFiles: ['src/ui/button.ts'],
      actualChangedFiles: ['src/ui/button.ts', 'src/auth/session.ts'],
      executedTests: [],
    });
    expect(delta.unexpectedChanges).toEqual(['src/auth/session.ts']);
    expect(delta.requiredTests).toEqual(['tests/login.test.ts']);
    expect(delta.untestedNeighbours).toEqual(['tests/login.test.ts']);
    const requirements = furyImpactRequirements(delta);
    const ledger = createFuryProofLedger();
    expect(ledger.judge({ requirements, receipts: [] }).verdict).toBe('UNPROVEN');
    const receipt = ledger.issue({ kind: 'TEST_RECEIPT', subject: 'test:tests/login.test.ts', outcome: 'pass', producer: 'host:vitest', evidenceDigest: 'a'.repeat(64) });
    expect(ledger.judge({ requirements, receipts: [receipt] }).verdict).toBe('ACCEPT');
    expect(furyImpactDelta(graph, { plannedFiles: ['src/auth/session.ts'], actualChangedFiles: ['src/auth/login.ts'], executedTests: ['tests/login.test.ts'] })).toMatchObject({ unexpectedChanges: [], untestedNeighbours: [] });
  });
});
