import * as acp from '@agentclientprotocol/sdk';

export const FURY_ACP_V1_CLIENT_TRANSPORT_FORMAT =
  'furypipe-acp-v1-client-transport/v1' as const;
export const FURY_ACP_V1_CLIENT_CAPABILITIES_FORMAT =
  'furypipe-acp-v1-client-capabilities/v1' as const;

export type FuryAcpV1ClientOperation =
  | 'fs.read'
  | 'fs.write'
  | 'terminal.create'
  | 'terminal.output'
  | 'terminal.wait'
  | 'terminal.kill'
  | 'terminal.release';

export interface FuryAcpV1ClientCapabilitiesSnapshot {
  readonly format: typeof FURY_ACP_V1_CLIENT_CAPABILITIES_FORMAT;
  readonly fsReadTextFile: boolean;
  readonly fsWriteTextFile: boolean;
  readonly terminal: boolean;
  readonly authority: 'advertised-capabilities-only';
  readonly executionAuthority: false;
}

export interface FuryAcpV1ClientTransport {
  readonly format: typeof FURY_ACP_V1_CLIENT_TRANSPORT_FORMAT;
  readonly capabilities: FuryAcpV1ClientCapabilitiesSnapshot;
  readonly authority: 'protocol-client-transport-only';
  readonly executionAuthority: false;
}

export class FuryAcpV1ClientTransportError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code:
      | 'invalid-transport'
      | 'transport-inactive'
      | 'capability-not-advertised',
  ) {
    super(
      code === 'invalid-transport'
        ? 'ACP client transport is not current process-local evidence.'
        : code === 'transport-inactive'
          ? 'ACP client transport is no longer active.'
          : 'ACP client capability was not advertised for this connection.',
    );
    this.name = 'FuryAcpV1ClientTransportError';
  }
}

interface TransportState {
  readonly capabilities: FuryAcpV1ClientCapabilitiesSnapshot;
  readonly request: (
    method: string,
    params: unknown,
    cancellationSignal?: AbortSignal,
  ) => Promise<unknown>;
  active: boolean;
}

const TRANSPORTS = new WeakMap<object, TransportState>();

export function snapshotFuryAcpV1ClientCapabilities(
  capabilities: acp.ClientCapabilities | undefined,
): FuryAcpV1ClientCapabilitiesSnapshot {
  return Object.freeze({
    format: FURY_ACP_V1_CLIENT_CAPABILITIES_FORMAT,
    fsReadTextFile: capabilities?.fs?.readTextFile === true,
    fsWriteTextFile: capabilities?.fs?.writeTextFile === true,
    terminal: capabilities?.terminal === true,
    authority: 'advertised-capabilities-only' as const,
    executionAuthority: false as const,
  });
}

export function createFuryAcpV1ClientTransport(
  capabilities: FuryAcpV1ClientCapabilitiesSnapshot,
  request: TransportState['request'],
): FuryAcpV1ClientTransport {
  if (
    capabilities.format !== FURY_ACP_V1_CLIENT_CAPABILITIES_FORMAT
    || capabilities.executionAuthority !== false
    || typeof request !== 'function'
  ) {
    throw new TypeError('ACP client transport configuration is invalid');
  }
  const transport = Object.freeze({
    format: FURY_ACP_V1_CLIENT_TRANSPORT_FORMAT,
    capabilities,
    authority: 'protocol-client-transport-only' as const,
    executionAuthority: false as const,
  });
  TRANSPORTS.set(transport, {
    capabilities,
    request,
    active: true,
  });
  return transport;
}

export function deactivateFuryAcpV1ClientTransport(
  transport: FuryAcpV1ClientTransport,
): void {
  const state = TRANSPORTS.get(transport as object);
  if (state) state.active = false;
}

export function isGeneratedFuryAcpV1ClientTransport(
  value: unknown,
): value is FuryAcpV1ClientTransport {
  return typeof value === 'object'
    && value !== null
    && TRANSPORTS.has(value);
}

function stateFor(
  transport: FuryAcpV1ClientTransport,
): TransportState {
  const state = TRANSPORTS.get(transport as object);
  if (!state) throw new FuryAcpV1ClientTransportError('invalid-transport');
  if (!state.active) throw new FuryAcpV1ClientTransportError('transport-inactive');
  return state;
}

function capabilityFor(
  operation: FuryAcpV1ClientOperation,
): keyof Pick<
  FuryAcpV1ClientCapabilitiesSnapshot,
  'fsReadTextFile' | 'fsWriteTextFile' | 'terminal'
> {
  if (operation === 'fs.read') return 'fsReadTextFile';
  if (operation === 'fs.write') return 'fsWriteTextFile';
  return 'terminal';
}

function methodFor(operation: FuryAcpV1ClientOperation): string {
  switch (operation) {
    case 'fs.read': return acp.methods.client.fs.readTextFile;
    case 'fs.write': return acp.methods.client.fs.writeTextFile;
    case 'terminal.create': return acp.methods.client.terminal.create;
    case 'terminal.output': return acp.methods.client.terminal.output;
    case 'terminal.wait': return acp.methods.client.terminal.waitForExit;
    case 'terminal.kill': return acp.methods.client.terminal.kill;
    case 'terminal.release': return acp.methods.client.terminal.release;
  }
}

export function assertFuryAcpV1ClientCapability(
  transport: FuryAcpV1ClientTransport,
  operation: FuryAcpV1ClientOperation,
): void {
  const state = stateFor(transport);
  if (!state.capabilities[capabilityFor(operation)]) {
    throw new FuryAcpV1ClientTransportError('capability-not-advertised');
  }
}

export async function requestFuryAcpV1ClientTransport<Response>(
  transport: FuryAcpV1ClientTransport,
  operation: FuryAcpV1ClientOperation,
  params: unknown,
  cancellationSignal?: AbortSignal,
): Promise<Response> {
  const state = stateFor(transport);
  if (!state.capabilities[capabilityFor(operation)]) {
    throw new FuryAcpV1ClientTransportError('capability-not-advertised');
  }
  return await state.request(
    methodFor(operation),
    params,
    cancellationSignal,
  ) as Response;
}
