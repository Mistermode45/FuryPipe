# FuryPipe VNext — FuryWeb Site Creation Pipeline (2026)

Status: Phase 0 architecture/design only.

This document turns a set of website-creation prompt patterns into a production-grade FuryPipe capability pipeline. The source material covered five recurring roles:

1. systems architecture;
2. visual-system architecture;
3. conversion copywriting;
4. interaction-system engineering;
5. prompt translation for Figma Make.

The VNext decision is to implement these as composable skills with explicit input/output contracts, not as one large persona prompt.

## Product goal

A user should be able to ask:

```text
Create a premium SaaS website for my product.
```

FuryPipe should automatically determine whether it needs:

- architecture;
- information architecture;
- user journeys;
- design system;
- conversion copy;
- interaction design;
- frontend implementation;
- SEO;
- accessibility;
- performance;
- analytics;
- browser QA;
- deployment evidence.

The user should not have to manually invoke five prompts.

## FuryWeb architecture

```text
User brief
   ↓
FuryWeb Intake
   ↓
Site Architect
   ↓
Visual System Architect
   ↓
Content / Conversion Architect
   ↓
Interaction Systems Engineer
   ↓
Implementation Planner
   ↓
Target Adapter / Prompt Compiler
   ├─ Figma Make
   ├─ v0
   ├─ Lovable
   ├─ Bolt
   ├─ Replit
   ├─ coding agent
   └─ direct Fury coding worker
   ↓
Build
   ↓
Browser QA
   ↓
Accessibility / SEO / Performance / Security checks
   ↓
Evidence-backed delivery
```

## 1. FuryWeb Site Architect

This replaces the generic "senior systems architect" prompt with a structured planning skill.

### Inputs

- site type;
- audience;
- business goal;
- feature set;
- brand constraints;
- target devices;
- content maturity;
- backend requirements;
- integrations;
- SEO importance;
- performance targets;
- deployment constraints.

### Outputs

- sitemap;
- page hierarchy;
- navigation model;
- primary and secondary user journeys;
- conversion paths;
- content/data entities;
- API/integration surface;
- authentication requirements if applicable;
- component inventory;
- page templates;
- technical stack options;
- SEO architecture;
- performance budgets;
- analytics/telemetry plan;
- risks and assumptions.

### Important improvement over the source prompt

Do not require arbitrary component counts such as "30 components" unless the product actually needs them.

FuryWeb should optimize for minimum sufficient architecture rather than feature-count inflation.

## 2. FuryWeb Visual System Architect

The source material correctly separates visual-system design from site architecture.

FuryWeb should formalize this as a design-token contract.

### Outputs

#### Color

- semantic color roles;
- light/dark themes when required;
- foreground/background contrast;
- success/warning/error/information states.

#### Typography

- display/body/support styles;
- responsive scale;
- font fallbacks;
- line-height and measure rules.

#### Spacing and layout

- base spacing scale;
- container widths;
- grids;
- responsive gutters;
- vertical rhythm.

#### Components

- component taxonomy;
- variants;
- interactive states;
- disabled/loading/error/empty states;
- responsive behavior.

#### Motion

- transition duration ranges;
- easing;
- entry/exit rules;
- reduced-motion behavior;
- no-motion fallback.

#### Accessibility

At minimum:
- keyboard support;
- visible focus;
- semantic structure;
- contrast targets;
- reduced-motion;
- form labels/errors;
- touch-target requirements.

### Deliverable formats

FuryWeb should be able to compile the design system into:

- JSON design tokens;
- CSS custom properties;
- Tailwind/theme configuration where selected;
- component documentation;
- Figma-oriented specification;
- framework-specific theme code.

## 3. FuryWeb Content and Conversion Architect

The source material includes conversion-copy structure such as hero, benefits, social proof, FAQ and footer.

FuryWeb should retain the useful structure but avoid blindly applying persuasion patterns.

### Inputs

- audience;
- product;
- brand voice;
- market position;
- evidence available;
- desired action;
- regulatory/legal constraints;
- region/language.

### Output contract

Per page:

- page intent;
- H1;
- supporting copy;
- primary/secondary CTA;
- feature/benefit blocks;
- evidence/proof blocks;
- objection handling;
- FAQ;
- footer/navigation copy;
- SEO title/meta description;
- structured-data candidates.

### Evidence rule

FuryWeb must never invent:

- testimonials;
- customer counts;
- revenue;
- awards;
- certifications;
- performance claims;
- market leadership.

If proof is unavailable:

```text
proof unavailable
```

not fabricated social proof.

### Conversion quality

Use clarity, relevance and evidence first.

Urgency/scarcity/exclusivity should only appear when factual and appropriate.

## 4. FuryWeb Interaction Systems Engineer

This is one of the strongest ideas in the supplied material.

Interactive modules should be designed as explicit state machines before implementation when complexity warrants it.

Examples:

- multi-step form;
- authentication;
- calculator;
- faceted search;
- dashboard CRUD;
- checkout;
- onboarding;
- account settings.

