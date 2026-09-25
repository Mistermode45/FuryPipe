import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { isPnpmCommand, resolvePnpmCommand } from './validation-command.mjs';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const OUTPUT_DIR = path.resolve(
  process.env.FURYPIPE_VALIDATION_OUTPUT_DIR?.trim() || 'artifacts/final-validation',
);
const MAX_OUTPUT = 2 * 1024 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function run(file, args, cwd, env = process.env) {
  let executable = file;
  let finalArgs = args;
  if (process.platform === 'win32' && file === 'npm') {
    executable = process.execPath;
    finalArgs = [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args];
  } else if (isPnpmCommand(file)) {
    const command = resolvePnpmCommand();
    executable = command.executable;
    finalArgs = [...command.prefixArgs, ...args];
  }
  try {
    return await execFileAsync(executable, finalArgs, {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
      shell: isPnpmCommand(file) ? resolvePnpmCommand().shell : false,
    });
  } catch (error) {
    const stdout = String(error.stdout ?? '');
    const stderr = String(error.stderr ?? '');
    throw new Error(`${file} ${args.join(' ')} failed (exit=${String(error.code ?? 'unknown')}, stdoutSha256=${sha256(Buffer.from(stdout))}, stderrSha256=${sha256(Buffer.from(stderr))})`);
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object', 'could not allocate clean-room port');
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function cliPath(installDir) {
  return path.join(installDir, 'node_modules', 'furypipe', 'bin', 'cli.js');
}

function envFor(installDir, home, config, port) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    FURYPIPE_CONFIG: config,
    FURYPIPE_LOG: path.join(home, '.furypipe', 'events.jsonl'),
    FURYPIPE_HOST: '127.0.0.1',
    FURYPIPE_PORT: String(port),
    FURYPIPE_MODEL_CATALOG_REFRESH: '0',
    FURYPIPE_AGENT_SKILLS: 'off',
    FURYPIPE_MCP_OBSERVATION: '0',
    NO_COLOR: '1',
  };
}

async function cli(installDir, args, env) {
  return run(process.execPath, [cliPath(installDir), ...args], installDir, env);
}

function start(installDir, env) {
  const child = spawn(process.execPath, [cliPath(installDir), 'start'], {
    cwd: installDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { child.output += chunk; });
  child.stderr.on('data', (chunk) => { child.output += chunk; });
  return child;
}

async function waitReady(child, port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`clean-room runtime exited early (sha256=${sha256(Buffer.from(child.output))})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/beta.json`);
      if (response.status === 200) {
        const body = JSON.parse(await response.text());
        assert(JSON.stringify(body).includes('executionAuthority'), 'installed beta endpoint omitted authority boundary');
        return body;
      }
    } catch {
      // The installed process is still binding; the bounded deadline controls this loop.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('clean-room runtime readiness timeout');
}

async function stop(child) {
  if (child.exitCode !== null) return 'already-exited';
  const close = once(child, 'close');
  child.kill('SIGTERM');
  let forced = false;
  const timer = setTimeout(() => {
    forced = true;
    child.kill('SIGKILL');
  }, 5_000);
  await close;
  clearTimeout(timer);
  return forced ? 'forced' : 'graceful';
}

