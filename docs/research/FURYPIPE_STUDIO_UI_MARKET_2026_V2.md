# FuryPipe Studio — 2026 AI Workspace UI/UX synthesis

Date: 2026-09-26

## Evidence reviewed

This pass intentionally studies interaction patterns rather than copying any product.

- OpenAI Codex app (2026-02-02): a command center for parallel, long-running agents; project/thread organization; worktree isolation; inspectable diffs and skills.
  - https://openai.com/index/introducing-the-codex-app/
- OpenAI ChatGPT Work (2026-07-09): separates quick conversation from long-running work; supports handoff across desktop/web and finished artifacts.
  - https://openai.com/index/chatgpt-for-your-most-ambitious-work/
- OpenAI Codex App Server engineering (2026-02-04): persistent conversation primitives and a product-integration protocol are preferable to treating an agent CLI like a terminal widget.
  - https://openai.com/index/unlocking-the-codex-harness/
- Cursor 3 (2026-04-02): simpler agent-centered shell, overview first with drill-down, parallel local/cloud/worktree/SSH agents.
  - https://cursor.com/changelog/3-0
- Cursor Design Mode (2026-06-05): spatial context and direct manipulation reduce prompt burden for UI work.
  - https://cursor.com/blog/design-mode

## Product implications for FuryPipe

1. Conversation must remain the lowest-friction default surface.
2. Work, Code and Agents are task modes, not a permanent wall of control-plane data.
3. Advanced infrastructure belongs behind progressive disclosure and Settings -> Advanced -> Control Plane.
4. Account/provider state must be verified and actionable; "runtime installed" is not equivalent to "account connected".
5. Long operations need visible progress, cancellation/recovery states and persistent task state.
6. Local/cloud locality and potential cost must be explicit at the moment a route is chosen.
7. Parallel agents should be represented as high-level task/thread state first, with receipts/worktrees/diffs available on demand.
8. Motion should communicate state changes; decorative motion must remain lightweight and reduced-motion safe.
9. FuryPipe should keep its own visual identity: restrained black surfaces, orange as an accent, high contrast, and minimal permanent chrome.

## This implementation pass

- Simplifies the primary sidebar around Chat / Work / Code / Agents / Automations.
- Moves context, models, providers and control-plane surfaces under a single More disclosure.
- Replaces the oversized setup wall with a compact readiness panel.
- Makes Work goal-first and moves permissions/scope into an Advanced disclosure.
- Keeps all existing routes/functionality accessible.
- Preserves the Fury Lux visual language while reducing large orange-filled actions.

This document records design evidence and does not claim FuryPipe is objectively superior to other products.