### Per-module contract

- states;
- events;
- state transitions;
- data dependencies;
- validation;
- loading;
- optimistic/pessimistic mutation behavior;
- errors;
- retries;
- empty states;
- permissions;
- edge cases;
- analytics events;
- accessibility behavior.

Example:

```text
idle
 → submitting
 → success

submitting
 → validation_error
 → server_error
 → timeout
```

### Frontend implementation artifact

The implementation planner can translate the state contract into:

- component boundaries;
- hooks;
- stores/state machines;
- event handlers;
- API client calls;
- error boundaries;
- tests.

## 5. FuryWeb Target Adapter / Prompt Compiler

The source material specifically targets Figma Make.

FuryWeb should generalize that idea.

One canonical website specification should compile into target-specific artifacts.

### Canonical spec

```text
FuryWebSpec
- identity
- architecture
- content
- design tokens
- components
- interactions
- responsive rules
- accessibility
- performance
- SEO
- analytics
- integrations
```

### Adapters

Potential adapters:

- Figma Make;
- v0;
- Lovable;
- Bolt;
- Replit;
- Framer;
- direct React/Next.js coding worker;
- static HTML/CSS;
- future website generators.

### Rule

Do not maintain five unrelated giant prompts.

Maintain:

```text
one canonical spec
+
small target adapters
```

This reduces drift and makes benchmarking possible.

## 6. Automatic skill routing

Capability Autopilot should activate only what the project needs.

Example landing page:

```text
Site Architect
Visual System
Content
Prompt Compiler
Browser QA
```

No database architect.

Example SaaS application:

```text
Site Architect
Visual System
Content
Interaction Engineer
Auth
API/Data
Security
Frontend
Backend
Browser QA
```

Example documentation website:

```text
Information Architecture
Technical Content
Search
SEO
Accessibility
Frontend
```

## 7. Additional production skills FuryWeb needs

The five supplied prompt roles are useful but not sufficient for a production website.

FuryWeb should also have lazy skills for:

### SEO

- crawlability;
- metadata;
- canonical URLs;
- sitemap/robots;
- structured data;
- internal linking;
- Open Graph;
- redirects.

### Accessibility

- semantic HTML;
- WCAG checks;
- keyboard flows;
- focus management;
- labels/errors;
- contrast;
- reduced motion.

### Performance

- Core Web Vitals;
- image strategy;
- JS budgets;
- route-level code splitting;
- font loading;
- cache strategy;
- server/client rendering choices.

### Security

- auth/session;
- CSRF/XSS boundaries;
- input validation;
- headers/CSP;
- secret handling;
- dependency risk;
- uploads.

### Analytics

- conversion events;
- funnels;
- privacy/consent;
- error monitoring;
- performance telemetry.

### Browser QA

- desktop/mobile;
- responsive breakpoints;
- interaction tests;
- forms;
- navigation;
- visual regressions;
- keyboard navigation.

## 8. FuryWeb QA gates

A site should not be marked "complete" just because it renders.

Suggested gates:

```text
architecture complete
design tokens complete
content evidence checked
build pass
typecheck pass
tests pass
browser QA pass
responsive QA pass
accessibility check
SEO check
performance check
broken-link check
security check where applicable
```

Each state remains independent.

```text
rendered != functional
functional != accessible
accessible != performant
performant != SEO-complete
agent says done != verified
```

## 9. FuryWeb modes

The same system should scale from a simple page to a full product.

### QUICK

For:
- landing pages;
- portfolios;
- small marketing sites.

### PRODUCT

For:
- SaaS;
- dashboards;
- authenticated apps;
- e-commerce.

### DEEP

Adds:
- market/research agents;
- multiple architecture alternatives;
- independent UX review;
- security review;
- performance benchmarking;
- conversion review.

Mode selection can be automatic but must remain inspectable.

## 10. Design inspiration versus copying

The screenshots supplied useful prompting patterns, but FuryPipe should not treat social-media prompt text as production specifications.

The valuable abstraction is the separation of concerns:

```text
architecture
visual system
content
interaction
target compilation
```

FuryWeb should implement these ideas independently with explicit schemas, tests and quality gates.

## 11. Relationship to existing FuryPipe VNext systems

```text
FuryWeb
  ↓
Capability Autopilot
  ├─ Skill selection
  ├─ Model selection
  └─ Tool/MCP selection

Context Engine
  ├─ project context
  ├─ screenshots
  ├─ brand references
  └─ Visual Engine

Fury CodeGraph
  └─ existing-site/repository understanding

Fury Worker
  ├─ browser worker
  └─ coding worker

Fury Evidence
  └─ QA results / receipts
```

## 12. VNext decision

Website creation should become a first-class FuryPipe capability called **FuryWeb**.

Its core principle:

> One canonical, evidence-backed website specification is progressively refined by specialized skills and compiled to the best target tool or coding runtime.

The system should not ask the user to know which specialist prompt to run.
