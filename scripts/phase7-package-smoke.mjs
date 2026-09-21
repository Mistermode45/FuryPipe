import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmCli = process.platform === 'win32'
  ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  : undefined;

async function run(file, args, cwd) {
  if (process.platform === 'win32' && file.endsWith('.cmd')) {
    if (!npmCli || !existsSync(npmCli)) throw new Error(`bundled npm CLI not found: ${npmCli ?? '<none>'}`);
    return execFileAsync(process.execPath, [npmCli, ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      shell: false,
    });
  }
  return execFileAsync(file, args, {
    cwd,
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
  assert(metadata?.filename, 'npm pack returned no Phase 7 tarball');
  const packedFiles = new Set((metadata.files ?? []).map((entry) => entry.path));
  assert(packedFiles.has('docs/FURYPIPE_VNEXT_PHASE7_MEMORY_VNEXT_2026.md'), 'Phase 7 documentation is missing from the package');
  tarball = path.resolve(root, metadata.filename);
  assert(existsSync(tarball), `npm pack did not create ${tarball}`);
  installDir = await mkdtemp(path.join(os.tmpdir(), 'furypipe-phase7-package-smoke-'));
  await run(npm, ['init', '-y'], installDir);
  await run(npm, ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir);
  const packageRoot = path.join(installDir, 'node_modules', 'furypipe');
  const installedPackage = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  assert(installedPackage.exports?.['./memory-vnext'], 'Memory VNext export is missing from package.json');
  const result = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/memory-vnext'); if (typeof m.createMemoryVNextStore !== 'function' || m.MEMORY_VNEXT_FORMAT !== 'furypipe-memory-vnext/v1') process.exit(1);",
  ], installDir);
  assert(result.stderr === '', `Memory VNext package export wrote stderr: ${result.stderr}`);
  console.log('phase7 package smoke passed: Memory VNext export and documentation load from the packed artifact');
} finally {
  if (installDir) await rm(installDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (tarball) await rm(tarball, { force: true });
}
