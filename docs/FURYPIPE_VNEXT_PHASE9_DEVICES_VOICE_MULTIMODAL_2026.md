# FuryPipe VNext — Phase 9 Devices + Voice/Multimodal (2026)

> Status: Gate 9.0 architecture + threat model — VALIDATED at implementation HEAD.
>
> Stack base: validated Phase 8 exact HEAD `46f7ded2edc1b399dcd65d53cc4490be8c1ac5bd`.
>
> Date: 2026-09-21.
>
> This track does not authorize merge, release, tag, npm publish or deploy.

## 1. Goal

Phase 9 extends FuryPipe VNext from a primarily host-local Agent OS into a
governed multi-device and multimodal runtime.

The roadmap target is explicit:

- paired local/remote device nodes;
- plugin-based speech-to-text;
- plugin-based text-to-speech;
- realtime voice;
- image/document/audio/video inputs;
- camera and microphone device inputs;
- media generation where a selected plugin/provider supports it.

Phase 9 must reuse the existing Fury Gateway, device authentication, pairing,
Capability Autopilot, plugin bundle, policy, evidence and recovery contracts.

It must not create a second trust system, a second permission system, or an
ambient remote-control channel.

The primary invariant is:

```text
available != authorized
```

A device, plugin, model or transport being present never implies permission to
use it.

## 2. Existing foundations that Phase 9 must reuse

Phase 9 begins from the validated Phase 8 HEAD and the already-implemented
FuryPipe foundations below.

### 2.1 Gateway device authentication

`src/gateway-auth-node.ts` already provides:

- Ed25519 device identity;
- challenge/response proof;
- challenge TTL;
- consumed-challenge replay protection;
- connect-envelope binding;
- public-key-derived device identity;
- process-local authenticated-device evidence;
- `authority:'authenticated-device'`;
- `pairing:'unpaired'`;
- `authorization:'none'`.

A serialized or copied lookalike is not equivalent to live process-local
authentication evidence.

Phase 9 must not replace this contract.

### 2.2 Gateway pairing

`src/gateway-pairing-node.ts` already provides:

- bounded pending pairing requests;
- request TTL;
- fresh-authentication requirement;
- explicit operator/principal approval;
- pinned device identity;
- paired registry bounds;
- rejection;
- revocation;
- mismatch detection;
- `authorization:'none'` even after pairing.

Pairing therefore means identity continuity and operator acceptance only.

```text
authenticated != paired
paired != connected
connected != capability advertised
capability advertised != approved
approved != authorized
authorized != executed
executed != succeeded
succeeded != verified
```

### 2.3 Capability Autopilot and activation lifecycle

Phase 9 must preserve the existing capability lifecycle:

```text
discovered
-> registered
-> connected
-> approved
-> ready for policy authorization
-> authorized by governed runtime
-> executed
-> verified
```

The existing activation contract intentionally returns
`executionAuthorized:false`. Phase 9 device/media discovery must not weaken
that property.

### 2.4 Plugin bundles

`src/plugin-bundles.ts` already requires:

- pinned bundle identity/version;
- source provenance;
- permission declarations;
- optional environment-variable names without secret values;
- health checks;
- explicit opt-in;
- no automatic CLI installation.

Phase 9 media/voice support must extend or adapt this plugin surface rather than
hardcode provider credentials or SDK authority into the Gateway.

### 2.5 Fury Link

Fury Link is an existing network routing/proxy subsystem. It is not a generic
device pairing or media-control authority.

Phase 9 must not infer device authorization from Fury Link connectivity.

## 3. Non-negotiable lifecycle truth

### 3.1 Node lifecycle

```text
device key exists
!= device authenticated
!= pairing requested
!= pairing approved
!= node registered
!= node connected
!= node live
!= capability advertised
!= capability current
!= capability selected
!= capability approved
!= operation authorized
!= side effect attempted
!= side effect outcome known
!= result verified
```

Reconnect does not restore stale authority.

Restart does not recreate a consumed permit.

A pairing record does not prove current liveness.

A liveness record does not prove that a previously advertised capability still
exists.

### 3.2 Media lifecycle

```text
media capability advertised
!= source accessible
!= user consent granted
!= capture started
!= bytes observed
!= bytes accepted
!= media decoded
!= content trusted
!= inference authorized
!= inference executed
!= transcript/result correct
!= transcript/result verified
```

### 3.3 Voice lifecycle

```text
microphone available
!= microphone authorized
!= microphone recording
!= audio transported
!= speech recognized
!= transcript trusted
!= agent instruction admitted
!= action authorized
```

Likewise:

```text
TTS available
!= audio generation authorized
!= playback authorized
!= remote speaker authorized
```

No voice or media event bypasses normal FuryPipe policy.

## 4. Trust boundaries

### 4.1 Paired node

A paired node is an authenticated external execution peer.

It may be:

- the same physical host;
- another workstation;
- a server;
- an iPhone/iPad;
- an Android device;
- a headless worker;
- a Minecraft host;
- a specialist media machine.

Its advertised state is evidence from that node, not authoritative truth.

A compromised paired node must not be able to mint Gateway authority for
another node, principal, session or capability.

### 4.2 Gateway

The Gateway owns:

- device-authentication verification;
- pairing state;
- active node-session binding;
- capability-advertisement acceptance;
- policy revalidation;
- permit issuance;
- evidence emission;
- revocation handling.

The Gateway does not treat transport connectivity as trust.

### 4.3 Plugin/provider

A media or voice plugin/provider is an external capability source.

It may transform:

- audio -> text;
- text -> audio;
- image/document/audio/video -> model/provider input;
- prompt/context -> generated media.

Plugin output remains untrusted data until validated for the consuming
boundary.

### 4.4 Media source

Camera frames, microphone audio, files, documents and remote media are
untrusted content.

They may contain:

- prompt injection;
- adversarial metadata;
- deceptive text;
- malformed codecs;
- oversized payloads;
- hidden instructions;
- sensitive personal information;
- secrets visible or audible in the environment.

Media content is never policy.

## 5. Node identity contract

Phase 9 node identity must continue to derive from the existing device
authentication/pairing evidence.

A future node descriptor must bind at minimum:

