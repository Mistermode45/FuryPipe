#!/usr/bin/env node

/**
 * Same-runner FuryBench comparison between a checked-out historical package
 * ref and the current candidate. The historical ref is built from source in
 * an isolated temporary worktree; no registry package or provider is used.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPnpmCommand, resolvePnpmCommand } from './validation-command.mjs';

const ROOT = process.cwd();
const OUTPUT_DIR = path.resolve(
  process.env.FURYPIPE_VALIDATION_OUTPUT_DIR?.trim() || 'artifacts/final-validation',
);
const BASELINE_REF = process.env.FURYPIPE_BENCHMARK_BASELINE_REF?.trim()
  || '24a2f7030c9fb7340229140f67e653688d5d039a';
// Five samples made p95 equal the single slowest process on Windows. Keep the
// historical same-runner comparison, but use a larger bounded sample and
// warmup so one scheduler outlier cannot decide the release gate.
const ITERATIONS = 10;
const WARMUP = 2;

function fail(message) {
  throw new Error(`[furypipe FuryBench comparison] ${message}`);
}

function run(file, args, cwd, options = {}) {
  const pnpm = isPnpmCommand(file) ? resolvePnpmCommand() : undefined;
  const executable = pnpm?.executable ?? file;
  const finalArgs = pnpm ? [...pnpm.prefixArgs, ...args] : args;
  try {
    return execFileSync(executable, finalArgs, {
      cwd,
      encoding: 'utf8',
      stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      shell: pnpm?.shell ?? false,
    });
  } catch (error) {
    const stdout = String(error.stdout ?? '');
    const stderr = String(error.stderr ?? '');
    fail(`${file} ${args.join(' ')} failed (stdout=${stdout.slice(-800)}, stderr=${stderr.slice(-800)})`);
  }
}

function readJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} did not emit JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function benchmark(root) {
  return readJson(run(process.execPath, [
    path.join(root, 'bench', 'v5', 'beta-local.mjs'),
    `--iterations=${ITERATIONS}`,
    `--warmup=${WARMUP}`,
  ], root), 'FuryBench');
}

function compare(candidate, baseline) {
  const maxRelativeRegression = 0.25;
  const regressions = [];
  for (const [metric, measurement] of Object.entries(candidate.measurements ?? {})) {
    const prior = baseline.measurements?.[metric];
    if (!prior || typeof prior.p95Ms !== 'number' || prior.p95Ms <= 0) {
      fail(`baseline has no positive p95 for ${metric}`);
    }
    const limitMs = prior.p95Ms * (1 + maxRelativeRegression);
    if (measurement.p95Ms > limitMs) {
      regressions.push({
        metric,
        baselineP95Ms: prior.p95Ms,
        candidateP95Ms: measurement.p95Ms,
        limitMs: Number(limitMs.toFixed(3)),
      });
    }
  }
  return regressions;
}

const temporary = mkdtempSync(path.join(os.tmpdir(), 'furypipe-furybench-baseline-'));
const previousRoot = path.join(temporary, 'previous');
let worktreeAdded = false;
try {
  const resolvedRef = run('git', ['rev-parse', '--verify', `${BASELINE_REF}^{commit}`], ROOT).trim();
  if (!/^[0-9a-f]{40}$/u.test(resolvedRef)) fail(`baseline ref ${BASELINE_REF} did not resolve to a commit`);
  run('git', ['worktree', 'add', '--detach', previousRoot, resolvedRef], ROOT, { capture: false });
  worktreeAdded = true;
  run('pnpm', ['install', '--frozen-lockfile'], previousRoot, { capture: false });
  run('pnpm', ['run', 'build'], previousRoot, { capture: false });

  const baseline = benchmark(previousRoot);
  const candidate = benchmark(ROOT);
  if (baseline.format !== 'furypipe-furybench-beta/v1' || candidate.format !== 'furypipe-furybench-beta/v1') {
    fail('candidate or baseline uses an unexpected FuryBench format');
  }
  const regressions = compare(candidate, baseline);
  const report = {
    format: 'furypipe-final-furybench-comparison/v1',
    status: regressions.length === 0 ? 'PASS' : 'REGRESSION',
    generatedAt: new Date().toISOString(),
    baseline: {
      ref: BASELINE_REF,
      commit: resolvedRef,
      result: baseline,
    },
    candidate: { result: candidate },
    threshold: {
      metric: 'p95Ms',
      maxRelativeRegression: 0.25,
      rule: 'candidate p95 <= baseline p95 * 1.25',
    },
    regressions,
    limitations: [
      'offline process-boundary measurements only',
      'same-runner historical-source baseline, not a provider or production benchmark',
      'browser, Gateway, provider and production latency are not inferred',
    ],
  };
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(path.join(OUTPUT_DIR, 'furybench-baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`);
  writeFileSync(path.join(OUTPUT_DIR, 'furybench-comparison.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (regressions.length > 0) process.exitCode = 1;
} finally {
  if (worktreeAdded) {
    try {
      run('git', ['worktree', 'remove', '--force', previousRoot], ROOT, { capture: false });
    } catch {
      // The temporary path is owned by this harness; leave the precise cleanup
      // failure visible to the caller rather than masking the benchmark result.
      process.stderr.write(`warning: could not remove temporary worktree ${previousRoot}\n`);
    }
  }
  rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
