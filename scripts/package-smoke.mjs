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
  if (process.platform === 'win32') {
    assert(
      !/no public root bundle available|no system root bundle found/u.test(linkLaunch.stderr),
      'FuryLink Windows child received a CA-only replacement trust bundle',
    );
  }

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
  const directMcpClientExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/mcp-direct-client-node'); if (typeof m.probeMcpDirectInventory !== 'function' || typeof m.deriveMcpDirectEndpointFingerprint !== 'function') process.exit(1);",
  ], installDir);
  assert(directMcpClientExport.stderr === '', `Direct MCP client package export wrote stderr: ${directMcpClientExport.stderr}`);
  const directMcpPolicyExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/mcp-direct-policy'); if (typeof m.selectMcpDirectTool !== 'function' || typeof m.createMcpDirectToolProposal !== 'function' || typeof m.evaluateMcpDirectPolicy !== 'function' || typeof m.approveMcpDirectPolicyDecision !== 'function' || typeof m.resolveMcpDirectProposalArguments !== 'undefined') process.exit(1);",
  ], installDir);
  assert(directMcpPolicyExport.stderr === '', `Direct MCP policy package export wrote stderr: ${directMcpPolicyExport.stderr}`);
  const directMcpExecutorExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/mcp-direct-executor-node'); if (typeof m.executeMcpDirectApprovedTool !== 'function' || typeof m.executeMcpDirectReplay !== 'function' || typeof m.createMcpDirectReplayIntent !== 'function' || typeof m.McpDirectReplayGovernanceError !== 'function' || typeof m.McpDirectExecutionPreCallRejectedError !== 'function' || typeof m.McpDirectExecutionOutcomeUnknownError !== 'function' || typeof m.McpDirectExecutionVerificationError !== 'function' || typeof m.McpDirectExecutionEvidenceError !== 'function' || typeof m.McpDirectExecutionDurabilityError !== 'function') process.exit(1);",
  ], installDir);
  assert(directMcpExecutorExport.stderr === '', `Direct MCP executor package export wrote stderr: ${directMcpExecutorExport.stderr}`);
  const directMcpDurableReplayExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/mcp-direct-durable-replay-node'); if (typeof m.createMcpDirectDurableReplayCoordinator !== 'function' || typeof m.inspectMcpDirectDurableReplayStatus !== 'function' || typeof m.reclaimMcpDirectDurableExpiredPreCall !== 'function' || typeof m.McpDirectDurableReplayError !== 'function' || typeof m.reserveMcpDirectDurableExecution !== 'undefined' || typeof m.armMcpDirectDurableExecution !== 'undefined' || typeof m.settleMcpDirectDurableExecution !== 'undefined') process.exit(1);",
  ], installDir);
  assert(directMcpDurableReplayExport.stderr === '', `Direct MCP durable replay package export wrote stderr: ${directMcpDurableReplayExport.stderr}`);
  const directMcpHiddenExports = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "for (const subpath of ['mcp-direct-governance','mcp-direct-client-node-internal','mcp-direct-policy-internal','mcp-direct-executor-node-internal','mcp-direct-replay-internal','mcp-direct-durable-replay-internal','mcp-direct-catalog','mcp-direct-json']) { try { await import('furypipe/' + subpath); process.exit(2); } catch (error) { if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; } }",
  ], installDir);
  assert(directMcpHiddenExports.stderr === '', `Hidden Direct MCP package path smoke wrote stderr: ${directMcpHiddenExports.stderr}`);
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
  const furyKernelExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/fury-kernel'); if (typeof m.createFuryKernelConversationStore !== 'function' || typeof m.FuryKernelConversationError !== 'function') process.exit(1);",
  ], installDir);
  assert(furyKernelExport.stderr === '', `Fury Kernel package export wrote stderr: ${furyKernelExport.stderr}`);
  const gatewayConversationAdapterExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-conversation-adapter-node'); if (typeof m.createFuryGatewayConversationAdapter !== 'function' || !Array.isArray(m.FURY_GATEWAY_CONVERSATION_COMMAND_NAMES) || !Array.isArray(m.FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS)) process.exit(1);",
  ], installDir);
  assert(gatewayConversationAdapterExport.stderr === '', `Gateway conversation adapter package export wrote stderr: ${gatewayConversationAdapterExport.stderr}`);
  const gatewayWebChatExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-webchat-node'); if (typeof m.createFuryGatewayWebChatHandler !== 'function' || m.FURY_GATEWAY_WEBCHAT_PATH !== '/gateway/webchat/') process.exit(1);",
  ], installDir);
  assert(gatewayWebChatExport.stderr === '', `Gateway WebChat package export wrote stderr: ${gatewayWebChatExport.stderr}`);
  const providerResponseTextExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/provider-response-text'); if (typeof m.decodeFuryProviderResponseText !== 'function' || typeof m.FuryProviderResponseTextError !== 'function') process.exit(1);",
  ], installDir);
  assert(providerResponseTextExport.stderr === '', `Provider response text export wrote stderr: ${providerResponseTextExport.stderr}`);
  const furyKernelModelBridgeExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/fury-kernel-model-bridge'); if (typeof m.createFuryKernelModelBridge !== 'function' || m.FURY_KERNEL_MODEL_BRIDGE_FORMAT !== 'furypipe-kernel-model-bridge-result/v1') process.exit(1);",
  ], installDir);
  assert(furyKernelModelBridgeExport.stderr === '', `Fury Kernel model bridge export wrote stderr: ${furyKernelModelBridgeExport.stderr}`);
  const gatewayModelCommandExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-model-command-node'); if (!Array.isArray(m.FURY_GATEWAY_MODEL_EXECUTION_COMMAND_NAMES) || !Array.isArray(m.FURY_GATEWAY_MODEL_EXECUTION_COMMAND_DEFINITIONS)) process.exit(1);",
  ], installDir);
  assert(gatewayModelCommandExport.stderr === '', `Gateway model command export wrote stderr: ${gatewayModelCommandExport.stderr}`);
  const gatewayLocalModelRuntimeExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-local-model-runtime-node'); if (typeof m.createFuryGatewayLocalModelRuntime !== 'function') process.exit(1);",
  ], installDir);
  assert(gatewayLocalModelRuntimeExport.stderr === '', `Gateway local model runtime export wrote stderr: ${gatewayLocalModelRuntimeExport.stderr}`);
  const furyKernelToolBridgeExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/fury-kernel-tool-bridge-node'); if (typeof m.createFuryKernelToolBridge !== 'function' || m.FURY_KERNEL_TOOL_BRIDGE_FORMAT !== 'furypipe-kernel-tool-bridge/v1') process.exit(1);",
  ], installDir);
  assert(furyKernelToolBridgeExport.stderr === '', `Fury Kernel tool bridge export wrote stderr: ${furyKernelToolBridgeExport.stderr}`);
  const gatewayToolCommandExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-tool-command-node'); if (!Array.isArray(m.FURY_GATEWAY_TOOL_COMMAND_NAMES) || !Array.isArray(m.FURY_GATEWAY_TOOL_COMMAND_DEFINITIONS)) process.exit(1);",
  ], installDir);
  assert(gatewayToolCommandExport.stderr === '', `Gateway tool command export wrote stderr: ${gatewayToolCommandExport.stderr}`);

  const gatewayToolBridgeAdapterExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-tool-bridge-adapter-node'); if (typeof m.createFuryGatewayToolBridgeAdapter !== 'function' || m.FURY_GATEWAY_TOOL_RESULT_FORMAT !== 'furypipe-gateway-tool-result/v1') process.exit(1);",
  ], installDir);
  assert(gatewayToolBridgeAdapterExport.stderr === '', `Gateway tool bridge adapter export wrote stderr: ${gatewayToolBridgeAdapterExport.stderr}`);

  const gatewayLocalToolRuntimeExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-local-tool-runtime-node'); if (typeof m.createFuryGatewayLocalToolRuntime !== 'function' || m.FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT !== 'furypipe-gateway-local-tool-config/v1') process.exit(1);",
  ], installDir);
  assert(gatewayLocalToolRuntimeExport.stderr === '', `Gateway local tool runtime export wrote stderr: ${gatewayLocalToolRuntimeExport.stderr}`);

  const capabilityIndexExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/capability-index'); if (typeof m.createFuryCapabilityIndex !== 'function' || m.FURY_CAPABILITY_INDEX_ENTRY_FORMAT !== 'furypipe-capability-index-entry/v1') process.exit(1);",
  ], installDir);
  assert(capabilityIndexExport.stderr === '', `Capability index export wrote stderr: ${capabilityIndexExport.stderr}`);

  const capabilityAutopilotExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/capability-autopilot'); if (typeof m.selectFuryCapabilitiesForTask !== 'function' || m.FURY_CAPABILITY_SELECTION_FORMAT !== 'furypipe-capability-selection/v1') process.exit(1);",
  ], installDir);
  assert(capabilityAutopilotExport.stderr === '', `Capability Autopilot export wrote stderr: ${capabilityAutopilotExport.stderr}`);

  const capabilityAdaptersExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/capability-index-adapters'); if (typeof m.projectSkillsIntoCapabilityIndex !== 'function' || typeof m.revalidateFuryCapabilitySelection !== 'function' || m.FURY_CAPABILITY_REVALIDATION_FORMAT !== 'furypipe-capability-revalidation/v1') process.exit(1);",
  ], installDir);
  assert(capabilityAdaptersExport.stderr === '', `Capability index adapters export wrote stderr: ${capabilityAdaptersExport.stderr}`);

  const capabilitySemanticAnalyzerExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/capability-semantic-analyzer'); if (typeof m.createGovernedFuryCapabilitySemanticAnalyzer !== 'function' || typeof m.isGeneratedFuryCapabilitySemanticAnalysis !== 'function' || m.FURY_CAPABILITY_SEMANTIC_ANALYSIS_FORMAT !== 'furypipe-capability-semantic-analysis/v1') process.exit(1);",
  ], installDir);
  assert(capabilitySemanticAnalyzerExport.stderr === '', `Capability semantic analyzer export wrote stderr: ${capabilitySemanticAnalyzerExport.stderr}`);

  const capabilitySignalsExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/capability-signals'); if (typeof m.createFuryCapabilitySignalRegistry !== 'function' || m.FURY_CAPABILITY_SIGNAL_FORMAT !== 'furypipe-capability-signal/v1') process.exit(1);",
  ], installDir);
  assert(capabilitySignalsExport.stderr === '', `Capability signals export wrote stderr: ${capabilitySignalsExport.stderr}`);

  const capabilitySignalAdaptersExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/capability-signal-adapters'); if (typeof m.projectProviderRuntimeModelSignals !== 'function' || m.FURY_CAPABILITY_SIGNAL_PROJECTION_FORMAT !== 'furypipe-capability-signal-projection/v1') process.exit(1);",
  ], installDir);
  assert(capabilitySignalAdaptersExport.stderr === '', `Capability signal adapters export wrote stderr: ${capabilitySignalAdaptersExport.stderr}`);

  const capabilityExposureExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/fury-kernel-capability-exposure'); if (typeof m.createFuryKernelCapabilityExposurePlan !== 'function' || typeof m.isGeneratedFuryKernelCapabilityExposurePlan !== 'function' || m.FURY_KERNEL_CAPABILITY_EXPOSURE_FORMAT !== 'furypipe-kernel-capability-exposure/v1') process.exit(1);",
  ], installDir);
  assert(capabilityExposureExport.stderr === '', `Fury Kernel capability exposure export wrote stderr: ${capabilityExposureExport.stderr}`);

  const gatewayChannelAdapterExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-channel-adapter-node'); if (typeof m.createFuryGatewayChannelAdapterRegistry !== 'function' || typeof m.isGeneratedFuryGatewayChannelInboundEvent !== 'function' || m.FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT !== 'furypipe-gateway-channel-adapter/v1') process.exit(1);",
  ], installDir);
  assert(gatewayChannelAdapterExport.stderr === '', `Gateway channel adapter export wrote stderr: ${gatewayChannelAdapterExport.stderr}`);

  const gatewayChannelPrincipalBindingExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-channel-principal-binding-node'); if (typeof m.createFuryGatewayChannelPrincipalBindingCoordinator !== 'function' || typeof m.isGeneratedFuryGatewayChannelPrincipalBinding !== 'function' || typeof m.isGeneratedFuryGatewayChannelPrincipalBindingCoordinator !== 'function' || m.FURY_GATEWAY_CHANNEL_PRINCIPAL_BINDING_FORMAT !== 'furypipe-gateway-channel-principal-binding/v1') process.exit(1);",
  ], installDir);
  assert(gatewayChannelPrincipalBindingExport.stderr === '', `Gateway channel principal binding export wrote stderr: ${gatewayChannelPrincipalBindingExport.stderr}`);

  const gatewayChannelDeliveryExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-channel-delivery-node'); if (typeof m.createFuryGatewayChannelDeliveryCoordinator !== 'function' || typeof m.isGeneratedFuryGatewayChannelDeliveryPermit !== 'function' || typeof m.isGeneratedFuryGatewayChannelDeliveryCoordinator !== 'function' || m.FURY_GATEWAY_CHANNEL_DELIVERY_PERMIT_FORMAT !== 'furypipe-gateway-channel-delivery-permit/v1' || m.FURY_GATEWAY_CHANNEL_DELIVERY_RECEIPT_FORMAT !== 'furypipe-gateway-channel-delivery-receipt/v1') process.exit(1);",
  ], installDir);
  assert(gatewayChannelDeliveryExport.stderr === '', `Gateway channel delivery export wrote stderr: ${gatewayChannelDeliveryExport.stderr}`);

  const gatewayChannelObservabilityCommandExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-channel-observability-command-node'); if (!Array.isArray(m.FURY_GATEWAY_CHANNEL_OBSERVABILITY_COMMAND_DEFINITIONS) || m.FURY_GATEWAY_CHANNEL_OBSERVABILITY_COMMAND_DEFINITIONS[0]?.name !== 'channels.status') process.exit(1);",
  ], installDir);
  assert(gatewayChannelObservabilityCommandExport.stderr === '', `Gateway channel observability command export wrote stderr: ${gatewayChannelObservabilityCommandExport.stderr}`);

  const gatewayChannelObservabilityExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-channel-observability-node'); if (typeof m.createFuryGatewayChannelObservability !== 'function' || typeof m.isGeneratedFuryGatewayChannelObservability !== 'function' || m.FURY_GATEWAY_CHANNEL_OBSERVABILITY_FORMAT !== 'furypipe-gateway-channel-observability/v1' || m.FURY_GATEWAY_CHANNEL_OBSERVABILITY_RESULT_FORMAT !== 'furypipe-gateway-channel-observability-result/v1') process.exit(1);",
  ], installDir);
  assert(gatewayChannelObservabilityExport.stderr === '', `Gateway channel observability export wrote stderr: ${gatewayChannelObservabilityExport.stderr}`);

  const gatewayAutomationDefinitionExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-automation-definition-node'); if (typeof m.createFuryGatewayAutomationDefinitionStore !== 'function' || typeof m.isGeneratedFuryGatewayAutomationDefinitionStore !== 'function' || m.FURY_GATEWAY_AUTOMATION_DEFINITION_FORMAT !== 'furypipe-gateway-automation-definition/v1' || m.FURY_GATEWAY_AUTOMATION_DEFINITION_INSPECTION_FORMAT !== 'furypipe-gateway-automation-definition-inspection/v1') process.exit(1);",
  ], installDir);
  assert(gatewayAutomationDefinitionExport.stderr === '', `Gateway automation definition export wrote stderr: ${gatewayAutomationDefinitionExport.stderr}`);

  const gatewayAutomationRunLedgerExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-automation-run-ledger-node'); if (typeof m.createFuryGatewayAutomationRunLedger !== 'function' || typeof m.isGeneratedFuryGatewayAutomationRunLedger !== 'function' || m.FURY_GATEWAY_AUTOMATION_TRIGGER_RECORD_FORMAT !== 'furypipe-gateway-automation-trigger-record/v1' || m.FURY_GATEWAY_AUTOMATION_RUN_STATUS_FORMAT !== 'furypipe-gateway-automation-run-status/v1') process.exit(1);",
  ], installDir);
  assert(gatewayAutomationRunLedgerExport.stderr === '', `Gateway automation run ledger export wrote stderr: ${gatewayAutomationRunLedgerExport.stderr}`);

  const gatewayAutomationSchedulerExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-automation-scheduler-node'); if (typeof m.createFuryGatewayAutomationScheduler !== 'function' || typeof m.isGeneratedFuryGatewayAutomationScheduler !== 'function' || m.FURY_GATEWAY_AUTOMATION_SCHEDULER_TICK_FORMAT !== 'furypipe-gateway-automation-scheduler-tick/v1') process.exit(1);",
  ], installDir);
  assert(gatewayAutomationSchedulerExport.stderr === '', `Gateway automation scheduler export wrote stderr: ${gatewayAutomationSchedulerExport.stderr}`);

  const gatewayAutomationRunAdmissionExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-automation-run-admission-node'); if (typeof m.createFuryGatewayAutomationRunAdmissionCoordinator !== 'function' || typeof m.isGeneratedFuryGatewayAutomationRunPermit !== 'function' || m.FURY_GATEWAY_AUTOMATION_RUN_ADMISSION_FORMAT !== 'furypipe-gateway-automation-run-admission/v1' || m.FURY_GATEWAY_AUTOMATION_RUN_PERMIT_FORMAT !== 'furypipe-gateway-automation-run-permit/v1') process.exit(1);",
  ], installDir);
  assert(gatewayAutomationRunAdmissionExport.stderr === '', `Gateway automation run admission export wrote stderr: ${gatewayAutomationRunAdmissionExport.stderr}`);

  const gatewayNotificationExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-notification-node'); if (typeof m.createFuryGatewayNotificationCoordinator !== 'function' || typeof m.isGeneratedFuryGatewayNotification !== 'function' || typeof m.isGeneratedFuryGatewayNotificationRoutePlan !== 'function' || typeof m.isGeneratedFuryGatewayNotificationCoordinator !== 'function' || m.FURY_GATEWAY_NOTIFICATION_FORMAT !== 'furypipe-gateway-notification/v1' || m.FURY_GATEWAY_NOTIFICATION_DELIVERY_RECEIPT_FORMAT !== 'furypipe-gateway-notification-delivery-receipt/v1') process.exit(1);",
  ], installDir);
  assert(gatewayNotificationExport.stderr === '', `Gateway notification export wrote stderr: ${gatewayNotificationExport.stderr}`);

  const gatewayDiscordAdapterExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-discord-adapter-node'); if (typeof m.createFuryGatewayDiscordAdapter !== 'function' || typeof m.isGeneratedFuryGatewayDiscordAdapter !== 'function' || typeof m.isGeneratedFuryGatewayDiscordServiceAuthentication !== 'function' || typeof m.isGeneratedFuryGatewayDiscordInboundEvent !== 'function' || m.FURY_GATEWAY_DISCORD_SERVICE_AUTH_FORMAT !== 'furypipe-gateway-discord-service-auth/v1' || m.FURY_GATEWAY_DISCORD_EVENT_FORMAT !== 'furypipe-gateway-discord-event/v1') process.exit(1);",
  ], installDir);
  assert(gatewayDiscordAdapterExport.stderr === '', `Gateway Discord adapter export wrote stderr: ${gatewayDiscordAdapterExport.stderr}`);

  const gatewayLocalMemoryRuntimeExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-local-memory-runtime-node'); if (typeof m.createFuryGatewayLocalMemoryRuntime !== 'function' || m.FURY_GATEWAY_LOCAL_MEMORY_CONFIG_FORMAT !== 'furypipe-gateway-local-memory-config/v1') process.exit(1);",
  ], installDir);
  assert(gatewayLocalMemoryRuntimeExport.stderr === '', `Gateway local memory runtime export wrote stderr: ${gatewayLocalMemoryRuntimeExport.stderr}`);

  const furyKernelMemoryBridgeExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/fury-kernel-memory-bridge-node'); if (typeof m.createFuryKernelMemoryBridge !== 'function' || m.FURY_KERNEL_MEMORY_BRIDGE_FORMAT !== 'furypipe-kernel-memory-bridge/v1') process.exit(1);",
  ], installDir);
  assert(furyKernelMemoryBridgeExport.stderr === '', `Fury Kernel memory bridge export wrote stderr: ${furyKernelMemoryBridgeExport.stderr}`);

  const gatewayMemoryCommandExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-memory-command-node'); if (!Array.isArray(m.FURY_GATEWAY_MEMORY_COMMAND_NAMES) || !Array.isArray(m.FURY_GATEWAY_MEMORY_COMMAND_DEFINITIONS)) process.exit(1);",
  ], installDir);
  assert(gatewayMemoryCommandExport.stderr === '', `Gateway memory command export wrote stderr: ${gatewayMemoryCommandExport.stderr}`);

  const gatewayMemoryAdapterExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway-memory-adapter-node'); if (typeof m.createFuryGatewayMemoryAdapter !== 'function' || m.FURY_GATEWAY_MEMORY_RESULT_FORMAT !== 'furypipe-gateway-memory-result/v1') process.exit(1);",
  ], installDir);
  assert(gatewayMemoryAdapterExport.stderr === '', `Gateway memory adapter export wrote stderr: ${gatewayMemoryAdapterExport.stderr}`);
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
  const controlPlaneExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/control-plane'); if (typeof m.createControlPlaneSnapshot !== 'function' || !Array.isArray(m.CONTROL_PLANE_LIFECYCLE)) process.exit(1);",
  ], installDir);
  assert(controlPlaneExport.stderr === '', `Control Plane package export wrote stderr: ${controlPlaneExport.stderr}`);
  const gatewayExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/gateway'); if (typeof m.parseFuryGatewayConnectEnvelope !== 'function' || typeof m.deriveFuryGatewayConnectFingerprint !== 'function' || typeof m.createFuryGatewayHealthSnapshot !== 'function' || typeof m.FuryGatewayProtocolError !== 'function' || typeof m.authenticateGatewayConnection !== 'undefined' || typeof m.pairGatewayDevice !== 'undefined' || typeof m.executeGatewayCommand !== 'undefined') process.exit(1);",
  ], installDir);
  assert(gatewayExport.stderr === '', `Fury Gateway package export wrote stderr: ${gatewayExport.stderr}`);
  const gatewayHiddenExports = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "for (const subpath of ['gateway-auth-node','gateway-pairing-node','gateway-principal-node','gateway-session-node','gateway-command-authorization-node','gateway-transport-node','gateway-websocket-host-node','gateway-runtime-daemon-node','gateway-local-operator-bootstrap-node','gateway-local-config-node','gateway-local-cli-node']) { try { await import('furypipe/' + subpath); process.exit(2); } catch (error) { if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; } }",
  ], installDir);
  assert(gatewayHiddenExports.stderr === '', `Hidden Gateway authority package paths wrote stderr: ${gatewayHiddenExports.stderr}`);
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