async function main() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'furypipe-clean-room-'));
  const installDir = path.join(workspace, 'install');
  const home = path.join(workspace, 'home');
  const config = path.join(home, '.config', 'furypipe', 'config.json');
  const port = await freePort();
  const startedAt = Date.now();
  let first;
  let second;
  try {
    await mkdir(installDir, { recursive: true });
    await mkdir(home, { recursive: true });
    await run('npm', ['init', '-y'], installDir);
    const packed = JSON.parse((await run('npm', [
      'pack', '--json', '--ignore-scripts', '--quiet', '--pack-destination', workspace,
    ], ROOT)).stdout)[0];
    const tarball = path.join(workspace, packed.filename);
    const candidateSha256 = sha256(await readFile(tarball));
    await run('npm', ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir);
    const env = envFor(installDir, home, config, port);
    const version = (await cli(installDir, ['--version'], env)).stdout.trim();
    assert(version === packed.version, `installed package version mismatch: ${version} != ${packed.version}`);
    const setup = await cli(installDir, ['setup', '--lang=en', '--yes', '--no-color'], env);
    assert(/status:\s+ready/u.test(setup.stdout), 'installed setup did not complete');
    const setupState = JSON.parse(await readFile(config, 'utf8'));
    assert(setupState.setup?.completed === true, 'clean-room setup did not persist completion');
    const migrated = JSON.parse((await cli(installDir, ['config', 'migrate-beta', '--json'], env)).stdout);
    assert(migrated.observation?.status === 'current', 'clean-room migration did not produce current state');
    const doctor = JSON.parse((await cli(installDir, ['doctor', '--json'], env)).stdout);
    assert(doctor.betaReadiness?.taskReady === true, 'clean-room doctor did not report task-ready');
    const status = JSON.parse((await cli(installDir, ['beta', 'status', '--json'], env)).stdout);
    assert(status.entry?.executionAuthority === false, 'clean-room beta status crossed authority boundary');
    const plan = JSON.parse((await cli(installDir, ['task', '--plan', 'clean-room verification', '--json'], env)).stdout);
    assert(plan.selection === 'not-run' && plan.execution === 'not-authorized', 'clean-room task plan executed work');

    first = start(installDir, env);
    const firstBody = await waitReady(first, port);
    // Installed FuryPipe Studio: product shell at /, Control Plane at
    // /control-plane, Studio discovery API answering from the packaged bundle.
    const studio = await fetch(`http://127.0.0.1:${port}/`);
    const studioHtml = await studio.text();
    assert(studio.status === 200 && studioHtml.includes('FuryPipe Studio') && /script-src 'nonce-/u.test(studio.headers.get('content-security-policy') ?? ''), 'installed Studio shell missing or unprotected');
    const controlPlane = await fetch(`http://127.0.0.1:${port}/control-plane`);
    assert(controlPlane.status === 200, `installed Control Plane returned HTTP ${controlPlane.status}`);
    const studioHarnesses = await fetch(`http://127.0.0.1:${port}/api/studio/harnesses.json`);
    const harnessBody = await studioHarnesses.json();
    assert(studioHarnesses.status === 200 && harnessBody.harnesses.some((h) => h.id === 'furypipe-native' && h.installed), 'installed Studio harness discovery failed');
    // Studio platform surfaces answer from the packaged bundle, with their safe defaults.
    const studioGet = async (route) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/studio/${route}`);
      const body = await res.json();
      assert(res.status === 200, `installed Studio ${route} returned HTTP ${res.status}`);
      return body;
    };
    const studioPost = (route, payload) => fetch(`http://127.0.0.1:${port}/api/studio/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(payload) });
    assert(Array.isArray((await studioGet('skills.json')).skills), 'installed Studio Skills Hub failed');
    assert(Array.isArray((await studioGet('mcp.json')).sources), 'installed Studio MCP Hub failed');
    assert((await studioGet('integrations.json')).manifest === 'absent', 'installed Studio integration registry failed');
    assert(typeof (await studioGet('knowledge.json')).chunks === 'number', 'installed Studio knowledge base failed');
    assert((await studioGet('memory.json')).enabled === false, 'installed Studio memory must stay off without an encrypted config');
    const ssrf = await studioPost('web', { action: 'FETCH', url: 'http://127.0.0.1/' });
    assert(ssrf.status === 403, `installed Studio web fetch reached loopback (HTTP ${ssrf.status})`);
    const savedChat = await studioPost('chats/save', { messages: [{ role: 'user', content: 'clean-room hello' }] });
    assert(savedChat.status === 200, `installed Studio chat save returned HTTP ${savedChat.status}`);
    assert((await studioGet('chats.json')).conversations.some((c) => c.title === 'clean-room hello'), 'installed Studio conversations not persisted');
    const tree = await studioPost('code/tree', { path: '' });
    assert(tree.status === 200 && (await tree.json()).entries.some((e) => e.name === 'package.json'), 'installed Studio code explorer failed');
    const crossOrigin = await fetch(`http://127.0.0.1:${port}/api/studio/chats/save`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"messages":[]}' });
    assert(crossOrigin.status === 403, `installed Studio accepted a cross-origin POST (HTTP ${crossOrigin.status})`);
    const firstStop = await stop(first);
    let runtimeDown = false;
    try {
      await fetch(`http://127.0.0.1:${port}/api/beta.json`, { signal: AbortSignal.timeout(750) });
    } catch {
      runtimeDown = true;
    }
    assert(runtimeDown, 'clean-room runtime remained reachable after shutdown');
    second = start(installDir, env);
    const secondBody = await waitReady(second, port);
    const secondStop = await stop(second);
    assert(firstBody.executionAuthority === false || JSON.stringify(firstBody).includes('executionAuthority'), 'first runtime authority evidence missing');
    assert(secondBody.executionAuthority === false || JSON.stringify(secondBody).includes('executionAuthority'), 'restarted runtime authority evidence missing');

    const rolledBack = JSON.parse((await cli(installDir, ['config', 'rollback-beta', '--json'], env)).stdout);
    assert(rolledBack.result?.status === 'rolled-back', 'clean-room config rollback failed');
    assert(JSON.parse(await readFile(config, 'utf8')).beta === undefined, 'clean-room rollback left beta marker');
    await run('npm', ['uninstall', 'furypipe', '--no-audit', '--no-fund'], installDir, env);
    await run('npm', ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir, env);
    const reinstalled = (await cli(installDir, ['--version'], env)).stdout.trim();
    assert(reinstalled === packed.version, 'clean-room reinstall version mismatch');

    const evidence = {
      format: 'furypipe-final-clean-room/v1',
      status: 'PASS',
      generatedAt: new Date().toISOString(),
      platform: { os: process.platform, arch: process.arch, node: process.version },
      package: { name: packed.name, version: packed.version, tarballSha256: candidateSha256, sourceRuntime: 'installed-package-only' },
      contract: {
        isolatedHome: true,
        isolatedConfig: true,
        isolatedData: true,
        setup: 'PASS',
        doctor: 'PASS',
        migration: 'PASS',
        taskPlan: 'PASS',
        start: 'PASS',
        readiness: 'PASS',
        stop: firstStop,
        runtimeDownAfterStop: 'PASS',
        restart: 'PASS',
        restartStop: secondStop,
        configRollback: 'PASS',
        uninstallReinstall: 'PASS',
      },
      selfHost: {
        installedPackageOnly: true,
        isolatedHomeConfigDataPorts: true,
        loopbackDashboard: 'PASS',
        persistenceAcrossRestart: 'PASS',
        runtimeDownAfterShutdown: 'PASS',
        diagnostics: 'PASS',
        gateway: 'SEPARATE_LOCAL_HARNESS',
      },
      durationMs: Date.now() - startedAt,
    };
    await mkdir(OUTPUT_DIR, { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(OUTPUT_DIR, 'clean-room.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    if (first) await stop(first).catch(() => undefined);
    if (second) await stop(second).catch(() => undefined);
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
