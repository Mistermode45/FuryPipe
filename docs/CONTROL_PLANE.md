# FuryPipe Control Plane V2

## Purpose

Control Plane V2 is FuryPipe's loopback, server-rendered observation surface.
It combines bounded dashboard counters with the optional source-bound Control
Room snapshot. Opening a page, JSON endpoint or fragment never executes a
Skill, MCP, Agent or Provider and never changes runtime configuration.

## Endpoints

- `GET /api/control-plane.json` returns `furypipe-control-plane/v2`.
- `GET /fragments/control-plane` returns the localized Control Plane panel.

Both endpoints are available only through the dashboard's existing loopback
route handling. They are read-only and use data already held by the process:
runtime counters, configured Visual Engine model scope and the injected Control
Room provider. They do not perform a disk scan, an external request or a
capability probe.

## Evidence model

Every snapshot has a generation time and a nullable `sourceCommit`. A source
commit exists only when the Node host received a valid exact
`FURYPIPE_SOURCE_COMMIT` and therefore constructed Control Room runtime
evidence. Without it, the V2 dashboard remains useful for local runtime
counters but marks source-bound evidence as `NOT_AVAILABLE`.

The Control Plane never upgrades a lifecycle state from implementation
presence. In particular:

```text
recommended != installed != connected != approved != executable
executable != executed != verified != released != deployed
```

The displayed lifecycle vocabulary is:

```text
AVAILABLE RECOMMENDED INSTALLED CONNECTED APPROVED EXECUTABLE EXECUTED
VERIFIED UNKNOWN STALE FAILED DISABLED
```

`NOT_AVAILABLE`, `NOT_EXECUTED` and `PARTIAL` remain fail-visible evidence
states. They are intentionally not collapsed into a green badge.

When an evidence source retains a CI `headSha`, its `evidenceSha` is compared
with the snapshot `sourceCommit`. A different SHA is rendered as `STALE`, even
if that source previously reported `VERIFIED`; an absent run identifier stays
absent rather than being synthesized.

## Domain data

The panel shows only actual sources:

- Visual Engine request counters and active model scope come from the live
  dashboard state;
- Agent, MCP, Provider, Recovery, Learning, Security and Evidence states come
  from the metadata-only `ControlRoomSnapshot` when the host injected one;
- Skills remain `NOT_AVAILABLE` until a real runtime registry inspection is
  wired; FuryLink is shown as an available local CLI surface, not a connected
  child agent.

The panel intentionally does not expose provider credentials, headers,
cookies, prompts, raw responses, local filesystem paths, Recovery plaintext or
agent objectives. Values rendered in the panel are HTML escaped.

## Refresh and performance

The panel is an independent htmx fragment refreshed every five seconds. Its
snapshot is bounded: 16 domains, two evidence rows and at most 64 model names.
It reuses in-memory dashboard totals and one injected snapshot, so it adds no
recurring disk traversal or provider request.

## Validation boundary

Browser QA covers the Control Plane fragment across Chromium, Firefox and
WebKit, EN/FR plus the existing RTL pseudo-locale, and the responsive matrix
including 1920, 1440, 1366, 1024, 768, 640, 560 and 390 pixel widths.

This evidence validates the rendered local dashboard artifact only. It does
not establish production deployment, provider account authentication, hosted
MCP interoperability, Figma integration or a full manual WCAG assessment.

## V4 Fury Instrument Panel

The V4 presentation keeps the V2 snapshot contract intact while making source,
state and evidence easier to distinguish at a glance. It is an observation
surface, not an operator console: navigation, search, filters, the command
palette and the inspector do not trigger a capability, mutate configuration,
call a provider or execute an agent.

### Information architecture

The primary navigation is intentionally limited to seven operator questions:

1. **Overview** — current runtime and savings already available from the dashboard.
2. **Observe** — retained request/context observations and sessions.
3. **Capabilities** — the bounded, source-bound domain collection.
4. **Visual Engine** — only live enabled/disabled and executed/executable state.
5. **Topology** — a Fury Graph rendered solely as `domain -> source` bindings.
6. **Evidence** — source SHA, evidence SHA, run ID, state and freshness.
7. **Settings** — existing local display/model-scope controls.

The compact `Ctrl/Cmd+K` palette is navigation-only. The Capability Explorer
uses dense rows rather than a grid of status cards. Selecting a row opens the
bounded inspector, which reports identity, source, lifecycle, warnings and a
small JSON projection. The projection is assigned as text, not HTML, and
contains no prompt, credential, header, cookie, filesystem path or provider
payload.

### Evidence Lens and Decision Lens

Evidence freshness is source-bound. `CURRENT` is shown only when an evidence
SHA exists and did not become `STALE` through the snapshot's exact comparison.
An absent SHA is `NOT_AVAILABLE`; a mismatch is explicitly `STALE`. The status
text remains visible alongside colour.

