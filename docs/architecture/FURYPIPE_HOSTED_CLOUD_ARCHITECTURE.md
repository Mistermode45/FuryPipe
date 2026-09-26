# FuryPipe Hosted Cloud Architecture

**Status:** FUTURE / NOT IMPLEMENTED  
**Product track:** web-first FuryPipe access without requiring the user to start the local runtime manually for cloud-only workflows.

## Goal

Provide a direct FuryPipe website where a user can:

- create an account;
- sign in with Google through standards-based OIDC;
- optionally add email/passkey and enterprise SSO later;
- access Chat, Projects, Agents, Automations, Artifacts, Memory and account settings from any browser;
- use cloud models without installing FuryPipe locally;
- optionally pair a trusted local FuryPipe Bridge when the user wants local models, local files, local runtimes or private-device tools.

The hosted product must preserve the existing FuryPipe principles:

- no model/provider lock-in;
- no hidden credential scraping;
- explicit local/cloud boundaries;
- least privilege;
- evidence-first execution;
- user-controlled permissions;
- local-only mode remains possible.

## Product shape

```text
browser
  ↓
app.furypipe.example
  ↓
FuryPipe Cloud Control Plane
  ├─ identity / accounts
  ├─ projects / conversations
  ├─ cloud model fabric
  ├─ dispatcher / agents
  ├─ automations
  ├─ encrypted connector secrets
  └─ evidence / replay
            ↕ explicit pairing
FuryPipe Local Bridge
  ├─ Ollama / LM Studio / llama.cpp / vLLM / SGLang / Jan
  ├─ local files
  ├─ Claude Code / Codex / Gemini CLI / OpenCode / other harnesses
  ├─ local MCP
  └─ private hardware
```

## Identity

Use a provider-neutral identity layer with stable FuryPipe user IDs.

Initial login methods:

1. Google OIDC.
2. Email/passkey or email magic-link as a provider-independent fallback.
3. Optional GitHub login for developer workflows.
4. Enterprise OIDC/SAML later.

Do not bind FuryPipe's internal user identity to a Google email address as the primary key.

Store an immutable internal account ID and attach identities:

```text
user
  ├─ google identity
  ├─ email/passkey identity
  ├─ github identity
  └─ enterprise identity
```

Account-linking must require proof of ownership for both identities.

## Google sign-in

Use the official OpenID Connect authorization-code flow with PKCE where applicable.

Requirements:

- exact redirect URI allowlist;
- state + nonce validation;
- PKCE;
- server-side token validation;
- issuer / audience / expiry validation;
- no OAuth tokens in browser localStorage;
- HttpOnly + Secure + SameSite cookies for FuryPipe web sessions;
- short-lived web sessions with rotation;
- CSRF protection for state-changing requests;
- logout / session revocation;
- account-linking protection against email-only assumptions.

Google login authenticates the FuryPipe user. It does **not** automatically grant access to Gemini APIs or other Google services. Provider authorization remains a separate explicit connection.

## AI provider connections

The FuryPipe account and AI-provider accounts are separate concepts.

Examples:

```text
FuryPipe account
  ├─ Google login identity
  ├─ Anthropic provider connection
  ├─ OpenAI provider connection
  ├─ Google Gemini provider connection
  ├─ OpenRouter connection
  └─ local bridge
```

Provider credentials must be stored encrypted server-side or delegated through official OAuth flows when providers support them.

Never:

- copy browser cookies;
- scrape tokens from another application;
- silently import credentials;
- expose provider tokens to the browser after connection.

## Local Bridge

The hosted site cannot directly access arbitrary local processes, GPUs or files from a normal browser.

Use an optional local companion:

```text
FuryPipe Local Bridge
```

Pairing flow:

1. user signs in to FuryPipe web;
2. local Bridge displays a short-lived pairing code / QR;
3. user explicitly approves the device;
4. cloud issues a scoped device credential;
5. Bridge opens an outbound authenticated channel;
6. permissions are granted per capability.

