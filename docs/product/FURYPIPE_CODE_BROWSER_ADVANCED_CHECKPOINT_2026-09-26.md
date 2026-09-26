# FuryPipe — FuryCode + Browser Advanced Studio checkpoint (2026-09-26)

Status: IMPLEMENTED_PENDING_EXACT_HEAD_EVIDENCE

Base: PR #235 exact green HEAD `9111dc144fde1872e47a2e5a53787bb4d0a28e47`.

## FuryCode

Studio now reuses canonical CodeGraph for bounded repository summary, file/symbol search, references, imports and related tests. This adds code intelligence without creating a second parser or execution authority.

Editor writes, terminal/process UX, commits, pushes and merges remain outside this checkpoint.

## Browser Advanced

Studio now has an opt-in managed-browser bridge. It is unavailable unless a canonical `BrowserRuntime` is injected. BrowserSession, BrowserPage and one-shot BrowserActionPermit authority objects remain server-side; permits are never serialized.

Session/page lifecycle and every browser action require explicit `confirm:true`. Actions delegate only to BrowserRuntime. Upload is deliberately excluded from this first bridge.

## Routes

- `POST /api/studio/code/intelligence`
- `POST /api/studio/code/symbol`
- `GET /api/studio/browser/status.json`
- `POST /api/studio/browser/sessions`
- `POST /api/studio/browser/sessions/close`
- `POST /api/studio/browser/pages`
- `POST /api/studio/browser/pages/close`
- `POST /api/studio/browser/action`

## Truth boundary

No production browser host is claimed. No editor/terminal/write parity is claimed. No merge, release, tag, npm publish or deploy is authorized.
