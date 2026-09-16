import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmCli = process.platform === 'win32'
  ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  : undefined;
async function run(file, args, cwd, env = process.env) {
  if (process.platform === 'win32' && file.endsWith('.cmd')) {
    if (!npmCli || !existsSync(npmCli)) throw new Error(`bundled npm CLI not found: ${npmCli ?? '<none>'}`);
    return execFileAsync(process.execPath, [npmCli, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      shell: false,
    });
  }
  return execFileAsync(file, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runMcp(binary, args, payload, validate) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: root,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32' && binary.endsWith('.cmd'),
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP smoke timed out: ${stderr || stdout}`));
    }, 10_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`MCP smoke exited ${code}: ${stderr || stdout}`));
        return;
      }
      const response = JSON.parse(stdout.trim().split(/\r?\n/u)[0]);
      validate(response);
      resolve(response);
    });
    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

let tarball;
let installDir;
try {
  const packed = await run(npm, ['pack', '--json', '--ignore-scripts', '--quiet'], root);
  const metadata = JSON.parse(packed.stdout)[0];
  assert(metadata?.filename, 'npm pack returned no tarball');
  const packedFiles = new Set((metadata.files ?? []).map((entry) => entry.path));
  const legacyNameForChecks = ['p', 'x', 'p', 'i', 'p', 'e'].join('');
  const legacyEnvForChecks = legacyNameForChecks.toUpperCase() + '_';
  const formerPortForChecks = ['478', '21'].join('');
  assert(!packedFiles.has(`docs/${legacyEnvForChecks}GAP_ANALYSIS.md`), 'historical gap analysis leaked into the public package');
  assert(packedFiles.has('docs/CLI.md'), 'FuryPipe CLI documentation is missing from the public package');
  assert(packedFiles.has('docs/VISUAL_ENGINE.md'), 'Visual Engine documentation is missing from the public package');
  assert(packedFiles.has('docs/MODEL_ADAPTERS.md'), 'Model Adapter documentation is missing from the public package');
  assert(packedFiles.has('docs/CAPABILITY_CATALOG.md'), 'Capability Catalog documentation is missing from the public package');
  assert(packedFiles.has('docs/ECOSYSTEM_INGESTION.md'), 'Ecosystem Ingestion documentation is missing from the public package');
  assert(packedFiles.has('docs/SKILL_ECOSYSTEM_2026.md'), '2026 Skill Ecosystem documentation is missing from the public package');
  assert(packedFiles.has('docs/PROVIDER_RETRY_FALLBACK_ORCHESTRATOR.md'), 'Provider Retry/Fallback Orchestrator documentation is missing from the public package');
  assert(packedFiles.has('docs/GOVERNED_PROVIDER_STREAMING.md'), 'Governed Provider Streaming documentation is missing from the public package');
  assert(packedFiles.has('docs/FURYTRUST.md'), 'FuryTrust documentation is missing from the public package');
  assert(packedFiles.has('docs/CAPABILITY_CATALOG_RESOLVER.md'), 'Capability Catalog Resolver documentation is missing from the public package');
  assert(packedFiles.has('docs/CAPABILITY_ACTIVATION.md'), 'Capability Activation documentation is missing from the public package');
  tarball = path.resolve(root, metadata.filename);
  assert(existsSync(tarball), `npm pack did not create ${metadata.filename}`);

  installDir = await mkdtemp(path.join(os.tmpdir(), 'furypipe-package-smoke-'));
  await run(npm, ['init', '-y'], installDir);
  await run(npm, ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir);

  const packageRoot = path.join(installDir, 'node_modules', 'furypipe');

  const legacyName = legacyNameForChecks;
  const legacyEnv = legacyEnvForChecks;
  const textExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.md', '.json', '.txt']);
  const identityLeaks = [];
  for (const entry of metadata.files ?? []) {
    if (!textExtensions.has(path.extname(entry.path).toLowerCase())) continue;
    const installedPath = path.join(packageRoot, entry.path);
    if (!existsSync(installedPath)) continue;
    const text = await readFile(installedPath, 'utf8');
    if (text.toLowerCase().includes(legacyName)) identityLeaks.push(entry.path + ': legacy product name');
    if (text.includes(legacyEnv)) identityLeaks.push(entry.path + ': legacy environment namespace');
    if (text.includes(formerPortForChecks)) identityLeaks.push(entry.path + ': former default port');
  }
  assert(identityLeaks.length === 0, 'published package leaked historical runtime identity:\n' + identityLeaks.join('\n'));

  const installedPackage = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  assert(installedPackage.bin?.furypipe === 'bin/cli.js', 'furypipe executable is missing from the installed package');
  assert(!Object.prototype.hasOwnProperty.call(installedPackage.bin ?? {}, legacyNameForChecks), 'legacy executable alias leaked into the installed package');
  const cli = path.join(packageRoot, 'bin', 'cli.js');
  const mcp = path.join(packageRoot, 'bin', 'mcp.js');
  const version = await run(process.execPath, [cli, '--version'], installDir);
  assert(version.stdout.trim() === metadata.version, `CLI version mismatch: ${version.stdout}`);
  const help = await run(process.execPath, [cli, '--help'], installDir);
  assert(/FuryPipe/u.test(help.stdout), 'FuryPipe CLI help is missing FuryPipe branding');
  assert(!help.stdout.toLowerCase().includes(legacyNameForChecks) && !help.stdout.includes(legacyEnvForChecks), 'FuryPipe CLI help exposed legacy product branding');

  const setupHelp = await run(process.execPath, [cli, 'setup', '--help'], installDir);
  assert(/FuryPipe setup/u.test(setupHelp.stdout), 'setup help is missing FuryPipe branding');
  assert(/--lang=fr\|en/u.test(setupHelp.stdout), 'setup help is missing bilingual language selection');

  const linkHelp = await run(process.execPath, [cli, 'link', '--help'], installDir);
  assert(/FuryLink/u.test(linkHelp.stdout), 'FuryLink help is missing FuryPipe link branding');
  assert(/furypipe link codex/u.test(linkHelp.stdout), 'FuryLink help is missing separator-free Windows syntax');
  assert(!/furypipe warp/u.test(linkHelp.stdout), 'retired warp command leaked into FuryLink help');

  // Cross-platform launcher smoke. On Windows npm is normally an npm.cmd shim;
  // this proves FuryLink resolves PATHEXT launchers instead of falling through
  // to a POSIX /bin/sh path. The child makes no provider request, so a running
  // FuryPipe listener is not required for this launcher-only check.
  const linkLaunch = await run(process.execPath, [cli, 'link', 'npm', '--version'], installDir, {
    ...process.env,
    CI: '1',
    NO_COLOR: '1',
  });
  assert(/^\d+\.\d+/u.test(linkLaunch.stdout.trim()), `FuryLink did not launch npm: ${linkLaunch.stdout}`);
  assert(/FuryLink exec/u.test(linkLaunch.stderr), 'FuryLink launcher did not emit its execution receipt');

  const setupConfig = path.join(installDir, 'furypipe-setup-smoke.json');
  const occupied = createServer();
  await new Promise((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolve);
  });
  const occupiedAddress = occupied.address();
  assert(occupiedAddress && typeof occupiedAddress === 'object', 'could not allocate occupied-port setup fixture');
  let setup;
  try {
    setup = await run(
      process.execPath,
      [cli, 'setup', '--lang=fr', '--yes', '--no-color'],
      installDir,
      {
        ...process.env,
        FURYPIPE_CONFIG: setupConfig,
        FURYPIPE_PORT: String(occupiedAddress.port),
        CI: '1',
        NO_COLOR: '1',
      },
    );
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
  assert(/status:\s+ready/u.test(setup.stdout), 'non-interactive setup did not finish ready');
  assert(!/listening on|EADDRINUSE/u.test(setup.stdout + setup.stderr), 'setup attempted to start the FuryPipe server');
  const setupState = JSON.parse(await readFile(setupConfig, 'utf8'));
  assert(setupState.locale === 'fr', 'setup did not persist the selected locale');
  assert(setupState.setup?.completed === true, 'setup did not persist completion state');
  assert(setupState.setup?.version === metadata.version, 'setup persisted the wrong package version');

  const occupiedRuntime = createServer();
  await new Promise((resolve, reject) => {
    occupiedRuntime.once('error', reject);
    occupiedRuntime.listen(0, '127.0.0.1', resolve);
  });
  const occupiedRuntimeAddress = occupiedRuntime.address();
  assert(occupiedRuntimeAddress && typeof occupiedRuntimeAddress === 'object', 'could not allocate runtime port-conflict fixture');
  let conflictError;
  try {
    await run(
      process.execPath,
      [cli, 'start'],
      installDir,
      {
        ...process.env,
        FURYPIPE_HOST: '127.0.0.1',
        FURYPIPE_PORT: String(occupiedRuntimeAddress.port),
        CI: '1',
        NO_COLOR: '1',
      },
    );
  } catch (error) {
    conflictError = error;
  } finally {
    await new Promise((resolve) => occupiedRuntime.close(resolve));
  }
  assert(conflictError, 'furypipe start unexpectedly succeeded on an occupied port');
  const conflictOutput = String(conflictError.stdout ?? '') + String(conflictError.stderr ?? '');
  assert(conflictOutput.includes('[furypipe] cannot start:'), 'occupied-port start did not emit the FuryPipe conflict message');
  assert(conflictOutput.includes('Set FURYPIPE_PORT to a free port'), 'occupied-port start did not explain the FuryPipe port override');
  assert(!conflictOutput.includes('node:events:'), 'occupied-port start leaked a Node internal stack');

  const doctorEnv = { ...process.env };
  delete doctorEnv.FURYPIPE_PORT;
  delete doctorEnv.FURYPIPE_HOST;
  const doctor = await run(process.execPath, [cli, 'doctor', '--json'], installDir, doctorEnv);
  const report = JSON.parse(doctor.stdout);
  assert(report.runtime?.node, 'doctor smoke returned no Node runtime');
  assert(report.network?.port === 48721, `doctor reported unexpected default FuryPipe port: ${report.network?.port}`);
  const httpExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/mcp-modern'); if (typeof m.createProductionMcpHandler !== 'function' || typeof m.getProductionMcpRuntimeEvidence !== 'function' || typeof m.isGeneratedModernMcpStdioHandle !== 'function') process.exit(1);",
  ], installDir);
  assert(httpExport.stderr === '', `MCP HTTP package export wrote stderr: ${httpExport.stderr}`);
  const nodeHttpExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/mcp-http-node'); if (typeof m.listenMcpHttpNode !== 'function') process.exit(1);",
  ], installDir);
  assert(nodeHttpExport.stderr === '', `Node MCP HTTP package export wrote stderr: ${nodeHttpExport.stderr}`);
  const furyPromptExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/fury-prompt'); if (typeof m.compileFuryPrompt !== 'function') process.exit(1);",
  ], installDir);
  assert(furyPromptExport.stderr === '', `FuryPrompt package export wrote stderr: ${furyPromptExport.stderr}`);
  const instructionProfilesExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/instruction-profiles'); if (typeof m.applyInstructionProfiles !== 'function' || typeof m.recommendInstructionProfiles !== 'function' || !m.FURY_INSTRUCTION_PROFILES) process.exit(1);",
  ], installDir);
  assert(instructionProfilesExport.stderr === '', `Instruction profiles package export wrote stderr: ${instructionProfilesExport.stderr}`);
  const agentRuntimeExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/agent-runtime'); if (typeof m.runAgent !== 'function') process.exit(1);",
  ], installDir);
  assert(agentRuntimeExport.stderr === '', `Agent runtime package export wrote stderr: ${agentRuntimeExport.stderr}`);
  const skillRegistryExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/skill-registry'); if (typeof m.createAgentSkillRegistry !== 'function' || !Array.isArray(m.SKILL_CATEGORIES)) process.exit(1);",
  ], installDir);
  assert(skillRegistryExport.stderr === '', `Skill registry package export wrote stderr: ${skillRegistryExport.stderr}`);
  const pluginBundlesExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/plugin-bundles'); if (typeof m.createFuryPluginBundleRegistry !== 'function' || !Array.isArray(m.BUILTIN_FURY_PLUGIN_BUNDLES)) process.exit(1);",
  ], installDir);
  assert(pluginBundlesExport.stderr === '', `Plugin bundles package export wrote stderr: ${pluginBundlesExport.stderr}`);
  const capabilityRouterExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/capability-router'); if (typeof m.resolveFuryCapabilities !== 'function' || !Array.isArray(m.FURY_CAPABILITY_PACK_IDS)) process.exit(1);",
  ], installDir);
  assert(capabilityRouterExport.stderr === '', `Capability Router package export wrote stderr: ${capabilityRouterExport.stderr}`);
  const externalReferencesExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/external-references'); if (!Array.isArray(m.EXTERNAL_REFERENCE_CATALOG) || typeof m.referencesByCapability !== 'function') process.exit(1);",
  ], installDir);
  assert(externalReferencesExport.stderr === '', `External references package export wrote stderr: ${externalReferencesExport.stderr}`);
  const learningExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/learning'); if (typeof m.runAgentLearningCycle !== 'function' || typeof m.createHumanLearningPath !== 'function') process.exit(1);",
  ], installDir);
  assert(learningExport.stderr === '', `Learning package export wrote stderr: ${learningExport.stderr}`);
  const knowledgeExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/knowledge'); if (typeof m.createKnowledgeIndex !== 'function') process.exit(1);",
  ], installDir);
  assert(knowledgeExport.stderr === '', `Knowledge package export wrote stderr: ${knowledgeExport.stderr}`);
  const webStudioExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/web-studio'); if (typeof m.renderStaticStudioPage !== 'function' || typeof m.runStudioBrowserQa !== 'function') process.exit(1);",
  ], installDir);
  assert(webStudioExport.stderr === '', `Web Studio package export wrote stderr: ${webStudioExport.stderr}`);
  const knowledgeRecoveryExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/knowledge-recovery'); if (typeof m.createRecoveryKnowledgeStore !== 'function') process.exit(1);",
  ], installDir);
  assert(knowledgeRecoveryExport.stderr === '', `Knowledge Recovery package export wrote stderr: ${knowledgeRecoveryExport.stderr}`);
  const longTermMemoryExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/long-term-memory'); if (typeof m.createLongTermMemoryStore !== 'function' || typeof m.promoteValidatedLessonToLongTermMemory !== 'function') process.exit(1);",
  ], installDir);
  assert(longTermMemoryExport.stderr === '', `Long-term memory package export wrote stderr: ${longTermMemoryExport.stderr}`);
  const controlRoomEvidenceExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/control-room-evidence'); if (typeof m.parseControlRoomHostEvidence !== 'function' || typeof m.loadControlRoomHostEvidence !== 'function') process.exit(1);",
  ], installDir);
  assert(controlRoomEvidenceExport.stderr === '', `Control Room evidence package export wrote stderr: ${controlRoomEvidenceExport.stderr}`);
  const controlRoomSecurityEvidenceExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/control-room-security-evidence'); if (typeof m.parseControlRoomSecurityCiEvidence !== 'function' || typeof m.createControlRoomSecurityCiSnapshot !== 'function' || typeof m.createControlRoomSecurityCiSnapshotFromUnknown !== 'function') process.exit(1);",
  ], installDir);
  assert(controlRoomSecurityEvidenceExport.stderr === '', `Control Room security evidence package export wrote stderr: ${controlRoomSecurityEvidenceExport.stderr}`);
  const providerRuntimeExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/provider-runtime'); if (typeof m.createProviderRuntimeState !== 'function') process.exit(1);",
  ], installDir);
  assert(providerRuntimeExport.stderr === '', `Provider runtime package export wrote stderr: ${providerRuntimeExport.stderr}`);
  const retryFallbackExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/provider-retry-fallback-orchestrator'); if (typeof m.createProviderRetryFallbackOrchestrator !== 'function' || typeof m.isGeneratedProviderRetryFallbackResult !== 'function') process.exit(1);",
  ], installDir);
  assert(retryFallbackExport.stderr === '', `Provider Retry/Fallback Orchestrator package export wrote stderr: ${retryFallbackExport.stderr}`);
  const providerStreamingExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/provider-streaming'); if (typeof m.createGovernedProviderStreamExecutor !== 'function' || typeof m.createProviderStreamTransportRegistry !== 'function' || typeof m.isGeneratedGovernedProviderStreamSession !== 'function') process.exit(1);",
  ], installDir);
  assert(providerStreamingExport.stderr === '', `Provider streaming package export wrote stderr: ${providerStreamingExport.stderr}`);
  const providerStreamTransportsExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/provider-stream-transports'); if (typeof m.createOpenAIProviderStreamTransport !== 'function' || typeof m.createAnthropicProviderStreamTransport !== 'function' || typeof m.createGoogleProviderStreamTransport !== 'function') process.exit(1);",
  ], installDir);
  assert(providerStreamTransportsExport.stderr === '', `Provider stream transports package export wrote stderr: ${providerStreamTransportsExport.stderr}`);
  const omniRouteExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/omniroute'); if (typeof m.createOmniRouteProxyConfig !== 'function' || typeof m.normalizeOmniRouteBaseUrl !== 'function') process.exit(1);",
  ], installDir);
  assert(omniRouteExport.stderr === '', `OmniRoute package export wrote stderr: ${omniRouteExport.stderr}`);
  const policyRuntimeExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/policy-runtime'); if (typeof m.createInMemoryPolicyCache !== 'function' || typeof m.executeRecoveryRetrieval !== 'function') process.exit(1);",
  ], installDir);
  assert(policyRuntimeExport.stderr === '', `Policy runtime package export wrote stderr: ${policyRuntimeExport.stderr}`);
  const continuousMemoryExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/continuous-memory'); if (typeof m.createContinuousMemoryEngine !== 'function' || typeof m.DEFAULT_CONTINUOUS_MEMORY_POLICY !== 'object') process.exit(1);",
  ], installDir);
  assert(continuousMemoryExport.stderr === '', `Continuous memory package export wrote stderr: ${continuousMemoryExport.stderr}`);
  const instructionFabricExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/instruction-fabric'); if (typeof m.resolveInstructionPlan !== 'function' || !Array.isArray(m.FURY_INSTRUCTION_FACET_IDS)) process.exit(1);",
  ], installDir);
  assert(instructionFabricExport.stderr === '', `Instruction Fabric package export wrote stderr: ${instructionFabricExport.stderr}`);
  const contextOptimizerExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/context-optimizer'); if (typeof m.optimizeContext !== 'function' || !Array.isArray(m.FURY_CONTEXT_LEVELS)) process.exit(1);",
  ], installDir);
  assert(contextOptimizerExport.stderr === '', `Context Optimizer package export wrote stderr: ${contextOptimizerExport.stderr}`);
  const continuousMemoryTurnExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/continuous-memory-turn'); if (typeof m.runContinuousMemoryTurn !== 'function') process.exit(1);",
  ], installDir);
  assert(continuousMemoryTurnExport.stderr === '', `Continuous Memory turn package export wrote stderr: ${continuousMemoryTurnExport.stderr}`);
  const taskOrchestratorExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/task-orchestrator'); if (typeof m.prepareFuryTask !== 'function') process.exit(1);",
  ], installDir);
  assert(taskOrchestratorExport.stderr === '', `Task Orchestrator package export wrote stderr: ${taskOrchestratorExport.stderr}`);
  const modelAdapterRegistryExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/model-adapter-registry'); if (typeof m.createModelAdapterRegistry !== 'function' || typeof m.digestModelAdapter !== 'function') process.exit(1);",
  ], installDir);
  assert(modelAdapterRegistryExport.stderr === '', `Model Adapter Registry package export wrote stderr: ${modelAdapterRegistryExport.stderr}`);
  const capabilityCatalogExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/capability-catalog'); if (typeof m.normalizeCapabilityCandidate !== 'function' || typeof m.createCapabilityRegistry !== 'function' || typeof m.evaluateFuryTrust !== 'function' || typeof m.scoreFuryCapability !== 'function' || typeof m.resolveFuryCatalog !== 'function' || typeof m.resolveFuryCapabilityActivation !== 'function') process.exit(1);",
  ], installDir);
  assert(capabilityCatalogExport.stderr === '', `Capability Catalog package export wrote stderr: ${capabilityCatalogExport.stderr}`);
  await runMcp(process.execPath, [mcp], {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'furypipe-package-smoke', version: '1.0.0' },
    },
  }, (response) => {
    assert(response.result?.protocolVersion === '2025-11-25', 'MCP legacy handshake version mismatch');
  });
  await runMcp(process.execPath, [mcp], {
    jsonrpc: '2.0',
    id: 1,
    method: 'server/discover',
    params: {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  }, (response) => {
    assert(response.result?.supportedVersions?.includes('2026-07-28'), 'MCP modern discovery has no 2026 support');
  });
  console.log(`package smoke passed: ${metadata.filename}`);
} finally {
  if (installDir) await rm(installDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (tarball) await rm(tarball, { force: true });
}
