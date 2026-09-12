# FuryPipe 2026 — Production MCP delta: observability, security, infrastructure and data

Date: 2026-09-12

## Scope

This research track extends the existing 2026 ecosystem audit with production-facing MCP surfaces that were not yet represented in the current FuryPipe source ledger.

This document is intentionally **research/provenance only**.

It does **not**:
- vendor third-party source;
- install packages or CLIs;
- connect credentials;
- execute remote tools;
- enable network access;
- change FuryPipe runtime permissions;
- change the default branch or release state.

The runtime policy remains fail-closed. A source being listed here never makes it executable.

## Decision model

- **ADOPT**: use the standard/interface directly when it matches FuryPipe's trust model.
- **ADAPT**: port a bounded design principle into native FuryPipe code without copying the implementation.
- **WRAP**: expose the external service/server only through an explicit FuryPipe adapter and permission boundary.
- **REFERENCE_ONLY**: useful architecture/source evidence, but not a runtime dependency.
- **REJECT**: do not integrate the current artifact.

## New candidates

| Source | Immutable source pin / evidence | Licence | Activity / state | FuryPipe decision | Default permission posture |
|---|---|---|---|---|---|
| HashiCorp Terraform MCP Server | `hashicorp/terraform-mcp-server@140e3c81fc9c0fc3b4eecd637a54d637a56f9f2e` | MPL-2.0 | Active 2026; Terraform MCP 1.0 GA announced 2026-06-11 | **WRAP** | `infra-read` only; apply/create/update/delete require explicit `infra-write` |
| Grafana MCP | `grafana/mcp-grafana@ffd90536d160ff4f3eb4a4fa79217455b8f22f0c` | Apache-2.0 | Active; v1.4.1 release commit observed 2026-09-11 | **WRAP** | `observability-read` default; dashboard/alert/annotation mutation separated |
| Grafana Docs MCP | `grafana/mcp-doc-server@2333a8e90063956649949fe08c7566ecb62066ec` | Apache-2.0 | Active 2026 | **ADOPT / WRAP** | read-only documentation retrieval only |
| Datadog MCP Server | `datadog-labs/mcp-server@83f1dc96150c74dfc783e8d855bf7515e225637c` | MIT | Active 2026; managed MCP endpoint | **WRAP** | `observability-read` default; incident/notification writes separate |
| Sentry MCP | `getsentry/sentry-mcp@858d9727916879d86db62f13977bb9063ae111aa` | FSL-1.1-Apache-2.0 future licence | Highly active 2026 | **WRAP + ADAPT auth model** | hosted remote preferred; `inspect`/read default; write skills explicit |
| SonarQube MCP Server | `SonarSource/sonarqube-mcp-server@d73e8b52b0ad54dd94c2360bff5956ba1380814d` | SONAR Source-Available License v1.0 | Active 2026 | **WRAP / REFERENCE_ONLY source** | code-quality/security read/scan only; no vendoring into FuryPipe |
| Snyk Studio MCP | `snyk/studio-mcp@f9756fa80e8a6426cb2efd66ffa49b7652173ee8` | Apache-2.0 | Active 2026 | **WRAP** | local security scanning only; auth/trust remains host-controlled |
| Semgrep MCP | `semgrep/mcp@cade782501e611373844696edc2ceef31eb7e1f7` | MIT | Repository archived; last observed commit 2025-10-28 | **REJECT current MCP / REFERENCE_ONLY patterns** | do not register as a current MCP runtime source |
| MongoDB MCP Server | `mongodb-js/mongodb-mcp-server@d1ff5d0e3a10e57ed12a08955d7f8ab69deef4ac` | Apache-2.0 | Active 2026; 2.0.0 released 2026-08-04 | **WRAP + ADAPT security patterns** | `database-read` default; CRUD/admin/Atlas mutation explicit |
| Neon MCP Server | `neondatabase/mcp-server-neon@857028feebcb4cae94dfe4fa67a23b5b066c2989` | MIT | Active 2026; official remote MCP v1 surface | **ADOPT / WRAP** | server-supported read-only mode by default; write scopes explicit |
| PostHog MCP | `PostHog/posthog@6fafbb9081bd15e79448af5650e02a4f9ea435cc`, current implementation under `services/mcp` | mixed repository terms; MCP path falls under repository terms, verify per-path before reuse | Active 2026; old standalone `PostHog/mcp` archived and implementation moved to monorepo | **WRAP** | analytics/error/session read default; feature flags/CDP/experiments writes explicit |

