# FuryPipe CLI

The documented public binary is **`furypipe`**.

The package is published on npm as `furypipe`.

## Install

```bash
npm install --global furypipe
furypipe doctor
```

Or run it without a global install:

```bash
npx furypipe doctor
```

## Commands

```text
furypipe setup [--lang=fr|en] [--plain] [--no-color] [--yes]
furypipe start
furypipe doctor [--json] [--locale=<BCP-47>]
furypipe stats [--json] [--file <path>]
furypipe export [...]
furypipe warp [...] -- <agent>
```

Use `furypipe --help` and command-specific help as the runtime source of truth for options available in the installed version.

## Setup

`furypipe setup` launches the FuryPipe first-run terminal experience.

The rich TUI is dependency-free and uses the terminal directly. It provides FuryPipe branding, a step rail, bilingual language selection, keyboard navigation and a completion screen.

```bash
furypipe setup
furypipe setup --lang=fr
furypipe setup --lang=en --yes
```

Interactive controls:

```text
← / → or ↑ / ↓   select language
1 / F             Français
2 / E             English
Enter             confirm
Esc / Q           cancel
```

Options:

```text
--lang=fr|en   preselect a language
-y, --yes      apply without interaction
--plain        force the text fallback
--no-color     disable ANSI colors
-h, --help     show setup help
```

In CI, pipes, non-TTY sessions, or `TERM=dumb`, FuryPipe automatically uses the plain-text fallback instead of attempting a full-screen TUI.

Setup writes only FuryPipe-owned preference metadata to the configured JSON file and preserves unrelated existing keys. An invalid existing config is never overwritten.

The setup command is explicit by design: installing an npm package must not unexpectedly block on an interactive lifecycle script. After installation, run `furypipe setup` when you want the guided experience.

## Start

`furypipe start` starts the Node runtime.

The default deployment is loopback-oriented. Non-loopback exposure requires an explicit operator security boundary; see [../SECURITY.md](../SECURITY.md).

## Doctor

`furypipe doctor` inspects runtime configuration without intentionally reading or printing provider credentials.

Upstream URLs are normalized before display so userinfo, query strings and fragments are not exposed in the report.

Missing tools are reported as unavailable. `doctor` does not automatically install third-party tooling.

Human-readable output supports locale selection, including:

```text
--locale=fr
--locale=en
--locale=<BCP-47 value resolved to a supported catalog>
```

The `--json` contract remains machine-oriented and is not localized.

## Stats

`furypipe stats` reads the configured event log and produces an offline summary without requiring the dashboard to remain open.

Treat event logs as potentially sensitive operational data.

## Export

`furypipe export` can prepare context artifacts without starting the proxy.

Examples:

```bash
furypipe export --stdin < prompt.txt
furypipe export --git
```

Depending on the input and runtime path, exports can include context pages, factsheets and prompt artifacts.

## Warp

`furypipe warp ... -- <agent>` prepares the FuryPipe routing environment for the requested child process.

Warp does not grant permissions, credentials or capabilities that the target process did not already have through the configured host environment.

## Legacy `pxpipe` command

The npm package currently retains:

```text
pxpipe -> bin/cli.js
```

This is a **legacy compatibility alias**.

New documentation, scripts and integrations should invoke:

```text
furypipe
```

Do not introduce new public workflows that depend on the legacy command name.

## Environment naming

FuryPipe-native environment variables use the `FURYPIPE_*` prefix.

Selected `PXPIPE_*` values remain accepted as fallbacks. When both forms are present, the FuryPipe-native value is authoritative.

See [../COMPATIBILITY.md](../COMPATIBILITY.md).

## Distribution and release status

Current public package:

```text
furypipe@0.13.2
```

Current GitHub release:

```text
v0.13.2
```

Package publication, GitHub release and production deployment are distinct lifecycle states.

The release pipeline includes CI/security/supply-chain/provenance gates, but a green gate must not be used as evidence for an unrelated capability or external integration.

See [RELEASE_SECURITY.md](RELEASE_SECURITY.md).
