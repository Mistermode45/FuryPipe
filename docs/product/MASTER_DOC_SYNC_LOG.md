# Master product doc — sync log

Append-only. Records every product decision taken in the repository that must
be reconciled with the Google Docs master specification
("FuryPipe — Master Product Vision & Completion Specification 2026",
document id `1xZXo7Y-FBZTu0tMhO5WIGEvCCjLRFBn0R9xnnwfSFQo`).

Conflict rule: technical state → GitHub wins; product intent → master doc wins.

| Date (UTC) | Decision | Reason | Commit | Master doc section | Sync status |
|---|---|---|---|---|---|
| 2026-09-25 | Master doc could not be read in this session. | `docs.google.com` is blocked by the session egress proxy (`EGRESS_BLOCKED` on both direct export and WebFetch). No Google Drive connector is attached. | this commit | whole document | NOT_READ — requirements taken from the operator's 2026-09-25 mission prompt only |
| 2026-09-25 | PR #226 (`69e2832`) is frozen as the foundation; new work lives on `claude/furypipe-studio-universal-ai-workspace`. | Mission §8. | this commit | Release / branching | PENDING_SYNC |
| 2026-09-25 | Graphify integrates through a `FuryGraph` provider interface; the Graphify provider reads the real `graphify-out/graph.json` schema observed with graphifyy 0.9.67 (`nodes`, `links` with `relation` and `confidence` EXTRACTED/INFERRED; `GRAPH_REPORT.md`, `graph.html`, `manifest.json`). A native fallback uses the existing `codegraph` indexer. | Mission §41–§49, §113; verified against the installed tool, not assumed. | this commit | FuryGraph | PENDING_SYNC |
| 2026-09-25 | The Completion Spec in `docs/product/FURYPIPE_PRODUCT_COMPLETION_SPEC_2026.md` is the single definition of done for this track; no new numbered phases. | Mission §20–§21. | this commit | Completion criteria | PENDING_SYNC |
| 2026-09-25 | Master doc read in full from the operator's local export (version 2026-09-25, 2 606 lines); it supersedes the NOT_READ entry above for this session. The export itself is not committed (public repository; the operator owns the document). | Operator provided the export after the egress block. | this commit | whole document | READ |
| 2026-09-25 | Harness integration preference aligned to master §15: 1 ACP/official protocol, 2 official SDK/API, 3 A2A, 4 structured CLI, 5 PTY fallback. | §15 | this commit | §15 Universal Harness Hub | SYNCED |
| 2026-09-25 | Harness `authenticated` state (§15) is reported as `not-probed`: FuryPipe must not read another tool's credential stores, and no harness exposes a safe, side-effect-free auth probe that we have verified. Resolution: technical safety wins; revisit per harness when an official status command is verified. | §15 vs §29 (no credential scraping) | this commit | §15 | CONFLICT_DOCUMENTED |
| 2026-09-25 | Completion Spec extended with master-doc items not yet listed: budget modes FAST/BALANCED/QUALITY/BUDGET/LOCAL-FIRST/PRIVATE/CUSTOM (§28), Graphify refresh on changed files (§47.2), predicted vs actual impact for the Judge (§47.5), simple→expert progressive UX (§37). | §28, §37, §47 | this commit | §28/§37/§47 | SYNCED |
| 2026-09-25 | Frontier Lab items (§46: Teleport, Multiverse, Shadow Twin, Epistemic Graph, Collective Cortex, Self-Science, Outcome Loop, Failure Genome, Agent Market, Determinism Envelope, Time Machine, Adaptive Workspace, Trust Fabric, Compute Mesh) stay OPTIONAL/FRONTIER_BET per §48; FuryIR, FuryProof, Intent Kernel, Context Compiler and Zero-Trust state are implemented as core because the dispatcher and judge depend on them. | §46, §48 | this commit | §46 | SYNCED |