- Fury Gateway device ID;
- pinned public-key digest;
- role;
- client ID;
- platform/device family when supplied;
- pairing ID;
- active connection/session identity;
- descriptor version;
- advertisement generation;
- observed timestamp.

Raw private keys must never enter node descriptors, evidence records, logs or
plugin requests.

Node identity aliases and human-readable names are display metadata only.

## 6. Capability advertisement contract

A node may advertise capabilities such as:

```text
filesystem.read
filesystem.write
shell
browser
gpu
camera
microphone
speaker
notifications
media.image.input
media.audio.input
media.video.input
media.document.input
voice.stt
voice.tts
voice.realtime
```

This is an extensible vocabulary, not an authority list.

Each advertisement must be:

- bound to the live authenticated/paired node;
- generation/versioned;
- bounded in count and serialized bytes;
- exact-schema validated;
- duplicate-free;
- expiry/liveness aware;
- digestible into evidence;
- replaceable atomically by a newer generation.

An advertisement must expose:

```text
authority: advertisement-only
executionAuthority: false
```

The Gateway must not infer a permission merely because a capability is
advertised.

## 7. Node session and reconnect semantics

Phase 9 must distinguish durable pairing from ephemeral connectivity.

Durable:

- pinned device identity;
- pairing approval evidence;
- revocation state/evidence.

Ephemeral:

- active connection;
- current liveness;
- current capability advertisement;
- current operation permits;
- live capture/playback session;
- process-local anti-forgery evidence.

On disconnect:

- active node session becomes unavailable;
- outstanding operations enter their defined terminal/unknown state;
- capability advertisement is no longer current;
- no new operation can start through that connection.

On reconnect:

- device identity and pairing are revalidated;
- capabilities are re-advertised;
- old process-local permits are not restored;
- old capture/playback authority is not restored;
- unknown prior side effects remain unknown.

## 8. Governed node-operation permits

No node command, capture, playback, notification, filesystem access or shell
operation may execute merely because a node is paired.

A future node-operation permit must be:

- process-local;
- short-lived;
- one-shot unless the operation contract explicitly defines bounded streaming;
- principal-bound;
- Gateway-session-bound;
- node-session-bound;
- device-ID-bound;
- pairing-ID-bound;
- capability-bound;
- exact-operation-bound;
- budget-bound;
- current-policy-bound.

Consumption must revalidate:

- current Gateway/session authority;
- current node connection;
- current pairing;
- current advertisement generation;
- exact normalized operation;
- expiry;
- applicable plugin/device permission state.

Copied/serialized permits fail closed.

## 9. Streaming authority

Realtime audio/video differs from one-shot operations.

A stream must not be represented as a timeless permit.

A future streaming lease must have:

- explicit start;
- explicit scope;
- monotonic bounded lifetime;
- byte/time/frame budgets;
- cancellation/revocation path;
- node/session/principal binding;
- media-direction binding;
- source/sink binding;
- no automatic resurrection after reconnect.

Examples:

```text
microphone capture lease
camera capture lease
speaker playback lease
realtime voice transport lease
```

A lease expiring or being revoked must prevent new frames from being accepted.
Already-transmitted remote side effects are not assumed rolled back.

## 10. Plugin-based media contract

Voice/media support should be expressed as plugin/provider capabilities.

Conceptual profile families:

- STT provider;
- TTS provider;
- realtime voice provider;
- vision/multimodal model adapter;
- image generation;
- audio generation;
- video generation;
- local device media adapter.

Every profile requires:

- stable profile ID;
- plugin bundle identity/version;
- capability family;
- declared permissions;
- supported media types;
- bounded input/output contract;
- health evidence;
- source/provenance;
- compatibility metadata;
- secret references by name only;
- explicit lifecycle state.

A profile being healthy and selected is not an execution permit.

## 11. Plugin permission extensions

Phase 9 will need media/device-specific permissions rather than overloading
generic `network` or `process` permissions.

Architecture target:

```text
device-discovery
device-notify
device-camera
device-microphone
device-speaker
media-read
media-write
voice-stt
voice-tts
voice-realtime
```

Exact permission names may be finalized by their implementation gate.

Requirements:

- least privilege;
- no implicit permission expansion;
- plugin-level declaration;
- profile-level subset validation;
- compatibility with current Capability Autopilot lifecycle;
- current-policy revalidation before use.

## 12. Speech-to-text

STT converts audio into candidate text.

STT output is not automatically a trusted user instruction.

A transcript should preserve evidence such as:

- source node/session digest;
- source stream/capture receipt;
- provider/profile identity;
- media digest;
- bounded timestamps;
- language when provided;
- model/provider observation when available;
- confidence/segment metadata only when supported by the provider;
- redaction state.

If a transcript is used as an agent prompt, normal prompt admission and content
boundaries still apply.

## 13. Text-to-speech

TTS converts admitted text into audio.

TTS must distinguish:

```text
text admitted
!= synthesis authorized
!= audio synthesized
!= speaker playback authorized
!= playback completed
```

Generation and playback are separate operations.

A cloud TTS provider must not implicitly gain permission to address a remote
device speaker.

## 14. Realtime voice

Realtime voice is a composition of governed capabilities, not a privileged
mode.

Potential pipeline:

```text
microphone capture
-> bounded audio transport
-> STT/realtime provider
-> Fury Kernel/Gateway prompt admission
-> governed agent work
-> admitted response text/audio
-> TTS/realtime output
-> separately authorized speaker playback
```

The architecture must support interruption/cancellation without claiming that a
remote provider or speaker rolled back already-received audio.

Provider session IDs are transport metadata, not FuryPipe authority.

## 15. Image/document/audio/video inputs

Multimodal ingestion must preserve the existing content/evidence boundary.

For every media item FuryPipe must know:

- media kind;
- MIME/content type;
- byte size;
- digest;
- provenance/source;
- whether bytes are local, remote or generated;
- whether content was transformed;
- transformation evidence;
- whether the selected model/provider accepts the representation.

Hard requirements:

- bounded bytes;
- bounded item count;
- bounded dimensions/duration where applicable;
- canonical or explicitly supported MIME set;
- no trust from file extension alone;
- no arbitrary metadata promoted into instructions;
- no automatic remote fetching from untrusted embedded references;
- no secret-bearing raw media in generic logs.

