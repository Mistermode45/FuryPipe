# i18n runtime status

## Status

`PARTIAL / CLI_AND_DASHBOARD_SHELL_WIRED`

FuryPipe now has a runtime locale controller in addition to the BCP-47 translation core.

Implemented:

- ordered locale preferences;
- bounded HTTP `Accept-Language` parsing with q-value ordering;
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
- automatic initial FR/EN negotiation from the browser's `Accept-Language` header when no explicit locale is present;
- explicit locale remains authoritative over HTTP negotiation;
- FR/EN plus `en-XA` / `ar-XB` selector; pseudo-locales are never selected automatically;
- `lang` and `dir` emitted from the canonical locale resolution;
- browser persistence through `localStorage` key `furypipe-locale`;
- htmx requests inherit the active locale;
- Control Room human labels are localized;
- technical status values, commit SHAs and protocol identifiers remain unchanged.

The following remain deliberately not claimed:

- full translation of every legacy dashboard fragment;
- CLI/OS locale auto-discovery outside HTTP browser negotiation;
- translated MCP/protocol payloads;
- translated code/config/IDs/hashes;
- visual browser validation of every RTL layout.

Protocol and exact machine values remain outside translation.

The UI/CLI integration should consume this runtime rather than implement independent locale fallback rules.


## Accept-Language boundary

The HTTP parser is deliberately bounded:

- headers longer than 4096 characters are ignored;
- at most 32 language ranges are considered;
- invalid BCP-47 ranges are isolated instead of failing the request;
- `q=0` entries and wildcard `*` are excluded from automatic selection;
- preferences are ordered by quality and original header order;
- automatic dashboard selection is limited to real catalogs (`en`, `fr`).

This keeps browser negotiation separate from the pseudo-locales used for localization QA.
