# i18n runtime status

## Status

`PARTIAL / CLI_AND_DASHBOARD_SHELL_WIRED`

FuryPipe now has a runtime locale controller in addition to the BCP-47 translation core.

Implemented:

- ordered locale preferences;
- exact-locale → language → default resolution;
- invalid preference isolation;
- explicit supported-locale allowlist;
- runtime locale snapshot;
- automatic LTR/RTL direction;
- state transitions and subscriptions;
- runtime translation helper;
- FR/EN catalog-key parity enforcement;
- pseudo-locale compatibility through the existing core.

The `doctor` human-readable CLI labels consume the shared catalog through
`--locale=<BCP-47>`.

The dashboard now has a real request-scoped locale surface:

- `?locale=<BCP-47>` on the dashboard page;
- FR/EN plus `en-XA` / `ar-XB` selector;
- `lang` and `dir` emitted from the canonical locale resolution;
- browser persistence through `localStorage` key `furypipe-locale`;
- htmx requests inherit the active locale;
- Control Room human labels are localized;
- technical status values, commit SHAs and protocol identifiers remain unchanged.

The following remain deliberately not claimed:

- full translation of every legacy dashboard fragment;
- OS locale auto-discovery;
- translated MCP/protocol payloads;
- translated code/config/IDs/hashes;
- visual browser validation of every RTL layout.

Protocol and exact machine values remain outside translation.

The UI/CLI integration should consume this runtime rather than implement independent locale fallback rules.
