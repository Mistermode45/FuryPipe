# Web Studio implementation status

## Status

`KERNEL_IMPLEMENTED_NOT_WIRED`

The Web/Figma Studio now has an executable domain kernel under `src/web-studio/**` with regression coverage. It is not yet wired to an external Figma API, a dashboard, website generator, deployment provider or Playwright runtime.

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
- automatic code generation;
- Playwright execution for generated sites;
- WCAG manual audit completion;
- OWASP ASVS verification;
- SEO verification;
- production deployment;
- production Core Web Vitals field evidence.

Those remain `NOT_EXECUTED` until a real Studio project and authorized external integrations exist.
