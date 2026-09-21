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
  assert(metadata?.filename, 'npm pack returned no Phase 8 tarball');
  const packedFiles = new Set((metadata.files ?? []).map((entry) => entry.path));
  assert(
    packedFiles.has('docs/FURYPIPE_VNEXT_PHASE8_ACP_INTEROPERABILITY_2026.md'),
    'Phase 8 documentation is missing from the package',
  );
  tarball = path.resolve(root, metadata.filename);
  assert(existsSync(tarball), `npm pack did not create ${tarball}`);

  installDir = await mkdtemp(path.join(os.tmpdir(), 'furypipe-phase8-acp-package-smoke-'));
  await run(npm, ['init', '-y'], installDir);
  await run(npm, ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir);

  const packageRoot = path.join(installDir, 'node_modules', 'furypipe');
  const installedPackage = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  assert(installedPackage.exports?.['./acp-v1-server-node'], 'ACP v1 server export is missing from package.json');
  assert(
    installedPackage.exports?.['./acp-gateway-session-bridge-node'],
    'ACP Gateway session bridge export is missing from package.json',
  );
  assert(
    installedPackage.exports?.['./acp-v1-update-projection-node'],
    'ACP display projection export is missing from package.json',
  );
  assert(
    installedPackage.dependencies?.['@agentclientprotocol/sdk'] === '1.4.0',
    'ACP SDK is not exact-pinned to 1.4.0',
  );

  const result = await run(process.execPath, [
    '--input-type=module',
    '-e',
    [
      "const m = await import('furypipe/acp-v1-server-node');",
      "if (m.FURY_ACP_V1_PROTOCOL_VERSION !== 1) process.exit(1);",
      "if (m.FURY_ACP_V1_SERVER_FORMAT !== 'furypipe-acp-v1-server/v1') process.exit(1);",
      "if (typeof m.createFuryAcpV1Server !== 'function') process.exit(1);",
      "if (typeof m.connectFuryAcpV1Stdio !== 'function') process.exit(1);",
      "const b = await import('furypipe/acp-gateway-session-bridge-node');",
      "if (typeof b.createFuryAcpGatewaySessionBridge !== 'function') process.exit(1);",
      "const p = await import('furypipe/acp-v1-update-projection-node');",
      "if (p.FURY_ACP_V1_DISPLAY_UPDATE_FORMAT !== 'furypipe-acp-v1-display-update/v1') process.exit(1);",
      "if (typeof p.projectFuryAcpV1DisplayUpdate !== 'function') process.exit(1);",
    ].join(' '),
  ], installDir);
  assert(result.stderr === '', `ACP v1 package export wrote stderr: ${result.stderr}`);
  console.log('phase8 ACP package smoke passed: server, Gateway bridge and display projection exports load with exact SDK dependency');
} finally {
  if (installDir) await rm(installDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (tarball) await rm(tarball, { force: true });
}
