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
    packedFiles.has('docs/GOVERNED_PROVIDER_EXECUTOR.md'),
    'docs/GOVERNED_PROVIDER_EXECUTOR.md is missing from the public package',
  );
  assert(
    packedFiles.has('docs/GOVERNED_PROVIDER_EXECUTION_RECEIPTS.md'),
    'docs/GOVERNED_PROVIDER_EXECUTION_RECEIPTS.md is missing from the public package',
  );
  assert(
    packedFiles.has('docs/PROVIDER_EXECUTION_AUDIT_CHAIN.md'),
    'docs/PROVIDER_EXECUTION_AUDIT_CHAIN.md is missing from the public package',
  );

  tarball = path.resolve(root, metadata.filename);
  assert(existsSync(tarball), 'npm pack did not create the tarball');

  installDir = await mkdtemp(path.join(os.tmpdir(), 'furypipe-governed-provider-smoke-'));
  await run(npm, ['init', '-y'], installDir);
  await run(npm, ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir);

  const imports = [
    [
      'furypipe/provider-request-envelope',
      "typeof m.prepareProviderRequestEnvelope === 'function' && typeof m.isGeneratedProviderRequestEnvelope === 'function'",
    ],
    [
      'furypipe/provider-execution-gate',
      "typeof m.createProviderExecutionGate === 'function' && typeof m.isGeneratedProviderExecutionPermit === 'function'",
    ],
    [
      'furypipe/provider-transport',
      "typeof m.createProviderTransportRegistry === 'function' && typeof m.validateProviderTransportResult === 'function'",
    ],
    [
      'furypipe/governed-provider-executor',
      "typeof m.createGovernedProviderExecutor === 'function'",
    ],
    [
      'furypipe/provider-execution-errors',
      "typeof m.FuryGovernedProviderExecutorError === 'function'",
    ],
    [
      'furypipe/governed-provider-execution-receipt',
      "typeof m.createGovernedProviderExecutionReceipt === 'function' && typeof m.verifyGovernedProviderExecutionReceipt === 'function'",
    ],
    [
      'furypipe/provider-execution-audit-chain',
      "typeof m.createProviderExecutionAuditChain === 'function' && typeof m.verifyProviderExecutionAuditChain === 'function'",
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

  const internalProbe = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "try { await import('furypipe/provider-execution-internal'); process.exit(2); } catch (error) { if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') process.exit(3); }",
  ], installDir);
  assert(internalProbe.stderr === '', `internal package path probe wrote stderr: ${internalProbe.stderr}`);

  console.log('governed provider package smoke passed');
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
