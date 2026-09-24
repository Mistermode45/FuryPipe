import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { WebSocket } from 'ws';
import os from 'node:os';
import path from 'node:path';
import { FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT } from '../dist/gateway-transport-node.js';
import { FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL } from '../dist/gateway-websocket-host-node.js';

const ROOT = process.cwd();
const WORKER = path.join(ROOT, 'scripts', 'fixtures', 'final-validation-gateway-worker.mjs');
const OUTPUT_DIR = path.resolve(
  process.env.FURYPIPE_VALIDATION_OUTPUT_DIR?.trim() || 'artifacts/final-validation',
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function childProcess(statePath) {
  const child = spawn(process.execPath, [WORKER, statePath], {
    cwd: ROOT,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
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

async function waitForState(pathname, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Gateway worker exited early: ${child.output.slice(-1000)}`);
    try {
      return JSON.parse(await readFile(pathname, 'utf8'));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error('Gateway worker readiness timeout');
}

function nextJson(ws) {
  return new Promise((resolve, reject) => {
    const onMessage = (data, binary) => {
      cleanup();
      if (binary) return reject(new Error('Gateway returned binary control frame'));
      try {
        resolve(JSON.parse(data.toString('utf8')));
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    ws.once('message', onMessage);
    ws.once('error', onError);
  });
}

async function connect(url, origin = 'http://localhost:3000') {
  const ws = new WebSocket(url, FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL, {
    headers: { Origin: origin },
  });
  const helloPromise = nextJson(ws);
  await once(ws, 'open');
  const hello = await helloPromise;
  assert(hello.type === 'connected', `Gateway handshake failed: ${JSON.stringify(hello)}`);
  assert(hello.executionAuthority === false, 'Gateway handshake exposed execution authority');
  return { ws, hello };
}

async function ping(ws, hello, sequence) {
  const responsePromise = nextJson(ws);
  ws.send(JSON.stringify({
    format: FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT,
    messageId: `final-validation-ping-${sequence}`,
    connectionId: hello.connectionId,
    sequence,
    type: 'ping',
    sentAt: Date.now(),
    payload: { nonce: `restart-${sequence}` },
  }));
  const response = await responsePromise;
  assert(response.type === 'pong', `Gateway ping did not return pong: ${JSON.stringify(response)}`);
  return response;
}

async function stop(child, force = false) {
  if (child.exitCode !== null) return;
  const close = once(child, 'close');
  child.kill(force ? 'SIGKILL' : 'SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  await close;
  clearTimeout(timer);
}

async function expectRejected(url) {
  const ws = new WebSocket(url, FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL, {
    headers: { Origin: 'https://invalid.example.test' },
  });
  const status = await new Promise((resolve, reject) => {
    ws.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    ws.once('open', () => reject(new Error('invalid-origin Gateway connection unexpectedly opened')));
    ws.once('error', (error) => {
      if (error.message.includes('Unexpected server response')) return;
      reject(error);
    });
  });
  assert(status === 401, `invalid-origin Gateway status was ${status}`);
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'furypipe-gateway-restart-'));
  const firstState = path.join(root, 'first.json');
  const secondState = path.join(root, 'second.json');
  const startedAt = Date.now();
  let first;
  let second;
  let firstSocket;
  let secondSocket;
  try {
    first = childProcess(firstState);
    const firstInfo = await waitForState(firstState, first);
    assert(firstInfo.status === 'ready', 'first Gateway worker was not ready');
    assert(firstInfo.authority === 'observability-only', 'first Gateway worker authority changed');
    const firstConnection = await connect(firstInfo.url);
    firstSocket = firstConnection.ws;
    await ping(firstSocket, firstConnection.hello, 1);
    await expectRejected(firstInfo.url);
    firstSocket.close();
    await once(firstSocket, 'close');
    await stop(first, true);

    second = childProcess(secondState);
    const secondInfo = await waitForState(secondState, second);
    assert(secondInfo.status === 'ready', 'restarted Gateway worker was not ready');
    assert(secondInfo.url !== firstInfo.url, 'Gateway restart unexpectedly reused stale address');
    const secondConnection = await connect(secondInfo.url);
    secondSocket = secondConnection.ws;
    await ping(secondSocket, secondConnection.hello, 1);
    secondSocket.close();
    await once(secondSocket, 'close');
    await stop(second, false);

    const evidence = {
      format: 'furypipe-final-gateway-restart/v1',
      status: 'PASS',
      generatedAt: new Date().toISOString(),
      platform: { os: process.platform, node: process.version },
      contract: {
        localGatewayStart: 'PASS',
        authBoundary: 'PASS',
        connectDisconnect: 'PASS',
        abruptRestart: 'PASS',
        reconnect: 'PASS',
        staleOriginDenied: 'PASS',
        executionAuthority: false,
        externalOpenClaw: 'NOT_EXECUTED',
      },
      durationMs: Date.now() - startedAt,
    };
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(path.join(OUTPUT_DIR, 'gateway-restart.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    if (firstSocket && firstSocket.readyState !== WebSocket.CLOSED) firstSocket.terminate();
    if (secondSocket && secondSocket.readyState !== WebSocket.CLOSED) secondSocket.terminate();
    if (first) await stop(first, true).catch(() => undefined);
    if (second) await stop(second, true).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
