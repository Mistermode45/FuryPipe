# Control Plane V4 — Design Review

## Scope and decision

This review covers the server-rendered FuryPipe Control Plane. Its purpose is
to verify the V4 **Fury Instrument Panel** direction without changing the
observation-only V2 data model or promoting absent evidence.

The review explicitly rejects a generic dashboard treatment: no decorative
gradients, no glass blur, no hover scale, no global rounded-card container and
no equal-weight domain card grid. The retained visual language is a technical
instrument surface: rails, source labels, tabular rhythm, a single raised
inspector and written lifecycle state.

## Screenshot review loop

| Loop | Screenshot evidence | Findings | Decision |
| --- | --- | --- | --- |
| 1 | `artifacts/cross-browser-qa/dashboard-chromium-ltr-desktop-dark.png` and `dashboard-chromium-ltr-mobile-dark.png`, first V4 implementation | **P1**: the desktop inspector could overlap the Capability Explorer filters and rows. **P2**: inherited large-radius declarations still existed in the stylesheet even though their later V4 rules neutralized them. | Corrected with a dedicated desktop grid rail and a raw CSS token cleanup. |
| 2 | `artifacts/cross-browser-qa/dashboard-chromium-ltr-desktop-dark.png` and `dashboard-chromium-ltr-at-560-light.png`, post-rail capture | No overlap in the explorer; 560 px remains a single reading flow; light/dark preserve hierarchy. Dense rows, bindings and Evidence Lens remain distinguishable without decorative containers. | Accepted for final exact-SHA browser evidence. |

The screenshot filenames are intentionally stable because the browser QA
artifact is regenerated for the exact commit under review. The accompanying
`report.json` is the source-bound machine-readable record.

## V4 audit outcomes

### Substitution and composition

- The domain card matrix became a compact row list with source, lifecycle and
  written state.
- The source topology is not a speculative node graph: each displayed line is
  a real `domain -> source` binding from `ControlPlaneSnapshot`.
- The Decision Lens says that per-request reason codes are unavailable when the
  snapshot does not expose them; it does not manufacture ExactGuard evidence.
- The inspector is a contextual, bounded projection, not an action panel.

### Card, radius, colour and type audit

- Canvas, surface and one raised inspector are the only V4 ownership levels.
- Structural borders replace shadows. Rounded shapes are limited to functional
  dots and the circular Fury Core mark; interactive/status surfaces are square
  or two-to-four pixels.
- Cobalt marks focus and structure, teal/green reinforces positive written
  states, and warm failure/stale colours never carry the only meaning.
- Headings use sentence case. Monospace is limited to IDs, SHAs, sources and
  metrics rather than body copy.

### Motion and content audit

- There is no gradient, glass blur, hover scale or non-essential animation in
  the final stylesheet. The remaining tooltip translation is an interaction
  positioning detail, and reduced-motion suppresses transitions globally.
- The command palette is navigation-only. It has no fake command execution,
  agent launch, provider call or configuration mutation.
- Unknown, unavailable, stale, disabled and not-executed states stay literal
  in both list and Evidence Lens.

## Limits

Browser QA verifies rendered layout, interaction and overflow across its
declared browser/locale matrix. It is not a manual WCAG certification, a live
provider/MCP/agent verification, a production deployment check or a release
approval. Those claims remain outside this review.
