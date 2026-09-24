import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const OUTPUT_DIR = path.resolve(
  process.env.FURYPIPE_VALIDATION_OUTPUT_DIR?.trim() || 'artifacts/external-validation',
);

export function isPresent(name) {
  return typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
}

export function presence(names) {
  return Object.fromEntries(names.map((name) => [name, isPresent(name)]));
}

export function sourceCommit() {
  return process.env.FURYPIPE_SOURCE_COMMIT?.trim() || 'not-bound';
}

export function hasExplicitOptIn(authorizationVariable) {
  return process.env.FURYPIPE_LIVE_VALIDATION === '1'
    && process.env[authorizationVariable] === 'YES';
}

export function boundedText(value, maximum = 256) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maximum ? trimmed : undefined;
}

export async function writeEvidence(filename, evidence) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, filename);
  const serialized = JSON.stringify(evidence, null, 2) + '\n';
  await writeFile(outputPath, serialized, 'utf8');
  process.stdout.write(serialized);
  return outputPath;
}
