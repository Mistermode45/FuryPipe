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

The `doctor` human-readable CLI labels consume the shared catalog. `--locale=<BCP-47>` remains authoritative; without it, the Node CLI now resolves a bounded OS preference chain from `LC_ALL`, `LC_MESSAGES`, `LANGUAGE`, `LANG`, then `Intl.DateTimeFormat().resolvedOptions().locale`. POSIX forms such as `fr_FR.UTF-8` are normalized before matching FR/EN catalogs.

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


## CLI / OS locale boundary

Doctor locale detection is intentionally bounded and human-output-only:

- explicit `--locale` wins over every environment/OS signal;
- `LC_ALL` and `LC_MESSAGES` precede `LANGUAGE` and `LANG`;
- `LANGUAGE` is capped and at most 8 entries are considered;
- POSIX `C` / `POSIX` are ignored;
- encoding/modifier suffixes are stripped (`fr_FR.UTF-8@euro` -> `fr-FR`);
- invalid tags are isolated;
- the Node `Intl` locale is the final OS signal;
- automatic CLI selection is limited to real EN/FR catalogs;
- JSON output remains language-neutral and unchanged.


## Primary dashboard fragments

The active dashboard locale is now propagated to the primary htmx fragments instead of stopping at the page shell and Control Room.

Localized human UI currently includes:

- compression kill-switch banner/state/action/hint;
- provider model-scope labels and hints;
- session-summary empty state and token-direction wording;
- recent-request empty state and Details action;
- session tracking empty state/axis;
- empty/evicted Context Map guidance;
- basic stats empty/parsed-event labels.

The English locale remains the default, preserving existing CLI/dashboard behavior and legacy test contracts.

Machine values remain untranslated: model IDs, HTTP statuses, paths, environment variable names, token counts, pricing figures, request IDs, hashes, protocol values and raw technical error strings.

Some deep analytical copy (formula explanations, detailed Responses-composition labels and legacy stat table row names) still remains English. M18 therefore remains PARTIAL rather than claiming full dashboard translation.
