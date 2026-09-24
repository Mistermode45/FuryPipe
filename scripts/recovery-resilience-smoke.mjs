import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const OUTPUT_DIR = path.resolve(
  process.env.FURYPIPE_VALIDATION_OUTPUT_DIR?.trim() || 'artifacts/final-validation',
);
const CLI = path.join(ROOT, 'dist', 'node.js');
const WORKER = path.join(ROOT, 'scripts', 'fixtures', 'final-validation-recovery-worker.mjs');
const MAX_OUTPUT = 512 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not JSON (sha256=${sha256(Buffer.from(text))})`);
  }
}

function runChild(file, args, env, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let timedOut = false;
    const append = (current, chunk) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_OUTPUT) {
        child.kill('SIGKILL');
        return current;
      }
      return current + chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

async function assertNoTempResidue(root, label) {
  const entries = await readdir(root, { recursive: true });
  const residue = entries.filter((entry) => String(entry).includes('.tmp-') || String(entry).includes('.recovery-bak-'));
  assert(residue.length === 0, `${label} left temporary residue: ${residue.join(', ')}`);
}

async function runWorker(root, mode, evidencePath) {
  const result = await runChild(WORKER, [root, mode, evidencePath]);
  assert(!result.timedOut, `${mode} timed out`);
  assert(result.code !== 0, `${mode} unexpectedly exited successfully`);
  return parseJson(await readFile(evidencePath, 'utf8'), `${mode} evidence`);
}

async function runMigrationFault(workRoot, point, action) {
  const root = path.join(workRoot, `migration-${point}-${action}`);
  const config = path.join(root, 'config.json');
  await mkdir(root, { recursive: true });
  await writeFile(config, `${JSON.stringify({
    locale: 'en',
    userOwned: { preserve: true },
    data: ['alpha', 'beta'],
  }, null, 2)}\n`, 'utf8');
  const result = await runChild(CLI, ['config', 'migrate-beta', '--json'], {
    FURYPIPE_CONFIG: config,
    FURYPIPE_TEST_MODE: '1',
    FURYPIPE_BETA_CONFIG_FAULT: point,
    FURYPIPE_BETA_CONFIG_FAULT_ACTION: action,
  });
  assert(!result.timedOut, `${point}/${action} migration fault timed out`);
  assert(result.code !== 0, `${point}/${action} fault did not interrupt migration`);
  const state = parseJson(await readFile(config, 'utf8'), `${point}/${action} config`);
  assert(state.userOwned?.preserve === true, `${point}/${action} lost user-owned config`);
  assert(Array.isArray(state.data) && state.data.join('|') === 'alpha|beta', `${point}/${action} lost user data`);
  if (state.beta !== undefined) {
    assert(state.beta.format === 'furypipe-beta-config/v1', `${point}/${action} published invalid beta marker`);
    assert(state.beta.schemaVersion === 1, `${point}/${action} published invalid beta schema`);
    assert(state.beta.mode === 'legacy', `${point}/${action} published invalid beta mode`);
  }
  const recoveryRead = await runChild(CLI, ['beta', 'status', '--json'], {
    FURYPIPE_CONFIG: config,
  });
  assert(recoveryRead.code === 0, `${point}/${action} recovery read failed after interruption`);
  await assertNoTempResidue(root, `${point}/${action}`);
  return {
    point,
    action,
    exitCode: result.code,
    signal: result.signal ?? null,
    resultingState: state.beta === undefined ? 'old-valid' : 'new-valid',
  };
}

async function main() {
  const workRoot = await mkdtemp(path.join(os.tmpdir(), 'furypipe-recovery-resilience-'));
  const startedAt = Date.now();
  try {
    const durableRoot = path.join(workRoot, 'durable');
    const durableEvidence = path.join(workRoot, 'durable.json');
    await mkdir(durableRoot, { recursive: true });
    const durable = await runWorker(durableRoot, 'durable-put-kill', durableEvidence);
    const { createRecoveryStore } = await import('../dist/core/recovery-store.js');
    const reopenedStore = createRecoveryStore(durableRoot, { namespace: 'final-crash' });
    const recovered = new TextDecoder().decode(await reopenedStore.get(durable.handle));
    assert(recovered === 'final-validation-durable-state-v1', 'durable state was not recovered after process kill');
    assert((await reopenedStore.verify(durable.handle)).ok === true, 'recovered durable state failed integrity verification');
    await assertNoTempResidue(durableRoot, 'durable recovery');

    const automationRoot = path.join(workRoot, 'automation');
    const automationEvidence = path.join(workRoot, 'automation.json');
    await mkdir(automationRoot, { recursive: true });
    const automation = await runWorker(automationRoot, 'automation-armed-kill', automationEvidence);
    const { createRecoveryStore: createStore } = await import('../dist/core/recovery-store.js');
    const { createFuryGatewayAutomationRunLedger } = await import('../dist/gateway-automation-run-ledger-node.js');
    const restartedLedger = createFuryGatewayAutomationRunLedger({
      store: createStore(automationRoot, { namespace: 'final-automation' }),
      now: () => 10_000,
      defaultClaimLeaseMs: 5000,
    });
    const unknown = await restartedLedger.inspect(automation.runIdSha256);
    assert(unknown?.state === 'outcome-unknown', 'armed process kill was not preserved as outcome-unknown');
    assert(unknown.automaticReplayAllowed === false, 'unknown outcome was marked automatically replayable');
    let replayRejected = false;
    try {
      await restartedLedger.claim(automation.runIdSha256, 'post-restart');
    } catch (error) {
      replayRejected = error?.code === 'run-conflict';
    }
    assert(replayRejected, 'unknown outcome was replayed without reconciliation');

    const wakeRoot = path.join(workRoot, 'automation-wake');
    const wakeEvidencePath = path.join(workRoot, 'automation-wake.json');
    await mkdir(wakeRoot, { recursive: true });
    const wakeBeforeKill = await runWorker(
      wakeRoot,
      'automation-wake-kill',
      wakeEvidencePath,
    );
    assert(
      wakeBeforeKill.decision === 'not-due' && wakeBeforeKill.nextDueAt === 1000,
      'scheduler did not durably preserve the not-yet-due wake boundary',
    );
    const { createFuryGatewayAutomationDefinitionStore } = await import(
      '../dist/gateway-automation-definition-node.js'
    );
    const { createFuryGatewayAutomationScheduler } = await import(
      '../dist/gateway-automation-scheduler-node.js'
    );
    const wakeDefinitions = createFuryGatewayAutomationDefinitionStore({
      store: createStore(wakeRoot, { namespace: 'final-wake-definitions' }),
      now: () => 1000,
    });
    const wakeRuns = createFuryGatewayAutomationRunLedger({
      store: createStore(wakeRoot, { namespace: 'final-wake-runs' }),
      now: () => 1000,
      defaultClaimLeaseMs: 5000,
    });
    const wakeScheduler = createFuryGatewayAutomationScheduler({
      definitions: wakeDefinitions,
      runs: wakeRuns,
      now: () => 1000,
    });
    const woken = await wakeScheduler.tick(
      'final-validation-wake',
      'after-kill',
      1000,
    );
    assert(
      woken.decision === 'claimed' && woken.scheduledFor === 1000,
      'scheduler did not claim the one-shot occurrence after restart',
    );
    const duplicate = await wakeScheduler.tick(
      'final-validation-wake',
      'after-kill-duplicate',
      1000,
    );
    assert(
      duplicate.decision === 'observed',
      'scheduler did not observe the already claimed occurrence',
    );
    assert(
      (await wakeRuns.countRuns()) === 1,
      'scheduler wake created more than one run for one occurrence',
    );
    await assertNoTempResidue(wakeRoot, 'automation wake');

    const migrationFaults = [];
    for (const point of ['after-temp-fsync', 'before-rename', 'after-rename', 'before-receipt']) {
      migrationFaults.push(await runMigrationFault(workRoot, point, 'throw'));
      migrationFaults.push(await runMigrationFault(workRoot, point, 'kill'));
    }

    const evidence = {
      format: 'furypipe-final-recovery-resilience/v1',
      status: 'PASS',
      generatedAt: new Date().toISOString(),
      platform: { os: process.platform, arch: process.arch, node: process.version },
      crashRecovery: {
        realSubprocessKill: 'PASS',
        durableStateIntegrity: 'PASS',
        automationUnknownOutcome: 'PASS',
        automaticReplay: 'DENIED',
      },
      automationWake: {
        processKillBeforeDue: 'PASS',
        boundedClockWake: 'PASS',
        firstOccurrence: 'claimed',
        duplicateOccurrence: 'observed',
        exactRunCount: 1,
      },
      migrationInterruption: {
        status: 'PASS',
        faultPoints: migrationFaults,
        invariant: 'old-valid-or-new-valid',
        tempCleanup: 'PASS',
        directoryFsync: 'NOT_CLAIMED',
      },
      durationMs: Date.now() - startedAt,
    };
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(path.join(OUTPUT_DIR, 'recovery-resilience.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await rm(workRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
