import { open } from 'node:fs/promises';
import { startFuryGatewayDaemon } from '../../dist/gateway-runtime-daemon-node.js';
import { createFuryGatewayCommandRegistry } from '../../dist/gateway-command-authorization-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
} from '../../dist/gateway-principal-node.js';
import { createFuryGatewaySessionCoordinator } from '../../dist/gateway-session-node.js';

const statePath = process.argv[2];
if (!statePath) throw new Error('state path is required');

let now = Date.now();
const principals = createFuryGatewayPrincipalRegistry({ now: () => now });
const principal = principals.recordAuthenticatedPrincipal({
  format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  principalId: 'principal:final-validation',
  kind: 'human',
  issuer: 'local',
  subject: 'final-validation',
  authenticationMethod: 'local-owner',
});
const sessions = createFuryGatewaySessionCoordinator({
  principalRegistry: principals,
  gatewayInstanceId: `gateway-final-validation-${process.pid}`,
  now: () => now,
  defaultTtlMs: 60_000,
  maxTtlMs: 60_000,
});
const session = sessions.issueSession({
  principal,
  role: 'operator',
  scopes: ['gateway.inspect'],
  binding: { kind: 'local-operator' },
});

const daemon = await startFuryGatewayDaemon({
  sessionCoordinator: sessions,
  commandRegistry: createFuryGatewayCommandRegistry(),
  resolveConnection: ({ origin }) => origin === 'http://localhost:3000'
    ? { session, clientKind: 'browser' }
    : undefined,
  config: {
    allowedOrigins: ['http://localhost:3000'],
    maxPayloadBytes: 64 * 1024,
  },
  now: () => now,
});

const file = await open(statePath, 'w', 0o600);
try {
  await file.writeFile(`${JSON.stringify({
    pid: process.pid,
    url: daemon.address.url,
    subprotocol: daemon.address.subprotocol,
    status: daemon.inspect().status,
    authority: daemon.inspect().authority,
  })}\n`, 'utf8');
  await file.sync();
} finally {
  await file.close();
}

let stopping;
async function stop() {
  if (stopping) return stopping;
  stopping = daemon.stop().then(() => process.exit(0));
  return stopping;
}
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
