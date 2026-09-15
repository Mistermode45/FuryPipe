/** Linear-time string helpers for untrusted/config-derived input.
 *
 * Keep these operations regex-free so CodeQL can prove there is no
 * polynomial-time backtracking path on attacker-controlled strings.
 */

/** Remove every trailing ASCII slash without using a regular expression. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* / */) end--;
  return end === value.length ? value : value.slice(0, end);
}

/**
 * Remove each complete `[...]` segment. An unmatched `[` is preserved,
 * matching the old global-regex semantics.
 */
export function stripBracketedSegments(value: string): string {
  let cursor = 0;
  let out = '';

  for (;;) {
    const open = value.indexOf('[', cursor);
    if (open < 0) return cursor === 0 ? value : out + value.slice(cursor);

    const close = value.indexOf(']', open + 1);
    if (close < 0) return out + value.slice(cursor);

    out += value.slice(cursor, open);
    cursor = close + 1;
  }
}
