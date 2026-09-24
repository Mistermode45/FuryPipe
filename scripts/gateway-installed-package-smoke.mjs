import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const MAX_OUTPUT = 4 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;
const GATEWAY_STOP_TIMEOUT_MS = 10_000;
const DYNAMIC_REQUIRE_ERROR = 'Dynamic require of "child_process" is not supported';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  return createHash('sha256').update(bytes).digest('hex');
}

function npmInvocation(args) {
  if (process.platform !== 'win32') return { file: 'npm', args };
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  assert(existsSync(npmCli), `bundled npm CLI not found: ${npmCli}`);
  return { file: process.execPath, args: [npmCli, ...args] };
}

async function run(file, args, cwd, env = process.env) {
  try {
    const result = await execFileAsync(file, args, {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT,
      timeout: COMMAND_TIMEOUT_MS,
      killSignal: 'SIGTERM',
      windowsHide: true,
      shell: false,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const stdout = String(error.stdout ?? '');
    const stderr = String(error.stderr ?? '');
    const detail = `${file} ${args.join(' ')} failed (exit=${String(error.code ?? 'unknown')}, signal=${String(error.signal ?? 'none')}, timedOut=${String(error.killed === true)}, timeoutMs=${COMMAND_TIMEOUT_MS}, stdoutSha256=${sha256(stdout)}, stderrSha256=${sha256(stderr)}, stderrTail=${stderr.slice(-2_000)})`;
    throw new Error(detail);
  }
}

async function runNpm(args, cwd, env = process.env) {
  const invocation = npmInvocation(args);
  return run(invocation.file, invocation.args, cwd, env);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object', 'ephemeral Gateway port allocation failed');
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function installedRoot(installDir) {
  return path.join(installDir, 'node_modules', 'furypipe');
}

function installedCli(installDir) {
  return path.join(installedRoot(installDir), 'bin', 'cli.js');
}

function acceptanceEnv(installDir, configFile, port) {
  const env = {
    ...process.env,
    FURYPIPE_CONFIG: configFile,
    FURYPIPE_LOG: path.join(installDir, 'events.jsonl'),
    FURYPIPE_GATEWAY_HOST: '127.0.0.1',
    FURYPIPE_GATEWAY_PORT: String(port),
    FURYPIPE_MODEL_CATALOG_REFRESH: '0',
    FURYPIPE_AGENT_SKILLS: 'off',
    FURYPIPE_MCP_OBSERVATION: '0',
    NO_COLOR: '1',
  };
  for (const name of [
    'FURYPIPE_WEBCHAT_PROVIDER',
    'FURYPIPE_WEBCHAT_MODEL',
    'FURYPIPE_WEBCHAT_MCP_CONFIG',
    'FURYPIPE_WEBCHAT_MEMORY_CONFIG',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
  ]) {
    delete env[name];
  }
  return env;
}

function startInstalled(installDir, args, env) {
  const child = spawn(process.execPath, [installedCli(installDir), ...args], {
    cwd: installDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdoutText = () => stdout;
  child.stderrText = () => stderr;
  child.output = () => `${stdout}${stderr}`;
  return child;
}

async function stop(child) {
  if (child.exitCode !== null) return child.exitCode;
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  const forceTimer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 5_000);
  let deadlineTimer;
  const stopDeadline = new Promise((_, reject) => {
    deadlineTimer = setTimeout(() => reject(new Error(`Gateway child did not stop within ${GATEWAY_STOP_TIMEOUT_MS} ms`)), GATEWAY_STOP_TIMEOUT_MS);
  });
  try {
    await Promise.race([closed, stopDeadline]);
    return child.exitCode;
  } finally {
    clearTimeout(forceTimer);
    clearTimeout(deadlineTimer);
  }
}

async function waitForGatewayReady(child) {
  const deadline = Date.now() + 15_000;
  let parsed;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`installed Gateway exited before ready (code=${child.exitCode}, outputSha256=${sha256(child.output())}, output=${child.output().slice(-2_000)})`);
    }
    const text = child.stdoutText().trim();
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // The bounded deadline below handles incomplete startup output.
      }
      if (parsed?.status === 'ready') break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(parsed?.format === 'furypipe-gateway-local-start/v1', 'installed Gateway did not emit its start envelope');
  assert(parsed.status === 'ready', 'installed Gateway did not reach ready state');
  assert(parsed.executionAuthority === false, 'installed Gateway start envelope crossed execution authority');
  assert(typeof parsed.webChatUrl === 'string' && parsed.webChatUrl.startsWith('http://127.0.0.1:'), 'installed Gateway emitted no loopback WebChat URL');
  assert(child.exitCode === null, 'installed Gateway exited after reporting ready');
  assert(!child.output().includes(DYNAMIC_REQUIRE_ERROR), 'installed Gateway emitted the dynamic child_process require failure');

  const response = await fetch(parsed.webChatUrl);
  const body = await response.text();
  assert(response.status === 200, `installed Gateway WebChat endpoint returned HTTP ${response.status}`);
  assert(/FuryPipe|WebChat/u.test(body), 'installed Gateway WebChat endpoint returned no recognizable surface');
  return parsed;
}

function fixtureSource() {
  return `import { writeFileSync } from 'node:fs';
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

const marker = process.argv[2];
const server = new McpServer({ name: 'furypipe-installed-stdio-fixture', version: '1.0.0' });
server.registerTool('installed-stdio-echo', {
  description: 'Local installed-package MCP stdio regression fixture.',
  inputSchema: fromJsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
}, async () => ({ content: [{ type: 'text', text: 'fixture' }] }));

const handle = serveStdio(() => server);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try { await handle.close(); } finally { process.exit(0); }
}
process.stdin.once('end', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
process.once('exit', () => { if (marker) { try { writeFileSync(marker, 'closed', 'utf8'); } catch {} } });
`;
}

function clientDriverSource() {
  return `import {
  deriveMcpDirectEndpointFingerprint,
  probeMcpDirectInventory,
} from 'furypipe/mcp-direct-client-node';

const fixture = process.env.FURYPIPE_MCP_FIXTURE;
if (!fixture) throw new Error('FURYPIPE_MCP_FIXTURE is required');
const provisional = {
  source: {
    sourceId: 'installed-package-stdio-fixture',
    transport: 'stdio',
    endpointFingerprint: '0'.repeat(64),
    trust: 'trusted',
  },
  command: process.execPath,
  args: [fixture, process.env.FURYPIPE_MCP_MARKER],
};
const config = {
  ...provisional,
  source: {
    ...provisional.source,
    endpointFingerprint: deriveMcpDirectEndpointFingerprint(provisional),
  },
};
const evidence = await probeMcpDirectInventory(config, {
  clientInfo: { name: 'furypipe-installed-package-regression', version: '1.0.0' },
  connectTimeoutMs: 10_000,
  listTimeoutMs: 10_000,
  probeTimeoutMs: 2_000,
});
if (evidence.toolCount !== 1) throw new Error('installed MCP stdio fixture did not return exactly one tool');
if (evidence.lifecycle.connected !== true || evidence.lifecycle.listed !== true) throw new Error('installed MCP stdio lifecycle did not reach connected/listed');
if (evidence.lifecycle.healthEvidence !== 'list_tools_success') throw new Error('installed MCP stdio did not prove tools/list success');
console.log(JSON.stringify({ status: 'PASS', transport: 'stdio', toolCount: evidence.toolCount, protocolVersion: evidence.protocolVersion }));
`;
}

async function main() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'furypipe-gateway-installed-'));
  const installDir = path.join(workspace, 'install');
  const configFile = path.join(workspace, 'config.json');
  const markerFile = path.join(workspace, 'stdio-closed.marker');
  let gateway;
  try {
    await mkdir(installDir, { recursive: true });
    await runNpm(['init', '-y'], installDir);
    const packedResult = await runNpm([
      'pack', '--json', '--ignore-scripts', '--quiet', '--pack-destination', workspace,
    ], ROOT);
    const packed = JSON.parse(packedResult.stdout)[0];
    assert(packed?.filename && packed.version === '0.16.0', 'npm pack did not produce the 0.16.0 candidate');
    const tarball = path.join(workspace, packed.filename);
    const tarballBytes = await readFile(tarball);
    const tarballSha256 = sha256(tarballBytes);
    await runNpm(['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir);

    const productionTree = await runNpm(['ls', '--omit=dev', '--depth=1'], installDir);
    const productionTreeText = `${productionTree.stdout}${productionTree.stderr}`;
    assert(productionTreeText.includes('@modelcontextprotocol/client'), `installed production tree omitted @modelcontextprotocol/client: ${productionTreeText}`);
    assert(productionTreeText.includes('@modelcontextprotocol/server'), `installed production tree omitted @modelcontextprotocol/server: ${productionTreeText}`);

    const installedBundle = await readFile(path.join(installedRoot(installDir), 'dist', 'node.js'), 'utf8');
    assert(!installedBundle.includes('node_modules/.pnpm/cross-spawn@'), 'installed CLI still embeds the cross-spawn CommonJS module');

    const env = acceptanceEnv(installDir, configFile, await freePort());
    const version = await run(process.execPath, [installedCli(installDir), '--version'], installDir, env);
    assert(version.stdout.trim() === '0.16.0', `installed CLI version mismatch: ${version.stdout}`);
    const setup = await run(process.execPath, [installedCli(installDir), 'setup', '--lang=fr', '--yes', '--no-color'], installDir, env);
    assert(/status:\s+ready/u.test(setup.stdout), 'installed package setup did not reach ready');

    gateway = startInstalled(installDir, ['gateway', 'start', '--json'], env);
    const startEnvelope = await waitForGatewayReady(gateway);
    assert(gateway.exitCode === null, 'installed Gateway did not remain alive after readiness');
    await stop(gateway);
    gateway = undefined;

    const fixturePath = path.join(installDir, 'mcp-installed-stdio-fixture.mjs');
    const driverPath = path.join(installDir, 'mcp-installed-client-driver.mjs');
    await writeFile(fixturePath, fixtureSource(), 'utf8');
    await writeFile(driverPath, clientDriverSource(), 'utf8');
    const mcpEnv = {
      ...env,
      FURYPIPE_MCP_FIXTURE: fixturePath,
      FURYPIPE_MCP_MARKER: markerFile,
    };
    const mcp = await run(process.execPath, [driverPath], installDir, mcpEnv);
    assert(!mcp.stdout.includes(DYNAMIC_REQUIRE_ERROR) && !mcp.stderr.includes(DYNAMIC_REQUIRE_ERROR), 'installed MCP stdio emitted the dynamic child_process require failure');
    const mcpResult = JSON.parse(mcp.stdout.trim());
    assert(mcpResult.status === 'PASS' && mcpResult.transport === 'stdio' && mcpResult.toolCount === 1, 'installed MCP stdio regression did not pass');
    const markerDeadline = Date.now() + 3_000;
    while (!existsSync(markerFile) && Date.now() < markerDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(existsSync(markerFile), 'installed MCP stdio child did not close after probe');

    const evidence = {
      format: 'furypipe-installed-gateway-mcp-smoke/v1',
      status: 'PASS',
      platform: { os: process.platform, arch: process.arch, node: process.version },
      package: { name: packed.name, version: packed.version, tarballSha256 },
      gateway: {
        installedBin: 'bin/cli.js',
        ready: true,
        processAliveAfterReady: true,
        loopbackEndpoint: 'PASS',
        cleanShutdown: true,
        dynamicRequireError: 0,
        startEnvelope: {
          format: startEnvelope.format,
          status: startEnvelope.status,
          executionAuthority: startEnvelope.executionAuthority,
        },
      },
      mcpStdio: {
        installedPublicExport: 'furypipe/mcp-direct-client-node',
        fixtureProcess: 'local-child-process',
        connect: 'PASS',
        toolsList: 'PASS',
        shutdown: 'PASS',
        dynamicRequireError: 0,
      },
    };
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    if (gateway) await stop(gateway).catch(() => undefined);
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
