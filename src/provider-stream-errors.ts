export type FuryGovernedProviderStreamErrorCode =
  | 'invalid-input'
  | 'stream-transport-not-registered'
  | 'stream-transport-provider-mismatch'
  | 'stream-transport-protocol-mismatch'
  | 'stream-transport-error'
  | 'stream-session-invalid'
  | 'stream-event-invalid'
  | 'stream-event-too-large'
  | 'stream-interrupted';

const SAFE_MESSAGES: Readonly<Record<FuryGovernedProviderStreamErrorCode, string>> = Object.freeze({
  'invalid-input': 'Governed provider stream input is invalid.',
  'stream-transport-not-registered': 'No exact provider stream transport is registered.',
  'stream-transport-provider-mismatch': 'Provider stream transport identity does not match the request.',
  'stream-transport-protocol-mismatch': 'Provider stream transport protocol does not match the request.',
  'stream-transport-error': 'Provider stream transport failed.',
  'stream-session-invalid': 'Provider stream transport returned an invalid session.',
  'stream-event-invalid': 'Provider stream transport returned an invalid event.',
  'stream-event-too-large': 'Provider stream output exceeded the governed size limit.',
  'stream-interrupted': 'Provider stream ended without a trustworthy terminal event.',
});

export class FuryGovernedProviderStreamError extends Error {
  constructor(
    readonly code: FuryGovernedProviderStreamErrorCode,
    readonly transportInvoked: boolean,
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = 'FuryGovernedProviderStreamError';
  }
}
