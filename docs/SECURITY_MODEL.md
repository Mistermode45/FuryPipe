# Security Model

This document describes pxpipe's security boundaries and the assumptions that
deployers and contributors should preserve. It is a living threat model, not a
claim that the software is free of vulnerabilities.

## Assets

- Provider credentials in request headers or deployment configuration.
- Prompt, system-message, tool-schema, and tool-result contents.
- Rendered PNGs, export bundles, and factsheets derived from that content.
- Local event logs, optional diagnostic request bodies, and session metadata.
- Recovery objects, manifests, backups, and encryption key identifiers.
- Provider quota and billing attached to configured credentials.
- The npm package and its release provenance.

## Trust boundaries

```text
client -> Node proxy or Worker -> configured provider/gateway
              |
              +-> transforms and rendered context
              +-> local Recovery Store (optional AES-256-GCM)
              +-> local logs/dashboard (Node) or Workers Logs

maintainer -> GitHub Actions -> npm trusted publishing
```

The client-to-proxy and proxy-to-provider hops cross network trust boundaries.
The Node dashboard crosses a separate boundary because it exposes telemetry
and captured context. Dependency installation and publishing cross the
software supply-chain boundary.

## Security assumptions

- The Node process runs as a non-privileged user on a trusted machine.
- The default `127.0.0.1` listener is reachable only by trusted local users.
- Operators who set `HOST` to a non-loopback address provide authentication
  and TLS in front of the proxy API. Dashboard routes remain loopback-only.
- Upstream URLs and gateway headers are trusted operator configuration, not
  attacker-controlled request inputs.
- Anyone who can read the pxpipe log directory or Workers Logs may learn
  sensitive metadata. Diagnostic body capture is treated as secret material.
- Recovery encryption keys are supplied and owned by the host application. The
  filesystem store does not generate, persist, print, or rotate key material
  outside an explicit `rekey()` operation using the supplied key ring.
- Callers that know `PXPIPE_WORKER_SECRET` are authorized to spend credentials
  configured in that Worker deployment.

## Threats and controls

| Threat | Existing control | Contributor requirement |
| --- | --- | --- |
| Public deployment spends a configured API key | Worker requires `PXPIPE_WORKER_SECRET` and fails closed | Preserve the fail-closed check and constant-work comparison tests |
| Provider credential is routed to the wrong upstream | An explicit inbound-credential x route policy (`resolveOpenAIRouteAuth`): Anthropic-shaped credentials never reach an OpenAI upstream, subscription OAuth is preserved rather than substituted, and a host key replaces only ordinary keys. Classification is by header shape; no local token store is read | Extend the policy table, not the call site, for every new route or provider, and keep the full matrix under test |
| Prompt or secret leaks through telemetry | Full 4xx body capture is opt-in; normal events retain hashes/metadata; local artifacts are owner-only | Do not add raw content to logs; document any new persistence |
| Dashboard exposes captured context | Dashboard routes require loopback source and host; cross-site mutations are rejected | Treat every dashboard route as sensitive and preserve both checks |
| Oversized dashboard request exhausts memory | Dashboard request bodies are bounded | Keep bounds before parsing and add negative tests for new endpoints |
| Oversized proxy request exhausts memory | Transformable routes refuse past `maxRequestBytes` (`PXPIPE_MAX_REQUEST_BYTES`, 16 MiB default) before allocating, using the streamed size rather than the declared one; label-only routes bound their model sniff and stream the remainder untouched | Never read an inbound body to completion before the limit is proven; add exact-boundary, missing-length and under-declared-length tests for new routes |
| Recovery object or manifest is exposed at rest | Recovery Store supports opt-in AES-256-GCM per object, digest-bound authenticated data, explicit key IDs, fail-closed legacy plaintext handling, non-overwriting publication, and verified backup/restore | Keep keys in the host secret boundary; retain old keys only for a bounded migration window; do not claim Windows ACL enforcement until the host deployment proves it |
| Malicious dependency or compromised release | Frozen lockfile, three-day release-age gate, restricted lifecycle scripts, OIDC trusted publishing, provenance | Keep least-privilege workflow permissions and review lockfile/lifecycle changes |
| Vulnerable dependency remains installed | Dependabot, CodeQL/GitHub security scanning, a high-severity CI audit gate, targeted overrides | Run `pnpm audit` and remove overrides when direct dependencies adopt fixed ranges |

## Out of scope and residual risks

- pxpipe does not authenticate the Node server or dashboard. Non-loopback
  deployment without an authenticated reverse proxy is unsafe by design.
- pxpipe cannot protect content after it reaches a configured provider,
  gateway, log sink, or a local user with access to its files.
- A malicious trusted operator can configure an upstream that receives request
  credentials and content. Upstream configuration must not be exposed to
  untrusted callers.
- Shared-secret authentication does not provide per-user identity, revocation,
  rate limits, or authorization scopes. Internet-facing deployments should
  add these controls at the edge.
- POSIX file modes are applied where supported, but Windows ACLs remain
  host-managed. A local account with filesystem access can still read the key
  ring or decrypted content while the host process is running.
- Recovery currently uses a filesystem backend with SHA-256 and uncompressed
  payloads. Root-wide file locking, stale-lock recovery, corruption fixtures,
  and cross-process put/get/delete/backup/restore/rekey scenarios are covered
  locally; a process kill injected during every write phase, Windows ACL
  enforcement, and SQLite durability remain unproven.

## Security review checklist

Changes to routing, headers, logging, persistence, dashboard endpoints,
authentication, dependencies, or release workflows should answer:

1. Can a credential cross into the wrong provider, response, or log?
2. Can raw prompt or tool content be persisted or displayed unexpectedly?
3. Does an unauthenticated caller gain a new operation or resource-spend path?
4. Are request sizes and attacker-controlled collections bounded before work?
5. Does the change introduce a new upstream, redirect, or SSRF path?
6. Does it broaden GitHub Actions permissions or execute new install scripts?
7. Are failure modes fail-closed, and are they covered by regression tests?
