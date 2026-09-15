export type FuryGovernedProviderExecutorErrorCode =
  | 'invalid-input'
  | 'invalid-prepared-attempt'
  | 'provider-not-registered'
  | 'provider-health-not-fresh'
  | 'provider-unavailable'
  | 'model-not-supported'
  | 'model-family-mismatch'
  | 'execution-not-authorized'
  | 'permit-expired'
  | 'permit-already-consumed'
  | 'permit-request-mismatch'
  | 'transport-not-registered'
  | 'transport-provider-mismatch'
  | 'transport-protocol-mismatch'
  | 'transport-result-invalid'
  | 'transport-error'
  | 'response-too-large';

const SAFE_MESSAGES: Readonly<Record<FuryGovernedProviderExecutorErrorCode, string>> = {
  'invalid-input': 'Governed provider executor input is invalid.',
  'invalid-prepared-attempt': 'The provider attempt was not prepared by this FuryPipe process.',
  'provider-not-registered': 'The exact provider is not registered.',
  'provider-health-not-fresh': 'Fresh provider health evidence is required.',
  'provider-unavailable': 'The exact provider is not available.',
  'model-not-supported': 'The exact model is not supported by the provider runtime.',
  'model-family-mismatch': 'The exact model family does not match the provider.',
  'execution-not-authorized': 'The host execution policy did not authorize this exact request.',
  'permit-expired': 'The provider execution permit has expired.',
  'permit-already-consumed': 'The provider execution permit has already been consumed.',
  'permit-request-mismatch': 'The provider execution permit is bound to another request.',
  'transport-not-registered': 'No exact provider transport is registered.',
  'transport-provider-mismatch': 'The registered transport does not match the exact provider.',
  'transport-protocol-mismatch': 'The registered transport protocol does not match the request.',
  'transport-result-invalid': 'The provider transport returned an invalid result.',
  'transport-error': 'The provider transport invocation failed.',
  'response-too-large': 'The provider transport response exceeds the configured byte limit.',
};

/** Stable, deliberately non-sensitive errors for the governed execution boundary. */
export class FuryGovernedProviderExecutorError extends Error {
  readonly transportInvoked: boolean;

  constructor(
    readonly code: FuryGovernedProviderExecutorErrorCode,
    options: { readonly transportInvoked?: boolean } = {},
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = 'FuryGovernedProviderExecutorError';
    this.transportInvoked = options.transportInvoked === true;
  }
}
