# FuryPipe Studio — AI workspace UI market scan 2026

Scope: how the leading AI workspaces present chat, models, agents, files and
approvals in 2026, and what FuryPipe Studio takes or refuses from each. This
drives the Studio rework (UX-01, human verdict REWORK_REQUIRED). Capability
and interoperability facts live in `AI_MARKET_2026.md` and
`COMPETITOR_CAPABILITY_MATRIX_2026.md`; this file is only about the product
experience.

Date checked for every row: **2026-09-25** (web search in this session).
Where no official page was reachable, the source column says so and names the
secondary source. 21st.dev pages are blocked by this session's egress proxy;
the two 21st.dev components the operator asked about were pasted as source
code instead (see the end of this file).

## Products

### Cursor 3 — Agents Window

| Field | Value |
|---|---|
| Date checked | 2026-09-25 |
| Official source | [cursor.com/blog/cursor-3](https://cursor.com/blog/cursor-3), [changelog 3.0](https://cursor.com/changelog/3-0), [Agents Window docs](https://cursor.com/docs/agent/agents-window) (Cursor 3, 2 Apr 2026) |
| Current UX pattern | A separate Agents Window: many agents run in parallel (local, worktrees, cloud, SSH), shown as tabs or a grid, each with its own diff and status. The editor becomes one view among others. |
| Best idea | Agents are first-class objects with live status and a diff, not chat bubbles. |
| Weakness | Dense and developer-only. A new user sees too many surfaces at once. |
| Learn | Mission Control and Code show agents with state, worktree and receipts. Parallel runs sit behind Engineer/Expert modes, not on the first screen. |
| Must not copy | IDE chrome on the home screen. The editor-first layout. |

### OpenClaw 2.0 — new web UI

| Field | Value |
|---|---|
| Date checked | 2026-09-25 |
| Official source | [docs.openclaw.ai/releases/2026.8.1](https://docs.openclaw.ai/releases/2026.8.1), [The new web UI](https://docs.openclaw.ai/releases/2026.8.1/the-new-web-ui) |
| Current UX pattern | The conversation sits at the centre. Files, approvals and live work are nearby in resizable panes that persist. Pending approvals stay visible until they are answered. |
| Best idea | Approvals never hide behind a menu. |
| Weakness | Pane-heavy at small widths. |
| Learn | Approvals (Cowork ASK) and tool activity sit next to the message that caused them. Activity rows under the user message show web reads and knowledge hits with their receipts. |
| Must not copy | A multi-pane layout as the default at phone width. |

### Codex app (OpenAI)

| Field | Value |
|---|---|
| Date checked | 2026-09-25 |
| Official source | [openai.com/index/introducing-the-codex-app](https://openai.com/index/introducing-the-codex-app/) (2 Feb 2026). Secondary: [VKTR](https://www.vktr.com/ai-news/openai-codex-app-for-macos-a-multi-agent-ai-development-command-center/), [IntuitionLabs](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents) for the Windows release and the merge into the ChatGPT desktop app |
| Current UX pattern | A "command center": parallel threads grouped by project, each an agent task with its own state. |
| Best idea | Threads grouped by project. The task is the unit, not the model. |
| Weakness | The model and runtime are mostly implicit, so you cannot see why a model ran. |
| Learn | Recent conversations in the sidebar, plus Branch and Retry. The route is always explicit: the route chip and the "Why this route?" panel. |
| Must not copy | Hiding which model and runtime ran. |

### ChatGPT (2026)

| Field | Value |
|---|---|
| Date checked | 2026-09-25 |
| Official source | [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes), [ChatGPT agent](https://help.openai.com/en/articles/11752874-chatgpt-agent). Secondary: [ai-toolbox sidebar guide](https://www.ai-toolbox.co/chatgpt-management-and-productivity/chatgpt-sidebar-redesign-guide), [Projects guide](https://www.ai-toolbox.co/chatgpt-management-and-productivity/how-to-use-chatgpt-projects-guide-2026) |
| Current UX pattern | A centred composer with a "+" menu. The model picker lives in the composer. Sidebar: New chat, Search, Library, Projects, pinned and recent chats. |
| Best idea | The model choice sits in the composer, where the decision is made. |
| Weakness | The sidebar has grown crowded, and some features only exist on some plans. |
| Learn | The Fury Auto / model picker sits inside FuryComposer. Sidebar: New chat, Search (Ctrl K), then nav, then Recent. |
| Must not copy | ChatGPT green. The ChatGPT layout pixel for pixel. |

### Claude — Chat + Cowork, Artifacts

| Field | Value |
|---|---|
| Date checked | 2026-09-25 |
| Official source | [Get started with Cowork](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork), [Artifacts in Cowork](https://support.claude.com/en/articles/14729249-use-artifacts-in-claude-cowork). Secondary: [TechCrunch, 16 Sep 2026](https://techcrunch.com/2026/09/16/anthropic-merges-claude-chat-and-cowork-in-one-interface/) for the merged Chat + Cowork interface |
| Current UX pattern | One interface for chat and file/folder work. A calm, text-first composer. Artifacts open beside the conversation. |
| Best idea | A single workspace: chatting and doing work are the same place. |
| Weakness | Warm beige branding that FuryPipe must not resemble. Cloud-only. |
| Learn | The composer behaviour: autosize, pasted-text cards, file cards, drag and drop, Enter to send. The Cowork permissions view lives inside the same shell. |
| Must not copy | Claude beige, the Claude logo, Anthropic wording. The 21st.dev "claude-style" demo's hardcoded Claude models. |

### Google Gemini — "Neural Expressive" redesign

| Field | Value |
|---|---|
| Date checked | 2026-09-25 |
| Official source | Not reachable in this session. Secondary: [Dezeen, 19 May 2026](https://www.dezeen.com/2026/05/19/google-rolls-out-neural-expressive-redesign-of-gemini-ai-tool/), [Engadget](https://www.engadget.com/2176568/google-redesigned-gemini-comes-with-a-new-interface-and-ai-models/), [Android Authority](https://www.androidauthority.com/gemini-neural-expressive-android-app-hands-on-3668985/) |
| Current UX pattern | A pill-shaped prompt box with a "+" menu. Structured, card-like answers. Expressive motion. |
| Best idea | Motion that shows the system is working. |
| Weakness | The motion and colour are loud, and the amount of animation is a design choice FuryPipe cannot afford on low-end GPUs. |
| Learn | Restrained motion: a pulse while connecting, a caret while streaming, the composer gliding from hero to dock (FLIP). All of it is transform/opacity only and stops under reduced motion. |
| Must not copy | The Google blue/multicolour palette. Heavy animated gradients. |

### Perplexity — Comet, Deep Research, Model Council

| Field | Value |
|---|---|
| Date checked | 2026-09-25 |
| Official source | [Perplexity changelog, 6 Feb 2026](https://www.perplexity.ai/changelog/what-we-shipped---february-6th-2026). Secondary: [datastudios](https://www.datastudios.org/post/perplexity-new-features-and-use-cases-in-march-2026) |
| Current UX pattern | Answers cite their sources inline. Research modes and a model council sit behind the "+" menu. |
| Best idea | Every claim can be traced to a source. |
| Weakness | Mode sprawl behind the "+". |
| Learn | Knowledge answers cite as [n] with the passage list in the activity row. Web reads show URL, bytes and receipt id. |
| Must not copy | Search-engine layout on the home screen. A fake "council" without real parallel models. |

### n8n / Dify — canvas builders

| Field | Value |
|---|---|
| Date checked | 2026-09-25 |
| Official source | [github.com/n8n-io/n8n](https://github.com/n8n-io/n8n), [github.com/langgenius/dify](https://github.com/langgenius/dify). Secondary: [n8n vs Dify comparison](https://www.ayautomate.com/blog/n8n-vs-dify) |
| Current UX pattern | Node canvases for automations and AI apps. |
| Best idea | The flow is visible as a graph. |
| Weakness | The canvas is the first thing you see, which is hostile to non-builders. |
| Learn | FuryFlow's canvas stays in Automations (Engineer mode), with deterministic and agentic zones drawn differently. |
| Must not copy | Canvas as the home screen. |

## What FuryPipe Studio takes

1. **Conversation first.** The home screen is one question, "How can FuryPipe help?", with the composer under it. Everything else is one click or one mode away.
2. **Model choice in the composer, with a reason.** Fury Auto routes on real local candidates. The route chip shows model · provider · Local, and "Why this route?" explains the choice (fit, task type, how many models were considered, privacy, cost).
3. **Progressive surfaces.** Simple shows Chat, Models and Settings. Power adds Cowork, Knowledge, Web, Memory, Skills and MCP. Engineer adds Code, Agents, Automations, Runtimes and Integrations. Expert adds Mission Control.
4. **Evidence near the message.** Web and knowledge activity rows carry receipts and citations. Errors come with Retry and "Use another model".
5. **A distinctive identity.** Layered black with a controlled orange scale, and no borrowed brand colours.

## The pasted 21st.dev components

- `claude-style-chat-input.tsx` (received as source; the 21st.dev page itself is egress-blocked). It is a React + Tailwind 4 + lucide-react component.
  - **Ported to vanilla FuryComposer** instead of copied: Studio is a zero-build, server-rendered page under a strict nonce CSP (no React, Tailwind or shadcn, no external scripts or fonts). Adding a bundler and three runtime dependencies would break the CSP model and grow the published npm package for one input box.
  - **Kept:**
    - autosize up to 384 px;
    - Enter to send, Shift+Enter for a new line;
    - attachment cards;
    - pasted-text cards over 300 characters;
    - drag-and-drop overlay;
    - popover model selector with check marks and descriptions;
    - send disabled while empty;
    - the disclaimer line.
  - **Removed as fake or foreign:**
    - hardcoded Claude model list;
    - simulated upload delay;
    - "Analyzed…" prefilled messages;
    - Claude logo and remote demo image;
    - a "Thinking" toggle with no real control behind it;
    - image attachments the local chat path cannot send.
- `ai-prompt-box.tsx`: named by the operator, but its source was not included in the paste and the page is egress-blocked. Not integrated.
