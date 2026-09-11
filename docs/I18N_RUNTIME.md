# i18n runtime status

## Status

`RUNTIME_KERNEL_IMPLEMENTED_NOT_SURFACE_WIRED`

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

Deliberately not claimed:

- CLI flag wiring;
- dashboard locale selector;
- browser localStorage persistence;
- OS locale auto-discovery;
- translated MCP/protocol payloads;
- translated code/config/IDs/hashes.

Protocol and exact machine values remain outside translation.

The UI/CLI integration should consume this runtime rather than implement independent locale fallback rules.
