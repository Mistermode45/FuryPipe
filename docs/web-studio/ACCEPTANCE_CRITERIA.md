# Web Studio acceptance criteria

## Status

`SPECIFIED_NOT_IMPLEMENTED`

## Accessibility

Baseline target:

- WCAG 2.2 AA;
- semantic document structure;
- keyboard operability;
- visible focus;
- accessible names;
- form labels/errors;
- no color-only meaning;
- zoom/reflow support;
- target-size and dragging behavior considered for WCAG 2.2.

Automated tooling is evidence, not complete proof of accessibility.

## Performance

Field targets use current Core Web Vitals guidance at the 75th percentile:

- LCP ≤ 2.5 s;
- INP ≤ 200 ms;
- CLS ≤ 0.1.

Lab budgets may be stricter but cannot be presented as field evidence.

Also track:

- JS transferred/executed;
- CSS transferred;
- image weight;
- font weight;
- request count;
- server response latency.

## Security

Use OWASP ASVS 5.0.0 as the application-security verification reference when applicable.

Project review must cover, as relevant:

- TLS;
- CSP;
- HSTS;
- secure cookies;
- authentication/authorization;
- CORS;
- CSRF;
- XSS;
- SQL/NoSQL injection;
- SSRF;
- path traversal;
- command injection;
- upload handling;
- IDOR/BOLA;
- rate limiting;
- webhook signatures/replay;
- secret handling;
- dependency/supply-chain exposure.

A static marketing site and an authenticated SaaS app do not receive identical control requirements; scope controls by architecture and threat model.

## SEO

Required when indexable:

- unique title;
- meta description;
- canonical;
- robots policy;
- sitemap;
- hreflang for localized equivalents;
- Open Graph/social metadata;
- structured data where semantically appropriate;
- redirect map;
- deliberate 404/410 handling;
- broken-link scan;
- duplicate/indexability review.

Do not add schema.org markup that does not match visible content.

## Privacy / analytics

Before adding analytics:

- identify lawful/contractual requirements;
- classify cookies/storage;
- ensure required consent before non-essential tracking;
- prevent PII/secret leakage;
- document retention and processors.

No analytics provider is enabled merely because it appears in a template.

## Design quality

Acceptance requires:

- coherent hierarchy;
- consistent tokens;
- responsive behavior;
- content fit;
- real empty/error/loading states;
- no horizontal overflow;
- no inaccessible contrast introduced by variants;
- motion respects user preference;
- approved variant traceability.

## Deployment

Before `DEPLOYMENT_VERIFIED`:

- build artifact identified;
- environment identified;
- config/secrets injected outside source;
- migrations reviewed if any;
- health/readiness checks;
- rollback path;
- security headers checked;
- production smoke tests;
- observability active;
- backup state distinguished from restore verification.

Use distinct statuses:

- `BACKUP_EXISTS`
- `RESTORE_VERIFIED`

They are never interchangeable.
