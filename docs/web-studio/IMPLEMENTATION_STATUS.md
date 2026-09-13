# Web Studio implementation status

## Status

`LOCAL_GENERATOR_AND_QA_HARNESS_IMPLEMENTED_REAL_CHROMIUM_WIRED`

The Web/Figma Studio now has an executable domain kernel plus a deterministic static-page generator and a browser-QA harness under `src/web-studio/**`. The harness executes a host-supplied pinned browser adapter. FuryPipe now also ships a CI host adapter in `scripts/web-studio-browser-qa.ts` that drives the Chromium/Chrome binary already present on the GitHub Ubuntu runner over the native Chrome DevTools Protocol. No Playwright package is added to the dependency graph, and no live Figma/deployment integration is claimed.

Implemented and tested:

- project/brief/source/variant/evidence model;
- 2–4 variant invariant;
- approved-variant invariant;
- third-party source trust/license/pinning gates;
- immutable implementation commit evidence;
- verification/deployment promotion rules;
- `BACKUP_EXISTS` versus `RESTORE_VERIFIED` distinction;
- 2026 QA browser/device/locale contract;
- real Chromium execution for the 48 `desktop-chromium` + `mobile-chromium` cases (6 declared viewports × 4 QA locales × 2 Chromium projects);
- source-bound browser QA JSON evidence emitted by `.github/workflows/web-studio-browser-qa.yml`;
- current Core Web Vitals thresholds;
- fail-visible missing field data;
- Figma adapter version pin contract.

Still deliberately not claimed:

- live Figma connectivity;
- asset download;
- framework/project code generation beyond the deterministic static-page artifact;
- Firefox/WebKit runtime execution for the remaining 72 matrix cases; Chromium evidence is not relabelled as Firefox/WebKit evidence;
- bundled Playwright itself; the current CI adapter deliberately uses Chromium CDP instead;
- WCAG manual audit completion;
- OWASP ASVS verification;
- SEO verification;
- production deployment;
- production Core Web Vitals field evidence.

Those remain `NOT_EXECUTED` until a real Studio project and authorized external integrations exist.


## Local generator

`renderStaticStudioPage()` requires an approved project and selected variant. It emits a deterministic HTML document with:

- canonical BCP-47 locale and LTR/RTL direction;
- UTF-8 + viewport metadata;
- title, description and canonical URL;
- one semantic `main` and `h1`;
- escaped text content;
- a restrictive metadata CSP;
- no third-party scripts;
- SHA-256 of the exact HTML artifact.

The generator rejects unapproved projects, malformed page paths, invalid locale tags and non-HTTPS/credential-bearing canonical URLs.

## Browser QA harness

`buildStudioQaMatrix()` expands the declared browser projects, six viewports and four QA locales into 120 deterministic cases.

`runStudioBrowserQa()` executes those cases through a pinned `StudioBrowserQaAdapter` and validates:

- load success;
- horizontal overflow;
- broken links;
- console errors;
- keyboard reachability;
- single H1;
- locale/direction agreement;
- title/description/canonical presence;
- external script origins.

The CI adapter is pinned as `chromium-cdp@1.0.0` and executes only cases whose declared browser project is Chromium. The full contract still contains Firefox/WebKit cases, which remain explicit and unexecuted rather than being simulated with Chromium.

This report is deliberately marked `promotionEvidenceCompatible: false`. Passing structural/browser checks does not prove a complete WCAG manual audit, OWASP ASVS review, field Core Web Vitals or production deployment.
