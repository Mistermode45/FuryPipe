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
  for (const doc of [
    'docs/PROVIDER_ATTEMPT_ADAPTER.md',
    'docs/CONTEXT_OPTIMIZER_PROFILES.md',
    'docs/PROVIDER_ATTEMPT_PLANNER.md',
    'docs/PROVIDER_ATTEMPT_CONTEXT_RUNTIME.md',
    'docs/PROVIDER_ATTEMPT_RECEIPTS.md',
  ]) {
    assert(packedFiles.has(doc), `${doc} is missing from the public package`);
  }

  tarball = path.resolve(root, metadata.filename);
  assert(existsSync(tarball), 'npm pack did not create the tarball');

  installDir = await mkdtemp(path.join(os.tmpdir(), 'furypipe-provider-attempt-smoke-'));
  await run(npm, ['init', '-y'], installDir);
  await run(npm, ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir);

  const imports = [
    [
      'furypipe/provider-attempt-adapter',
      "typeof m.createProviderAttemptAdapterPlanner === 'function'",
    ],
    [
      'furypipe/context-optimizer-profile',
      "typeof m.createContextOptimizerProfileRegistry === 'function' && typeof m.qualifyContextOptimizerProfile === 'function' && typeof m.digestContextOptimizerProfile === 'function'",
    ],
    [
      'furypipe/provider-attempt-planner',
      "typeof m.createProviderAttemptPlanner === 'function' && typeof m.isGeneratedProviderAttemptPlan === 'function'",
    ],
    [
      'furypipe/provider-attempt-context-runtime',
      "typeof m.prepareProviderAttemptContext === 'function' && typeof m.FuryProviderAttemptContextRuntimeError === 'function'",
    ],
    [
      'furypipe/provider-attempt-receipt',
      "typeof m.createProviderAttemptPlanReceipt === 'function' && typeof m.verifyProviderAttemptPlanReceipt === 'function'",
    ],
  ];

  for (const [specifier, assertion] of imports) {
    const imported = await run(process.execPath, [
      '--input-type=module',
      '-e',
      `const m = await import(${JSON.stringify(specifier)}); if (!(${assertion})) process.exit(1);`,
    ], installDir);
    assert(imported.stderr === '', `${specifier} package export wrote stderr: ${imported.stderr}`);
  }

  console.log('provider attempt package smoke passed');
} finally {
  if (installDir) {
    await rm(installDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
  if (tarball) await rm(tarball, { force: true });
}
