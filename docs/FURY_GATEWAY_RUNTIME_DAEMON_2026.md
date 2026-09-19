# Fury Gateway Runtime Daemon (VNext Phase 1.4A, 2026)

## Status

Phase 1.4A composes the already-validated Gateway protocol, device auth, pairing, principal/session authority, transport kernel and real loopback WebSocket host into one **long-lived local runtime daemon**.

This phase does not add a browser login flow, a remote listener, an agent loop, command execution, automations or workers.

## Runtime lifecycle

```text
starting
→ ready
→ draining
→ stopped
```

The daemon lifecycle is observability state only.

```text
ready
!= user authenticated

ready
!= command authorized

ready
!= agent running
```

## Local-first network posture

The daemon delegates its physical listener to the Phase 1.3B WebSocket host.

Therefore inherited security remains:

- loopback-only bind;
- exact route and subprotocol;
- no query-string credentials;
- exact Origin allowlist;
- permessage-deflate disabled;
- bounded payloads;
- bounded pending upgrades;
- heartbeat;
- transport/session revalidation;
- no execution in socket callbacks.

## Health

The daemon exposes a bounded health snapshot derived from current runtime state.

Health includes:

- lifecycle status;
- uptime;
- exact active connection counts per Gateway role;
- active session count;
- automation count = 0 in this phase;
- worker count = 0 in this phase.

Health remains observability only.

## Connection accounting

Phase 1.4A extends the safe WebSocket event `connection-open` with the already-known Gateway role.

The daemon keeps a process-local map:

```text
connectionId → role
```

This allows exact per-role increments/decrements without reading raw session/principal identity into logs or public events.

## Event journal

The daemon maintains a bounded in-memory event journal.

Default:

```text
512 events
```

Hard maximum:

```text
4096 events
```

Each event has:

- format;
- monotonic sequence;
- observedAt;
- type;
- bounded safe payload.

Journal eviction removes oldest observability evidence only.

```text
event evicted
!= action never happened
```

The event journal is not durable recovery evidence.

## Event subscriptions

Consumers may subscribe to safe daemon events.

Subscriber exceptions are isolated and cannot affect runtime authority or network processing.

```text
observer failure
!= Gateway failure
```

## Stop semantics

`stop()` is idempotent.

First call:

1. transitions to `draining`;
2. stops the WebSocket host;
3. closes active sockets using the host's governed shutdown path;
4. clears local connection accounting;
5. transitions to `stopped`;
6. clears subscribers.

Subsequent calls return the same stop promise.

The daemon does not claim that arbitrary future external effects are cancelled merely because the transport closed.

## Health after stop

Live health after `stopped` fails closed.

A stopped daemon can still be inspected for its final lifecycle/event sequence, but cannot report itself as a live healthy Gateway.

## Authority boundaries

```text
daemon running
!= principal authority

daemon event
!= session authority

health snapshot
!= execution authority

WebSocket connection
!= command authorization

command eligible
!= execution permit

executed
!= verified
```

## Public package surface

The raw daemon module remains internal:

```text
gateway-runtime-daemon-node
```

It is not an npm package export.

The public Gateway contract remains:

```text
furypipe/gateway
```

A stable high-level user-facing daemon/CLI surface will be introduced only after local operator bootstrap and configuration contracts are complete.

## Explicitly NOT implemented

- no remote/WSS public bind;
- no browser credential/bootstrap flow;
- no durable session database;
- no channel adapters;
- no automations;
- no agent kernel;
- no command execution;
- no worker execution;
- no shell/browser/MCP execution inside daemon callbacks;
- no durable event journal;
- no service installation/startup integration yet.

## Validation gate

Require exact-head:

- frozen lock install;
- production audit;
- typecheck;
- full tests;
- real WebSocket daemon E2E;
- build;
- package smoke;
- 9/9 CI matrix;
- every applicable workflow green.

No merge, release, tag, publish or deploy.