## 16. Visual Engine relationship

Phase 9 does not replace the Visual Engine.

The Visual Engine remains responsible for representation planning when text,
structured context or other inputs may be more efficient/useful as images.

Phase 9 adds governed media sources/sinks and provider surfaces.

Representation choice does not imply provider authorization.

## 17. Consent and user-presence model

Camera, microphone, speaker, location-like sensors and other privacy-sensitive
device capabilities require explicit product semantics.

Architecture rule:

- pairing approval is not capture consent;
- plugin approval is not capture consent;
- capability selection is not capture consent;
- a previous capture does not imply future capture consent.

A later implementation gate must define whether a given operation requires:

- one-shot approval;
- bounded session approval;
- explicit current user-presence evidence;
- local-device confirmation.

Phase 9 must fail closed when required consent evidence is absent.

## 18. Privacy and redaction

Evidence should prefer digests and bounded metadata over raw media.

Do not persist raw microphone, camera or voice content merely to prove an
operation happened.

Where durable recovery evidence is needed, prefer:

- media digest;
- byte count;
- duration/frame count;
- provider/profile digest;
- source node/session digest;
- outcome state;
- verification references.

Raw media retention requires an explicit storage product contract outside the
default evidence path.

Credentials must never be embedded in transcripts, descriptors, receipts or
logs.

## 19. Outcome semantics

Remote/device operations must use explicit outcomes.

At minimum:

```text
not-started
rejected
cancelled-before-dispatch
dispatched
succeeded
failed
unknown
```

For side-effecting operations, loss of transport after dispatch must not become
automatic success or automatic safe retry.

Examples:

- notification may have been displayed;
- speaker may have played audio;
- camera/microphone capture may have started;
- remote file write may have happened;
- provider synthesis request may have completed.

`unknown` remains `unknown` until independent evidence resolves it.

## 20. Replay and retry semantics

Default:

```text
automaticReplayAllowed: false
```

Retry is allowed only when the exact operation contract proves idempotence or a
new explicit permit authorizes another attempt.

Reconnect never means replay.

Provider reconnect never means replay.

Node reconnect never means replay.

## 21. Resource and budget governance

Device/media operations require code-level bounds.

Potential resources:

- max concurrent node sessions;
- max capabilities per node;
- max advertisement bytes;
- max active streaming leases;
- max stream duration;
- max audio bytes;
- max image bytes/pixels;
- max video bytes/duration/frames;
- max document bytes/pages;
- max provider requests;
- max estimated cost;
- max output bytes;
- max retained evidence records.

Bounds are runtime constraints, not prompt suggestions.

## 22. Capability Autopilot integration

Phase 9 capabilities should become discoverable through the existing
out-of-context capability index.

The index may know that a node/plugin can provide:

- camera;
- microphone;
- STT;
- TTS;
- image input;
- video input;
- media generation.

Selection remains projection/recommendation only.

Before exposure or use:

- registration is revalidated;
- connectivity is revalidated;
- health is revalidated;
- approval is revalidated;
- current permissions are revalidated;
- policy authorization is still required.

Capability Autopilot must select the minimum useful media/device surface.

## 23. Dashboard / user-facing evidence

The existing VNext product target includes a Devices surface.

Phase 9 should make it possible to inspect, without exposing secrets:

- paired devices;
- current connection state;
- advertised capabilities;
- last observed generation;
- revocation state;
- active bounded media/voice sessions;
- plugin/provider used;
- receipts and evidence;
- explicit unknown outcomes.

Dashboard display data is observation only.

It must not become a hidden admin bypass.

## 24. Persistence boundaries

Pairing may be durable.

Execution authority must not be durable by default.

Persistable:

- pairing identity/provenance;
- revocation facts;
- digest-only capability observations;
- operation receipts;
- unknown-outcome evidence;
- bounded provider/media metadata.

Process-local / ephemeral:

- private keys;
- live authenticated-device proof objects;
- active node connections;
- operation permits;
- streaming leases;
- raw bearer credentials;
- current capture handles;
- current playback handles.

Restart must not resurrect process-local authority.

## 25. Failure and restart model

After Gateway restart:

- durable pairing may be rediscovered/reloaded if its storage contract supports
  it;
- every device must authenticate again;
- every node must establish a new connection;
- capabilities must be re-advertised;
- active media sessions are not silently restored;
- operation permits are not restored;
- streaming leases are not restored;
- unresolved dispatched side effects remain unknown.

After node restart:

- device key continuity may preserve device identity;
- connection/session identity changes;
- capabilities must be re-advertised;
- stale advertisements/leases/permits fail closed.

## 26. Threat model

Phase 9 must defend against at least:

### Identity and pairing

- forged device proof;
- replayed authentication challenge;
- copied authenticated-device evidence;
- stale pairing request;
- pairing approval race;
- device-ID/public-key mismatch;
- pairing metadata mismatch;
- revoked device reconnect;
- paired-device impersonation.

### Capability advertisements

- fake capability;
- capability downgrade/upgrade race;
- stale generation replay;
- duplicate capabilities;
- oversized advertisements;
- unknown capability names abusing parser behavior;
- copied descriptor forging current liveness.

### Operations

- permit reuse;
- permit copied across node/session/principal;
- operation digest mismatch;
- stale advertisement use;
- policy revoked between approval and dispatch;
- disconnect before dispatch;
- disconnect after possible side effect;
- blind replay after timeout.

### Voice/media

- hidden prompt injection in image/document/audio/video;
- malformed media;
- codec/container bombs;
- decompression/resource exhaustion;
- oversized duration/resolution;
- microphone/camera use without current consent;
- speaker playback without authorization;
- transcript promoted directly to authority;
- provider claims treated as verified facts;
- secret leakage through raw media/logging;
- embedded remote-resource fetches;
- malicious metadata;
- synthetic/deceptive media.

### Plugins/providers

- unpinned or replaced plugin source;
- permission escalation;
- capability overclaim;
- unhealthy provider selected as ready;
- provider credential leakage;
- provider response lost after possible side effect;
- plugin lifecycle state confused with policy authority.

## 27. Adversarial test requirements

