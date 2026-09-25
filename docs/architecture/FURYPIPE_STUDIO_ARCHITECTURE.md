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

POST routes: same-origin, `application/json` only, 256 KiB cap. The page is served with a nonce CSP (`default-src 'none'`, no inline handlers, `connect-src 'self'`), `X-Frame-Options: DENY` and no-referrer. Every runtime value is rendered with `textContent`. Discovery failures return `503 discovery-failed`.

## What each view does today

| View | State |
|---|---|
| Chat | Real streaming chat with a discovered local model. Model/provider/runtime/locality indicators always shown. Cloud chat stays in the governed Gateway WebChat. |
| Cowork | Builds an intent contract with per-capability ALLOW/ASK/DENY and hands it to Agents. It does not execute. |
| Code | FuryGraph summary (provider, freshness, outputs) and blast-radius analysis. |
| Agents | Dispatch preview over real discovered bindings, optionally graph-aware. It does not start agents. |
| Automations | Explicit empty state that points to the Gateway. |
| Models / Runtimes | Live discovery tables. |
| Settings | Link to the Control Plane. |

Accessibility: skip link as first tab stop, `aria-current` navigation, focus moved to the view heading on in-app navigation, `role=log` + `aria-live` chat, labelled controls, a 404 view, `prefers-color-scheme` and `prefers-reduced-motion`, no horizontal overflow at 390 px (verified in browser QA). Automated checks do not replace a human screen-reader pass.
