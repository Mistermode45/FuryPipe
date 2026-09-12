# MCP 2026-07-28 — FuryPipe M8 conformance audit

**Audit date:** 2026-09-12  
**Audited FuryPipe source SHA:** `48aaec7373ba87195922d6757b099804da9de6bc`  
**Scope:** existing M8 MCP implementation only; no connector registry, marketplace or third-party MCP integration work.

## Status model

This document distinguishes:

- `VERIFIED_LOCAL`: directly supported by current source plus automated tests on the audited SHA.
- `IMPLEMENTED_NOT_ASSERTED`: implementation is provided by the pinned official SDK or FuryPipe code, but the exact invariant is not asserted by a dedicated FuryPipe test.
- `PARTIAL`: FuryPipe provides part of the contract but an external host/verifier/environment must supply additional evidence.
- `NOT_APPLICABLE`: the current FuryPipe MCP surface does not expose the affected capability.
- `NOT_IMPLEMENTED`: optional/new protocol capability deliberately not shipped.
- `BLOCKED_EXTERNAL_ENV`: proof requires an external Authorization Server/client/network environment.

No row should be interpreted as certification of hosted interoperability.

## Normative/current references

- MCP 2026-07-28 release:
  https://blog.modelcontextprotocol.io/posts/2026-07-28/
- Official TypeScript SDK 2026-07-28 migration:
  https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28
- Current MCP transports:
  https://modelcontextprotocol.io/specification/draft/basic/transports
- Current MCP caching:
  https://modelcontextprotocol.io/specification/draft/server/utilities/caching
- MCP authorization:
  https://modelcontextprotocol.io/specification/draft/basic/authorization

The implementation pins `@modelcontextprotocol/server@2.0.0`.

## Executive conclusion

FuryPipe M8 is **not a 2025-only MCP implementation**.

The HTTP path already uses the official v2 server SDK and serves the `2026-07-28` stateless protocol while retaining a bounded stateless `2025-11-25` fallback. The old `PROTOCOL_VERSION = '2025-11-25'` in `src/mcp.ts` belongs to the legacy hand-written stdio dispatcher and must not be used as evidence that the modern SDK surface is stale.

The principal remaining conformance gaps are not a missing modern transport. They are:

1. hosted OAuth/Authorization Server conformance remains external;
2. access-token audience validation is delegated to the host-provided `OAuthTokenVerifier` and is not independently proven by FuryPipe;
3. modern cache-hint emission is delegated to the SDK and is not asserted by a dedicated FuryPipe regression test;
4. optional 2026 extensions such as Tasks/MCP Apps/MRTR-backed server-to-client workflows are not needed by the current Recovery tool surface and are not claimed;
5. multi-client hosted interoperability is still unexecuted.

## Conformance matrix

