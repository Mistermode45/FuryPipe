import { boundedText, hasExplicitOptIn, isPresent, presence, sourceCommit, writeEvidence } from './external-validation-common.mjs';

const MAX_BODY_BYTES = 1_048_576;
const issuerValue = boundedText(process.env.FURYPIPE_OIDC_ISSUER, 2_048);
const allowedHostname = boundedText(process.env.FURYPIPE_OIDC_ALLOWED_HOSTNAME, 253)?.toLowerCase();
const issuerCredentialPresence = presence([
  'FURYPIPE_OIDC_CLIENT_ID',
  'FURYPIPE_OIDC_CLIENT_SECRET',
  'FURYPIPE_OIDC_BEARER_TOKEN',
]);
const baseEvidence = {
  format: 'furypipe-oidc-live-validation/v1',
  sourceCommit: sourceCommit(),
  requestExecuted: false,
  externalMutation: false,
  credentialPresence: issuerCredentialPresence,
  scope: 'OIDC discovery and JWKS retrieval; optional read-only userinfo probe',
};

function fail(message) {
  const error = new Error(message);
  error.safe = true;
  throw error;
}

function issuerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('issuer URL is invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    fail('issuer must be an HTTPS URL without credentials, query or fragment');
  }
  url.pathname = url.pathname.replace(/\/+$/u, '');
  return url;
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) fail('OIDC HTTP status was not successful');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) fail('response body exceeded the bounded OIDC limit');
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail('OIDC response was not valid JSON');
  }
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

if (!hasExplicitOptIn('FURYPIPE_OIDC_LIVE_AUTHORIZED')) {
  await writeEvidence('oidc-live.json', {
    ...baseEvidence,
    status: 'AUTHORIZATION_REQUIRED',
    reason: 'Set FURYPIPE_LIVE_VALIDATION=1 and FURYPIPE_OIDC_LIVE_AUTHORIZED=YES to authorize external OIDC requests.',
  });
} else if (!issuerValue || !allowedHostname) {
  await writeEvidence('oidc-live.json', {
    ...baseEvidence,
    status: 'BLOCKED_EXTERNAL_ENV',
    reason: 'FURYPIPE_OIDC_ISSUER and exact FURYPIPE_OIDC_ALLOWED_HOSTNAME are required.',
  });
  process.exitCode = 2;
} else {
  try {
    const issuer = issuerUrl(issuerValue);
    if (issuer.hostname.toLowerCase() !== allowedHostname) fail('issuer hostname does not match the explicit allowlist');
    const discovery = record(await jsonRequest(issuer.origin + issuer.pathname + '/.well-known/openid-configuration'));
    if (!discovery) fail('OIDC discovery document is not an object');
    if (typeof discovery.issuer !== 'string' || discovery.issuer.replace(/\/+$/u, '') !== issuer.toString().replace(/\/+$/u, '')) {
      fail('discovery issuer does not match the configured issuer');
    }
    if (typeof discovery.jwks_uri !== 'string' || typeof discovery.token_endpoint !== 'string') {
      fail('discovery document omitted jwks_uri or token_endpoint');
    }
    const jwks = new URL(discovery.jwks_uri);
    const tokenEndpoint = new URL(discovery.token_endpoint);
    if (jwks.protocol !== 'https:' || tokenEndpoint.protocol !== 'https:' || jwks.hostname.toLowerCase() !== allowedHostname) {
      fail('OIDC endpoints are outside the exact HTTPS host allowlist');
    }
    const jwksDocument = record(await jsonRequest(jwks.toString()));
    if (!jwksDocument || !Array.isArray(jwksDocument.keys) || jwksDocument.keys.length === 0) {
      fail('JWKS response did not contain a non-empty keys array');
    }
    let userinfo = 'NOT_REQUESTED';
    if (isPresent('FURYPIPE_OIDC_BEARER_TOKEN')) {
      if (typeof discovery.userinfo_endpoint !== 'string') fail('bearer token supplied but discovery omitted userinfo_endpoint');
      const userinfoEndpoint = new URL(discovery.userinfo_endpoint);
      if (userinfoEndpoint.protocol !== 'https:' || userinfoEndpoint.hostname.toLowerCase() !== allowedHostname) {
        fail('userinfo endpoint is outside the exact HTTPS host allowlist');
      }
      const response = await fetch(userinfoEndpoint, {
        method: 'GET',
        headers: { authorization: 'Bearer ' + process.env.FURYPIPE_OIDC_BEARER_TOKEN.trim() },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) fail('userinfo HTTP status was not successful');
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength > MAX_BODY_BYTES) fail('userinfo response exceeded the bounded OIDC limit');
      userinfo = 'HTTP_2XX';
    }
    await writeEvidence('oidc-live.json', {
      ...baseEvidence,
      status: 'PARTIAL',
      requestExecuted: true,
      issuerHostname: issuer.hostname,
      discovery: 'VERIFIED',
      jwks: 'VERIFIED',
      userinfo,
      limitation: 'Discovery/JWKS and optional userinfo do not by themselves prove token signature, issuer/audience policy, expiry, scopes or production authorization.',
    });
  } catch {
    await writeEvidence('oidc-live.json', {
      ...baseEvidence,
      status: 'BLOCKED_EXTERNAL_ENV',
      requestExecuted: true,
      reason: 'OIDC validation failed; tokens and response bodies were not recorded.',
    });
    process.exitCode = 1;
  }
}