No inbound router port or manual port-forwarding should be required.

Bridge capabilities are individually scoped:

- local model inference;
- file read;
- file write;
- shell;
- local MCP;
- harness invocation;
- browser/computer;
- hardware metrics.

A cloud task can never gain a stronger capability than the paired device policy allows.

## Device trust

Each paired machine has:

- device ID;
- public key;
- display name;
- OS;
- last-seen time;
- capability grants;
- revocation state.

Prefer device-bound asymmetric keys over reusable bearer secrets.

Users can revoke any device from the web account.

## Hosted / local UX

The same FuryPipe Studio UI should support three top-level execution locations:

- **Cloud**
- **Local**
- **Hybrid**

Fury Auto can choose among allowed locations, but the user's privacy policy wins.

Examples:

```text
Private mode
→ local bridge only
→ no cloud model fallback

Cloud mode
→ hosted providers allowed
→ local bridge optional

Hybrid
→ dispatcher may combine both within explicit policy
```

## Account onboarding

First web visit:

1. choose language automatically from browser preferences;
2. create/sign in to FuryPipe account;
3. ask whether the user wants Cloud only or Local + Cloud;
4. discover connected cloud providers;
5. optionally pair Local Bridge;
6. discover local runtimes/models after pairing;
7. show Fury Auto ready state.

Keep this short. Advanced configuration remains optional.

## Data model

Minimum entities:

- users;
- identities;
- web sessions;
- organizations/workspaces;
- memberships;
- projects;
- conversations;
- artifacts;
- provider connections;
- paired devices;
- device grants;
- automations;
- approvals;
- receipts;
- replay events.

Separate identity data from provider secrets and project content.

## Security requirements

Mandatory before production:

- hardened session management;
- PKCE / state / nonce;
- account-linking threat model;
- rate limiting;
- anti-CSRF;
- anti-session fixation;
- encrypted provider credentials;
- KMS/HSM-compatible envelope encryption;
- audit log;
- device revocation;
- device key rotation;
- secret redaction;
- tenant isolation;
- authorization tests;
- SSRF protection;
- webhook signature verification;
- secure passwordless flows;
- recovery codes or equivalent account recovery;
- abuse controls.

## Multi-tenant boundary

Hosted FuryPipe introduces a multi-tenant security boundary that does not exist in the current loopback Studio.

Never reuse loopback-only trust assumptions in hosted mode.

Every server-side object must be authorized against:

```text
user / organization / project / capability
```

before read or mutation.

## Deployment architecture

Keep the initial deployment modular:

- web frontend;
- API/control plane;
- async workers;
- durable task store;
- database;
- encrypted secret service;
- object/artifact storage;
- realtime channel;
- optional local Bridge relay.

Do not put every subsystem into a single stateful web process.

## Hosted URLs

Future shape, not reserved names:

```text
furypipe.example
app.furypipe.example
api.furypipe.example
```

The product should open directly to FuryPipe Studio after sign-in.

## Compatibility with desktop/local FuryPipe

Do not retire the local product.

Target modes:

```text
1. FuryPipe Web — cloud-first, no install required
2. FuryPipe Web + Local Bridge — universal local/cloud mode
3. FuryPipe Local — fully private/offline
4. Enterprise/self-hosted — future
```

All four should share the same high-level capability contracts.

## Product rule

The hosted version must never require a local FuryPipe process merely to:

- chat with a cloud model;
- manage cloud projects;
- run cloud agents;
- inspect cloud artifacts;
- manage account settings.

Local software is only required for capabilities that truly live on the user's machine.

## Current status

This document is architectural intent only.

Not yet implemented:

- hosted backend;
- production identity service;
- Google OIDC client;
- web session store;
- device pairing;
- cloud/local relay;
- multi-tenant storage.

These remain future work and must not be represented as available features in the current Studio.
