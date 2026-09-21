import type * as acp from '@agentclientprotocol/sdk';

export type FuryAcpExternalLifecycleState =
  | 'ready'
  | 'closed'
  | 'disconnected';

export interface FuryAcpExternalSessionInternalState {
  readonly agentId: string;
  readonly agentIdentitySha256: string;
  readonly protocolVersion: 1;
  readonly workspaceRootSha256: string;
  readonly agentCapabilitiesSha256: string;
  readonly acpSessionId: string;
  readonly connection: acp.ClientConnection;
  readonly lifecycle: () => FuryAcpExternalLifecycleState;
  readonly subscribeUpdates: (
    listener: (notification: acp.SessionNotification) => void,
  ) => () => void;
}

const INTERNAL_SESSION_STATE =
  new WeakMap<object, FuryAcpExternalSessionInternalState>();

export function registerFuryAcpExternalSessionInternal(
  session: object,
  state: FuryAcpExternalSessionInternalState,
): void {
  if (INTERNAL_SESSION_STATE.has(session)) {
    throw new Error('external ACP internal session state already registered');
  }
  INTERNAL_SESSION_STATE.set(session, Object.freeze(state));
}

export function getFuryAcpExternalSessionInternal(
  session: unknown,
): FuryAcpExternalSessionInternalState | undefined {
  if (!session || typeof session !== 'object') return undefined;
  return INTERNAL_SESSION_STATE.get(session);
}
