# FuryPipe — Artifacts + Plugin Runtime Admission checkpoint (2026-09-26)

Status: IMPLEMENTED_PENDING_EXACT_HEAD_EVIDENCE

Base: PR #233 exact HEAD `ef17b67ea0928d9b9d703d331cf3d5642f447233`.

## Artifact Ledger v1

The new `fury-artifacts` contract provides a bounded process-local artifact store with:

- immutable revisions;
- SHA-256 content identity;
- deterministic head search;
- revision history;
- restore-by-new-revision rather than history mutation;
- export envelopes with a stable digest;
- explicit 8 MiB payload, 1024 artifact and 128 revision bounds;
- no implicit filesystem, network or execution authority.

This is a core ledger primitive, not a persistence claim. Durable backing stores, cross-workspace retention and Studio history/diff UX remain open.

## Plugin Runtime Admission v1

The new `fury-plugin-runtime` contract adds:

- operator-gated metadata admission for validated `FuryPluginBundle` objects;
- permission subset enforcement (no admission-time escalation);
- package-relative declarative UI extension contracts;
- bounded extension count and unique identities;
- an isolation profile requiring process isolation, no host DOM, credential, filesystem or network access;
- CSP suitable for a sandboxed iframe projection;
- UI extension projections that remain `mountAuthorized:false`.

This does **not** execute third-party code. It deliberately separates metadata admission from executable loading/mounting. A later runtime must provide a real isolated host, explicit grants, lifecycle/rollback and security evidence before the Plugins/SDK gap can be closed.

## Security invariants

- no auto-install;
- no subprocess launch;
- no secret value access;
- no filesystem writes;
- no network access;
- no plugin execution;
- no UI mount authority;
- no merge, release, tag, npm publish or deploy authorization.

## Verification required

- TypeScript build;
- unit tests for artifacts and plugin runtime admission;
- package smoke after public exports;
- Secret Scan;
- Local Contracts;
- CI matrix;
- Clean Room;
- Recovery/Restart;
- Upgrade/Rollback;
- Browser QA regression gates.

Do not upgrade the ledger status to DONE until exact-head evidence is green.
