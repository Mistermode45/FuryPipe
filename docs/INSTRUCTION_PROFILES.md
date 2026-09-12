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
