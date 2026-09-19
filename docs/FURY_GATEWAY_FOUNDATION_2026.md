# Fury Gateway Foundation (VNext Phase 1, 2026)

## Status

Phase 1 foundation only.

This change deliberately does **not** start a public WebSocket server, persist credentials, pair devices, run workers, execute tools or create model sessions.

The first implementation freezes the credential-free protocol envelope and bounded health contract before adding a transport.

## Security rule

A valid connection envelope is descriptive evidence only.

```text
valid envelope != authenticated
authenticated != paired
paired != authorized
capability advertised != capability granted
command advertised != command executable
```

Authentication and pairing will be transport-level authorities introduced by a later VNext track.

## Roles

The initial protocol vocabulary is intentionally small:

- `operator`: a control-plane client such as CLI, desktop or web UI;
- `node`: a paired device endpoint that may later advertise device capabilities/commands;
- `channel`: a messaging/channel adapter;
- `worker`: an isolated execution worker.

Operator and channel handshakes cannot advertise executable commands.

## Connect envelope

Format: `furypipe-gateway-connect/v1`

Protocol: `furypipe-gateway/v1`

The public envelope contains only:

- role;
- bounded client/instance identifiers;
- optional platform/device-family metadata;
- capability names;
- command names.

The parser rejects unknown fields, so credentials cannot accidentally drift into the public handshake contract.

Parsed envelopes are marked:

```text
authority = unverified
```

by construction.

## Bounds

Initial hard limits:

- client id: 128 UTF-8 bytes;
- instance id: 128 UTF-8 bytes;
- platform: 48 UTF-8 bytes;
- device family: 64 UTF-8 bytes;
- capability: 96 UTF-8 bytes;
- command: 96 UTF-8 bytes;
- capabilities: 64;
- commands: 128.

Duplicates are rejected rather than silently merged.

Lists are canonicalized before hashing so equivalent handshakes have stable SHA-256 fingerprints.

## Health

`furypipe-gateway-health/v1` is observability-only.

It contains:

- lifecycle status: `starting | ready | draining`;
- start/observation timestamps;
- uptime;
- bounded connection counters by role;
- session/automation/worker counters.

A healthy Gateway does not imply that providers, channels, credentials, workers or tools are authorized or verified.

## Next gates

Before a real network listener is introduced, Phase 1 must specify and test:

1. transport handshake and nonce/challenge;
2. principal identity;
3. pairing;
4. device/node keys;
5. session ownership;
6. replay protection;
7. remote-vs-loopback policy;
8. rate/buffer limits;
9. event ordering/resync semantics;
10. credential isolation.

Only after these boundaries exist should `furypipe gateway` expose a persistent socket.
