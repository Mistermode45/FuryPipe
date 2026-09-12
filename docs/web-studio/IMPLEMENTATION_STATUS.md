# Web Studio implementation status

## Status

`LOCAL_GENERATOR_AND_QA_HARNESS_IMPLEMENTED`

The Web/Figma Studio now has an executable domain kernel plus a deterministic static-page generator and a browser-QA harness under `src/web-studio/**`. The harness executes a host-supplied pinned browser adapter; FuryPipe itself still does not bundle Playwright or claim a live Figma/deployment integration.

Implemented and tested:

- project/brief/source/variant/evidence model;
- 2–4 variant invariant;
- approved-variant invariant;
- third-party source trust/license/pinning gates;
- immutable implementation commit evidence;
- verification/deployment promotion rules;
- `BACKUP_EXISTS` versus `RESTORE_VERIFIED` distinction;
- 2026 QA browser/device/locale contract;
- current Core Web Vitals thresholds;
- fail-visible missing field data;
- Figma adapter version pin contract.

Still deliberately not claimed:

- live Figma connectivity;
- asset download;
- framework/project code generation beyond the deterministic static-page artifact;
- bundled Playwright/browser runtime execution; a pinned host adapter is required;
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

This report is deliberately marked `promotionEvidenceCompatible: false`. Passing structural/browser checks does not prove a complete WCAG manual audit, OWASP ASVS review, field Core Web Vitals or production deployment.
