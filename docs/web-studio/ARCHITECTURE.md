# M14 — FuryPipe Web / Figma Studio architecture

## Status

`SPECIFIED_NOT_IMPLEMENTED`

This document defines the architecture and gates for M14. It does not claim a working Figma integration, website generator, deployment engine, or Playwright suite.

## Product flow

```text
brief
→ research
→ UX
→ information architecture
→ user flows
→ wireframes
→ 2–4 design variants
→ client/maintainer review
→ approval
→ implementation
→ QA
→ accessibility
→ security
→ SEO
→ performance
→ deployment
→ post-deploy verification
```

## Components

### 1. Brief / Research

Inputs:

- business objective;
- audience;
- conversion objective;
- content inventory;
- brand constraints;
- legal/privacy constraints;
- target locales;
- target devices;
- integrations.

Outputs are structured evidence, not a generated design.

### 2. UX Engine

Owns:

- user journeys;
- navigation;
- information architecture;
- onboarding;
- forms;
- errors/feedback;
- conversion friction;
- keyboard/touch behavior;
- accessibility requirements.

### 3. UI Engine

Owns:

- design tokens;
- color;
- typography;
- spacing;
- grids;
- iconography;
- components;
- responsive states;
- motion;
- themes.

The engine must keep semantic tokens separate from raw color/size values.

### 4. Variant Engine

For material design tasks, generate 2–4 genuinely distinct variants rather than cosmetic recolors.

Typical directions:

- clean/minimal;
- premium/visual;
- conversion/CTA.

Each variant receives:

- desktop composition;
- tablet adaptation;
- mobile adaptation;
- rationale;
- accessibility risks;
- implementation complexity;
- performance risks.

### 5. Figma Adapter

Future adapter responsibilities:

- create/read design variables and components;
- preserve stable component/variant IDs;
- attach design-token metadata;
- map approved components to implementation contracts;
- export only approved assets;
- record source/provenance.

Figma output is not the source of truth for runtime security, SEO or accessibility.

### 6. Implementation Adapter

Consumes an approved design contract and produces framework-specific implementation.

It must not silently:

- change approved information architecture;
- invent analytics/tracking;
- add third-party scripts;
- copy external designs pixel-perfect;
- weaken accessibility/security gates.

### 7. QA / Verification

The verification layer is independent from the generation layer.

It covers:

- browsers/devices;
- responsiveness;
- visual overflow;
- navigation;
- forms;
- modals;
- links;
- images;
- keyboard/focus;
- touch;
- zoom;
- locale/RTL;
- accessibility;
- SEO;
- security headers;
- performance.

## Trust boundaries

External design/inspiration sources are untrusted inputs.

Treat as potentially hostile:

- copied HTML/CSS/JS;
- design-system snippets;
- Figma plugins/files;
- MCP servers;
- images/SVGs;
- WordPress plugins;
- generated code;
- third-party analytics;
- remote fonts.

The model is not a security boundary.

## Evidence model

Each generated project should retain:

- brief digest;
- research source ledger;
- selected variant ID;
- approved token set;
- implementation commit;
- QA run ID;
- accessibility report;
- security report;
- SEO report;
- performance report;
- deployment target/version.

A project cannot move from `IMPLEMENTED` to `VERIFIED` merely because the UI renders.