| 2026-07-28 requirement / behavior | FuryPipe evidence | Status | Notes |
|---|---|---|---|
| Stateless modern HTTP core | `createMcpHandler(..., { legacy: 'stateless' })`; modern requests tested without session state | **VERIFIED_LOCAL** | No `Mcp-Session-Id` dependency in the modern path. |
| No modern `initialize` requirement | `tests/mcp-modern.test.ts` calls `server/discover`, `tools/list`, `tools/call` directly | **VERIFIED_LOCAL** | Legacy `initialize` remains intentionally supported for 2025 fallback. |
| `MCP-Protocol-Version: 2026-07-28` | modern test fixtures + official SDK | **VERIFIED_LOCAL** | Modern handler accepts the current protocol revision. |
| Per-request modern `_meta` envelope | tests reject missing required modern envelope | **VERIFIED_LOCAL** | SDK owns reserved wire bookkeeping. |
| `Mcp-Method` routing header | FuryPipe pre-validation + SDK; mismatch regression test | **VERIFIED_LOCAL** | Request body/header disagreement fails closed. |
| `Mcp-Name` for `tools/call` | FuryPipe pre-validation + mismatch regression test | **VERIFIED_LOCAL** | Other named modern methods are left to the official SDK; current FuryPipe surface is tools-only. |
| `Mcp-Param-*` header mirroring | no FuryPipe tool schema currently declares `x-mcp-header` | **NOT_APPLICABLE** | If added later, SDK behavior must be covered by a regression test. |
| One HTTP POST per modern JSON-RPC message | dedicated POST-only production endpoint | **VERIFIED_LOCAL** | GET is not used as the main MCP message transport. |
| Client `Accept` includes JSON + SSE | production boundary requires both media types | **VERIFIED_LOCAL** | Matches current Streamable HTTP client requirement. |
| JSON or SSE server response | official SDK handler | **IMPLEMENTED_NOT_ASSERTED** | Existing tests consume JSON; legacy fallback test observes SSE. |
| Request cancellation through per-request stream/AbortSignal | Node bridge propagates disconnect; production handler propagates abort | **VERIFIED_LOCAL** | Dedicated abort/499 tests exist. |
| Stateless load-balancer-safe core | no protocol session state in modern handler | **VERIFIED_LOCAL** | Application state remains explicit in Recovery handles. |
| Deterministic `tools/list` order | tools registered from stable `TOOLS` constant | **IMPLEMENTED_NOT_ASSERTED** | Add an explicit repeated-list ordering test if this becomes release evidence. |
| Required modern cache hints `ttlMs` / `cacheScope` | official v2 SDK emits conservative defaults for 2026 responses | **IMPLEMENTED_NOT_ASSERTED** | Add direct assertion that `tools/list` includes `ttlMs: 0` and `cacheScope: private`. |
| `server/discover` | exercised in `tests/mcp-modern.test.ts` | **VERIFIED_LOCAL** | Current server discovery is available. |
| Host/DNS rebinding protection | official Host validator + explicit allowlist tests | **VERIFIED_LOCAL** | Foreign Host rejected. |
| Origin validation | official Origin validator + explicit allowlist tests | **VERIFIED_LOCAL** | Foreign browser Origin rejected. |
| Request size bounds | encoded body bounded before dispatch | **VERIFIED_LOCAL** | Chunked overflow test verifies early stop. |
| Media-type validation | Content-Type + Accept validation | **VERIFIED_LOCAL** | Invalid media rejected before dispatch. |
| Request deadline | bounded timeout and abort controller | **VERIFIED_LOCAL** for local boundary | Hosted latency behavior remains environment-specific. |
| OAuth protected-resource metadata | `oauthMetadataResponse` + RFC 9728 discovery test | **VERIFIED_LOCAL** | FuryPipe acts as MCP Resource Server, not Authorization Server. |
| Bearer validation | official `requireBearerAuth` middleware + host verifier | **PARTIAL** | Signature/token semantics depend on the supplied verifier. |
| Scope checking | official middleware supports `requiredScopes`; tested | **VERIFIED_LOCAL** for declared scopes | Does not prove real IdP policies. |
| Expiration validation | official middleware/verifier contract | **IMPLEMENTED_NOT_ASSERTED** | Exact hosted token expiry behavior requires real verifier evidence. |
| Resource/audience binding | resource metadata is exposed; verifier is host-owned | **PARTIAL / BLOCKED_EXTERNAL_ENV** | FuryPipe does not independently inspect JWT `aud`; the verifier must reject tokens not intended for this MCP resource. |
| OAuth issuer/mix-up hardening | Authorization Server/client responsibility | **BLOCKED_EXTERNAL_ENV** | FuryPipe does not implement the authorization-code client flow. |
| PKCE | client/Authorization Server responsibility | **NOT_APPLICABLE** to Resource Server core | Must be verified in external client/IdP conformance. |
| CIMD vs deprecated DCR | client/Authorization Server concern | **NOT_APPLICABLE** to Resource Server core | Do not add a proprietary Authorization Server to FuryPipe. |
| Token passthrough prohibition | Recovery MCP tools do not call downstream APIs | **NOT_APPLICABLE** today | Future external MCP/connectors must maintain separate upstream credentials. |
| Short-lived/token-safe logging | token material is not returned in auth failures | **VERIFIED_LOCAL** for response leakage | Host verifier/storage policy remains external. |
| Legacy 2025 compatibility | stateless legacy fallback test with `initialize` | **VERIFIED_LOCAL** | Compatibility path should remain bounded and explicitly deprecated over time. |
| Legacy standalone HTTP+SSE transport | not separately exposed | **NOT_APPLICABLE** | FuryPipe uses modern handler with compatibility fallback, not a second legacy transport service. |
| MRTR | current Recovery tools do not request elicitation/sampling/roots | **NOT_IMPLEMENTED / NOT_REQUIRED** | Add only for a demonstrated tool workflow. |
| Tasks extension | no long-running MCP task surface | **NOT_IMPLEMENTED / NOT_REQUIRED** | Agent Runtime jobs should not be mislabeled as MCP Tasks. |
| MCP Apps | no MCP-rendered UI from Recovery tools | **NOT_IMPLEMENTED / NOT_REQUIRED** | Could be evaluated separately for Control Room in the future. |
| W3C trace context | no dedicated MCP trace propagation evidence | **NOT_IMPLEMENTED** | Do not claim distributed tracing merely from request handling. |
| Hosted multi-client conformance | no real external client/Authorization Server matrix | **BLOCKED_EXTERNAL_ENV** | Requires actual clients/IdP/network endpoint. |

