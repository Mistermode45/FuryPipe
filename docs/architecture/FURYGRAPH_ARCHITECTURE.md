# FuryGraph

Code: `src/fury-graph.ts`, `src/fury-context-compiler.ts` · tests: `tests/fury-graph.test.ts` · fixture: `tests/fixtures/graphify-0.9.67/` (real output of graphifyy 0.9.67)

FuryGraph is structure and relations only. It is separate from FuryMemory (persistence), FuryKnowledge (retrieval) and the epistemic graph (facts/hypotheses).

## Providers

| Provider | Source | Notes |
|---|---|---|
| `graphify` | `graphify-out/graph.json` (`nodes`, `links` with `relation`, `confidence` EXTRACTED/INFERRED), `manifest.json`, `GRAPH_REPORT.md`, `graph.html` | read-only, 128 MiB cap, relative paths only; staleness = source mtime newer than manifest. Never run implicitly; `refreshGraphify()` runs `graphify update <root>` without a shell when explicitly requested. |
| `native-codegraph` | existing `buildCodeGraph()` | fallback when Graphify output is absent |

`loadFuryGraph(root)` tries Graphify first, then native, and returns the detections.

## Uses

- `furyFileDependencies()` aggregates symbol-level edges to file → file counts over dependency relations (calls, imports, imports_from, references, re_exports, inherits, …, the same set `graphify affected` walks).
- `furyBlastRadius(graph, changed, depth)` does a reverse traversal. On the fixture it matches `graphify affected session.ts` exactly. It separates affected tests.
- `furyScopeCoupling(graph, scopeA, scopeB)` counts crossing edges and feeds graph-aware dispatch.

## Context capsule

`compileFuryContextCapsule({ ir, taskId, candidates, budgetBytes, graph?, changedFiles? })` pins the intent, MUST, MUST NOT, success predicates and the assigned task. It refuses when those alone exceed the budget instead of dropping one. Other candidates are ranked by priority plus changed-file, blast-radius and write-scope boosts; expired and duplicate entries are omitted. Every entry has source, reason, sha256 digest, scope and expiry.
