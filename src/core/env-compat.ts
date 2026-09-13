/**
 * Resolve a FuryPipe-native environment value with a legacy compatibility
 * fallback.
 *
 * Presence wins over truthiness: an explicitly empty FuryPipe value is still
 * authoritative and MUST NOT fall through to legacy state.
 */
export function furyEnvValue(
  primary: string | undefined,
  legacy: string | undefined,
): string | undefined {
  return primary !== undefined ? primary : legacy;
}
