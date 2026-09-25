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
