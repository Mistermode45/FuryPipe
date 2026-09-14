# Web Studio implementation status

## Status

`LOCAL_GENERATOR_AND_QA_HARNESS_IMPLEMENTED_REAL_CROSS_BROWSER_WIRED`

The Web/Figma Studio now has an executable domain kernel plus a deterministic static-page generator and a browser-QA harness under `src/web-studio/**`. The harness executes a host-supplied pinned browser adapter. CI retains the Chromium/Chrome DevTools Protocol adapter in `scripts/web-studio-browser-qa.ts` and adds a separate Playwright 1.63.0 cross-engine harness in `scripts/cross-browser-qa.ts`. The complete 120-case matrix can report `VERIFIED`; a passing subset is only `PARTIAL`. No live Figma/deployment integration is claimed.

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
- pinned Playwright 1.63.0 cross-engine execution for the full 120-case matrix and Dashboard Chromium/Firefox/WebKit LTR/RTL responsive checks;
- source-bound Chromium evidence from `.github/workflows/web-studio-browser-qa.yml` and source-bound multi-engine evidence from `.github/workflows/cross-browser-qa.yml`;
- current Core Web Vitals thresholds;
- fail-visible missing field data;
- Figma adapter version pin contract.

Still deliberately not claimed:

- live Figma connectivity;
- asset download;
- framework/project code generation beyond the deterministic static-page artifact;
- branch-specific hosted Firefox/WebKit results until the cross-browser workflow completes on the exact final source SHA; local engine runs are not promoted to hosted evidence;
- Playwright in the published runtime package; it is a development-only QA dependency;
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

The CDP adapter is pinned as `chromium-cdp@1.0.0` and executes only Chromium cases. The separate Playwright adapter is pinned to package version 1.63.0 (Apache-2.0) and runs Chromium, Firefox, and WebKit binaries installed by that exact Playwright version. Its report is bound to the exact source SHA. A partial case list cannot yield `VERIFIED` from `runStudioBrowserQa()`.

This report is deliberately marked `promotionEvidenceCompatible: false`. Passing structural/browser checks does not prove a complete WCAG manual audit, OWASP ASVS review, field Core Web Vitals or production deployment.
