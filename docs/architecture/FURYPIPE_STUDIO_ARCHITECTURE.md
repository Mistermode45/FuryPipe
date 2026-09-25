# FuryPipe Studio

Code: `src/studio/studio-page.ts`, `src/studio/studio-api.ts`, routing in `src/node.ts` · tests: `tests/studio-api.test.ts`, `tests/node-security.test.ts` (real server), `scripts/studio-browser-qa.ts` (Chromium/Firefox/WebKit), installed-package check in `scripts/clean-room-package-smoke.mjs`

## Routes (Node runtime, loopback only)

| Route | Purpose |
|---|---|
| `GET /` (`/studio`) | Studio shell: Chat, Cowork, Code, Agents, Automations; Models, Runtimes, Settings |
| `GET /control-plane` (`/dashboard`) | the former dashboard (Settings › Advanced › Control Plane) |
| `GET /api/studio/harnesses.json` | Harness Hub discovery |
| `GET /api/studio/local.json` | local backends with hardware fit |
| `GET /api/studio/hardware.json` | local hardware profile |
| `GET /api/studio/bindings.json` | runtime bindings derived from discovery (unscored) |
| `GET /api/studio/graph.json` | FuryGraph summary for the runtime working directory |
| `POST /api/studio/blast-radius` | blast radius for changed files |
| `POST /api/studio/dispatch-preview` | FuryIR → dispatch plan (`execution: NOT_EXECUTED`) |
| `POST /api/studio/chat` | streams a chat completion from a **local** endpoint only |
| `GET chats.json`, `POST chats/{get,save,branch,delete}` | persisted conversations; each answer records its model |
| `POST flow-preview` | FuryFlow validation and fixture dry-run |
| `GET runs.json`, `POST runs`, `POST runs/act` | real runs (confirm required, local unless `allowCloud`, ASK needs approval), live workers, STOP |
| `POST code/{tree,file,diff}`, `GET code/worktrees.json` | read-only explorer, worktrees, diffs, agents and receipts per worktree |
| `GET skills.json`, `POST skills/{act,select,install,compare}` | Skills Hub |
| `GET mcp.json`, `POST mcp/{act,probe,decide}` | MCP Hub |
| `GET integrations.json` | Integration Fabric registry |
| `GET knowledge.json`, `POST knowledge/{ingest,search}` | local knowledge base with cited hits |
| `POST web` | FuryWeb FETCH / MAP / CRAWL / SEARCH |
| `GET memory.json`, `POST memory/{remember,search,act}` | Memory VNext surface (off without the encrypted config) |

All routes are under `/api/studio/`. POST routes: same-origin, `application/json` only, 256 KiB cap. The page is served with a nonce CSP (`default-src 'none'`, no inline handlers, `connect-src 'self'`), `X-Frame-Options: DENY` and no-referrer. Every runtime value is rendered with `textContent`. Discovery failures return `503 discovery-failed`. Operator state lives under `~/.furypipe/studio/<surface>/<project hash>/`.

## What each view does today

| View | State |
|---|---|
| Chat | Streaming chat with a discovered local model; conversations persisted, branch from any answer, retry with another model (as a branch); model/provider/locality on every answer. Cloud chat stays in the governed Gateway WebChat. |
| Cowork | Task + permissions (ALLOW/ASK/DENY) + files → real run; ASK needs approval, DENY is enforced, external actions never ALLOW. |
| Code | Graph summary, blast radius, file explorer, worktrees with diffs and the agents/receipts that ran there. |
| Agents | Dispatch preview over real discovered bindings, optionally graph-aware. |
| Mission Control | Real runs: writers in worktrees → FuryIntegrator → readers → FuryJudge; live worker state and STOP. |
| Knowledge / Web / Memory | Cited local RAG; SSRF-safe web fetch/map/crawl and adapter-only search; governed memory. |
| Automations | FuryFlow canvas with deterministic/agentic zones and fixture dry-runs. |
| Models / Runtimes / Skills / MCP / Integrations | Live discovery and governance tables. |
| Settings | Link to the Control Plane. |

Progressive modes (Simple / Power / Engineer / Expert) hide surfaces by level; the choice is kept per viewer.

Accessibility: skip link as first tab stop, `aria-current` navigation, focus moved to the view heading on in-app navigation, `role=log` + `aria-live` chat, labelled controls, a 404 view, `prefers-color-scheme` and `prefers-reduced-motion`, no horizontal overflow at 390 px (verified in browser QA). Automated checks do not replace a human screen-reader pass.
