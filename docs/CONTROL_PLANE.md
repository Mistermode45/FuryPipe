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
