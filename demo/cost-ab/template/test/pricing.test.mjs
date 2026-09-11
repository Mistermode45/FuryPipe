import test from 'node:test';
import assert from 'node:assert/strict';
import { orderTotalCents } from '../src/pricing.js';

// Expected values are derived from SPEC.md (volume tier by total qty, loyalty on
// the post-volume amount, 8.25% tax last, banker's rounding at each money step).
const cases = [
  { name: 'no discount, plain', items: [{ cents: 200, qty: 12 }], tier: 'NONE', expected: 2468 },
  { name: 'volume 12% + gold 3%', items: [{ cents: 150, qty: 60 }], tier: 'GOLD', expected: 8316 },
  { name: 'banker rounding tie (tax 16.5 -> 16)', items: [{ cents: 200, qty: 1 }], tier: 'NONE', expected: 216 },
  { name: 'volume 5% then gold 3% (order matters)', items: [{ cents: 1000, qty: 10 }], tier: 'GOLD', expected: 9975 },
  { name: 'multi-line, silver', items: [{ cents: 999, qty: 50 }, { cents: 50, qty: 55 }], tier: 'SILVER', expected: 45181 },
];

for (const c of cases) {
  test(c.name, () => {
    assert.equal(orderTotalCents(c.items, c.tier), c.expected);
  });
}
