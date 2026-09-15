# Agent Plugins v1 — FuryPipe inspector

## Status

`READ_ONLY_INSPECTOR_IMPLEMENTED_NO_INSTALL_NO_EXECUTION`

FuryPipe implements a read-only inspector for Agent Plugins specification v1.0.0.

Normative sources:

- <https://agent-plugins.org/specification>
- <https://agentskills.io/specification>

The inspector is deliberately not an installer.

## What it does

`inspectAgentPluginPackage(root)`:

1. resolves the plugin root;
2. loads `plugin.json`;
3. enforces the supported v1 schema identifier;
4. validates the plugin-name constraints;
5. ignores/reports unknown top-level manifest fields as required by the specification;
6. discovers only immediate `skills/*/SKILL.md` entries;
7. checks every discovered filesystem path remains inside the real plugin root;
8. loads `mcp.json` when present;
9. validates stdio / streamable-http / legacy sse server metadata;
10. returns metadata-only inspection results.

It always reports:

- `packageInstalled: false`;
- `skillExecuted: false`;
- `subprocessExecuted: false`;
- `networkConnectionExecuted: false`.

## Filesystem containment

The inspector resolves real paths before accepting package files.

Paths that resolve outside the plugin root through:

- symlinks;
- junction-like filesystem behavior visible through realpath;
- `../` traversal;
- absolute escape paths;

are rejected or skipped at the narrow component boundary.

A `plugin.json` escape rejects the package.

An escaping skill is skipped.

An invalid/escaping `mcp.json` disables MCP inspection while leaving valid skill discovery available.

## Skills

FuryPipe currently discovers Agent Skills but does **not** claim full Agent Skills validation in this inspector.

Returned skill entries contain only:

- package-relative directory;
- package-relative `SKILL.md` path;
- `validation: NOT_EXECUTED`.

The `SKILL.md` body is not included in inspection output.

Full Agent Skills frontmatter/body validation belongs in a separate validator against the Agent Skills specification or reference validator.

## MCP stdio

A stdio entry is inspectable only as metadata.

FuryPipe checks:

- one executable token;
- bare executable or `./` package-relative command;
- contained package-relative command path;
- bounded string argument list;
- bounded environment map;
- no override of `PLUGIN_ROOT` / `PLUGIN_DATA`;
- supported working-directory forms;
- no unknown server fields.

FuryPipe applies a stricter execution policy than the portable floor:

environment variable names that look like embedded tokens, passwords, API keys, credentials or private keys make the entry ineligible. Secret values must be injected by the host, not shipped in plugin metadata.

## MCP remote

For streamable HTTP / legacy SSE entries:

- URL must be HTTP(S);
- URL credentials/fragments are rejected;
- non-loopback HTTP is rejected;
- header names are normalized case-insensitively;
- duplicate case-insensitive names are rejected;
- credential-bearing headers such as Authorization/cookies/API-key headers make the entry ineligible.

Header **values are never returned** by the inspection result.

OAuth/credential discovery remains client-managed as required by Agent Plugins v1.

## Failure boundaries

The inspector follows the narrow-failure model instead of turning every bad component into a package-wide failure.

Fatal plugin-manifest/schema/name errors reject the package.

MCP top-level errors disable MCP only.

Individual invalid MCP server entries are skipped or returned with explicit blockers where safe.

Skill validation remains separate.

## Trust boundary

Format conformance is not trust.

An inspected plugin still needs:

- immutable source provenance;
- licence review;
- FuryPipe Skill Registry classification;
- permission classification;
- health checks;
- explicit opt-in;
- independent authorization before network/process/write execution.

The inspector never downloads a plugin and never turns registry discovery into installation.
