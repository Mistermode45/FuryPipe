# pricing-engine

A small order-pricing library. Computes an order total from line items, a
volume discount, a loyalty-tier discount, and tax.

- `src/pricing.js` — `orderTotalCents(items, tier)` (**currently buggy — your task**)
- `src/money.js` — monetary helpers (`roundHalfEven`, `formatCents`)
- `src/catalog.js` — product catalog + SKU → line-item resolution
- `SPEC.md` — the exact pricing rules the implementation must follow
- `test/` — the test suite (`node --test`)

## Task

`src/pricing.js` does not follow `SPEC.md` and the tests fail. Implement the
rules in `SPEC.md` so that `node --test` passes (5 tests). No dependencies to
install — Node's built-in test runner is used.

```bash
node --test
```
