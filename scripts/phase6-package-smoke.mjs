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
    return execFileAsync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  }
  return execFileAsync(file, args, { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let tarball;
let installDir;
try {
  const packed = await run(npm, ['pack', '--json', '--ignore-scripts', '--quiet'], root);
  const metadata = JSON.parse(packed.stdout)[0];
  assert(metadata?.filename, 'npm pack returned no Phase 6 tarball');
  tarball = path.resolve(root, metadata.filename);
  assert(existsSync(tarball), `npm pack did not create ${tarball}`);
  installDir = await mkdtemp(path.join(os.tmpdir(), 'furypipe-phase6-package-smoke-'));
  await run(npm, ['init', '-y'], installDir);
  await run(npm, ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir);
  const packageRoot = path.join(installDir, 'node_modules', 'furypipe');
  const installedPackage = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const expected = {
    'browser-runtime': ['createManagedBrowserRuntime', 'validateBrowserUrl'],
    'coding-runtime': ['createCodingSandbox', 'createCodingProcessRuntime'],
    'patch-engine': ['createPatchEngine'],
    'codegraph': ['buildCodeGraph'],
    'phase6-verification': ['createVerificationCoordinator'],
    phase6: ['createManagedBrowserRuntime', 'createVerificationCoordinator'],
  };
  for (const [subpath, exports] of Object.entries(expected)) {
    assert(installedPackage.exports?.['./' + subpath], `Phase 6 export is missing from package.json: ${subpath}`);
    const expression = `const m = await import('furypipe/${subpath}'); if (${JSON.stringify(exports)}.some((name) => typeof m[name] !== 'function')) process.exit(1);`;
    const result = await run(process.execPath, ['--input-type=module', '-e', expression], installDir);
    assert(result.stderr === '', `Phase 6 package export wrote stderr: ${subpath}: ${result.stderr}`);
  }
  console.log('phase6 package smoke passed: all public runtime exports load from the packed artifact');
} finally {
  if (installDir) await rm(installDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (tarball) await rm(tarball, { force: true });
}
