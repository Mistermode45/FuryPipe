# FuryPipe Security Policy

## Supported versions

Security fixes are applied to the latest public FuryPipe release.

| Version | Security support |
|---|---|
| 0.14.x | Supported |
| 0.15.0 release candidate | Validated before publication; becomes the supported line when publicly released |
| Older releases / unreleased snapshots | Upgrade or reproduce on the latest supported release before triage |

Pre-1.0 releases may contain API changes. Security support refers to vulnerability fixes, not indefinite compatibility guarantees.

## Reporting a vulnerability

Do **not** open a public issue for a suspected vulnerability and do not include secrets, private prompts, request bodies, credentials or weaponized proof-of-concept material in public discussions.

Use GitHub private vulnerability reporting:

https://github.com/Mistermode45/FuryPipe/security/advisories/new

Include, where possible:

- affected FuryPipe version and runtime (Node or Cloudflare Workers);
- deployment topology and configuration needed to reproduce the issue;
- secrets removed or replaced with synthetic values;
- security impact and required attacker capability;
- minimal reproduction steps;
- relevant logs with sensitive content redacted;
- suggested mitigation, if known.

Maintainers will assess severity, coordinate a fix and release, and credit the reporter unless anonymity is requested.

## Security principles

FuryPipe is designed around explicit trust boundaries and fail-closed behavior.

Core expectations include:

- provider credentials never cross to an unrelated upstream by accident;
- untrusted external content does not gain instruction priority;
- secrets are not intentionally persisted in normal telemetry;
- Agent Runtime network/write capabilities require explicit permission;
- hosted/runtime claims require evidence rather than configuration alone;
- release state is kept separate from deployment state.

See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for the detailed threat model.

## Node deployment

The Node runtime is loopback-oriented by default.

If `FURYPIPE_HOST` is configured to a non-loopback address, the proxy API can become reachable off-host. Put any non-loopback deployment behind an authenticated TLS reverse proxy or another equivalent access-control boundary.

Dashboard routes remain loopback-only in the current runtime.

Do not expose a local development instance directly to an untrusted network.

## Cloudflare Workers deployment

When a Worker is configured with provider credentials, FuryPipe requires a shared secret and fails closed when it is missing.

Use the FuryPipe-native variable:

```text
FURYPIPE_WORKER_SECRET
```

Clients present the corresponding value with:

```text
x-furypipe-secret
```

Set the secret with Wrangler, for example:

```bash
npx wrangler secret put FURYPIPE_WORKER_SECRET
```

## Diagnostic capture

Full 4xx request/upstream-error capture is a debugging feature and may contain prompts, tool data or credentials.

The FuryPipe-native opt-in is:

```text
FURYPIPE_DEBUG_CAPTURE_4XX=1
```

Do not enable diagnostic body capture in normal production operation unless the storage, retention and access model is explicitly controlled.

## Filesystem and Recovery security

Local telemetry, rendered artifacts and configuration files should be treated as sensitive.

The Recovery Store supports bounded storage and optional AES-256-GCM object encryption when the host provides key material. The host remains responsible for key lifecycle, filesystem access and backup policy.

POSIX owner-only permissions are applied where supported. Windows ACL enforcement remains host-managed and should not be inferred from POSIX tests.

## Supply-chain and release security

FuryPipe's repository release model includes separate controls for:

- multi-OS / multi-Node CI;
- CodeQL/static analysis;
- secret scanning;
- supply-chain checks;
- license compliance;
- package smoke tests;
- provenance/attestation workflows;
- tag/version/source binding;
- npm Trusted Publishing for automated publication.

Release controls must not be weakened merely to make a failing release pass.

The first public `0.13.2` npm publication was bootstrapped manually so the package could exist before npm Trusted Publishing was configured. Trusted Publishing is configured for subsequent automated publication. This does **not** retroactively turn the manual first publication into an npm-provenance claim.

See [docs/RELEASE_SECURITY.md](docs/RELEASE_SECURITY.md) for the exact release-state record.

## Runtime identity

FuryPipe uses a FuryPipe-only runtime identity.

- CLI: `furypipe`
- environment namespace: `FURYPIPE_*`
- default bind host: `127.0.0.1`
- default listener port: `48721`
- Worker auth header: `x-furypipe-secret`

The runtime does not consult historical command aliases, historical environment-variable namespaces, historical config/event paths or the former default listener port.

## Security-sensitive contribution areas

Changes in any of these areas deserve explicit security review:

- provider credential routing;
- HTTP headers or proxy routing;
- MCP authentication/authorization;
- Agent Runtime permissions;
- persistence, Recovery or memory;
- logs and diagnostic capture;
- dashboard endpoints;
- dependency or lockfile changes;
- release workflows and publishing permissions.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.
