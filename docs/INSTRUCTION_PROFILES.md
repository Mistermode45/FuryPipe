# FuryPipe Instruction Profiles

## Purpose

Instruction profiles are bounded, inspectable additions to a caller-provided FuryPrompt.

They are not tools, MCP servers, skills, permissions or hidden system prompts. A profile can only add declared FuryPrompt sections before normal compilation and ExactGuard processing.

## Karpathy-inspired coding discipline

ID: `karpathy-coding-discipline`

Source reviewed:

- repository: `multica-ai/andrej-karpathy-skills`
- commit: `2c606141936f1eeef17fa3043a72095b4765b9c2`
- source file: `CLAUDE.md`
- reviewed blob: `daced9bd64f25908ebedeb4701fb406985dc8366`
- plugin metadata: version `1.0.0`, MIT declaration
- audit caveat: no root `LICENSE` file was found at the reviewed repository state

Decision: `ADAPT`

FuryPipe does not embed the upstream CLAUDE.md text. The native profile paraphrases four engineering principles:

1. surface material ambiguity instead of silently inventing assumptions;
2. prefer the smallest correct implementation;
3. keep changes surgical and avoid unrelated refactors;
4. define observable success criteria and verify them.

The profile adds only:

- `constraints`;
- `plan`;
- `acceptanceCriteria`;
- `verification`.

It never changes:

- the caller's task/objective text;
- tool permissions;
- MCP availability;
- Agent Runtime permissions;
- network access;
- provider routing.

## API

`applyInstructionProfiles(input, profileIds)` returns:

- the new FuryPrompt input;
- the ordered set of applied profile IDs.

The function rejects unknown and duplicate IDs.

`inspectInstructionProfiles()` returns metadata/provenance and the FuryPipe-owned additions for inspection.

## Trust boundary

A profile source is provenance, not runtime authority.

Future external instruction profiles must be:

- pinned to immutable source;
- reviewed for licence;
- rewritten or adapted where appropriate rather than copied blindly;
- bounded to FuryPrompt sections;
- tested for deterministic output;
- unable to grant tool/network/write permissions.

Instruction profiles are deliberately separate from the Skill Registry. Skills can execute callbacks and therefore require stronger permission/health gates.


## spec-driven-development

Source pattern: GitHub Spec Kit, pinned at `d848fb4e18f44640ad6b42e60a280551ee90cdce` (MIT).

This is a FuryPipe-native adaptation, not an embedded Spec Kit runtime.

It adds a durable engineering contract around FuryPrompt:

- stable specification/intent before implementation;
- architecture and technical plan before task decomposition;
- explicit risks, assumptions, dependencies and non-functional requirements;
- implementation tasks mapped to acceptance criteria;
- verification against the specification;
- blockers remain visible when a criterion is unmet.

Use it together with `karpathy-coding-discipline` when both minimal-change discipline and spec-first traceability are useful.


## systematic-debugging

Source reviewed:

- repository: `obra/superpowers`
- commit: `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`
- source file: `skills/systematic-debugging/SKILL.md`
- root licence: MIT, verified

Decision: `ADAPT`.

The native profile keeps the high-value method without copying the upstream protocol:

- reproduce before changing code;
- gather evidence at component boundaries;
- trace the originating value/failure instead of patching symptoms;
- test one falsifiable hypothesis at a time;
- prefer one scoped root-cause fix;
- prove the original failure and surrounding regressions before completion;
- reconsider architecture when repeated failed fixes indicate a structural problem.

It grants no tool, network, filesystem or provider authority.

## codebase-audit-discipline

Source reviewed:

- repository: `ksimback/tech-debt-skill`
- commit: `5a15c1ca4a929b2759461c218478de391a8bda0f`
- source file: `SKILL.md`
- licence: README declares MIT; no root licence file resolved at the reviewed commit

Decision: `ADAPT` with `DECLARED_MIT_NO_ROOT_LICENSE_FILE`.

The native profile requires orientation before judgment, repository evidence for findings, explicit false-positive/intentional-pattern review, scoped remediation, and open questions when intent cannot be proven.

## ui-design-discipline

Source reviewed:

- repository: `Nutlope/hallmark`
- commit: `13ac0ec7e148655948100b6396439e481361d690`
- source file: `skills/hallmark/SKILL.md`
- root licence: MIT, verified

Decision: `ADAPT`.

The FuryPipe profile keeps only portable design discipline:

- inspect the existing design system before changing it;
- decide page/component scope first;
- preserve routes/component ownership unless broader replacement is explicitly requested;
- never invent proof, metrics, testimonials or customer logos;
- learn principles from references instead of pixel-cloning them;
- design responsive/accessibility/state behavior before cosmetic polish;
- verify focus, contrast, overflow, state completeness and system consistency.

It does not import Hallmark themes, runtime, remote fetching, generators or project files.

## product-marketing-context-discipline

Source reviewed:

- repository: `coreyhaines31/marketingskills`
- commit: `5b2c0007766c6a1cf1d53fd8fc73e979e0821022`
- source file: `skills/product-marketing/SKILL.md`
- root licence: MIT, verified

Decision: `ADAPT`.

The profile makes product/audience/positioning/proof context reusable while preserving evidence boundaries. Customer quotes, metrics, pricing, logos and competitor claims are never invented; hypotheses remain separate from facts.

## Explicit workload recommendations

`recommendInstructionProfiles(workload)` provides a deterministic policy owned by FuryPipe. It does not inspect prompt text and it does not activate external skills.

| Workload | Native profile recommendation |
|---|---|
| `general-engineering` | `karpathy-coding-discipline` |
| `feature-development` | Karpathy + spec-driven |
| `bugfix` | Karpathy + systematic debugging |
| `codebase-audit` | codebase audit |
| `production-hardening` | Karpathy + spec-driven + systematic debugging + codebase audit |
| `ui-development` | Karpathy + spec-driven + UI design |
| `marketing` | product marketing context |
| `research` | none by default |

A recommendation is not authorization. Profiles add bounded FuryPrompt sections only and cannot make a skill, MCP, tool, provider or external service executable.