## Security boundary

### FuryPipe is a Resource Server

The correct architecture remains:

```text
MCP client
   |
   | access token for exact FuryPipe MCP resource
   v
FuryPipe MCP Resource Server
   |
   +-- host-provided token verifier
   +-- Host/Origin/media/body/routing gates
   +-- Recovery tools
```

FuryPipe should **not** create an ad-hoc Authorization Server merely to mark OAuth as complete.

### Audience validation must remain explicit

The existing `OAuthTokenVerifier` abstraction is a correct extension point, but a verifier returning an `AuthInfo` object is not itself proof that the presented token was minted for FuryPipe.

A production verifier must demonstrate:

- issuer validation;
- signature/introspection validation;
- expiry/not-before validation;
- exact resource/audience binding;
- scope validation;
- revocation/introspection behavior where applicable;
- no downstream token passthrough.

Until a real verifier/IdP is exercised, hosted OAuth remains `BLOCKED_EXTERNAL_ENV`.

## Immediate local follow-ups

These are locally actionable without credentials and should be considered in a separate technical PR only after checking overlap with Codex:

1. add a regression assertion for `ttlMs` / `cacheScope` on modern `tools/list`;
2. add repeated `tools/list` ordering assertion;
3. add explicit modern notification/202 response coverage if notification handling becomes release-critical;
4. add a verifier fixture that demonstrates audience rejection as a **host-verifier contract test**, without pretending it proves a real IdP;
5. add a protocol-version rejection test for unsupported future/invalid revisions if the official SDK contract is not already covered;
6. keep the compatibility matrix source-bound to the exact SDK version and FuryPipe SHA.

## External follow-ups

Require actual infrastructure and must not be marked complete locally:

- real OAuth/OIDC Authorization Server;
- at least two real MCP clients using 2026-07-28;
- issuer/mix-up validation;
- Resource Indicator request/response flow;
- audience-bound access token rejection/acceptance;
- remote HTTPS endpoint;
- reverse-proxy/load-balancer test without sticky sessions;
- cancellation through a real client/network disconnect;
- optional Tasks/MCP Apps conformance only if FuryPipe chooses to expose them.

## Non-claims

This audit does **not** claim:

- hosted OAuth is verified;
- every MCP client interoperates with FuryPipe;
- FuryPipe implements all optional MCP extensions;
- a modern SDK dependency alone proves protocol conformance;
- the 2025 fallback should remain indefinitely;
- external connectors are trusted because the MCP core transport is hardened.
