# FuryPipe trust model (Studio track additions)

The base model is `docs/SECURITY_MODEL.md` and `SECURITY.md`. This track adds the following boundaries, each covered by a negative test.

| Boundary | Rule | Test |
|---|---|---|
| Agent claims | CLAIMED never becomes VERIFIED without a host-signed receipt; forged or tampered receipts are rejected | `tests/fury-proof.test.ts` |
| Task authority | child ≤ parent; DENY stays DENY; external actions need a human gate | `tests/fury-ir.test.ts`, `tests/fury-dispatcher.test.ts` |
| Privacy | local-only / LOCAL_ONLY never select a cloud binding | `tests/fury-dispatcher.test.ts` |
| Write isolation | one worktree per writer; overlapping or graph-coupled writers are serialized | `tests/fury-dispatcher.test.ts`, `tests/fury-graph.test.ts` |
| Local probing (SSRF) | loopback by default; LAN only as explicit private IP literals; no redirects; bounded bodies | `tests/fury-local-fabric.test.ts` |
| Studio chat | local endpoints only (cloud and metadata addresses refused) | `tests/studio-api.test.ts`, `tests/node-security.test.ts` |
| Studio API | loopback-only; POST same-origin + JSON + 256 KiB cap | `tests/node-security.test.ts`, `tests/studio-api.test.ts` |
| Studio page | nonce CSP, no inline handlers, textContent rendering, frame-ancestors none | `tests/studio-api.test.ts`, browser QA console check |
| Harness discovery | absolute PATH only, no shell, minimal env without provider keys, no auth probing | `tests/fury-harness-hub.test.ts` |
| Graph files | bounded size, relative paths only, Graphify never run implicitly | `tests/fury-graph.test.ts` |

No security claim here is absolute; each row states the tested boundary.
