import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmCli = process.platform === 'win32'
  ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  : undefined;

async function run(file, args, cwd) {
  if (process.platform === 'win32' && file.endsWith('.cmd')) {
    if (!npmCli || !existsSync(npmCli)) throw new Error('bundled npm CLI not found');
    return execFileAsync(process.execPath, [npmCli, ...args], {
      cwd,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      shell: false,
    });
  }
  return execFileAsync(file, args, {
    cwd,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let tarball;
let installDir;
try {
  const packed = await run(npm, ['pack', '--json', '--ignore-scripts', '--quiet'], root);
  const metadata = JSON.parse(packed.stdout)[0];
  assert(metadata?.filename, 'npm pack returned no tarball');
  const packedFiles = new Set((metadata.files ?? []).map((entry) => entry.path));
  assert(
    packedFiles.has('docs/BENCHMARK_CLAIM_GATE.md'),
    'Benchmark Claim Gate documentation is missing from the public package',
  );

  tarball = path.resolve(root, metadata.filename);
  assert(existsSync(tarball), 'npm pack did not create the tarball');

  installDir = await mkdtemp(path.join(os.tmpdir(), 'furypipe-benchmark-claim-smoke-'));
  await run(npm, ['init', '-y'], installDir);
  await run(npm, ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir);

  const imported = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/benchmark-claim-gate'); if (typeof m.validateBenchmarkSuiteEvidence !== 'function' || typeof m.assessBenchmarkAntiRegression !== 'function' || typeof m.evaluateBenchmarkClaim !== 'function' || !Array.isArray(m.FURY_BENCHMARK_METRICS)) process.exit(1);",
  ], installDir);
  assert(imported.stderr === '', 'Benchmark Claim Gate package export wrote stderr');

  console.log('benchmark claim package smoke passed');
} finally {
  if (installDir) await rm(installDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (tarball) await rm(tarball, { force: true });
}
