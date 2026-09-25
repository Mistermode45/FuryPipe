// FuryBench — Studio track cases (QA-04), paired and budget-matched.
//
//   context   Does the context capsule put the files that really changed
//             together into a fixed budget? Ground truth is this repository's
//             own git history (files co-changed in one commit), not the graph
//             the capsule uses, so the metric is not circular. Baselines see
//             the same candidates and the same byte budget.
//   dispatch  Planner + FuryDispatcher on the same commits: SINGLE vs AUTO,
//             sequential steps, parallel width, and write-scope overlap
//             inside a parallel group (must be 0).
//   localfit  Measured tokens/s for a reachable local model; NOT_EXECUTED
//             when this machine has none (never estimated).
// No provider is called. Output: artifacts/furybench-studio/{result.json,summary.md}.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { compileFuryContextCapsule, type FuryContextCandidate } from '../src/fury-context-compiler.js';
import { planFuryDispatch, type FuryRuntimeBinding } from '../src/fury-dispatcher.js';
import { createNativeGraphProvider, loadFuryGraph } from '../src/fury-graph.js';
import { discoverFuryLocalBackends, measureFuryLocalModel } from '../src/fury-local-fabric.js';
import { planFuryTask } from '../src/fury-planner.js';

const ROOT = process.cwd();
const OUT = path.resolve(process.env.FURYPIPE_VALIDATION_OUTPUT_DIR?.trim() || 'artifacts/furybench-studio');
const BUDGET = Number(process.env.FURYBENCH_CONTEXT_BUDGET ?? 96 * 1024);

function listTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listTs(p) : e.name.endsWith('.ts') ? [path.relative(ROOT, p).split(path.sep).join('/')] : [];
  });
}