The Decision Lens reports only the runtime facts already in the snapshot:
Visual Engine is `DISABLED`, `EXECUTABLE`, or `EXECUTED`. The currently exposed
snapshot has no per-request reason-code or ExactGuard counter, so the panel
says so instead of inventing a decision path.

### Design-system and accessibility constraints

The panel uses canvas, surface and one raised inspector surface. Borders mark
structural ownership; radius is square or two-to-four pixels except for the
Fury Core's intentionally circular instrumentation mark and semantic dots.
There are no gradients, glass blur or motion-dependent state changes. The
`prefers-reduced-motion: reduce` path suppresses non-essential animation and
transition. Focus uses a visible cobalt outline, the command palette is a
native labelled dialog with an explicit close path, and a skip link reaches the
instrument panel.

The responsive layout changes composition rather than scaling a desktop card
grid: capability rows and source bindings become stacked reading order, the
inspector stops being sticky, and evidence tables preserve their labelled
mobile representation. Collections remain bounded by the V2 contract.

## V5 convergence — the Control Plane is the shell

The dashboard no longer renders a historical dashboard followed by a Control
Plane section. `renderPage()` now composes one Control Plane shell with exactly
these navigation surfaces:

1. **Overview** — Fury Core, live runtime lane and existing aggregate
   efficiency counters.
2. **Observe** — retained request records, context breakdown, source inspector
   and sessions. It is not called a trace explorer because the current runtime
   does not retain a span hierarchy, timings or provider attempt graph.
3. **Capabilities** — bounded source-bound domains and the inert inspector.
4. **Visual Engine** — enabled/disabled and executed/executable state only.
   Per-request reason codes, ExactGuard decisions and budget deltas remain
   explicitly unavailable until they have a safe runtime source.
5. **Topology** — observed `domain -> source` bindings, not a simulated graph.
6. **Evidence** — the V2 Evidence Lens, Control Room metadata and retained
   aggregate history.
7. **Settings** — the pre-existing explicit runtime toggle, agent connection
   guidance and model-scope controls. No new mutation was introduced.

| Previous page block | Convergence disposition | New shell owner |
|---|---|---|
| Session warm-up hero | Removed; it duplicated the runtime lane and implied a global state | Overview runtime lane |
| Header savings strip | Kept as a source-backed aggregate | Overview efficiency row |
| Recent / context / image source | Kept without changing its data source | Observe |
| Sessions | Kept without changing its data source | Observe |
| Control Plane + Control Room section | Split into its own seven-surface shell | Overview, Capabilities, Visual Engine, Topology, Evidence |
| Historical full-history table | Kept as aggregate evidence, not a second dashboard | Evidence |
| FuryLink guide, model scope, existing toggle | Kept; made subordinate to the shell | Settings |

The full `GET /fragments/control-plane` response remains a backwards-compatible
localized composite. The shell uses independently refreshable, read-only
fragments for `control-plane-overview`, `control-plane-visual-engine`,
`control-plane-capabilities`, `control-plane-topology` and
`control-plane-evidence`. Each is built from the same bounded snapshot contract;
opening or refreshing one cannot execute a capability or mutate configuration.

### Mobile composition

At 640 CSS pixels and below, the shell changes from an always-expanded desktop
reading surface to progressive disclosure. Observe is the only secondary
surface open on initial load; a hash target (for example `#evidence`) is opened
when the user explicitly navigates to it. Fragment refreshes still occur and
are bounded, but hidden sections do not create an unbounded vertical stack.

### FuryLink Windows launch boundary

Windows `.cmd` and `.bat` launchers require a command interpreter. FuryLink
therefore launches the configured `ComSpec` explicitly with `/d /v:off /s /c`.
Native `.exe` and `.com` programs remain direct with discrete argv values.
Batch launchers use one command line only after strict validation; FuryLink
does not use Node `shell: true`. NUL, CR and LF are rejected at this command
boundary.
Because an arbitrary third-party batch file can re-parse `%*`, FuryLink also
rejects literal quotes and `& | ( ) ^ % !` for `.cmd` / `.bat` launchers rather
than claiming a universal escaping contract. Paths with spaces and ordinary
Unicode arguments remain supported, including
`C:\\Program Files\\nodejs\\npm.cmd`. The requested command is still
intentionally executed by the explicit `furypipe link` action.

### Validation boundary

The browser harness now asserts the seven-shell structure, locale retention,
no horizontal overflow, inert explorer interactions and mobile progressive
disclosure. It checks Chromium locally across EN/FR/RTL and all declared
breakpoints. Cross-engine proof is separate and must be attached to the exact
committed source SHA; a development-worktree run is never promoted to hosted
or release evidence.
