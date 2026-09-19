# Fury Gateway Device Authentication & Pairing (VNext Phase 1.1, 2026)

## Scope

This track adds cryptographic **device authentication evidence** and an explicit in-memory **pairing registry** on top of the credential-free Gateway envelope.

It deliberately does not add:

- WebSocket transport;
- remote listening;
- bearer/session tokens;
- OAuth/OIDC;
- user login;
- scopes;
- command authorization;
- worker execution;
- automatic remote pairing;
- durable pairing persistence.

The implementation is a security boundary foundation, not a complete Gateway.

## State separation

The core invariant is:

```text
valid connect envelope
!= authenticated device

authenticated device
!= paired device

paired device
!= authorized device

authorized device
!= executed command

executed command
!= verified outcome
```

### Connect envelope

The Phase 1 envelope remains descriptive only:

```text
authority = unverified
```

### Authenticated device

A successful Ed25519 challenge proof produces:

```text
authority = authenticated-device
pairing = unpaired
authorization = none
```

### Paired device

An explicit trusted-host pairing decision produces:

```text
status = paired
authorization = none
```

Pairing therefore pins identity but grants no command/tool scope.

## Process-local provenance

A successful signature verification returns an authenticated-device object that is also registered in a process-local provenance set.

Therefore:

```text
valid serialized shape
!= authenticated-device authority

copied object
!= authenticated-device authority

JSON round-trip
!= authenticated-device authority
```

The pairing coordinator accepts only provenance-bearing evidence produced by the actual verifier in this process.

This follows the same anti-forgery pattern already used by FuryPipe governed execution surfaces: public data can describe evidence, but serialized data alone cannot recreate process-local authority.

## Device identity

The device uses an Ed25519 key pair.

The private key is owned by the device and is never part of the Gateway connect envelope.

The device ID is derived from the canonical SPKI DER public key:

```text
deviceId = "fgwdev_" + base64url(sha256(publicKeyDer))
```

This avoids trusting a user-supplied device name as cryptographic identity.

Device labels/names may be added later as display metadata only.

## Challenge protocol

The coordinator issues a fresh random challenge:

```text
format
challengeId
nonce
issuedAt
expiresAt
```

Default lifetime: 30 seconds.

Supported configured lifetime:

```text
5 seconds <= challenge TTL <= 120 seconds
```

The challenge is single-use.

Successful verification consumes the challenge. A second use returns a stable replay failure.

## Signed proof

The proof binds:

- challenge ID;
- challenge nonce;
- signed timestamp;
- derived device ID;
- canonical public key;
- exact Fury Gateway connect-envelope fingerprint.

Because the connect fingerprint already covers:

- role;
- client ID;
- instance ID;
- platform;
- device family;
- advertised capabilities;
- advertised commands;

changing any of those fields after signing invalidates the proof.

## Proof input hardening

Proof objects are exact-schema plain data objects.

The verifier rejects:

- unknown fields;
- symbol keys;
- accessor/getter properties;
- custom prototypes;
- over-size proof strings;
- malformed digest/device-id fields.

This prevents schema drift or hidden authority/secret fields from being smuggled into the signed-proof boundary.

## Replay model

The current coordinator maintains:

- bounded active challenges;
- bounded consumed-challenge IDs.

Default limits:

- 4096 active;
- 4096 consumed replay markers.

This is process-local Phase 1.1 state.

Durable replay protection will be required before a production remote Gateway is enabled.

## Pairing

Pairing is a separate explicit operation.

### Pairing freshness

A pairing request requires fresh authenticated-device evidence.

Default maximum authenticated-evidence age:

```text
60 seconds
```

Configurable range:

```text
5 seconds <= authenticated evidence age <= 5 minutes
```

This prevents an old process-local authentication object from being retained indefinitely and later reused to initiate pairing.

Pairing approval still remains a distinct trusted-host action.

Pairing is a separate explicit operation.

A fresh authenticated-device evidence object can request pairing.

The pairing coordinator pins:

- device ID;
- public-key digest;
- role;
- client ID;
- platform;
- device family.

It intentionally does not pin:

- ephemeral instance ID;
- capability grants;
- command permissions.

Capabilities/commands advertised in a connection remain declarations, not authorization.

## Pairing lifetime and quotas

Default pending request TTL:

- 5 minutes.

Configurable range:

- 30 seconds to 30 minutes.

Default bounds:

- 1024 pending pairing requests;
- 8192 paired device+role identities.

Each device+role has at most one active pairing.

A different role requires a separate pairing identity.

## Pairing approval

The coordinator requires the trusted host to provide a principal ID when approving.

The library does not authenticate that principal itself.

That is intentional: principal authentication belongs to the future operator/session identity layer.

Therefore:

```text
pairedByPrincipalId
= audit evidence supplied by the trusted Gateway host
!= proof of user authentication by this module
```

## Revocation

Pairings can be explicitly revoked by:

```text
deviceId + role
```

A future durable registry must preserve revocation across Gateway restarts.

## Metadata pinning

When a paired device reconnects, the pairing registry checks stable identity metadata.

A changed platform/device-family/client identity does not silently inherit the old pairing.

This is deliberately fail-closed.

## Security references used for the design

The architecture is informed by current public security patterns including:

- OpenClaw's server challenge before connect and device-key proof;
- Tailscale's separation of user identity and device/node identity;
- OWASP WebSocket guidance on per-action authorization, origin validation, size/rate bounds and secret-safe logging.

FuryPipe does not copy those protocols verbatim. It uses its own versioned contracts and lifecycle semantics.

## Next security track

Before a real network transport is allowed, the next layer must specify:

1. operator/principal authentication;
2. session identity;
3. session-token rotation/revocation;
4. authorization scopes;
5. per-command authorization;
6. durable device pairing/revocation;
7. origin allowlist;
8. connection/message rate limits;
9. payload bounds/backpressure;
10. transport event sequencing and resync;
11. audit logging without credentials or full sensitive payloads;
12. loopback versus remote policy.

Only after those gates should FuryPipe expose a production persistent WebSocket Gateway.