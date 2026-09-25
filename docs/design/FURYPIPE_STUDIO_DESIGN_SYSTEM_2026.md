# FuryPipe Studio — design system "Fury Lux" (2026)

Source of truth: `src/studio/studio-page.ts` (CSS tokens, icons, markup and
client script). Market reasoning: `docs/research/FURYPIPE_STUDIO_UI_MARKET_2026.md`.

## Principles

1. **Conversation first.** A new chat is one question and one composer.
   Everything else is one click, one shortcut (Ctrl K) or one mode away.
2. **Honest surfaces.** Nothing is simulated: no fake models, uploads,
   "thinking" or progress. A control that has no real backend is not shown.
3. **Say where it runs.** Every answer names its model, provider and locality.
   The route chip opens "Why this route?".
4. **Progressive depth.** Simple → Power → Engineer → Expert reveal surfaces.
   They never change what a surface does.
5. **Black × orange, restrained.** Layered blacks carry the structure; orange
   marks intent (primary action, focus, active item, the Fury core). Any
   gradient is subtle and purposeful.

## Constraints that shape the implementation

- Zero-build, server-rendered page with vanilla JS. No React, Tailwind or
  shadcn, and no external fonts, CDN or remote images.
- CSP: `default-src 'none'`, with nonce for script and style,
  `connect-src 'self'` and `img-src 'self' data:`.
  - No inline handlers.
  - No `style="` attributes; CSSOM from script is allowed.
- Runtime text always goes through `textContent`. Icons are static,
  compile-time SVG path strings (the `ICONS` map).
- Motion uses transform and opacity only. It pauses when the tab is hidden
  and collapses under `prefers-reduced-motion` or Settings › Motion › Reduced.

## Tokens

| Token | Dark (default) | Role |
|---|---|---|
| `--b0` … `--b5` | `#050506` `#0a0a0c` `#0f0f12` `#15151a` `#1c1c22` `#25252c` | Layered blacks: page → sidebar → cards → rows → hover → pressed |
| `--line`, `--line-2`, `--line-3` | white at 6.5 %, 11 %, 18 % | Hairlines, input borders, emphasis borders |
| `--ink`, `--ink-2` | `#f4f1ec`, `#c3bdb4` | Primary text, secondary text |
| `--muted` | `#8b857c` | Tertiary text (≥ 4.6:1 on every dark surface) |
| `--faint` | `#5d5953` | Decorative only: separators, disabled controls. Never for readable text. |
| `--o-core` | `#ff6a1a` | Fury core, primary button fill |
| `--o-hot` | `#ff8a3d` | Orange text, focus ring, active nav bar |
| `--o-deep` | `#d9480f` | Gradient depth |
| `--o-soft`, `--o-line`, `--o-glow` | orange at 12 %, 34 %, 32 % | Pressed tool background, accent border, focus glow |
| `--ok`, `--warn`, `--bad` | `#5fd99a`, `#f5b547`, `#ff6b6b` | Status only |
| Radii | 8 / 12 / 16 / 22 px | Chips / controls / cards / composer |
| Easing | `cubic-bezier(.16,1,.3,1)` | Entrances, the composer glide |

Light theme exists only as Settings › Appearance › System, following the OS.
It is a warm off-white with orange darkened to `#b93d0a` (≥ 4.4:1 on every
light surface). Dark is the signature look.

Measured contrast in the dark theme:

| Pair | Ratio |
|---|---|
| `--ink-2` on `--b4` | 9.1:1 |
| `--muted` on `--b4` | 4.6:1 |
| `--o-hot` on `--b4` | 7.2:1 |
| Primary button text on `--o-core` | 6.7:1 |

Typography uses system stacks (Inter if installed, then Segoe UI Variable,
then system-ui). Monospace: JetBrains Mono → Cascadia → SF Mono.

## Components

| Component | Behaviour |
|---|---|
| **Sidebar** | Mark and wordmark, then New chat, Search (Ctrl K), mode-filtered nav with an orange bar on the active item, Recent (rename/delete via ⋯), and the mode button plus a Settings link. Collapsible (persisted). Below 860 px it becomes a drawer with a scrim; Escape closes it. |
| **Hero (new chat)** | CSS 3D orbits around the Fury core, the headline "How can FuryPipe help?", and suggestion chips that only prefill the composer. Collapses into the conversation after the first message. |
| **FuryComposer** | Textarea that autosizes up to 384 px. Enter sends; Shift+Enter adds a line. **+** attaches text files (≤ 6 files, ≤ 256 KB each; binary files refused with a reason). Pasting more than 300 characters becomes a card. Drag and drop shows an overlay. **Web** reads linked URLs through the SSRF-hardened FuryWeb FETCH. **Knowledge** searches the local index. The model button (Fury Auto or a named local model) sits next to Send, and Send becomes Stop while streaming (AbortController). |
| **Model picker** | Popover with search: Fury Auto, "On this machine" (fit pills FITS / SLOW / TOO BIG / UNKNOWN), and a Cloud entry that links to the governed Gateway WebChat. Arrow keys and Escape work. |
| **Route chip → "Why this route?"** | Model, provider, runtime, where it ran, privacy, cost ($0 local), hardware fit, tools used, who chose (Fury Auto with the number of models considered, or you), and the reason in plain words. |
| **Messages** | User bubble with attachment chips. Assistant header `model · provider · local`. Light markdown: paragraphs, bold, inline code, code blocks with Copy. Actions: Copy, Branch from here, Retry with selected model (which creates a branch). |
| **Activity rows** | Collapsible rows under the user message: web pages read (URL, bytes, receipt), knowledge passages (citations), or why nothing was used. |
| **Errors** | Inline alert with Retry and "Use another model". Stop keeps partial text marked "(stopped)". |
| **Command palette** | Ctrl K. Actions include New chat (Ctrl Shift O), Change model, the views allowed by the mode, mode switches and recent conversations. |
| **Mode menu** | Custom `menuitemradio` popover that replaces the native select. The same choice is available in Settings › General. |
| **Models page** | Hardware card and Fury Auto explainer. Runtime cards: "Running" with model rows and fit pills, or "Not running" with a Set up link. Then the Cloud card. Endpoints only under Advanced. |
| **Settings** | General (workspace mode), Appearance (theme Dark/System, motion System/Reduced, density Comfortable/Compact), Privacy (what stays local), and Advanced (Control Plane). Preferences are stored in this browser. |

## Accessibility

- Skip link is the first tab stop. View headings receive focus on in-app
  navigation (no outline; they are not controls) and set `document.title`.
- Every icon-only control has an `aria-label`. Pressed tools use
  `aria-pressed`. The picker and palette use `option`/`aria-selected`, the mode
  menu `menuitemradio`/`aria-checked`, and the conversation menu `menuitem`.
- Visible 2 px orange `:focus-visible` ring everywhere else.
- `[hidden]` always wins (`display:none!important`), so closed overlays never
  intercept input.

## QA

`scripts/studio-browser-qa.ts` drives every view. It checks:

- Fury Auto routing, the route inspector, the model picker, retry-as-branch
  and rename;
- mode gating;
- no horizontal overflow on 15 views × 1280/1024/768/390 px;
- no console or CSP errors.

With Chromium it also saves visual evidence to
`artifacts/studio-browser-qa/screens/`: new chat, model picker, attachment,
conversation, why-this-route, Models, Settings, Expert Mission Control,
palette, no-local-model, 1024 px, 390 px, the drawer, and the System light
theme.
