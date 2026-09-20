# FuryPipe VNext — Phase 4 Channels + Notifications

**Status:** implementation complete; final exact-head validation required after history cleanup  
**Stack base:** exact validated Phase 3 HEAD `523e94e225abf39efe3092042f86474383c19793`  
**Branch:** `vnext-phase4-channels-notifications`  
**Pull request:** #215 — OPEN + DRAFT; merge is not authorized

## 0. Implementation status

Implemented gates:

- **4.0 Architecture contract** — transport adapters remain outside agent/runtime authority.
- **4.1 Channel Adapter V1** — strict normalized inbound events, bounded attachment metadata and replay protection.
- **4.2 Principal binding + channel session** — process-local sender-to-principal evidence, bounded scopes and stale/revoked binding invalidation.
- **4.3 Governed outbound delivery** — one-shot permit, TTL, idempotency and sticky `outcome-unknown` after ambiguous post-invocation failure.
- **4.4 Notification plane** — destination policy, delivery lifecycle and acknowledgement remain separate from underlying task success.
- **4.5 Discord adapter contract** — trusted-host service authentication boundary, DM/guild/thread distinction, deterministic fixtures and governed outbound mapping.
- **4.6 Gateway/WebChat observability** — redacted aggregate `channels.status`, delivery/notification lifecycle snapshots and `browserAuthority: none`.

Pre-cleanup validation on implementation HEAD `4aa9ef3ad57838d79af2891f0c3020cf75e397bb`:

- 7/7 GitHub workflows: SUCCESS;
- 9/9 CI matrix jobs: SUCCESS;
- Secret Scan: SUCCESS;
- Benchmark Contract: SUCCESS;
- RC Preparation Evidence: SUCCESS;
- Dashboard Browser QA: SUCCESS;
- Web Studio Browser QA: SUCCESS;
- Cross-Browser QA: SUCCESS.

This evidence is **not** reused as final proof after history cleanup. The final squashed SHA must independently pass the same gates.

## 1. Goal

Implement the revised VNext Phase 4:

```text
Channels + notifications
```

Channels are transport adapters, not agents.

Notifications are a separate delivery plane, not chat messages and not task execution.

Phase 4 reuses the existing Fury Gateway principal/session/command/evidence boundaries. It must not create a second authentication model, second agent runtime, second session store, or second permission vocabulary.

## 2. Existing source of truth

Phase 4 builds on:

- `gateway-principal-node.ts` for authenticated principals and generation/revocation;
- `gateway-session-node.ts` for process-local session leases and scopes;
- `gateway-command-authorization-node.ts` for command admission;
- Gateway roles including `channel`;
- existing `channels.inspect` / `channels.manage` scopes;
- Gateway WebSocket/event infrastructure;
- Fury Kernel conversation/model/tool/memory governance;
- plugin permissions and capability scopes;
- existing WebChat as an independent local browser surface.

## 3. Non-negotiable lifecycle

```text
channel configured
!= transport authenticated
!= external sender identified
!= Fury principal mapped
!= channel session issued
!= command eligible
!= execution permitted
!= executed
!= succeeded
!= verified
```

Outbound lifecycle:

```text
delivery requested
!= delivery accepted by adapter
!= transport invoked
!= provider accepted
!= delivered
!= read
!= task succeeded
```

Notification lifecycle:

```text
notification created
!= destination selected
!= delivery attempted
!= delivered
!= acknowledged
!= underlying task succeeded
```

Additional invariants:

```text
channel service identity != message sender identity
group conversation != private conversation
reaction/event != instruction authority
attachment metadata != trusted attachment bytes
channel session != local-owner session
channel delivery receipt != verified task evidence
notification delivery != task execution status
```

All normalized channel/event/notification receipts remain:

```text
executionAuthority = false
```

## 4. Channel adapter boundary

A channel adapter normalizes transport-specific input/output.

It may know how to translate:

- authenticated channel account;
- sender identity;
- conversation/thread;
- message/event ID;
- text;
- attachment metadata;
- reactions/events;
- reply/thread relation;
- transport delivery result.

It does **not**:

- run the Fury Kernel directly;
- create provider/tool permits;
- grant Gateway scopes;
- trust a raw sender ID as a Fury principal;
- silently reuse local-owner authority;
- persist secrets in normalized messages;
- turn reactions/events into commands by itself.

