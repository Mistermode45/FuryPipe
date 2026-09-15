# Web Studio QA matrix

## Status

`LOCAL_AND_CI_HARNESS_IMPLEMENTED`

Playwright 1.63.0 runs the same declared cases across real Chromium, Firefox and WebKit engines, desktop/mobile projects, locales and viewports. The CI workflow installs only the browsers pinned to that exact Playwright version and emits source-bound evidence; local success does not replace exact-SHA hosted evidence.

The current 120 cases are `5 browser projects × 6 viewports × 4 locales` over the deterministic static-page QA fixture. They validate rendering/structure, responsive overflow, language/direction, links and runtime errors; they do not claim every interaction in the broader contract below, a live Figma project, or manual accessibility review.

## Browser matrix

Required release coverage:

| Class | Browser engine |
|---|---|
| Desktop | Chromium |
| Desktop | Firefox |
| Desktop | WebKit |
| Mobile | Chromium device emulation |
| Mobile | WebKit / Mobile Safari emulation |

Branded Chrome/Edge runs are optional compatibility gates when a project requires them.

## Viewport matrix

At minimum:

- mobile small: 320×568;
- mobile: 390×844;
- tablet portrait: 768×1024;
- tablet landscape: 1024×768;
- desktop: 1440×900;
- large desktop: 1920×1080.

These are test contracts, not assumptions that responsive breakpoints must equal those exact widths.

## Locale matrix

Minimum:

- `en`;
- `fr`;
- `en-XA` pseudo-localized expansion;
- `ar-XB` pseudo RTL.

Where the application supports a real RTL locale, include it separately.

## Interaction coverage

Every relevant surface checks:

- navigation;
- active/hover/focus states;
- keyboard traversal;
- visible focus;
- forms;
- validation;
- error recovery;
- modal open/close/focus trap;
- escape behavior;
- links;
- media;
- loading states;
- empty states;
- long content;
- touch targets;
- orientation;
- zoom;
- reduced motion where applicable.

## Accessibility

Automated accessibility checks are a gate for detectable violations, but they are not sufficient by themselves.

Release verification also requires manual checks for:

- keyboard-only use;
- focus order;
- screen-reader naming where critical;
- semantic headings/landmarks;
- error messaging;
- zoom/reflow;
- color-independent meaning.

Target standard: WCAG 2.2 AA unless a project contract requires more.

## Failure artifacts

On E2E failure retain, subject to privacy rules:

- trace;
- screenshot;
- DOM snapshot where supported;
- console errors;
- network failures;
- project/browser name;
- locale;
- viewport.

Do not retain credentials, tokens or user PII in artifacts.

## Gate semantics

- `NOT_RUN`: suite not executed.
- `FAILED`: at least one required project failed.
- `PARTIAL`: only subset executed.
- `VERIFIED`: all required projects and manual gates completed.

Retries may detect flakiness, but a pass-after-retry must remain observable; retries do not erase flaky-test evidence.
