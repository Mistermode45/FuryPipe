# Hosted MCP conformance — external validation runbook

This runbook closes only the **Hosted MCP external-conformance** evidence slice.
It does not prove a production OAuth Authorization Server, provider billing,
physical durability, Figma, npm provenance, deployment or release authorization.

The intended topology is deliberately cross-host:

```text
GitHub-hosted runner
  -> public HTTPS / DNS
  -> trusted reverse proxy (TLS)
  -> FuryPipe hosted MCP fixture on loopback
  -> dedicated Recovery conformance namespace
```

The external client is the official MCP Inspector CLI pinned to
`@modelcontextprotocol/inspector@2.6.0`. The Inspector itself uses the official
MCP client packages. Modern and legacy protocol eras are forced separately by
read-only Inspector config files.

## What the evidence requires

A run is `VERIFIED` only when all checks below succeed on the same exact source
SHA:

- remote non-loopback network boundary;
- HTTPS request succeeds with normal certificate verification;
- server response carries `X-FuryPipe-Source-Commit` equal to checkout HEAD;
- modern MCP `2026-07-28` negotiation;
- exact 11-tool inventory through the official Inspector with `--strict`;
- real read-only `tools/call` using `verify_handle`;
- fresh-process reconnect;
- legacy MCP `2025-11-25` initialization and exact tool inventory;
- missing Bearer token -> HTTP 401;
- invalid Bearer token -> HTTP 401;
- a deliberately incomplete streaming body -> HTTP 504 from the configured
  FuryPipe request deadline;
- client abort followed by a successful fresh Inspector reconnect.

The evidence format is `furypipe-hosted-mcp-conformance/v1`. The workflow also
writes a SHA-256 checksum. Tokens, response bodies, tool payloads and AuthInfo
are not written to the evidence file.

## Conformance-only auth boundary

The guarded fixture uses one static Bearer value only to exercise the hosted MCP
auth boundary. It is **not** a production OAuth Authorization Server and it must
never be promoted as one.

The separate real-OAuth gate remains `NOT_EXECUTED` until an actual issuer,
discovery document, token endpoint, JWKS, expiry, audience/scope and negative
paths are exercised.

## 1. Prepare the exact server checkout

On the hosted FuryPipe machine, use the exact branch/commit that will be tested.

```bash
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
```

Do not reuse hosted evidence after the source SHA changes. A stacked or rebased
release candidate needs a new hosted run.

## 2. Start the guarded fixture

Use a fresh high-entropy Bearer value. Do not paste it into issues, PRs, logs or
documentation.

```bash
export FURYPIPE_ALLOW_HOSTED_MCP_FIXTURE=1
export FURYPIPE_SOURCE_COMMIT="$(git rev-parse HEAD)"
export FURYPIPE_HOSTED_MCP_BEARER_TOKEN="<secret>"
export FURYPIPE_HOSTED_MCP_ALLOWED_HOSTNAMES="mcp.example.com"
export FURYPIPE_HOSTED_MCP_HOST="127.0.0.1"
export FURYPIPE_HOSTED_MCP_PORT="47822"
export FURYPIPE_HOSTED_MCP_TIMEOUT_MS="1500"
export FURYPIPE_RECOVERY_ROOT="$PWD/.furypipe/hosted-mcp-conformance"
export FURYPIPE_TENANT="hosted-conformance"

pnpm run hosted-mcp:fixture
```

Startup prints metadata only: source SHA, listener address, configured timeout
and the deterministic read-only fixture handle. The Bearer value is never
printed.

The fixture seeds one deterministic object into the dedicated Recovery
namespace. The external client calls only `verify_handle`, so the client-side
conformance run performs no Recovery mutation.

## 3. Put HTTPS in front of the loopback listener

Terminate TLS at a trusted reverse proxy. The exact proxy syntax is
host-specific, but an Nginx location should preserve Host and Authorization and
must disable request buffering so the slow-body timeout test reaches FuryPipe.

Example:

```nginx
location = /mcp {
    proxy_pass http://127.0.0.1:47822/mcp;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;

    proxy_request_buffering off;
    proxy_buffering off;

    proxy_read_timeout 10s;
    proxy_send_timeout 10s;
}
```

The public endpoint must be the exact path:

```text
https://mcp.example.com/mcp
```

Do not expose the conformance listener itself directly to the Internet when a
reverse proxy can keep it loopback-only.

## 4. Configure the GitHub secret

Add the same ephemeral Bearer value as repository secret:

```text
FURYPIPE_HOSTED_MCP_BEARER_TOKEN
```

The manual workflow does not run on pull requests or pushes, so forks and normal
CI cannot consume this secret.

## 5. Run the external client from GitHub-hosted Actions

Dispatch:

```text
Hosted MCP Conformance
```

Inputs:

- `target_url`: the public HTTPS `/mcp` endpoint;
- `server_timeout_ms`: the exact fixture timeout, normally `1500`.

The workflow checks out its exact `github.sha`, performs frozen install,
typecheck and build, then executes:

```bash
pnpm run hosted-mcp:conformance
```

The client process boundary is the official Inspector launched in separate
processes. Modern, reconnect and legacy checks therefore do not reuse a
process-local MCP session.

## 6. Evidence artifact

Expected artifact name:

```text
furypipe-hosted-mcp-conformance-<exact-sha>
```

Expected files:

```text
hosted-mcp-conformance.json
hosted-mcp-conformance.json.sha256
```

The canonical result must contain:

```text
externalConformance = VERIFIED
oauthAuthorizationServer = NOT_EXECUTED
requestExecuted = true
sourceCommit = exact tested SHA
```

Every individual check must also be `VERIFIED`. A green workflow from another
SHA, an HTTP-only endpoint, a loopback client, a missing source header or a
partial protocol matrix does not close the gate.

## 7. Cleanup

After evidence is retained:

1. stop the conformance fixture;
2. remove or disable the temporary public route if it is not intended to remain;
3. rotate/delete the conformance Bearer secret;
4. keep the dedicated Recovery fixture namespace separate from production data.

## Non-claims

This run does **not** establish:

- real OAuth Authorization Server conformance;
- production identity or authorization policy;
- provider/model/account/billing truth;
- physical crash durability;
- production deployment or rollback;
- signed npm provenance;
- release authorization.

`hosted MCP VERIFIED != OAuth VERIFIED != production release authorized`.
