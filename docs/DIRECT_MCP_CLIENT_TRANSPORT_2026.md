# Governed Direct MCP Client Transport — M1

## Status

M1 adds a FuryPipe-owned MCP **connection + inventory** path. It still does not
execute MCP tools.

The M0 lifecycle contract remains authoritative:

```text
configured
!= connected
!= healthy
!= listed
!= trusted
!= selected
!= approved
!= executed
!= succeeded
!= verified
```

## Official SDK baseline

M1 uses `@modelcontextprotocol/client@2.0.0`.

The client is constructed with protocol negotiation in `auto` mode. The
negotiated SDK era is recorded as:

- SDK `modern` -> FuryPipe `modern_2026` / `discover`;
- SDK `legacy` -> FuryPipe `legacy_2025` / `initialize`.

Connection alone never sets `healthy=true`. A successful bounded
`tools/list` call supplies the M1 liveness evidence
`list_tools_success`.

## Supported transports

### stdio

- SDK `StdioClientTransport`;
- no shell invocation;
- bounded command, argument and environment surfaces;
- explicit read buffer ceiling: 8 MiB by default, 16 MiB hard maximum;
- child stderr is drained but not persisted;
- command + args + cwd are bound into the endpoint fingerprint; secrets must be passed through env, never args.

### Streamable HTTP

- SDK `StreamableHTTPClientTransport`;
- loopback may use HTTP/HTTPS;
- non-loopback endpoints require HTTPS;
- every non-loopback hostname must be explicitly allowlisted by operator config;
- URL-embedded credentials and query strings are rejected; secrets belong in runtime headers;
- the configured source fingerprint is recomputed from the actual endpoint identity and must match before trust evidence is accepted;
- HTTP response bodies are bounded to 8 MiB by default (16 MiB hard maximum);
- redirects are disabled (`redirect: manual`) so a configured source cannot
  silently redirect to another origin/private endpoint;
- transport-owned MCP headers cannot be overridden by runtime static headers;
- authorization headers may exist in runtime config but are never copied into
  FuryPipe lifecycle evidence.

Legacy SSE is not selected or silently attempted by this track.

## Inventory bounds

- SDK pagination is capped at 16 pages by default (32 hard maximum);
- final inventory is capped at 256 tools;
- each input schema is canonicalized and SHA-256 digested;
- schema JSON is capped at 1 MiB and depth 64;
- descriptions and raw schemas are not persisted into M1 lifecycle evidence;
- annotations are normalized through the existing trust-aware risk policy;
- an untrusted source remains `untrusted_unknown` regardless of annotations.

## Failure/cleanup model

- connect timeout: 15 s default, 60 s hard maximum;
- list timeout: 15 s default, 60 s hard maximum;
- discovery probe timeout: 3 s default, 15 s hard maximum;
- the client is closed on success and on every failure path;
- a close failure is surfaced only when it is the primary failure.

## Authority boundary

M1 has no tool-call API. Listing a tool does not select, approve, authorize,
execute, succeed, or verify it.

M2 will add proposal/schema validation and policy/approval evidence. M3 is the
first track permitted to introduce one governed tool invocation after a
single-use execution permit has been synchronously consumed.

No release, tag, npm publish, or deploy is part of M1.
