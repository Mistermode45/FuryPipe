# Web Studio source / connector registry

Sources are references, not vendored dependencies.

| Source | Decision | Use | Verification baseline |
|---|---|---|---|
| W3C WCAG 2.2 | ADOPT_STANDARD | Accessibility acceptance baseline | W3C Recommendation, current published update |
| Playwright | ADOPT_TOOLING_PATTERN | Cross-browser/device/locale E2E project model | official Playwright docs |
| OWASP ASVS 5.0.0 | ADOPT_STANDARD | Web application security verification reference | OWASP stable 5.0.0 |
| web.dev Core Web Vitals | ADOPT_METRICS | LCP/INP/CLS field thresholds | current web.dev guidance |
| Figma | WRAP | Design source/variant adapter | adapter/API contract to be pinned when implemented |
| WordPress MCP Adapter | REFERENCE_ONLY | Future WordPress integration research | repo/license/security review required before implementation |
| 21st.dev | REFERENCE_ONLY | UI inspiration/component research | no blind vendoring |
| Awwwards | REFERENCE_ONLY | visual inspiration | inspiration only, no pixel-perfect copying |
| 60fps.design | REFERENCE_ONLY | visual research | provenance/licence review for any asset |
| Design Vault | REFERENCE_ONLY | visual research | provenance/licence review for any asset |
| Pexels | REFERENCE_ONLY | image sourcing | asset-specific license/provenance record required |
| Remotion | REFERENCE_ONLY | motion/video implementation research | package/repo version and license review required |
| HyperFrames | REFERENCE_ONLY | UI/motion research | repo/version/license review required |

## Rules

Before converting a `REFERENCE_ONLY` source to `WRAP`, `ADAPT` or `ADOPT`:

1. identify canonical source;
2. pin version/SHA where applicable;
3. verify license;
4. verify maintenance;
5. threat-model the integration;
6. record data sent externally;
7. define permission boundaries;
8. add tests and rollback behavior.

No third-party MCP, plugin, skill or Figma extension receives secrets or write access by default.
