# Third-party notices

This file records third-party license and provenance notes relevant to the FuryPipe repository and build environment.

The dependency inventory below was generated from the installed lockfile with `pnpm licenses list --json` on **2026-09-14**. It describes packages present in that build environment; it is **not** a substitute for legal review, a release SBOM or a signed provenance attestation.

## License counts from the recorded inventory

| Declared license | Packages |
|---|---:|
| MIT | 61 |
| Apache-2.0 | 9 |
| MIT OR Apache-2.0 | 4 |
| ISC | 3 |
| MPL-2.0 | 2 |
| Apache-2.0 AND LGPL-3.0-or-later | 1 |
| CC0-1.0 | 1 |
| BSD-3-Clause | 1 |

## Notices that must remain visible

- The repository `LICENSE` file is MIT and retains the upstream copyright attribution `claude-image-proxy contributors`. That attribution is intentionally preserved as upstream provenance and must not be removed without a legal/provenance review.
- Bundled font/assets must retain their license files:
  - `assets/JETBRAINS_MONO_LICENSE.txt`
  - `assets/SPLEEN_LICENSE.txt`
  - `assets/UNIFONT_LICENSE.txt`
- `@img/sharp-win32-x64` declared `Apache-2.0 AND LGPL-3.0-or-later` in the recorded inventory; any redistribution that embeds it must preserve the applicable obligations.
- `lightningcss` and its Windows binding declared MPL-2.0.
- `source-map-js` declared BSD-3-Clause.
- `@speed-highlight/core` declared CC0-1.0.
- `blake3-wasm` appeared transitively and declared MIT.
- `json5@2.2.3` declared MIT and is used to read JSON5 OpenClaw configuration.
- `playwright@1.63.0` and `playwright-core@1.63.0` declared Apache-2.0. Playwright browser binaries are test dependencies and are not shipped as part of the FuryPipe npm package.

## Post-inventory dependency additions

- `ws@8.21.3` is a direct runtime dependency for the loopback Fury Gateway WebSocket host. It is MIT licensed. FuryPipe disables per-message compression for this control-plane use and does not install the optional native `bufferutil` or `utf-8-validate` addons.
- `@types/ws@8.18.1` is a development-only TypeScript declaration dependency and is MIT licensed.
- The recorded 2026-09-14 license-count table above predates these direct dependency additions and is intentionally not rewritten as if it were a new inventory.

## Upstream provenance

FuryPipe derives from and studies upstream/open-source work documented in:

- [UPSTREAM.md](UPSTREAM.md)
- [SOURCE_LEDGER.md](SOURCE_LEDGER.md)
- [SKILL_LICENSE_MATRIX.md](SKILL_LICENSE_MATRIX.md)

Those files record source identity and integration decisions. They do not transfer ownership of third-party code or licenses.

## Release state

FuryPipe `v0.13.2` was publicly released on **2026-09-15** and `furypipe@0.13.2` is published on npm.

The recorded 2026-09-14 license inventory predates that publication by one day. Release evidence, package digests and SBOM/provenance artifacts are tracked separately by the repository release workflows and release documentation.

The local command `pnpm audit --prod --audit-level high` was green at the time of the 2026-09-14 inventory. That historical result must not be interpreted as a permanent vulnerability-free guarantee.