Later implementation gates must cover:

- forged/copy-authenticated device;
- pairing expiry/replay/revocation;
- copied pairing evidence;
- capability advertisement replacement and stale generation;
- node reconnect without authority restoration;
- copied/expired/wrong-node operation permit;
- policy change immediately before dispatch;
- disconnect before vs after dispatch;
- one-shot permit consumption;
- streaming lease expiry/revocation;
- microphone/camera consent absence;
- TTS generation without speaker authority;
- bounded media bytes/count/duration/dimensions;
- MIME mismatch;
- malicious metadata;
- prompt injection remains content;
- transcript remains untrusted input;
- plugin permission subset failures;
- provider output-size/time bounds;
- evidence contains digests rather than raw secrets/media;
- restart leaves active authority dead;
- unknown outcomes do not become safe retries.

## 28. Phase 9 gate plan

### Gate 9.0 — architecture + threat model — VALIDATED

Exact validated implementation HEAD:

`f7e2bf872882279bba22963d51d3cd0fd58c2440`

Evidence:

- 7/7 workflows SUCCESS;
- 9/9 CI matrix SUCCESS across Ubuntu/macOS/Windows and Node 22/24/26;
- 265 test files / 3,000 tests SUCCESS on observed Ubuntu/Node 26;
- package smoke SUCCESS;
- Phase 6, Phase 7 and Phase 8 package smokes remain SUCCESS;
- only `docs/FURYPIPE_VNEXT_PHASE9_DEVICES_VOICE_MULTIMODAL_2026.md`
  changed against validated Phase 8;
- no Phase 9 runtime dependency was introduced;
- no device/media execution path was introduced;
- PR #222 remained OPEN + DRAFT;
- no merge, release, tag, npm publish or deploy occurred.

Gate 9.0 freezes the Phase 9 architecture and threat model. The
documentation-only closure commit itself must receive the same exact-head 7/7
workflow and 9/9 CI proof before Gate 9.1 begins.

### Gate 9.1 — node registry + capability advertisements — VALIDATED

Implementation surface:

- `src/gateway-pairing-node.ts` now marks genuine pairing coordinators with
  process-local anti-forgery evidence so copied/lookalike coordinators cannot
  feed Phase 9 registry state;
- `src/gateway-node-registry-node.ts` adds the bounded Phase 9 node registry;
- `tests/fury-gateway-node-registry.test.ts` adds dedicated adversarial
  registry/advertisement coverage.

Contract:

- only fresh process-local authenticated-device evidence with Gateway role
  `node` may register;
- registration reuses the existing pairing coordinator and requires a currently
  paired identity;
- the registry itself, node descriptors and capability advertisements are
  process-local generated evidence;
- copied descriptors and copied coordinators fail closed;
- node descriptors bind device ID, public-key digest, client/instance identity
  and pairing ID;
- descriptors remain
  `authority:'registry-evidence-only'` and `executionAuthority:false`;
- advertisements use an exact input schema and monotonic generation;
- capability names are canonical, duplicate-free and bounded by item/byte
  limits;
- advertisements are atomically replaced only by a newer generation;
- each advertisement carries a SHA-256 capability digest,
  `authority:'advertisement-only'`, `executionAuthority:false` and
  `automaticReplayAllowed:false`;
- pairing is revalidated before every new advertisement, so explicit revocation
  blocks newer capability evidence;
- registry snapshots expose bounded observation metadata and capability digests,
  not pairing principals or execution authority;
- explicit unregister invalidates the descriptor for that registry;
- no node command, filesystem, shell, camera, microphone, speaker, notification
  or media execution path exists in Gate 9.1.

Exact validated Gate 9.1 implementation HEAD:

`f096425df693d996a8e67a8670a81941dd7f138d`

Evidence:

- 7/7 workflows SUCCESS;
- 9/9 CI matrix SUCCESS across Ubuntu/macOS/Windows and Node 22/24/26;
- 266 test files / 3,011 tests SUCCESS on observed macOS/Node 26;
- 11 dedicated Phase 9 node-registry tests SUCCESS;
- strict TypeScript typecheck SUCCESS;
- build SUCCESS;
- package smoke SUCCESS, with Phase 6/7/8 packed-artifact smokes remaining
  green;
- Secret Scan and Benchmark Contract SUCCESS;
- RC Preparation Evidence, Dashboard Browser QA, Web Studio Browser QA and
  Cross-Browser QA SUCCESS;
- no public Phase 9 runtime export or new dependency was introduced;
- no node/device command execution path was introduced;
- no merge, release, tag, npm publish or deploy occurred.

The documentation-only Gate 9.1 closure commit itself requires the same
exact-head 7/7 workflow and 9/9 CI proof before Gate 9.2 begins.

### Gate 9.2 — node session/liveness + reconnect governance — VALIDATED

Implementation surface:

- `src/gateway-node-session-node.ts` adds the bounded process-local Phase 9
  node-session/liveness coordinator;
- `tests/fury-gateway-node-session.test.ts` adds dedicated adversarial
  session, heartbeat, reconnect and restart coverage.

Contract:

- the coordinator requires a genuine process-local node registry and pairing
  coordinator; copied/lookalike coordinators fail closed;
- opening a live session requires a current process-local node descriptor,
  fresh process-local authenticated-device evidence and the exact current
  pairing identity;
- each session binds registration ID, device ID, public-key digest, pairing ID,
  client/instance identity, a fresh session ID and a fresh liveness epoch;
- session evidence remains
  `authority:'node-session-evidence-only'`, `authorization:'none'`,
  `executionAuthority:false` and `automaticReplayAllowed:false`;
- heartbeats use an exact plain-data schema bound to the session ID and
  liveness epoch, with bounded monotonically increasing sequence numbers;
- heartbeat TTL expiry makes the session terminal for liveness; an old timed
  out session cannot be revived by a later heartbeat;
- explicit close disconnects without claiming rollback, replay safety or
  restored authority;
- reconnect creates a new session ID and liveness epoch and supersedes the
  previous live session; the superseded session cannot heartbeat again;
- same device key and same durable pairing do not imply the same live session
  or restore ephemeral authority;
