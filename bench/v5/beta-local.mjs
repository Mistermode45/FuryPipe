#!/usr/bin/env node

/**
 * Bounded offline FuryBench envelope for the Phase 10 beta entry surface.
 *
 * This measures installed-artifact-like Node process boundaries only:
 * startup/version, doctor readiness, task planning and beta status. It does
 * not call a provider, execute a capability or prove browser/server
 * performance. A baseline comparison is explicit and uses p95 wall time.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const root = path.resolve(import.meta.dirname, '../..');
const entry = path.join(root, 'dist', 'node.js');
const MAX_ITERATIONS = 25;
const MAX_WARMUP = 5;

function fail(message) {
  throw new Error(`[furypipe beta benchmark] ${message}`);
}

function parseArgs(argv) {
  let iterations = 5;
  let warmup = 1;
  let baseline;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--iterations') {
      iterations = Number(argv[++index]);
    } else if (arg?.startsWith('--iterations=')) {
      iterations = Number(arg.slice('--iterations='.length));
    } else if (arg === '--warmup') {
      warmup = Number(argv[++index]);
    } else if (arg?.startsWith('--warmup=')) {
      warmup = Number(arg.slice('--warmup='.length));
    } else if (arg === '--baseline') {
      baseline = argv[++index];
    } else if (arg?.startsWith('--baseline=')) {
      baseline = arg.slice('--baseline='.length);
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node bench/v5/beta-local.mjs [--iterations=5] [--warmup=1] [--baseline=baseline.json]');
      process.exit(0);
    } else if (arg !== '--json') {
      fail(`unknown option: ${arg}`);
    }
  }
  if (!Number.isSafeInteger(iterations) || iterations < 3 || iterations > MAX_ITERATIONS) {
    fail(`iterations must be an integer from 3 to ${MAX_ITERATIONS}`);
  }
  if (!Number.isSafeInteger(warmup) || warmup < 0 || warmup > MAX_WARMUP) {
    fail(`warmup must be an integer from 0 to ${MAX_WARMUP}`);
  }
  return { iterations, warmup, baseline };
}

function sourceCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function workingTreeDirty() {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
  } catch {
    return true;
  }
}

function cleanEnvironment(configFile) {
  const env = { ...process.env, FURYPIPE_CONFIG: configFile, FURYPIPE_MODELS: 'fixture-model' };
  for (const key of [
    'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN_FILE',
    'OPENAI_API_KEY', 'CLOUDFLARE_API_TOKEN', 'OMNIROUTE_API_KEY',
    'FURYPIPE_UPSTREAM', 'FURYPIPE_GATEWAY_BASE_URL', 'FURYPIPE_PROVIDER',
    'FURYPIPE_MCP_CONFIG', 'FURYPIPE_WEBCHAT_MCP_CONFIG',
  ]) delete env[key];
  return env;
}

function runCommand(args, cwd, env) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, [entry, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`command timed out: ${args.join(' ')}`));
    }, 10_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr,
        durationMs: performance.now() - started,
      });
    });
  });
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function summarize(values) {
  return Object.freeze({
    samples: values.length,
    minMs: Number(Math.min(...values).toFixed(3)),
    medianMs: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  });
}

async function measure(name, args, iterations, env, validate) {
  const values = [];
  for (let index = 0; index < iterations; index += 1) {
    const result = await runCommand(args, root, env);
    if (result.code !== 0) {
      fail(`${name} exited ${result.code}: ${result.stderr || result.stdout}`);
    }
    validate(result.stdout);
    values.push(result.durationMs);
  }
  return summarize(values);
}

function compare(candidate, baseline, maxRelativeRegression) {
  const regressions = [];
  for (const [name, measurement] of Object.entries(candidate)) {
    const prior = baseline?.measurements?.[name];
    if (!prior || typeof prior.p95Ms !== 'number' || prior.p95Ms <= 0) continue;
    const limitMs = prior.p95Ms * (1 + maxRelativeRegression);
    if (measurement.p95Ms > limitMs) {
      regressions.push({ metric: name, candidateP95Ms: measurement.p95Ms, baselineP95Ms: prior.p95Ms, limitMs: Number(limitMs.toFixed(3)) });
    }
  }
  return regressions;
}

const { iterations, warmup, baseline: baselinePath } = parseArgs(process.argv.slice(2));
if (!existsSync(entry)) fail('dist/node.js is missing; run pnpm run build first');
const commit = sourceCommit();
if (!commit || !/^[0-9a-f]{40}$/u.test(commit)) fail('could not bind the benchmark to a Git HEAD');

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'furypipe-beta-bench-'));
const configFile = path.join(tempDir, 'config.json');
writeFileSync(configFile, `${JSON.stringify({ models: ['fixture-model'], benchmark: 'offline-beta' })}\n`, { mode: 0o600 });
const env = cleanEnvironment(configFile);
const commands = {
  startup: {
    args: ['--version'],
    validate: (stdout) => { if (!/^\d+\.\d+\.\d+\s*$/u.test(stdout)) fail('startup did not emit a version'); },
  },
  doctor: {
    args: ['doctor', '--json'],
    validate: (stdout) => {
      const value = JSON.parse(stdout);
      if (value?.betaReadiness?.authority !== 'readiness-observation-only'
        || value?.betaReadiness?.executionAuthority !== false) {
        fail('doctor readiness exposed authority');
      }
    },
  },
  taskPlan: {
    args: ['task', '--plan', '--task-first', 'offline beta benchmark objective', '--json'],
    validate: (stdout) => {
      const value = JSON.parse(stdout);
      if (value.selection !== 'not-run' || value.execution !== 'not-authorized' || value.authority !== 'planning-only') {
        fail('task plan was not planning-only');
      }
      if (Object.prototype.hasOwnProperty.call(value, 'objective')) fail('task plan leaked objective text');
    },
  },
  betaStatus: {
    args: ['beta', 'status', '--json'],
    validate: (stdout) => {
      const value = JSON.parse(stdout);
      if (value.entry?.executionAuthority !== false || value.entry?.grantAuthority !== false) {
        fail('beta status exposed authority');
      }
    },
  },
};

try {
  for (let index = 0; index < warmup; index += 1) {
    for (const command of Object.values(commands)) {
      const result = await runCommand(command.args, root, env);
      if (result.code !== 0) fail(`warmup command failed: ${command.args.join(' ')}`);
    }
  }
  const measurements = {};
  for (const [name, command] of Object.entries(commands)) {
    measurements[name] = await measure(name, command.args, iterations, env, command.validate);
  }
  let baseline;
  let regressions = [];
  const maxRelativeRegression = 0.25;
  if (baselinePath) {
    try {
      baseline = JSON.parse(readFileSync(path.resolve(baselinePath), 'utf8'));
    } catch (error) {
      fail(`could not read baseline: ${error instanceof Error ? error.message : 'invalid file'}`);
    }
    if (baseline?.format !== 'furypipe-furybench-beta/v1') fail('baseline format is not Phase 10 beta FuryBench');
    regressions = compare(measurements, baseline, maxRelativeRegression);
  }
  const output = {
    format: 'furypipe-furybench-beta/v1',
    status: baselinePath ? (regressions.length === 0 ? 'PASS' : 'REGRESSION') : 'BASELINE_CAPTURED',
    source: { repository: 'Mistermode45/FuryPipe', commit, workingTreeDirty: workingTreeDirty() },
    runtime: { node: process.versions.node, platform: process.platform, arch: process.arch },
    parameters: { iterations, warmup, commands: Object.fromEntries(Object.entries(commands).map(([name, command]) => [name, command.args])) },
    thresholds: {
      metric: 'p95Ms',
      maxRelativeRegression: 0.25,
      comparison: baselinePath ? 'candidate p95 <= baseline p95 * 1.25' : 'not evaluated without --baseline',
    },
    measurements,
    comparison: { baseline: baselinePath ? path.resolve(baselinePath) : null, regressions },
    limitations: [
      'offline process-boundary measurements only',
      'provider execution and provider latency are not executed',
      'browser, Gateway restart, multi-platform and production validation are not inferred',
    ],
  };
  console.log(JSON.stringify(output, null, 2));
  if (regressions.length > 0) process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
