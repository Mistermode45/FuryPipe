import { exec, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const root = process.cwd();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
async function run(file, args, cwd) {
  if (process.platform === 'win32' && file.endsWith('.cmd')) {
    // npm is exposed as a .cmd shim on Windows. Use one quoted command
    // string so Node does not emit DEP0190 for shell=true plus argv.
    const quote = (value) => `"${String(value).replaceAll('"', '\\"')}"`;
    return execAsync([file, ...args.map(quote)].join(' '), {
      cwd,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    });
  }
  return execFileAsync(file, args, {
    cwd,
    env: process.env,
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
  tarball = path.resolve(root, metadata.filename);
  assert(existsSync(tarball), `npm pack did not create ${metadata.filename}`);

  installDir = await mkdtemp(path.join(os.tmpdir(), 'furypipe-package-smoke-'));
  await run(npm, ['init', '-y'], installDir);
  await run(npm, ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installDir);

  const packageRoot = path.join(installDir, 'node_modules', 'furypipe');
  const cli = path.join(packageRoot, 'bin', 'cli.js');
  const mcp = path.join(packageRoot, 'bin', 'mcp.js');
  const version = await run(process.execPath, [cli, '--version'], installDir);
  assert(version.stdout.trim() === metadata.version, `CLI version mismatch: ${version.stdout}`);

  const doctor = await run(process.execPath, [cli, 'doctor', '--json'], installDir);
  const report = JSON.parse(doctor.stdout);
  assert(report.runtime?.node, 'doctor smoke returned no Node runtime');
  const httpExport = await run(process.execPath, [
    '--input-type=module',
    '-e',
    "const m = await import('furypipe/mcp-modern'); if (typeof m.createProductionMcpHandler !== 'function') process.exit(1);",
  ], installDir);
  assert(httpExport.stderr === '', `MCP HTTP package export wrote stderr: ${httpExport.stderr}`);
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
