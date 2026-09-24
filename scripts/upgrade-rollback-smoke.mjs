import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { isPnpmCommand, resolvePnpmCommand } from './validation-command.mjs';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const PREVIOUS_REF = process.env.FURYPIPE_PREVIOUS_REF?.trim() || 'v0.14.0';
const OUTPUT_DIR = path.resolve(
  process.env.FURYPIPE_VALIDATION_OUTPUT_DIR?.trim() || 'artifacts/final-validation',
);
const MAX_OUTPUT = 2 * 1024 * 1024;
const DEBUG = process.env.FURYPIPE_VALIDATION_DEBUG === '1';

function trace(message) {
  if (DEBUG) process.stderr.write(`[upgrade-rollback] ${message}\n`);
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
    const result = await execFileAsync(executable, finalArgs, {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
      shell: isPnpmCommand(file) ? resolvePnpmCommand().shell : false,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const stdout = String(error.stdout ?? '');
    const stderr = String(error.stderr ?? '');
    const stderrHint = stderr.trim().slice(-800).replace(/[\r\n]+/gu, ' ');
    const detail = `${file} ${args.join(' ')} failed (exit=${String(error.code ?? 'unknown')}, stdoutSha256=${sha256(stdout)}, stderrSha256=${sha256(stderr)}${stderrHint ? `, stderr=${stderrHint}` : ''})`;
    throw new Error(detail);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  return createHash('sha256').update(bytes).digest('hex');
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON (sha256=${sha256(text)})`);
  }
}

async function pack(cwd, destination) {
  await mkdir(destination, { recursive: true });
  const result = await run('npm', [
    'pack', '--json', '--ignore-scripts', '--quiet', '--pack-destination', destination,
  ], cwd);
  const metadata = parseJson(result.stdout, `npm pack in ${cwd}`)[0];
  assert(metadata?.filename && metadata.version, `npm pack did not return package metadata for ${cwd}`);
  const tarball = path.resolve(destination, metadata.filename);
  const bytes = await readFile(tarball);
  return Object.freeze({
    name: metadata.name,
    version: metadata.version,
    filename: metadata.filename,
    tarball,
    sha256: sha256(bytes),
    files: (metadata.files ?? []).map((entry) => entry.path).sort(),
  });
}

async function createPreviousBuild(workRoot) {
  const source = path.join(workRoot, 'previous-source');
  await mkdir(source, { recursive: true });
  await run('git', ['worktree', 'add', '--detach', source, PREVIOUS_REF], ROOT);
  trace(`previous worktree ready: ${source}`);
  try {
    await run('pnpm', ['install', '--frozen-lockfile'], source);
    await run('pnpm', ['run', 'build'], source);
    return { source, package: await pack(source, path.join(workRoot, 'previous-package')) };
  } catch (error) {
    await run('git', ['worktree', 'remove', '--force', source], ROOT).catch(() => undefined);
    throw error;
  }
}

function installedRoot(installDir) {
  return path.join(installDir, 'node_modules', 'furypipe');
}

function installedCli(installDir) {
  return path.join(installedRoot(installDir), 'bin', 'cli.js');
}

async function runCli(installDir, args, env, allowFailure = false) {
  try {
    return await run(process.execPath, [installedCli(installDir), ...args], installDir, env);
  } catch (error) {
    if (allowFailure) return { error };
    throw error;
  }
}

function environment(installDir, configFile, port, extra = {}) {
  const home = path.dirname(path.dirname(path.dirname(configFile)));
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    FURYPIPE_CONFIG: configFile,
    FURYPIPE_LOG: path.join(installDir, 'data', 'events.jsonl'),
    FURYPIPE_PORT: String(port),
    FURYPIPE_HOST: '127.0.0.1',
    FURYPIPE_MODEL_CATALOG_REFRESH: '0',
    FURYPIPE_AGENT_SKILLS: 'off',
    FURYPIPE_MCP_OBSERVATION: '0',
    NO_COLOR: '1',
    ...extra,
  };
}

async function freePort() {
  const { createServer } = await import('node:net');
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object', 'ephemeral port allocation failed');
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForRuntime(child, port) {
  const deadline = Date.now() + 20_000;
  let lastError = 'not attempted';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`installed runtime exited before readiness (code=${child.exitCode}, outputSha256=${sha256(child.output)})`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/beta.json`);
      const text = await response.text();
      if (response.status === 200) {
        const body = parseJson(text, 'beta dashboard endpoint');
        assert(body && typeof body === 'object', 'beta dashboard response is not an object');
        assert(JSON.stringify(body).includes('executionAuthority'), 'beta dashboard omitted authority boundary');
        return body;
      }
      lastError = `HTTP ${response.status} bodySha256=${sha256(text)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`installed runtime readiness timeout: ${lastError}`);
}

function startRuntime(installDir, env) {
  const child = spawn(process.execPath, [installedCli(installDir), 'start'], {
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

async function stopRuntime(child, signal = 'SIGTERM') {
  if (child.exitCode !== null) return child.exitCode;
  const closePromise = once(child, 'close');
  trace(`stopping runtime pid=${child.pid} signal=${signal}`);
  child.kill(signal);
  const deadline = Date.now() + 5_000;
  while (child.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (child.exitCode === null) {
    trace(`runtime pid=${child.pid} did not stop gracefully; forcing kill`);
    child.kill('SIGKILL');
  }
  await closePromise;
  return child.exitCode;
}

async function readConfig(file) {
  return parseJson(await readFile(file, 'utf8'), `config ${file}`);
}

async function main() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'furypipe-upgrade-rollback-'));
  const installDir = path.join(workspace, 'install');
  const dataDir = path.join(installDir, 'data');
  const homeDir = path.join(installDir, 'home');
  // v0.14 retains the historical pxpipe compatibility path when it exists.
  // Keeping the fixture there proves that the candidate can migrate a real
  // legacy-owned config without moving or deleting unrelated state.
  const configFile = path.join(homeDir, '.config', 'pxpipe', 'config.json');
  const port = await freePort();
  const startedAt = Date.now();
  let previousWorktree;
  try {
    await mkdir(dataDir, { recursive: true });
    await mkdir(homeDir, { recursive: true });
    await mkdir(installDir, { recursive: true });
    await run('npm', ['init', '-y'], installDir);

    const candidate = await pack(ROOT, path.join(workspace, 'candidate-package'));
    trace(`candidate packed: ${candidate.version}`);
    const sourceCommit = (await run('git', ['rev-parse', 'HEAD'], ROOT)).stdout.trim();
    assert(/^[0-9a-f]{40}$/u.test(sourceCommit), 'candidate source commit is not an exact SHA');
    const previousBuild = await createPreviousBuild(workspace);
    previousWorktree = previousBuild.source;
    const previous = previousBuild.package;
    trace(`previous packed: ${previous.version}`);
    assert(candidate.name === 'furypipe', `candidate package name mismatch: ${candidate.name}`);
    assert(previous.name === candidate.name, 'previous and candidate package names differ');
    assert(previous.version === '0.14.0', `unexpected previous version: ${previous.version}`);
    assert(candidate.version === '0.15.0', `unexpected candidate version: ${candidate.version}`);
    assert(candidate.files.includes('bin/cli.js') && candidate.files.includes('dist/node.js'), 'candidate package omitted executable runtime');
    assert(previous.files.includes('bin/cli.js') && previous.files.includes('dist/node.js'), 'previous package omitted executable runtime');

    const baseEnv = environment(installDir, configFile, port);
    await run('npm', ['install', previous.tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir, baseEnv);
    const baselineVersion = (await runCli(installDir, ['--version'], baseEnv)).stdout.trim();
    assert(baselineVersion === previous.version, `baseline installed version mismatch: ${baselineVersion}`);
    await runCli(installDir, ['setup', '--lang=en', '--yes', '--no-color'], baseEnv);
    const setupBefore = await readConfig(configFile);
    const userDataPath = path.join(dataDir, 'user-owned.txt');
    await writeFile(userDataPath, 'user-owned-state-v0.14\n', 'utf8');
    const mixedConfig = {
      ...setupBefore,
      userOwned: { keep: true, marker: 'outside-furypipe-beta-contract' },
      pluginData: { version: 1, values: ['preserve-a', 'preserve-b'] },
    };
    await writeFile(configFile, `${JSON.stringify(mixedConfig, null, 2)}\n`, 'utf8');
    const userDataDigest = sha256(await readFile(userDataPath));
    const setupDigest = sha256(JSON.stringify({ locale: mixedConfig.locale, setup: mixedConfig.setup }));
    const baselineDoctor = parseJson((await runCli(installDir, ['doctor', '--json'], baseEnv)).stdout, 'baseline doctor');
    assert(baselineDoctor.paths?.config === configFile, `baseline doctor did not observe isolated config path: ${JSON.stringify(baselineDoctor.paths?.config)} != ${JSON.stringify(configFile)}`);

    await run('npm', ['install', candidate.tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir, baseEnv);
    const candidateVersion = (await runCli(installDir, ['--version'], baseEnv)).stdout.trim();
    assert(candidateVersion === candidate.version, `candidate installed version mismatch: ${candidateVersion}`);
    const migrated = parseJson((await runCli(installDir, ['config', 'migrate-beta', '--json'], baseEnv)).stdout, 'candidate migration');
    assert(migrated.result?.status === 'migrated', `candidate migration status was ${migrated.result?.status}`);
    assert(migrated.observation?.status === 'current', 'candidate migration did not produce current config');
    const afterMigration = await readConfig(configFile);
    assert(afterMigration.userOwned?.keep === true, 'migration removed user-owned config');
    assert(afterMigration.pluginData?.version === 1
      && Array.isArray(afterMigration.pluginData?.values)
      && afterMigration.pluginData.values.join('|') === 'preserve-a|preserve-b',
    `migration changed non-owned config: before=${JSON.stringify(mixedConfig.pluginData)} after=${JSON.stringify(afterMigration.pluginData)}`);
    assert(sha256(await readFile(userDataPath)) === userDataDigest, 'migration changed non-owned data');
    assert(sha256(JSON.stringify({ locale: afterMigration.locale, setup: afterMigration.setup })) === setupDigest, 'migration changed setup state');
    const status = parseJson((await runCli(installDir, ['beta', 'status', '--json'], baseEnv)).stdout, 'candidate beta status');
    assert(status.entry?.executionAuthority === false, 'beta status exposed execution authority');
    const planned = parseJson((await runCli(installDir, ['task', '--plan', 'verify preserved install state', '--json'], baseEnv)).stdout, 'candidate task plan');
    assert(planned.selection === 'not-run' && planned.execution === 'not-authorized', 'task plan crossed the execution boundary');

    const first = startRuntime(installDir, baseEnv);
    trace(`first runtime pid=${first.pid}`);
    await waitForRuntime(first, port);
    trace('first runtime ready');
    await stopRuntime(first);
    trace('first runtime stopped');
    const second = startRuntime(installDir, baseEnv);
    trace(`second runtime pid=${second.pid}`);
    await waitForRuntime(second, port);
    trace('second runtime ready');
    await stopRuntime(second);
    trace('second runtime stopped');

    const rolledBack = parseJson((await runCli(installDir, ['config', 'rollback-beta', '--json'], baseEnv)).stdout, 'candidate config rollback');
    assert(rolledBack.result?.status === 'rolled-back', 'candidate config rollback did not complete');
    const afterConfigRollback = await readConfig(configFile);
    assert(afterConfigRollback.beta === undefined, 'config rollback left the FuryPipe-owned marker');
    assert(afterConfigRollback.userOwned?.keep === true, 'config rollback removed user-owned config');

    await run('npm', ['install', previous.tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir, baseEnv);
    const rollbackVersion = (await runCli(installDir, ['--version'], baseEnv)).stdout.trim();
    assert(rollbackVersion === previous.version, `binary rollback did not restore ${previous.version}`);
    const rollbackDoctor = parseJson((await runCli(installDir, ['doctor', '--json'], baseEnv)).stdout, 'rollback doctor');
    assert(rollbackDoctor.paths?.config === configFile, 'rollback doctor lost isolated config path');
    assert(sha256(await readFile(userDataPath)) === userDataDigest, 'binary rollback changed non-owned data');
    const afterBinaryRollback = await readConfig(configFile);
    assert(afterBinaryRollback.userOwned?.keep === true, 'binary rollback changed user-owned config');

    await run('npm', ['install', candidate.tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir, baseEnv);
    const finalMigration = parseJson((await runCli(installDir, ['config', 'migrate-beta', '--json'], baseEnv)).stdout, 'final migration');
    assert(finalMigration.observation?.status === 'current', 'candidate was not re-installable after binary rollback');
    trace('all assertions complete');

    const evidence = {
      format: 'furypipe-final-upgrade-rollback/v1',
      status: 'PASS',
      generatedAt: new Date().toISOString(),
      sourceCommit,
      platform: { os: process.platform, arch: process.arch, node: process.version },
      previous: { ref: PREVIOUS_REF, version: previous.version, tarballSha256: previous.sha256 },
      candidate: { version: candidate.version, tarballSha256: candidate.sha256 },
      contract: {
        packageUpgrade: 'PASS',
        configMigration: 'PASS',
        configRollback: 'PASS',
        binaryRollback: 'PASS',
        installedRuntimeStart: 'PASS',
        installedRuntimeRestart: 'PASS',
        userOwnedConfigPreserved: true,
        userOwnedDataPreserved: true,
        packagePublication: false,
        productionRollback: 'NOT_CLAIMED',
      },
      durationMs: Date.now() - startedAt,
    };
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(path.join(OUTPUT_DIR, 'upgrade-rollback.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    trace(`evidence written: ${path.join(OUTPUT_DIR, 'upgrade-rollback.json')}`);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    if (previousWorktree) {
      await run('git', ['worktree', 'remove', '--force', previousWorktree], ROOT).catch(() => undefined);
    }
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