- pairing revocation/change and node unregister invalidate future liveness use;
- a fresh coordinator after Gateway restart does not recognize old
  process-local session evidence;
- capability advertisements that existed before a reconnect are not promoted
  to current-for-session evidence; a strictly newer advertisement generation
  is required after the new session baseline;
- observations/snapshots expose bounded identity, liveness and capability
  digest metadata only, never raw capability arrays or execution authority;
- no shell, filesystem command, camera, microphone, speaker, notification,
  media execution or other node-operation authority is introduced by Gate
  9.2.

Exact validated Gate 9.2 implementation HEAD:

`d870d66e7f46e9f3be4b95a3b8482dd644219724`

Evidence:

- 7/7 workflows SUCCESS;
- 9/9 CI matrix SUCCESS across Ubuntu/macOS/Windows and Node 22/24/26;
- 267 test files / 3,031 tests SUCCESS on observed Ubuntu/Node 26;
- 20 dedicated Phase 9 node-session/liveness tests SUCCESS;
- strict TypeScript typecheck SUCCESS;
- build SUCCESS;
- package smoke SUCCESS, with Phase 6/7/8 packed-artifact smokes remaining
  green;
- Secret Scan and Benchmark Contract SUCCESS;
- RC Preparation Evidence, Dashboard Browser QA, Web Studio Browser QA and
  Cross-Browser QA SUCCESS;
- no public Phase 9 runtime export or new dependency was introduced;
- no node/device command or media execution path was introduced;
- no merge, release, tag, npm publish or deploy occurred.

The documentation-only Gate 9.2 closure commit itself requires the same
exact-head 7/7 workflow and 9/9 CI proof before Gate 9.3 begins.

### Gate 9.3 — governed node-operation permits — VALIDATED

Implementation surface:

- `src/gateway-node-operation-node.ts` adds process-local, short-lived,
  one-shot node-operation permits and dispatch-boundary consumption evidence;
- `tests/fury-gateway-node-operation.test.ts` adds dedicated adversarial
  permit, reconnect, expiry, policy and anti-replay coverage.

Contract:

- issue requires current Gateway operator admission with `nodes.manage`,
  a genuine live Phase 9 node session and the exact current capability
  advertisement;
- permits are bound to the exact normalized operation digest, principal,
  Gateway session, node session/liveness epoch, registration, device, pairing,
  capability generation and capability digest;
- permits are process-local, copied permits fail closed, expire within a
  bounded TTL and are consumed exactly once;
- Gateway/session policy, node liveness and current advertisement generation
  are revalidated immediately before dispatch-boundary consumption;
- reconnect, session close, capability re-advertisement, Gateway-session
  revocation and coordinator restart invalidate old authority;
- the consume receipt records only `consumed-for-dispatch`; it never claims
  that a remote side effect succeeded;
- side-effecting operations explicitly require reconciliation when a later
  dispatch outcome is unknown;
- `retrySafe:false` and `automaticReplayAllowed:false` prevent blind retry
  or replay after a possible side effect;
- Gate 9.3 introduces no shell, filesystem, camera, microphone, speaker,
  notification or other node transport/executor.

Exact validated Gate 9.3 implementation HEAD:

`008c1802fe877e70a8c4714abb9730e73fbc301e`

Evidence:

- 7/7 workflows SUCCESS;
- CI 9/9 SUCCESS across Ubuntu/macOS/Windows and Node 22/24/26;
- 268 test files / 3,047 tests SUCCESS on observed Ubuntu/Node 26;
- 16 dedicated Phase 9 governed node-operation tests SUCCESS;
- strict TypeScript typecheck SUCCESS;
- build SUCCESS;
- package smoke SUCCESS, including Phase 6/7/8 packed-artifact smokes;
- Secret Scan, Benchmark Contract, RC Preparation Evidence, Dashboard Browser
  QA, Web Studio Browser QA and Cross-Browser QA SUCCESS;
- no public Phase 9 runtime export or new dependency was introduced;
- no merge, release, tag, npm publish or deploy occurred.

The documentation-only Gate 9.3 closure commit itself requires the same
exact-head 7/7 workflow and 9/9 CI proof before Gate 9.4 begins.

### Gate 9.4 — media/voice plugin contracts — VALIDATED

Implementation surface:

- `src/media-plugin-contracts.ts` adds bounded Phase 9 media/voice plugin and
  profile contracts;
- `tests/media-plugin-contracts.test.ts` adds dedicated adversarial contract,
  provenance, permission, bounds and authority-separation coverage.

Contract:

- media/device permissions are explicit and least-privilege:
  `device-discovery`, `device-notify`, `device-camera`,
  `device-microphone`, `device-speaker`, `media-read`, `media-write`,
  `voice-stt`, `voice-tts` and `voice-realtime`;
- profiles support device adapters, STT, TTS, realtime voice, multimodal input
  and bounded image/audio/video generation families without implying execution;
- profile permissions must remain a subset of the parent bundle declaration;
- source provenance is credential-free HTTPS and GitHub-backed sources require
  an immutable pinned commit SHA;
- secrets remain environment-variable references by name only;
- MIME declarations are canonical explicit media types; wildcard or
  extension-like declarations fail closed;
- input/output bytes, item counts and optional durations are code-level bounded;
- health, lifecycle and compatibility are observation data only and cannot
  become selection or execution authority;
- validated profiles are bound to the exact bundle ID/version by FuryPipe
  rather than trusting caller-supplied profile identity;
- inspection exposes bounded metadata and source digests without exposing source
  URLs or secret values;
- bundles remain `authority:'plugin-contract-only'`,
  `executionAuthority:false` and `automaticExecutionAllowed:false`;
- profiles remain `authority:'profile-observation-only'`,
  `executionAuthority:false` and `selectionAuthority:false`;
- Gate 9.4 introduces no provider invocation, device operation, capture,
  playback or other media execution path.

Exact validated Gate 9.4 implementation HEAD:

`3a10d8ad3f26ddf15395b941c3a6d97f48e053a4`

Evidence:

