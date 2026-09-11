# Pricing Engine — Specification

`orderTotalCents(items, tier)` returns the final order total as an **integer
number of cents**.

- `items`: array of `{ cents, qty }` — unit price in integer cents, integer quantity.
- `tier`: one of `"NONE"`, `"SILVER"`, `"GOLD"`.

Apply these steps **in exactly this order**:

1. **Subtotal** = Σ (`cents` × `qty`) over all line items.

2. **Volume discount**, keyed on the **total quantity across all lines** (the sum
   of every `qty`, *not* the number of line items):
   | total qty | discount |
   |---|---|
   | ≥ 100 | 20% |
   | ≥ 50  | 12% |
   | ≥ 10  | 5%  |
   | < 10  | 0%  |
   Subtract `roundHalfEven(subtotal × pct)` from the subtotal.

3. **Loyalty discount**, applied to the **post-volume-discount** amount
   (**not** the original subtotal):
   | tier | discount |
   |---|---|
   | GOLD | 3% |
   | SILVER | 1% |
   | NONE | 0% |
   Subtract `roundHalfEven(amount × pct)`.

4. **Tax** = `roundHalfEven(amount × 0.0825)` computed on the
   **post-all-discounts** amount; add it to the amount.

## Rounding rule (important)

Every monetary rounding uses **round-half-to-even** ("banker's rounding") —
import and use `roundHalfEven` from `src/money.js`. Do **not** use `Math.round`:
that is half-*up* and produces the wrong cent on exact `.5` ties (e.g. a tax of
`16.5` cents must round to **16**, not 17). Round at each money step above; the
returned value is the post-tax total in integer cents.