## 5. Channel service identity vs external sender

These are separate principals.

### Channel service

The channel transport itself is authenticated by a host-owned connector/adapter.

Examples:

- Discord bot/application credential;
- Telegram bot credential;
- Slack app credential.

Credential values stay outside normalized records.

### External sender

The incoming external sender is untrusted identity metadata until a trusted host mapping binds:

```text
channel account
+ external sender
+ conversation/group context
→ Fury principal mapping decision
```

A channel adapter cannot mint a Fury principal by itself.

## 6. Channel principal binding evidence

Phase 4 introduces a process-local Channel Principal Binding receipt.

Required fields should include only bounded/redacted identity:

- channel kind;
- channel account digest;
- external sender digest;
- conversation/group digest;
- mapped Fury principal evidence;
- policy profile ID;
- issued/expiry timestamps.

Raw external display names, tokens and credentials are not authority.

The binding receipt is process-local and one of the requirements for issuing a `role: channel` Gateway session.

## 7. Gateway session extension

Current Gateway session bindings support:

- `local-operator`;
- `paired-device`.

Phase 4 adds:

- `channel`.

A channel session requires:

1. current process-local authenticated Fury principal evidence;
2. current process-local Channel Principal Binding evidence;
3. role exactly `channel`;
4. principal/channel binding identity match;
5. bounded channel-specific scopes;
6. non-expired mapping/policy evidence.

Channel sessions must never inherit local-owner scopes automatically.

## 8. Channel-specific policy

Channel policy may depend on:

- channel kind;
- channel account;
- sender;
- direct/group conversation;
- workspace/server;
- thread;
- current authenticated mapping;
- requested capability.

Initial policy should be deny-by-default and scope allowlisting.

Examples:

- a private owner-mapped Discord DM may receive a bounded chat/model scope set;
- a Discord guild channel may be read/chat-only;
- a public/group thread must not receive local process/repository-write/provider-management authority merely because the account owner is present.

## 9. Inbound normalized message

Initial normalized message contract:

```text
format
channel kind
channel account digest
message/event ID
external sender digest
conversation digest
thread digest? 
message type
text?
attachment descriptors[]
reply/reaction metadata?
observedAt
authority = transport-data-only
executionAuthority = false
```

Raw channel tokens are forbidden.

Text is user/channel data, not system/developer instruction authority.

## 10. Attachments

Phase 4 normalizes attachment **descriptors**, not arbitrary attachment bytes.

Descriptor may include:

- stable transport attachment ID digest;
- declared MIME type;
- declared byte size;
- filename digest or bounded display name;
- remote reference classification.

Downloading/opening attachment content is a separate governed network/browser/file capability.

```text
attachment announced != attachment fetched != attachment trusted
```

## 11. Inbound routing

Required sequence:

```text
transport authentication
→ normalize message
→ map/bind external sender to Fury principal
→ issue/revalidate channel session
→ select channel policy/scopes
→ route message to existing Fury Kernel conversation path
→ normal command/model/tool governance
```

No channel adapter bypasses Gateway command admission or the Fury Kernel.

## 12. Outbound delivery

Outbound delivery is separately governed.

A delivery request must bind:

- exact channel kind/account;
- exact destination/thread;
- bounded payload;
- optional reply relation;
- exact process-local delivery permit;
- TTL;
- idempotency key.

The delivery permit is consumed before the transport callback.

No automatic retry after ambiguous post-invocation failure.

## 13. Delivery receipts

Receipt states should distinguish:

```text
not-started
accepted-for-delivery
transport-invoked
provider-rejected
delivered
outcome-unknown
```

Where supported, later adapter evidence may add:

- provider message ID digest;
- delivered/read timestamps;
- reaction/acknowledgement evidence.

Do not claim delivered/read without transport/provider evidence.

## 14. Idempotency and replay

Every inbound/outbound channel event needs bounded replay protection.

Inbound:

- canonical event/message identity;
- recent replay window;
- duplicate events ignored/reported;
- sequence when transport supports it.

Outbound:

- stable idempotency key;
- process-local permit consumed once;
- terminal result cached for bounded replay lookup;
- unknown outcome must not trigger blind resend.

## 15. Notification plane

