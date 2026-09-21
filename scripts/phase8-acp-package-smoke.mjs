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
    installedPackage.exports?.['./acp-permission-bridge-node'],
    'ACP permission bridge export is missing from package.json',
  );
  assert(
    installedPackage.exports?.['./acp-client-capability-runtime-node'],
    'ACP client capability runtime export is missing from package.json',
  );
  assert(
    installedPackage.exports?.['./acp-external-client-runtime-node'],
    'ACP external client runtime export is missing from package.json',
  );
  assert(
    installedPackage.exports?.['./acp-delegation-runtime-node'],
    'ACP delegation runtime export is missing from package.json',
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
      "const acp = await import('@agentclientprotocol/sdk');",
      "const server = m.createFuryAcpV1Server({ promptHandler: async (context) => { await context.emitText('packed ACP response'); return { stopReason: 'end_turn' }; } });",
      "const packedProof = await acp.client({ name: 'furypipe-packed-acp-smoke' }).connectWith(server.app, async (agent) => { const initialized = await agent.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} }); if (!initialized.agentCapabilities?.sessionCapabilities?.additionalDirectories) process.exit(1); const session = await agent.request(acp.methods.agent.session.new, { cwd: process.cwd(), additionalDirectories: [process.cwd()], mcpServers: [] }); const response = await agent.request(acp.methods.agent.session.prompt, { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'package smoke' }] }); return response.stopReason; });",
      "if (packedProof !== 'end_turn') process.exit(1);",
      "const b = await import('furypipe/acp-gateway-session-bridge-node');",
      "if (typeof b.createFuryAcpGatewaySessionBridge !== 'function') process.exit(1);",
      "const p = await import('furypipe/acp-v1-update-projection-node');",
      "if (p.FURY_ACP_V1_DISPLAY_UPDATE_FORMAT !== 'furypipe-acp-v1-display-update/v1') process.exit(1);",
      "if (typeof p.projectFuryAcpV1DisplayUpdate !== 'function') process.exit(1);",
      "const g = await import('furypipe/acp-permission-bridge-node');",
      "if (g.FURY_ACP_PERMISSION_PERMIT_FORMAT !== 'furypipe-acp-permission-permit/v1') process.exit(1);",
      "if (typeof g.createFuryAcpPermissionBridge !== 'function') process.exit(1);",
      "if (typeof g.isGeneratedFuryAcpPermissionPermit !== 'function') process.exit(1);",
      "const c = await import('furypipe/acp-client-capability-runtime-node');",
      "if (c.FURY_ACP_CLIENT_OPERATION_PLAN_FORMAT !== 'furypipe-acp-client-operation-plan/v1') process.exit(1);",
      "if (typeof c.createFuryAcpClientCapabilityRuntime !== 'function') process.exit(1);",
      "const e = await import('furypipe/acp-external-client-runtime-node');",
      "if (e.FURY_ACP_EXTERNAL_AGENT_REGISTRY_FORMAT !== 'furypipe-acp-external-agent-registry/v1') process.exit(1);",
      "if (e.FURY_ACP_EXTERNAL_SESSION_FORMAT !== 'furypipe-acp-external-session/v1') process.exit(1);",
      "if (typeof e.createFuryAcpExternalAgentRegistry !== 'function') process.exit(1);",
      "if (typeof e.createFuryAcpExternalClientRuntime !== 'function') process.exit(1);",
      "const d = await import('furypipe/acp-delegation-runtime-node');",
      "if (d.FURY_ACP_DELEGATION_PERMIT_FORMAT !== 'furypipe-acp-delegation-permit/v1') process.exit(1);",
      "if (d.FURY_ACP_DELEGATION_RECEIPT_FORMAT !== 'furypipe-acp-delegation-receipt/v1') process.exit(1);",
      "if (typeof d.prepareFuryAcpDelegationRequest !== 'function') process.exit(1);",
      "if (typeof d.createFuryAcpDelegationGate !== 'function') process.exit(1);",
      "if (typeof d.createFuryAcpDelegationRuntime !== 'function') process.exit(1);",
    ].join(' '),
  ], installDir);
  assert(result.stderr === '', `ACP v1 package export wrote stderr: ${result.stderr}`);
  console.log('phase8 ACP package smoke passed: packed ACP lifecycle, server, Gateway bridge, display projection, permission bridge, governed client capabilities, external client foundation and governed delegation runtime load with exact SDK dependency');
} finally {
  if (installDir) await rm(installDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (tarball) await rm(tarball, { force: true });
}
