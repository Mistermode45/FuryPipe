# i18n runtime status

## Status

`PARTIAL / CLI_AND_DASHBOARD_HUMAN_COPY_WIRED_RTL_VISUAL_PENDING`

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
- deep dashboard analytical copy is localized, including cost/savings explanations and the math drawer;
- OpenAI Responses composition labels, request x-ray, recent-request columns, image/source inspector and legacy stats labels are localized;
- agent connection help, model-scope warnings and provider-routing help are localized while commands and environment variables remain exact;
- technical status values, commit SHAs, formulas/variable identifiers and protocol identifiers remain unchanged.

The following remain deliberately not claimed:

- translated MCP/protocol payloads; protocol/machine payloads intentionally remain exact;
- translated code/config/IDs/hashes/formula identifiers;
- hosted/browser visual validation of every RTL layout and every responsive breakpoint.

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

- compression kill-switch banner/state/action/confirmation/hint;
- provider model-scope labels, warnings and routing help;
- session summary, cost/savings tiles and deep math explanations;
- recent-request empty state, columns, tooltips and cache-create explanation;
- session tracking empty state/axis;
- Context Map buckets, cache-aware comparison copy, image-cap warnings and OpenAI Responses composition diagnostics;
- image/source inspector controls and labels;
- full-history legacy stat row labels;
- Control Room human labels and release-readiness copy.

The English locale remains the default, preserving existing CLI/dashboard behavior and legacy test contracts.

Machine values remain untranslated: model IDs, HTTP statuses, paths, environment variable names, token counts, pricing figures, request IDs, hashes, protocol values and raw technical error strings.

The remaining PARTIAL status is not a claim that those dashboard surfaces are still unwired. It reflects the missing real-browser visual validation for RTL/responsive layouts and the deliberate decision not to translate protocol/machine payloads. English remains the default and pseudo-locales remain QA-only.
