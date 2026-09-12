# FuryPipe Plugin Bundles

## Status

`CONTRACT_IMPLEMENTED_EXTERNAL_OPT_IN`

FuryPipe plugin bundles combine connector metadata without granting extra permission.

A bundle can describe:

- portable skill IDs;
- remote or stdio MCP profiles;
- pinned CLI tools;
- provider adapter profiles;
- required permissions;
- secret **environment variable names**;
- health checks;
- immutable source provenance.

The bundle registry never downloads a package, starts a process, opens a network connection or reads a secret by itself.

## Built-in bundles

### Context7

- source: `upstash/context7` pinned to `6f42b66f3b6dee20ba870dd6f70f1b565eb62e6e`;
- remote MCP: `https://mcp.context7.com/mcp`;
- auth: MCP OAuth or host-owned `CONTEXT7_API_KEY`;
- permission: network;
- read-only documentation use.

### GitHub MCP

- source: `github/github-mcp-server` pinned to `7d13a7ad6f2a17f351a6d77ce280c85ae1821f4d`;
- remote MCP: `https://api.githubcopilot.com/mcp/`;
- OAuth;
- read-only repository permission by default.

Write-capable GitHub toolsets are deliberately outside the built-in default bundle.

### Playwright CLI

- source: `microsoft/playwright-cli` pinned to `655530f6d0dc71a0d6bf46ae165877d3c7311099`;
- package: `@playwright/cli@0.1.19`;
- executable: `playwright-cli`;
- permissions: browser, process, network;
- auto-install: **false**.

This bundle is intended to back the Web Studio browser QA adapter after explicit host installation and health verification.

### Supabase

- source: `supabase/supabase` pinned to `26585dd4a4d6db8910a595214c9f6e8fdd206768`;
- remote MCP base: `https://mcp.supabase.com/mcp`;
- OAuth;
- project-scoped;
- read-only preferred;
- database-read only in the built-in bundle.

Database writes, migrations and function deployments require a separate explicit bundle/profile with scoped-write approval.


### Figma

- official remote MCP: `https://mcp.figma.com/mcp`;
- OAuth;
- permission: network + `design-read`;
- read-only preferred;
- no default `design-write`.

The built-in profile is for design context, variables/components and implementation context. Canvas mutation belongs in a distinct future write-capable profile with explicit approval.

### Cloudflare

- source: `cloudflare/mcp@1027dbd2865fc1932120db42ed53749bc30d2af0`;
- official API MCP: `https://mcp.cloudflare.com/mcp`;
- OAuth;
- permission: network + `cloud-read`;
- read-only preferred;
- no default `cloud-write` or deployment authority.

Cloudflare product-specific MCPs can be added as narrower profiles when they materially reduce scope. A general read profile must not silently become a deploy profile.

### Exa

- source: `exa-labs/exa-mcp-server@15ffb50519e719dc791cdc750ce5ed1934c0a1ed`;
- MIT verified;
- hosted MCP: `https://mcp.exa.ai/mcp`;
- OAuth;
- permission: network;
- read-only preferred.

Exa is one optional primary research connector. FuryPipe should not enable Exa, Firecrawl and Tavily simultaneously by default because duplicated search schemas increase context and attack surface.

## Secret boundary

Bundle manifests contain only secret **names**, for example `CONTEXT7_API_KEY`.

`inspectFuryPluginBundle()` intentionally removes the MCP `bearerEnv` mapping and exposes only the set of environment variable names. Secret values are never accepted by this manifest API.

## Provenance rules

GitHub-backed bundle sources require an exact 40-character commit SHA.

A URL, marketplace listing or service popularity is not sufficient provenance.

CLI profiles additionally require an exact semantic package version and can never set `autoInstall: true`.

## Adding a new connector

For Firecrawl, Codebase Memory, Graft, Sentry, Cloudflare, Notion or another researched integration:

1. verify current official endpoint/package;
2. pin source commit/version;
3. verify license when code would be reused;
4. define minimum permissions;
5. define secret names, never values;
6. define health check;
7. keep bundle `EXTERNAL_OPT_IN`;
8. test the adapter independently;
9. only then register it as built-in.

The plugin bundle contract is configuration/provenance. Runtime authorization still belongs to MCP policy, Agent Runtime, Provider Runtime and the operator.


## Permission separation added in the 2026 audit

Design and cloud surfaces are not represented by generic write access.

- `design-read` — inspect design context/components/tokens;
- `design-write` — mutate design documents; never granted by the built-in Figma profile;
- `cloud-read` — inspect cloud configuration/resources;
- `cloud-write` — change/deploy cloud resources; never granted by the built-in Cloudflare profile.

Repository and database permissions remain separate as before.

A bundle's permission list is descriptive policy metadata. It does not itself authenticate, connect, execute, install or escalate another runtime.

## Portable ecosystem boundary

The 2026 audit also tracks Agent Skills and Agent Plugins as portability standards. FuryPipe does not treat portable format support as trust.

A future Agent Plugins importer/exporter must preserve:

- package-root containment;
- component identity;
- skill/MCP separation;
- secret names without values;
- FuryPipe permission classification;
- immutable source provenance;
- per-artifact licence state.

No incomplete importer is shipped merely to claim compatibility.