- 7/7 workflows SUCCESS;
- CI 9/9 SUCCESS across Ubuntu/macOS/Windows and Node 22/24/26;
- 269 test files / 3,061 tests SUCCESS on observed Ubuntu/Node 26;
- 14 dedicated Phase 9 media/voice plugin-contract tests SUCCESS;
- strict TypeScript typecheck SUCCESS;
- build SUCCESS;
- package smoke SUCCESS, including Phase 6/7/8 packed-artifact smokes;
- Secret Scan, Benchmark Contract, RC Preparation Evidence, Dashboard Browser
  QA, Web Studio Browser QA and Cross-Browser QA SUCCESS;
- no public Phase 9 runtime export or new dependency was introduced;
- no provider/device/media execution path was introduced;
- no merge, release, tag, npm publish or deploy occurred.

The documentation-only Gate 9.4 closure commit itself requires the same
exact-head 7/7 workflow and 9/9 CI proof before Gate 9.5 begins.

### Gate 9.5 — governed multimodal ingestion — VALIDATED

Implementation surface:

- `src/media-ingestion.ts` adds bounded process-local multimodal ingestion for
  image/document/audio/video bytes;
- `tests/media-ingestion.test.ts` adds dedicated adversarial MIME, provenance,
  bounds, anti-forgery and prompt-injection-safety coverage.

Contract:

- ingestion accepts bytes already supplied to FuryPipe; it never performs an
  implicit remote fetch and exposes no fetch/send/execute authority;
- only an explicit canonical MIME set is accepted and media kind must match the
  declared MIME;
- PNG/JPEG/GIF dimensions, WAV duration and MP4 `mvhd` duration are derived
  from bytes rather than trusted extension metadata;
- per-item, per-batch and active byte/item budgets are code-level bounded and
  batch admission is atomic;
- image dimensions/pixel count and audio/video duration are bounded before a
  process-local handle is admitted;
- remote-transfer provenance requires an explicit reference digest and URLs are
  not accepted as fetch authority;
- transformed media binds exact source-media and transformation digests;
- raw bytes stay behind process-local anti-forgery handles, are copied on read,
  and are zeroed/released when the handle is released;
- copied handles and handles from another coordinator fail closed;
- evidence contains media/provenance digests and bounded metadata, not raw media
  or secret-like content;
- media content remains
  `contentTrust:'untrusted-media-content'`,
  `instructionAuthority:false` and `executionAuthority:false`;
- provider compatibility remains explicitly `not-evaluated`, so successful
  ingestion is never confused with provider/model compatibility;
- schema drift, accessors, duplicate item IDs, MIME spoofing, unsupported MIME
  types, oversized media and malformed timing/dimension evidence fail closed;
- Gate 9.5 introduces no provider inference, STT/TTS, device capture, playback
  or other media execution path.

Exact validated Gate 9.5 implementation HEAD:

`ed79e5be2d039ec618a92de3d803550c65e87265`

Evidence:

- 7/7 workflows SUCCESS;
- CI 9/9 SUCCESS across Ubuntu/macOS/Windows and Node 22/24/26;
- 270 test files / 3,080 tests SUCCESS on observed Ubuntu/Node 26;
- 19 dedicated governed multimodal-ingestion tests SUCCESS;
- strict TypeScript typecheck SUCCESS;
- build SUCCESS;
- package smoke SUCCESS, including Phase 6/7/8 packed-artifact smokes;
- Secret Scan, Benchmark Contract, RC Preparation Evidence, Dashboard Browser
  QA, Web Studio Browser QA and Cross-Browser QA SUCCESS;
- no public Phase 9 runtime export or new dependency was introduced;
- no provider/device/media execution path was introduced;
- no merge, release, tag, npm publish or deploy occurred.

The documentation-only Gate 9.5 closure commit itself requires the same
exact-head 7/7 workflow and 9/9 CI proof before Gate 9.6 begins.

### Gate 9.6 — governed STT/TTS — VALIDATED

Implementation surface:

- `src/media-voice-operations.ts` adds governed one-shot STT and TTS request,
  policy, permit, adapter and evidence contracts;
- four dedicated `media-voice-operations-*.test.ts` suites cover authorization,
  execution, recovery and adversarial boundaries.

Contract:

- STT and TTS are separate explicit operations bound to the exact validated
  media-plugin bundle/version/profile and operation request digest;
- execution requires a short-lived process-local one-shot permit whose exact
  request/policy binding is revalidated before adapter dispatch;
- copied requests/permits and permits from a fresh coordinator fail closed;
- profile lifecycle, permissions, supported media types, bounds and fresh health
  evidence are revalidated before use;
- STT consumes governed media handles and keeps transcripts
  `contentTrust:'untrusted-transcript'`, `instructionAuthority:false` and
  `promptAdmissionRequired:true`;
- STT adapter audio snapshots are zeroed after dispatch, including error paths;
- TTS output is re-ingested as governed `provider-output` media and malformed,
  undeclared or over-budget output fails closed;
- successful TTS generation explicitly leaves
  `speakerPlaybackAuthorized:false` and `deviceOperationAuthorized:false`;
- provider request IDs, permit IDs and policy IDs are digest-only in emitted
  evidence;
- adapter throw, malformed result or otherwise uncertain post-dispatch outcome
  is `unknown`, `retrySafe:false`, with no blind replay;
- no camera/microphone capture, speaker playback, realtime voice session or
  ambient device authority is introduced by Gate 9.6.

Exact validated Gate 9.6 implementation HEAD:

`0a6f8dfe812c05bfc4da348b6b5c8e9fd998c7f3`

Evidence:

- 7/7 workflows SUCCESS;
- CI 9/9 SUCCESS across Ubuntu/macOS/Windows and Node 22/24/26;
- 274 test files / 3,103 tests SUCCESS on observed Ubuntu/Node 26;
- 23 dedicated governed STT/TTS tests SUCCESS;
- strict TypeScript typecheck SUCCESS;
- build SUCCESS;
- package smoke SUCCESS, including Phase 6/7/8 packed-artifact smokes;
- Secret Scan, Benchmark Contract, RC Preparation Evidence, Dashboard Browser
  QA, Web Studio Browser QA and Cross-Browser QA SUCCESS;
- no new public Phase 9 package export or dependency was introduced;
- no speaker/device playback path was introduced;
- no merge, release, tag, npm publish or deploy occurred.

