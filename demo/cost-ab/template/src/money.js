/**
 * Monetary helpers. All money is handled as integer cents.
 *
 * roundHalfEven — round to the nearest integer, with exact halves going to the
 * nearest EVEN integer (banker's rounding). This is the rounding the pricing
 * SPEC requires; Math.round (half-up) is wrong for tie cases.
 *
 *   roundHalfEven(16.5) === 16   // tie -> even
 *   roundHalfEven(17.5) === 18   // tie -> even
 *   roundHalfEven(16.4) === 16
 *   roundHalfEven(16.6) === 17
 */
export function roundHalfEven(value) {
  const floor = Math.floor(value);
  const frac = value - floor;
  if (Math.abs(frac - 0.5) < 1e-9) {
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return Math.round(value);
}

/** Format integer cents as a dollar string, e.g. 2468 -> "$24.68". */
export function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
