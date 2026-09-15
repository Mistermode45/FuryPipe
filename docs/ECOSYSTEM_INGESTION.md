# Ecosystem Ingestion V1

## Status

`IMPLEMENTED_STATIC_FOUNDATION_WITH_PUBLIC_CATALOG_PRIMITIVES`

This track adds a typed candidate contract, bounded static JSON importer,
canonical identity, deterministic in-memory registry, explainable duplicate
matches and an ingestion coordinator. Candidate types, normalization and the
in-memory registry are now exposed through the non-executing
`furypipe/capability-catalog` public facade together with FuryTrust, FuryScore,
Catalog Resolver and the Capability Activation Contract.

The lower-level ingestion coordinator/importer remains internal. None of these
surfaces are connected to automatic installation, Agent Runtime execution, MCP
execution or a persistent catalog. Public exposure does not enable or run an
ecosystem capability.

## Lifecycle

```text
caller-provided manifest
  -> version/size validation
  -> normalized candidate
  -> canonical identity and pin classification
  -> static trust report
  -> duplicate analysis and in-memory registration
  -> metadata search/filter
```

The default importer reads JSON already provided by the caller. It does not
open files, follow URLs, query GitHub/MCP registries, resolve packages, invoke
installers, connect to services or execute candidate code. Future GitHub,
MCP Registry, Agent Plugins, Skills, npm and marketplace importers must map
their data into `NormalizedCapabilityCandidate` before it reaches trust or
registry code.

`createEcosystemIngestionEngine()` evaluates every candidate in a manifest
before mutating the registry. Unknown evidence-map keys, invalid candidates,
invalid trust inputs and over-limit batches fail closed. A conflicting record
for an existing immutable candidate ID is reported and never replaces the
stored candidate or its trust report.

## Candidate contract

The JSON record uses `format: "furypipe-capability/v1"` and
`schemaVersion: 1`. V1 includes:

- stable `id`, `canonicalUrl`, `repository`, source version/commit/release date;
- capability type, category/capability/domain tags, publisher/authors;
- supported stages, platforms, models and languages;
- provenance classification, review state and bounded evidence references;
- declared and discovered SPDX values, evidence source, review time and
  declaration/discovery conflict state;
- filesystem, network, subprocess, credential, external-write, database,
  browser, provider and cloud permissions;
- integration decision/reason/mode, cost model, maintenance, activity,
  caller-reported health/security metadata;
- generic benchmark records, future FuryBench fields and optional ROI deltas;
- bounded namespaced `extensions` for future formats.

No timestamp is invented. `createdAt`, `releaseDate` and `lastAuditedAt` are
optional input facts normalized to UTC; they are the only intentionally
time-varying candidate fields.

The schema accepts the current minimum types (`skill`, `instruction`,
`plugin`, `mcp`, `agent`, `subagent`, `cli`, `api`, `provider`, `workflow`,
`framework`, `standard`, `tool`) plus additional categories. Unknown V1 fields
are rejected. Forward extension data must use a namespaced key in `extensions`;
an unknown schema version is rejected rather than guessed.

## Canonical identity and pinning

Canonical URLs require HTTPS without credentials, query strings or fragments;
internal candidates use the separate `furypipe://local/...` namespace.
Known forge hosts and paths are normalized. The canonical ID incorporates the
canonical source URL and a revision key (commit, content SHA-256, exact version,
mutable reference or `unversioned`), so a changed commit produces a different
candidate version ID.

`PINNED` requires a full commit SHA or a full content SHA-256. A version label
alone is not treated as an immutable artifact because V1 does not verify the
registry's immutability guarantees. Explicit `main`, `master`, `HEAD`, `latest`,
`stable`, `nightly`, `next`, branch, tag and ref paths are mutable. A commit or
content digest remains the pin when present.

## Duplicate handling

The registry reports same canonical source/revision, content digest, repository,
package coordinates, marketplace aliases, repository/marketplace intersections
and caller-declared `fork-of`, `mirror-of`, `renamed-from`, `package-for` and
`marketplace-entry-for` relationships. These links explain why two records were
related; they do not erase their separate provenance or history.

Same-name/type/publisher matches are only `possibleDuplicate` suggestions with
a reason and `POSSIBLE` confidence. They are never auto-merged. Even exact
matches are auto-merge eligible only when their normalized serialized records
are identical. No fuzzy or vector index is used.

## Registry and serialization

The in-memory registry is bounded to 5,000 candidates; one manifest is bounded
to 256 candidates and 4 MiB. Search uses literal normalized terms, not regular
expressions. Queries filter by type, category, capability, domain, provenance,
license, pin state, integration decision, trust verdict and declared
permissions. Trust filtering includes only candidates with a recorded trust
report.

`serializeCapabilityManifest()` emits stable JSON ordered by canonical ID.
There is no database or disk writer in V1. Trust reports are versioned JSON
objects held in memory alongside candidate records.

## Example

```ts
const engine = createEcosystemIngestionEngine();
const batch = engine.ingest({
  manifest: callerSuppliedManifestJson,
  staticEvidence: new Map([[candidateId, [{ path: 'src/index.ts', content: suppliedText }]]]),
});
const readOnlyResearch = engine.registry.list({
  types: ['mcp'],
  excludePermissions: { network: 'arbitrary', subprocess: 'arbitrary' },
});
```

The example is metadata processing only. `batch` reports trust and registration
states; it cannot start the listed MCP, fetch its source or authorize execution.

## Security and ownership boundaries

- Imported fields and evidence references are claims supplied by the caller.
- A `VERIFIED` license requires a discovered SPDX value, a typed evidence
  reference, a non-unknown evidence source and an explicit review timestamp;
  FuryPipe does not fetch or independently verify the referenced file.
- `OFFICIAL` requires reviewed HTTPS evidence with a host-boundary match and,
  for forge repositories, a matching repository-owner path. This conservative
  shape check cannot prove domain ownership, signature validity or publisher
  identity.
- Integration decision (`ADOPT`, `PORT`, `ADAPT`, `WRAP`, `REFERENCE_ONLY`,
  `REJECT`) is separate from FuryTrust and does not grant permission.
- Candidate health/security fields are descriptive metadata, not live health
  checks, dependency audits or runtime observations.
- Candidate text has bounded lengths and the schema has explicit field,
  collection, nesting and URL limits. The credential-pattern check is a
  defensive filter, not a complete secret detector.
- Source text passed to FuryTrust is scanned in memory only and is not copied
  into findings or registry records.

Runtime authorization, sandboxing, dependency-vulnerability checks, signed
source verification, persistent storage, marketplace crawlers, protocol
compatibility and integration with runtime routing remain later tracks.
