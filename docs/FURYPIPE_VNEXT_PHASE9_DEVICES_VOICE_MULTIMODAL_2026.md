# FuryPipe VNext — Phase 9 Devices + Voice/Multimodal (2026)

> Status: Gate 9.0 architecture + threat model.
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

### Gate 9.0 — architecture + threat model

Freeze this document and validate it on an exact clean HEAD.

No Phase 9 runtime dependency or execution capability is introduced here.

### Gate 9.1 — node registry + capability advertisements

Implement bounded, process-local/durable-aware node descriptors and
advertisement generations on top of existing auth/pairing.

No node command execution yet.

### Gate 9.2 — node session/liveness + reconnect governance

Bind paired identity to live node sessions, heartbeat/liveness and strict
reconnect/restart semantics.

No stale authority restoration.

### Gate 9.3 — governed node-operation permits

Introduce exact, one-shot bounded permits for node actions.

No ambient remote-control authority.

### Gate 9.4 — media/voice plugin contracts

Extend plugin/capability contracts for device/media/STT/TTS/realtime profiles,
permissions, health and provenance.

No implicit provider execution.

### Gate 9.5 — governed multimodal ingestion

Bound image/document/audio/video ingestion, MIME/type validation, provenance and
prompt-injection-safe content handling.

### Gate 9.6 — governed STT/TTS

Implement separate governed synthesis/recognition operations and evidence.

TTS generation and device playback remain separate authorities.

### Gate 9.7 — realtime voice sessions

Implement bounded streaming leases, cancellation/revocation, interruption and
unknown-outcome semantics.

### Gate 9.8 — camera/microphone/device media capture

Add privacy-sensitive capture with explicit consent/user-presence semantics and
strict source/session binding.

### Gate 9.9 — Capability Autopilot + Devices evidence surface

Index the new capabilities lazily and expose inspection/evidence without
turning the dashboard or selection layer into authority.

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