function commits(): { sha: string; files: string[] }[] {
  const log = execFileSync('git', ['log', '--no-merges', '--format=@%H', '--name-only', '-n', '400', '--', 'src'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const out: { sha: string; files: string[] }[] = [];
  for (const block of log.split('@').filter(Boolean)) {
    const [sha, ...rest] = block.split('\n').map((l) => l.trim()).filter(Boolean);
    out.push({ sha: sha!, files: rest });
  }
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x: number, d = 3) => Number(x.toFixed(d));

async function contextCase(existing: Set<string>, contents: Map<string, string>) {
  const { graph } = await loadFuryGraph(ROOT, [createNativeGraphProvider()]);
  const all = [...existing].sort();
  const candidates: FuryContextCandidate[] = all.map((f) => ({ source: f, kind: 'file', content: contents.get(f)!, priority: 50 }));
  const fill = (order: string[], seed: string) => {
    const got = new Set<string>();
    let used = 0;
    for (const f of order) {
      if (f === seed) continue;
      const b = Buffer.byteLength(contents.get(f)!, 'utf8');
      if (used + b > BUDGET) continue;
      used += b;
      got.add(f);
    }
    return got;
  };
  const rows: { commit: string; seed: string; truth: number; recall: Record<string, number> }[] = [];
  for (const c of commits()) {
    const src = [...new Set(c.files.filter((f) => existing.has(f)))];
    if (src.length < 2 || src.length > 12) continue;
    for (const seed of src.slice(0, 3)) {
      const truth = src.filter((f) => f !== seed);
      const plan = planFuryTask({ runId: 'bench', intent: `Change ${seed}`, plannedFiles: [seed], checks: { tests: false, security: 'never', docs: 'never' } });
      const implTask = plan.ir.tasks.find((t) => t.role === 'implementer')!;
      const capsule = compileFuryContextCapsule({ ir: plan.ir, taskId: implTask.id, candidates: candidates.filter((x) => x.source !== seed), budgetBytes: BUDGET + 8 * 1024, graph, changedFiles: [seed], now: 0 });
      const inCapsule = new Set(capsule.entries.map((e) => e.source));
      const dir = path.posix.dirname(seed);
      const lexical = fill(all, seed);
      const directory = fill([...all.filter((f) => path.posix.dirname(f) === dir), ...all.filter((f) => path.posix.dirname(f) !== dir)], seed);
      const r = (set: Set<string>) => truth.filter((f) => set.has(f)).length / truth.length;
      rows.push({ commit: c.sha.slice(0, 10), seed, truth: truth.length, recall: { capsule: r(inCapsule), lexical: r(lexical), directory: r(directory) } });
    }
  }
  const variants = ['capsule', 'lexical', 'directory'] as const;
  const paired = (a: string, b: string) => rows.reduce((acc, x) => {
    const d = x.recall[a]! - x.recall[b]!;
    if (d > 1e-9) acc.wins++; else if (d < -1e-9) acc.losses++; else acc.ties++;
    return acc;
  }, { wins: 0, losses: 0, ties: 0 });
  const fullBytes = all.reduce((n, f) => n + Buffer.byteLength(contents.get(f)!, 'utf8'), 0);
  return {
    status: rows.length ? 'EXECUTED' : 'NOT_EXECUTED',
    groundTruth: 'files co-changed with the seed in the same git commit (this repository)',
    budgetBytes: BUDGET, graphProvider: graph.provider, samples: rows.length,
    candidateFiles: all.length, fullContextBytes: fullBytes, budgetFractionOfFullContext: round(BUDGET / fullBytes, 4),
    meanRecall: Object.fromEntries(variants.map((v) => [v, round(mean(rows.map((x) => x.recall[v]!)))])),
    capsuleVsDirectory: paired('capsule', 'directory'), capsuleVsLexical: paired('capsule', 'lexical'),
    rows,
  };
}

function dispatchCase(existing: Set<string>) {
  const candidates: FuryRuntimeBinding[] = [
    { id: 'a', harnessId: 'claude-code', provider: 'p', model: 'm', locality: 'local', available: true, scores: { coding: 0.8, review: 0.7 }, estimatedCostUsdPerTask: 0 },
    { id: 'b', harnessId: 'codex', provider: 'p', model: 'm', locality: 'local', available: true, scores: { coding: 0.7, review: 0.8 }, estimatedCostUsdPerTask: 0 },
  ];
  const rows: { commit: string; files: number; workstreams: number; single: { steps: number; agents: number }; auto: { steps: number; agents: number; width: number; mode: string; benefit: string }; overlapViolations: number }[] = [];
  for (const c of commits()) {
    const files = [...new Set(c.files.filter((f) => existing.has(f) || f.startsWith('src/')))].filter((f) => /^[\w./-]+$/u.test(f));
    if (files.length < 2) continue;
    const plan = planFuryTask({ runId: 'bench', intent: `Replay ${c.sha.slice(0, 10)}`, plannedFiles: files, checks: { security: 'never', docs: 'never' } });
    const single = planFuryDispatch({ ir: plan.ir, candidates, mode: 'SINGLE' });
    const auto = planFuryDispatch({ ir: plan.ir, candidates, mode: 'AUTO' });
    const scopes = new Map(plan.ir.tasks.map((t) => [t.id, t.writeScopes.map((s) => s.replace(/\/?\*+$/u, ''))]));
    let violations = 0;
    const byGroup = new Map<number, string[]>();
    for (const a of auto.assignments) byGroup.set(a.group, [...(byGroup.get(a.group) ?? []), a.taskId]);
    for (const ids of byGroup.values()) {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const x = scopes.get(ids[i]!) ?? [];
        const y = scopes.get(ids[j]!) ?? [];
        if (x.some((p) => y.some((q) => p === q || p.startsWith(`${q}/`) || q.startsWith(`${p}/`)))) violations++;
      }
    }
    rows.push({
      commit: c.sha.slice(0, 10), files: files.length, workstreams: plan.ir.tasks.filter((t) => t.writeScopes.length).length,
      single: { steps: single.groups, agents: single.agents },
      auto: { steps: auto.groups, agents: auto.agents, width: Math.max(...[...byGroup.values()].map((v) => v.length)), mode: auto.mode, benefit: auto.dispatchBenefit },
      overlapViolations: violations,
    });
  }
  return {
    status: rows.length ? 'EXECUTED' : 'NOT_EXECUTED',
    note: 'Plan-level comparison only: steps and width are scheduling properties, not measured wall time.',
    samples: rows.length,
    meanSteps: { single: round(mean(rows.map((r) => r.single.steps))), auto: round(mean(rows.map((r) => r.auto.steps))) },
    meanAgents: { single: round(mean(rows.map((r) => r.single.agents))), auto: round(mean(rows.map((r) => r.auto.agents))) },
    parallelPlans: rows.filter((r) => r.auto.width > 1).length,
    overlapViolations: rows.reduce((n, r) => n + r.overlapViolations, 0),
    rows,
  };
}

async function localFitCase() {
  const { backends } = await discoverFuryLocalBackends();
  const reachable = backends.filter((b) => b.reachable);
  const model = reachable.flatMap((b) => b.models).find((m) => m.modality !== 'embeddings' && m.modality !== 'vision');
  if (!model) return { status: 'NOT_EXECUTED', reason: 'no reachable local inference server with a text model on this machine', backendsProbed: backends.map((b) => ({ kind: b.kind, reachable: b.reachable })) };
  const measurement = await measureFuryLocalModel({ backend: model.backend, baseUrl: model.baseUrl, model: model.id } as never);
  return { status: 'EXECUTED', model: `${model.backend}:${model.id}`, measurement };
}

async function main() {
  const files = listTs(path.join(ROOT, 'src'));
  const existing = new Set(files.filter((f) => statSync(path.join(ROOT, f)).size <= 256 * 1024));
  const contents = new Map([...existing].map((f) => [f, readFileSync(path.join(ROOT, f), 'utf8')]));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const result = { format: 'furypipe-furybench-studio/v1', head, generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, context: await contextCase(existing, contents), dispatch: dispatchCase(existing), localFit: await localFitCase() };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  const c = result.context;
  const d = result.dispatch;
  const summary = [
    `# FuryBench — Studio track (${head.slice(0, 10)})`, '',
    `## Context capsule vs baselines (budget ${c.budgetBytes} B, ${c.samples} samples, ${c.candidateFiles} candidate files, budget = ${(c.budgetFractionOfFullContext * 100).toFixed(1)}% of full context)`, '',
    '| Variant | Mean recall of co-changed files |', '|---|---|',
    ...Object.entries(c.meanRecall).map(([k, v]) => `| ${k} | ${v} |`), '',
    `Capsule vs directory: ${c.capsuleVsDirectory.wins} wins / ${c.capsuleVsDirectory.losses} losses / ${c.capsuleVsDirectory.ties} ties. Capsule vs lexical: ${c.capsuleVsLexical.wins} / ${c.capsuleVsLexical.losses} / ${c.capsuleVsLexical.ties}.`, '',
    `## Dispatch (plan level, ${d.samples} commits)`, '',
    `Mean sequential steps SINGLE ${d.meanSteps.single} vs AUTO ${d.meanSteps.auto}; mean agents SINGLE ${d.meanAgents.single} vs AUTO ${d.meanAgents.auto}; parallel plans ${d.parallelPlans}; write-scope overlap inside a parallel group: ${d.overlapViolations}.`, '',
    `## Local fit`, '', `${result.localFit.status}${'reason' in result.localFit ? `: ${result.localFit.reason}` : ''}`, '',
  ].join('\n');
  writeFileSync(path.join(OUT, 'summary.md'), summary);
  console.log(summary);
  if (d.overlapViolations > 0) {
    console.error('FuryBench studio: parallel writers with overlapping scopes');
    process.exitCode = 1;
  }
}

await main();