The documentation-only Gate 9.6 closure commit itself requires the same
exact-head 7/7 workflow and 9/9 CI proof before Gate 9.7 begins.

### Gate 9.7 — realtime voice sessions — VALIDATED

Implementation surface:

- `src/media-realtime-voice.ts` adds bounded realtime voice stream leases tied
  to current Gateway/node/session/capability evidence;
- `tests/media-realtime-voice.test.ts` adds dedicated adversarial lease,
  budget, replay, authority-change, cancellation and recovery coverage.

Contract:

- realtime voice is represented by a short-lived process-local stream lease,
  never a timeless permit or provider session ID;
- requests bind exact Gateway session/principal, node session/liveness epoch,
  registration/device/pairing identity, capability generation/digest,
  source/sink digests, direction and byte/frame/duration budgets;
- authorization revalidates current Gateway authority, live node session,
  current `voice.realtime` advertisement, profile lifecycle/permission/health
  and exact policy scope before issuing a lease;
- lease expiry is bounded by policy TTL, requested duration, Gateway-session
  expiry, node liveness and profile-health freshness;
- frame sequence is monotonic; direction, MIME, per-frame bytes, cumulative
  bytes and frame count are revalidated before each dispatch;
- current authority/capability generation is checked again immediately before
  dispatch and after adapter completion;
- an adapter exception, malformed/unknown adapter result or authority change
  after possible dispatch moves the lease to explicit `unknown` and removes it
  from the active set;
- unknown outcomes are never replay-safe and never automatically replayed;
- `interrupt`, `cancel` and `revoke` transition the lease terminally only
  after an acknowledged adapter result; remote rollback is never assumed;
- frame bytes are copied for dispatch and zeroed after use;
- provider session IDs are digest-only transport metadata and never FuryPipe
  authority;
- frame and terminal receipts remain observation/evidence only with
  `executionAuthority:false`, `retrySafe:false` and
  `automaticReplayAllowed:false`;
- realtime output does not imply speaker playback authority;
- copied/foreign lease/request objects and stale authority fail closed;
- restart/reconnect cannot resurrect process-local streaming authority.

Exact validated Gate 9.7 implementation HEAD:

`1172716bd7c82582358a6ba4102ff4dcfc7870d3`

Evidence:

- 7/7 workflows SUCCESS;
- CI 9/9 SUCCESS across Ubuntu/macOS/Windows and Node 22/24/26;
- 275 test files / 3,128 tests SUCCESS on observed Ubuntu/Node 26;
- 25 dedicated realtime voice streaming-lease tests SUCCESS;
- strict TypeScript typecheck SUCCESS;
- build SUCCESS;
- package smoke SUCCESS, including Phase 6/7/8 packed-artifact smokes;
- Secret Scan, Benchmark Contract, RC Preparation Evidence, Dashboard Browser
  QA, Web Studio Browser QA and Cross-Browser QA SUCCESS;
- Gate 9.6 documentation closure `1bce7d3eda30e9e68a081b412827e3142ec89c5f`
  was independently exact-head validated 7/7 + CI 9/9 before Gate 9.7;
- no merge, release, tag, npm publish or deploy occurred.

The documentation-only Gate 9.7 closure commit itself requires the same
exact-head 7/7 workflow and 9/9 CI proof before Gate 9.8 begins.

### Gate 9.8 — camera/microphone/device media capture — VALIDATED

Implementation surface:

- `src/media-device-capture.ts` adds governed one-shot camera/microphone
  capture composed with the existing node-operation permit and media-ingestion
  boundaries;
- `tests/media-device-capture.test.ts` adds 26 dedicated privacy, consent,
  reconnect, anti-forgery, replay and unknown-outcome tests.

Contract:

- pairing, capability advertisement and plugin availability never imply capture
  consent;
- each capture request binds the exact Gateway session/principal, live node
  session/liveness epoch, registration/device/pairing identity, current
  capability generation/digest, plugin bundle/version/profile and media bounds;
- camera requires `device-camera + media-write`; microphone requires
  `device-microphone + media-write`, with fresh profile health and exact
  supported MIME declarations;
- consent is process-local, one-shot, short-lived and bound to the exact request,
  principal/session/device/pairing plus fresh user-presence evidence, explicit
  local-confirmation digest and consent-text digest;
- one consent can reserve only one capture permit;
- the capture permit composes the existing governed node-operation permit;
  it does not create a second dispatch authority;
- `consumeForDispatch` occurs before the adapter callback and revalidates the
  current node/session/capability authority;
- captured bytes are admitted only through governed media ingestion as
  `node-capture` content and remain untrusted media;
- capture buffers are zeroed on success and on every terminal post-dispatch
  rejection/error path;
- adapter exceptions, unknown/malformed results, MIME/budget failures and
  post-dispatch authority uncertainty remain non-retryable `unknown`; no blind
  replay or rollback is claimed;
- receipts are digest-only and expose no raw camera/microphone content;
- copied/foreign requests, consents and permits fail closed;
- reconnect or a fresh coordinator cannot resurrect consent or capture
  authority;
- Gate 9.8 introduces no biometric authentication, face recognition,
  surveillance behavior or speaker/playback authority.

Exact validated Gate 9.8 implementation HEAD:

`013ef23ee1ed3b825ae1888c1e762ebc294e6947`

Evidence:

- 7/7 workflows SUCCESS;
- CI 9/9 SUCCESS across Ubuntu/macOS/Windows and Node 22/24/26;
- 276 test files / 3,154 tests SUCCESS on observed Ubuntu/Node 26;
- 26 dedicated governed device-capture tests SUCCESS;
- strict TypeScript typecheck SUCCESS;
- build SUCCESS;
- package smoke SUCCESS, including Phase 6/7/8 packed-artifact smokes;
- Secret Scan, Benchmark Contract, RC Preparation Evidence, Dashboard Browser
  QA, Web Studio Browser QA and Cross-Browser QA SUCCESS;
- no new public Phase 9 package export or dependency was introduced;
- no merge, release, tag, npm publish or deploy occurred.

The documentation-only Gate 9.8 closure commit itself requires the same
exact-head 7/7 workflow and 9/9 CI proof before Gate 9.9 begins.