Notifications are separate from conversation/chat.

Notification record examples:

- task completed;
- approval requested;
- automation failed;
- CI failed;
- server offline;
- agent blocked;
- security warning.

A notification contains structured data such as:

- kind/severity;
- title;
- bounded summary;
- source receipt/evidence digest;
- creation time;
- destination policy key;
- acknowledgement requirement.

It does not contain execution authority.

## 16. Notification routing

```text
notification event
→ notification policy
→ destination selection
→ channel/desktop adapter
→ delivery permit
→ delivery receipt
```

The notification router may select a destination but cannot execute a side effect without the destination adapter's governed delivery path.

## 17. First supported channel strategy

Start small.

Phase 4 core should first prove:

1. generic Channel Adapter V1 contract;
2. in-memory deterministic test adapter;
3. Discord adapter normalization/delivery contract;
4. notification routing through the same delivery governance.

Telegram/Slack/Teams/etc. should not be added until the contract is proven.

Actual external credentials/network calls remain host-owned and opt-in.

## 18. Secrets

Adapter configuration may reference host environment variables or connector-owned secret handles.

Normalized channel records must never expose:

- bot tokens;
- app secrets;
- signing secrets;
- Authorization headers;
- cookies;
- raw webhook secrets.

Errors and receipts must also avoid secret names/values where practical.

## 19. Observability

Safe observability may expose:

- channel kind;
- account digest;
- active/healthy/unknown status;
- inbound/outbound counters;
- replay rejects;
- delivery states;
- latency where measured;
- notification counts;
- redacted error codes.

It must not expose:

- message bodies by default;
- sender raw IDs by default;
- credentials;
- attachment bytes;
- execution permits.

## 20. Gate sequence

### Gate 4.0 — architecture
- lifecycle distinctions;
- channel service vs sender identity;
- session binding;
- inbound/outbound/notification contracts;
- replay/idempotency semantics.

### Gate 4.1 — typed Channel Adapter V1
- bounded data-only normalized inbound events;
- bounded outbound requests/results;
- process-local adapter registry;
- no network/execution by normalization.

### Gate 4.2 — channel principal binding + Gateway session
- process-local channel principal binding;
- `channel` session binding;
- explicit bounded scopes;
- revocation/staleness;
- group/private policy distinction.

### Gate 4.3 — governed outbound delivery
- exact one-shot delivery permit;
- TTL;
- idempotency;
- unknown outcome semantics;
- bounded terminal receipt.

### Gate 4.4 — notification plane
- typed notification records;
- destination policy;
- channel delivery integration;
- acknowledgement/delivery separate from task status.

### Gate 4.5 — Discord adapter contract
- strict inbound normalization;
- signature/service authentication boundary documented;
- DM/guild/thread distinctions;
- outbound delivery mapping;
- no raw token exposure;
- deterministic test fixtures.

### Gate 4.6 — Gateway/WebChat observability
- channel status;
- delivery/notification lifecycle;
- no message/credential leakage;
- browser UI remains non-authoritative.

## 21. Required tests

Before Phase 4 passes:

- unknown fields/accessors/custom prototypes/symbols/sparse arrays fail closed;
- malformed message/event IDs rejected;
- raw external sender cannot mint Fury principal/session;
- forged channel binding rejected;
- expired/revoked binding cannot issue/keep session;
- channel session cannot use local-owner binding;
- group policy has strictly bounded scopes;
- attachment descriptor never fetches content;
- duplicate inbound event detected;
- outbound permit is one-shot;
- outbound ambiguous post-call failure is `outcome-unknown` and not retried automatically;
- idempotency replay does not duplicate delivery;
- delivery receipt never claims task success;
- notification delivered does not imply source task success;
- channel adapter result remains `executionAuthority:false`;
- no bot token/secret in normalized records, logs or receipts;
- package smoke remains green;
- Secret Scan/Benchmark/RC Evidence remain green;
- 9/9 CI matrix remains green.

## 22. Completion invariant

Phase 4 is complete only when FuryPipe can prove:

```text
channel configured != authenticated
authenticated transport != authenticated sender
sender identified != Fury principal mapped
principal mapped != channel session issued
channel session != command authority
delivery attempted != delivered
delivered != task succeeded
notification delivered != task succeeded
```
