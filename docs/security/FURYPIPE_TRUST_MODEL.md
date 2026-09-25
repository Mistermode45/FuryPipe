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
| Harness execution | Claude Code gets `--restricted`, `dontAsk`, explicit allowed/disallowed tools; ASK is treated as DENY headless; external actions refused; provider keys stripped from the child env; claims never become receipts | `tests/fury-harness-runner.test.ts` |
| Runs and Cowork | `confirm: true` required; cloud runtimes only with `allowCloud`; ASK needs approval before start; EXTERNAL_ACTION can never be ALLOW; WRITE DENY yields a read-only plan; at most 2 concurrent runs | `tests/studio-api.test.ts`, `tests/fury-planner.test.ts` |
| Integration | ordered merges in a dedicated worktree; conflicts stop; the base branch is never moved | `tests/fury-integrator.test.ts`, `tests/fury-run.test.ts` |
| Skills | install from a local directory only; symlinks, special files, >128 files or >4 MiB refused; snapshot before overwrite; LOCKED blocks content changes; pin mismatch blocks auto-selection; skills never gain tool/script authority | `tests/fury-skill-hub.test.ts` |
| MCP configs | env/header values reduced to names; URL credentials and query strings stripped; secret-looking args redacted; probes send no configured secret and contact remote hosts only with `allowRemote`; READ_ONLY allows only tools a trusted probe saw as read-only | `tests/fury-mcp-hub.test.ts` |
| Integrations manifest | secret values rejected (names only); outbound webhooks HTTPS without credentials or query; OpenAPI specs confined to the project | `tests/fury-integrations.test.ts` |
| Web fetch (SSRF) | public HTTP(S) on 80/443 only; private/loopback/link-local/metadata refused after DNS; socket pinned to the validated address; every redirect revalidated; size/type caps; no cookies; no browser | `tests/fury-web.test.ts` |
| Search | only a configured loopback SearXNG adapter; no paid search API | `tests/fury-web.test.ts` |
| Knowledge ingestion | inside the project only (Studio), symlinks/binaries/vendor dirs skipped, bounded files; embeddings only from a loopback backend | `tests/fury-knowledge.test.ts`, `tests/studio-api.test.ts` |
| Memory | off without the encrypted memory config; Studio stores only operator-typed, user-declared facts; recall is data, never instructions | `tests/studio-api.test.ts`, `tests/memory-vnext.test.ts` |
| Code explorer | realpath-confined to the project (symlink escape → 403); diffs only for worktrees git lists; git without shell, bounded output | `tests/studio-api.test.ts` |
| Conversations | bounded messages/conversations, serialized writes, file mode 0600 | `tests/studio-chats.test.ts` |

No security claim here is absolute; each row states the tested boundary.
