# Fury Gateway Local Config + CLI (VNext Phase 1.4C, 2026)

## Status

Phase 1.4C adds the first user-facing local CLI surface for the VNext Gateway while preserving the existing FuryPipe proxy runtime.

The legacy/current proxy remains:

```text
127.0.0.1:48721
```

The VNext Gateway defaults to:

```text
127.0.0.1:48722
```

This separation is intentional during migration.

## Commands

```text
furypipe gateway start
furypipe gateway start --json

furypipe gateway config
furypipe gateway config --json

furypipe gateway --help
```

There is deliberately no `gateway status` in this phase.

A TCP port accepting connections is not sufficient evidence that:

- the process is FuryPipe;
- the Gateway is healthy;
- the current operator session is active;
- the runtime has the expected authority state.

A future authenticated status surface may be added after a stable Control Plane client exists.

## Config file

Gateway config lives inside the existing FuryPipe config file:

```text
~/.config/furypipe/config.json
```

or the path selected by:

```text
FURYPIPE_CONFIG
```

Example:

```json
{
  "locale": "fr",
  "gateway": {
    "host": "127.0.0.1",
    "port": 48722,
    "bootstrapTtlMs": 60000,
    "browserSessionTtlMs": 900000,
    "maxEventHistory": 512
  }
}
```

Unrelated existing root fields remain compatible.

The `gateway` block itself is strict: unknown fields fail closed.

## Host policy

Accepted hosts:

- `127.0.0.1`
- `::1`
- `localhost`

No other host is accepted from either file or environment.

Therefore:

```text
FURYPIPE_GATEWAY_HOST=0.0.0.0
→ rejected
```

and:

```text
FURYPIPE_GATEWAY_HOST=192.168.x.x
→ rejected
```

This CLI phase cannot silently turn the local Gateway into a public listener.

## Environment overrides

Supported:

```text
FURYPIPE_CONFIG
FURYPIPE_GATEWAY_HOST
FURYPIPE_GATEWAY_PORT
```

Precedence:

```text
host/port: env > config file > defaults
other bounded Gateway options: config file > defaults
```

Environment variables do not create hidden auth tokens or capability scopes.

## Config file hardening

The config resolver:

- accepts a regular file only;
- rejects symlinks/non-regular paths;
- rejects files above 1 MiB;
- requires valid JSON;
- requires a JSON object root;
- requires a plain `gateway` object;
- rejects unknown Gateway keys;
- validates every numeric bound;
- never interprets arbitrary strings as remote bind addresses.

## Local runtime bootstrap

`furypipe gateway start` creates a local trusted-host principal boundary for the current OS user process.

It then creates:

```text
human principal
authenticationMethod = local-owner
role = operator
binding = local-operator
```

The initial session scope is intentionally minimal:

```text
gateway.inspect
```

No write, process, browser, MCP, model-management, plugin-management or provider-management scope is granted in this phase.

## Trusted-host assumption

The CLI's `local-owner` assertion means:

```text
the local FuryPipe process trusts the OS user context that launched it
```

It does **not** mean FuryPipe has independently authenticated a Windows/macOS/Linux password.

The raw local subject is used only at the trusted-host principal boundary; principal evidence stores the existing bound digest semantics.

## Command registry

The Phase 1.4C local runtime starts with an empty Gateway command registry.

Therefore a connected browser cannot gain action authority merely because the CLI started successfully.

```text
Gateway started
!= command registered
!= command eligible
!= execution permit
```

## Browser bootstrap

The CLI creates one bootstrap ticket before opening the long-lived user interaction loop.

If the daemon cannot bind/start, local principal/session authority is revoked before the startup error is returned.

On successful start, the CLI prints exactly one short-lived ticket.

The raw ticket exists only because the trusted local user needs to hand it to the local browser bootstrap flow.

It is not persisted by FuryPipe.

## JSON start output

`furypipe gateway start --json` is intended for trusted local automation.

It includes the one-time bootstrap code and therefore its output is secret-bearing.

Consumers must not:

- persist it to public logs;
- upload it to telemetry;
- include it in URLs;
- copy it into issue reports.

The JSON explicitly reports:

```text
authority = bootstrap-only
executionAuthority = false
```

## Shutdown

The Gateway runs in the foreground.

Default shutdown signals:

- SIGINT;
- SIGTERM.

Shutdown order:

1. revoke local browser sessions;
2. drain/stop the Gateway daemon;
3. revoke the local operator session;
4. revoke the local principal generation.

The stop path is idempotent.

## Existing FuryPipe proxy compatibility

`furypipe` and `furypipe start` retain their current proxy/control-plane behavior.

The new Gateway only starts via:

```text
furypipe gateway start
```

No automatic migration or port takeover occurs.

## Explicitly NOT implemented

- no public/non-loopback bind;
- no remote WSS;
- no username/password;
- no OAuth/OIDC login;
- no persistent Gateway secret;
- no durable browser token database;
- no remote status endpoint;
- no background OS service;
- no command execution;
- no Agent Kernel loop;
- no automatic capability elevation;
- no merge of proxy port 48721 and Gateway port 48722 yet.

## Validation requirements

Exact-head validation must prove:

- config defaults;
- file overrides;
- environment overrides;
- IPv4/IPv6 loopback origin formatting;
- remote bind rejection;
- unknown field rejection;
- oversized/non-regular config rejection;
- numeric bounds;
- CLI parser fail-closed behavior;
- config command does not start a runtime;
- start prints one bootstrap ticket;
- start waits for shutdown;
- start stops exactly once;
- startup error fails closed;
- existing full suite remains green;
- build and package smoke pass;
- 9/9 CI matrix passes;
- all applicable workflows green.

No merge, release, tag, publish or deploy.
