# Hosted MCP conformance

Hosted MCP evidence is deliberately separate from local stdio and loopback HTTP evidence.

## What this track proves when executed

The manual GitHub Actions workflow .github/workflows/hosted-mcp-conformance.yml runs an external client process from a GitHub-hosted runner against a separately hosted FuryPipe MCP endpoint. VERIFIED requires all of the following on the exact workflow SHA:

- public-style non-loopback target URL;
- successful DNS resolution;
- HTTPS with an authorized TLS chain (TLS 1.2 minimum);
- missing and invalid Bearer credentials rejected with HTTP 401 and a Bearer challenge;
- a valid Bearer accepted;
- MCP 2026-07-28 server/discover;
- tools/list;
- a source-bound fixture plus read-only fetch_text round trip;
- server source SHA equal to the workflow source SHA;
- MCP 2025-11-25 initialize fallback;
- reconnect from a separate Node client process;
- deterministic server timeout behavior;
- client cancellation followed by a healthy request;
- source-bound JSON evidence plus SHA-256 checksum.

Anything less remains PARTIAL. Merely adding this workflow, running local tests, or reaching the endpoint from the same host must not promote externalConformance.

## Conformance target

scripts/hosted-mcp-conformance-target.mjs is an opt-in wrapper around listenMcpHttpNode(). It binds a non-loopback listener only when explicitly enabled, uses an isolated Recovery namespace, injects the exact git HEAD into server-side Recovery metadata, and provides a deterministic slow manifest fixture for timeout/cancellation testing.

The target expects TLS termination at the hosting reverse proxy and an ephemeral Bearer secret. That static conformance token proves only Bearer interoperability. It is not a production OAuth Authorization Server and must never be used to close the separate real-OAuth blocker.

Required target environment:

- FURYPIPE_ALLOW_HOSTED_MCP_CONFORMANCE_TARGET=1
- FURYPIPE_HOSTED_MCP_BEARER_TOKEN
- FURYPIPE_HOSTED_MCP_RECOVERY_ROOT
- FURYPIPE_HOSTED_MCP_PUBLIC_HOSTNAME
- optional FURYPIPE_HOSTED_MCP_ALLOWED_HOSTNAMES
- optional FURYPIPE_HOSTED_MCP_BIND_HOST (default 0.0.0.0)
- optional FURYPIPE_HOSTED_MCP_PORT (default 47823)

## External client workflow

The workflow requires repository secrets FURYPIPE_HOSTED_MCP_URL and FURYPIPE_HOSTED_MCP_BEARER_TOKEN. It is workflow_dispatch only: it does not deploy the target, mutate repository state, publish a package, create a tag, or create a release.

The evidence artifact is named furypipe-hosted-mcp-conformance-<sha> and contains hosted-mcp-conformance.json plus hosted-mcp-conformance.json.sha256.

When and only when the matrix is VERIFIED, the JSON also carries canonical release-gate provenance for runtime.mcp with origin hosted and the exact sourceCommit. PARTIAL evidence carries no VERIFIED provenance.

## Non-claims

Hosted MCP conformance does not by itself prove a real OAuth issuer/JWKS/token lifecycle, provider or billing truth, Figma integration, physical durability, signed npm provenance, production rollback, or release authorization.