## Security and permission conclusions

### 1. Read and write must be separate capability classes

FuryPipe should not expose these services through broad generic `network` or `write` permissions.

Recommended new permission classes for future runtime work:

- `observability-read`
- `observability-write`
- `security-scan`
- `infra-read`
- `infra-write`
- `database-read`
- `database-write`
- `database-admin`
- `analytics-read`
- `analytics-write`

No new class should imply deployment, deletion, payment, cluster administration or production mutation.

### 2. Tool-level allowlisting is required

External MCP registration should be deny-by-default.

A connector profile must be able to:
- permit named read-only tools;
- reject unknown tools after a server update;
- bind the approved tool list to source/service provenance;
- fail closed when the remote tool list expands unexpectedly;
- separate discovery from invocation.

This is especially important for Terraform, Grafana, MongoDB, Neon and PostHog because their servers expose both inspection and mutation surfaces.

### 3. Hosted service != trusted write authority

Official/vendor-managed services still require FuryPipe policy gates.

Required controls:
- OAuth/API key owned by host, never FuryPipe-generated implicitly;
- credentials never persisted in receipts;
- HTTPS remote endpoints;
- no ambient bearer forwarding;
- tenant/project/org binding where available;
- explicit write escalation;
- source/service identity visible in Control Room;
- remote health does not imply permission.

### 4. Licence handling

- MPL-2.0 (Terraform) is compatible with external wrapping, but vendoring/modification would create file-level obligations.
- Apache-2.0/MIT sources remain candidates for bounded adapters but are not automatically trusted.
- Sentry's FSL source should remain external/reference for FuryPipe; no source vendoring is needed.
- SonarQube MCP uses SONAR Source-Available License v1.0; keep it external and do not copy it into FuryPipe.
- Archived Semgrep MCP should not be presented as an actively maintained 2026 integration.

## Native FuryPipe patterns worth adapting

### Sentry: skill-based authorization

Sentry exposes user-facing capability groups rather than forcing clients to reason only in raw API scopes.

FuryPipe should adapt this concept as:
- named capability packs;
- explicit read/write split;
- deterministic expansion to concrete tool IDs;
- policy inspection before execution;
- no automatic enablement of newly introduced tools.

### MongoDB: strict tool input and sensitive-output hardening

MongoDB 2.x release notes show useful defensive patterns:
- strict unknown-argument rejection;
- sensitive configuration redaction;
- path-traversal validation;
- server-side JavaScript disabled by default;
- explicit connection identifiers.

These are suitable **ADAPT** targets for FuryPipe's generic MCP adapter validator.

### Neon: server-declared scope/read-only metadata

Neon exposes read-only mode and tool scope metadata.

FuryPipe should consume such metadata only as **advisory evidence**:
- host policy remains authoritative;
- server metadata can reduce the visible tool set;
- server metadata must never grant a permission FuryPipe policy did not already authorize.

### Grafana Docs MCP: deterministic non-embedding documentation retrieval

Grafana's standalone docs MCP uses deterministic lexical retrieval without an embedded LLM.

This is a useful pattern for FuryPipe documentation connectors:
- lower privacy risk;
- predictable cost;
- source URLs remain citable;
- no hidden model invocation.

## Proposed runtime follow-up

A future implementation PR should remain separate from this research PR and should only start after overlap with Codex is checked.

Recommended first runtime slice:

1. extend plugin permission taxonomy with the read-only classes only;
2. add a generic external MCP tool allowlist contract;
3. implement one low-risk profile first:
   - Grafana Docs MCP **or**
   - Neon read-only mode;
4. add tests proving:
   - unknown tools fail closed;
   - write tools are invisible under read profiles;
   - credentials are not serialized;
   - no process/network call occurs during registry inspection;
5. only then add high-impact services such as Terraform/MongoDB/PostHog.

## Explicit non-claims

- No endpoint in this document was connected from FuryPipe.
- No credential was used.
- No remote tool invocation was executed.
- No production write path is VERIFIED.
- No performance or security claim is inferred from repository activity.
- No source listed here is approved for vendoring merely because its licence is permissive.