### Gate 9.9 — Capability Autopilot + Devices evidence surface — VALIDATED

Implementation surface:

- `src/phase9-devices-evidence.ts` projects current live Phase 9 node
  capabilities into the existing Capability Index as observation/routing
  metadata only and builds a digest-only Devices evidence snapshot;
- `tests/phase9-devices-evidence.test.ts` adds 18 dedicated projection,
  reconnect, anti-forgery, unknown-outcome, authority-separation and bounds
  tests.

Contract:

- only current live node-session capability generations are projectable;
- reconnect makes pre-reconnect advertisements stale until a newer generation
  is advertised;
- projected device capabilities reuse the existing Capability Index and remain
  `executionAuthority:false`;
- Capability Autopilot remains `selection-only`; projection does not grant
  activation, connection, policy or execution authority;
- camera, microphone, speaker, notification, media-input and voice surfaces
  receive minimum capability-specific permission metadata;
- projected records use host-origin routing metadata and never durable bearer
  authority;
- copied/lookalike node descriptors fail closed;
- projection requires the complete current registry descriptor set and rolls
  back partial index mutation on failure;
- Devices snapshots hash registration/device/pairing/client/session/liveness
  identifiers and do not expose raw process-local authority identifiers;
- realtime voice, capture and STT/TTS activity may be displayed only from
  process-local generated evidence objects;
- explicit realtime `unknown` outcomes remain visible with
  `retrySafe:false` and `automaticReplayAllowed:false`;
- activity evidence bound to a node outside the current snapshot fails closed;
- disconnected or revoked/stale authority is represented by loss of current
  live capability/session evidence; no synthetic revocation boolean is
  fabricated where the pairing coordinator does not expose durable revocation
  inspection;
- dashboard/inspection output remains `dashboard-observation-only` with
  execution, activation, connection and policy authority all false;
- Gate 9.9 adds no new public Phase 9 package export and no dependency.

Initial Gate 9.9 candidate:

`b39e37b7cf44cdd7e3a7be56753439f0065e791f`

This candidate correctly failed CI because a capability without a dotted
namespace (for example `camera`) produced duplicate Capability Index keywords.
The failure was fixed by deterministic keyword deduplication before the gate was
accepted.

Exact validated Gate 9.9 implementation HEAD:

`98bf4489af25044e8a49853d5002fc0b561815d1`

Evidence:

- 7/7 workflows SUCCESS;
- CI 9/9 SUCCESS across Ubuntu/macOS/Windows and Node 22/24/26;
- 277 test files / 3,172 tests SUCCESS on observed Ubuntu/Node 26;
- 18 dedicated Phase 9 Devices/Capability Autopilot evidence tests SUCCESS;
- strict TypeScript typecheck SUCCESS;
- build SUCCESS;
- package smoke SUCCESS, including Phase 6/7/8 packed-artifact smokes,
  benchmark claim, provider-attempt and governed-provider smokes;
- Secret Scan, Benchmark Contract, RC Preparation Evidence, Dashboard Browser
  QA, Web Studio Browser QA and Cross-Browser QA SUCCESS;
- the failed pre-fix implementation HEAD was not accepted as Gate 9.9 evidence;
- no merge, release, tag, npm publish or deploy occurred.

The documentation-only Gate 9.9 closure commit itself requires the same
exact-head 7/7 workflow and 9/9 CI proof before Gate 9.10 begins.

### Gate 9.10 — final Phase 9 evidence

Require:

- exact-head Secret Scan;
- CI 9/9 across Ubuntu/macOS/Windows and Node 22/24/26;
- Benchmark Contract;
- RC Preparation Evidence;
- Dashboard Browser QA;
- Web Studio Browser QA;
- Cross-Browser QA;
- package smoke for every new public Phase 9 runtime export;
- adversarial device/media tests;
- restart/reconnect proof;
- unknown-outcome/no-blind-replay proof.

## 29. Non-goals

Phase 9 does not authorize:

- silent camera or microphone capture;
- ambient remote shell merely because a node is paired;
- automatic plugin installation;
- treating voice as trusted identity;
- biometric authentication;
- face recognition;
- surveillance features;
- persistent raw media collection by default;
- automatic replay of uncertain side effects;
- public Gateway exposure;
- merge/release/tag/npm publish/deploy.

## 30. Gate 9.0 exit criteria

Gate 9.0 is complete only when:

- this architecture is committed on a branch stacked exactly on validated Phase
  8 HEAD `46f7ded2edc1b399dcd65d53cc4490be8c1ac5bd`;
- the Phase 9 PR remains OPEN + DRAFT;
- only architecture/documentation changes are present for Gate 9.0;
- no new Phase 9 runtime dependency has been introduced;
- no new device/media execution path exists;
- exact-head Secret Scan is green;
- exact-head CI 9/9 is green;
- exact-head Benchmark Contract is green;
- exact-head RC Preparation Evidence is green;
- exact-head Dashboard Browser QA is green;
- exact-head Web Studio Browser QA is green;
- exact-head Cross-Browser QA is green;
- no merge/release/tag/npm publish/deploy occurred.

Until all criteria are true, Gate 9.1 must not begin.

## 31. Caveman correctness checklist

Before accepting any Phase 9 feature, answer explicitly:

1. What exact device/session/media state exists?
2. Who owns that state?
3. What evidence proves it?
4. Is the device merely authenticated, paired, connected or actually
   authorized for this operation?
5. Which exact capability generation is current?
6. Which exact principal/Gateway/node session owns the authority?
7. What consent/user-presence evidence is required?
8. What happens if the Gateway restarts here?
9. What happens if the node disconnects here?
10. What happens if the provider response is lost?
11. Could the side effect already have happened?
12. Can this operation be retried safely?
13. Can a copied object forge authority?
14. Can stale authority survive reconnect?
15. Can media content become instructions without prompt admission?
16. Can raw media or credentials leak into evidence/logs?
17. Is success observed, claimed or independently verified?

Priority:

```text
security
> correctness
> evidence
> privacy
> recoverability
> interoperability
> maintainability
> performance
> convenience
```

No magic. No pairing-as-permission. No capability-as-authority. No silent
capture. No blind retry. No raw-secret leakage. No auto-install. No auto-merge.
