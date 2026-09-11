import { roundHalfEven } from './money.js';

/**
 * Compute an order total in integer cents.
 *
 * ⚠️  THIS IMPLEMENTATION IS BUGGY — it does NOT follow SPEC.md. Your task is to
 * fix it so the test suite (`node --test`) passes. Read SPEC.md carefully: the
 * discount keys, the order of operations, and the rounding rule all matter.
 *
 * @param {{cents:number, qty:number}[]} items
 * @param {"NONE"|"SILVER"|"GOLD"} tier
 * @returns {number} total in integer cents
 */
export function orderTotalCents(items, tier) {
  const subtotal = items.reduce((sum, i) => sum + i.cents * i.qty, 0);

  // BUG: discounts by number of line items, not total quantity; half-up rounding.
  const volume = items.length > 1 ? Math.round(subtotal * 0.05) : 0;

  // BUG: ignores the loyalty tier entirely, and taxes before discounts are final.
  const tax = Math.round(subtotal * 0.0825);

  return subtotal - volume + tax;
}
