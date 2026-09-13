import { lstatSync, readFileSync, statSync } from 'node:fs';

import type { SecurityEvidence } from './index.js';
import {
  createControlRoomSecurityCiSnapshotFromUnknown,
  type ControlRoomSecurityCiSnapshot,
} from './security-ci-evidence.js';

export const CONTROL_ROOM_SECURITY_CI_EVIDENCE_MAX_BYTES = 64 * 1024;

function boundedPath(value: string): string {
  const path = value.trim();
  if (path.length < 1 || path.length > 4096 || path.includes('\0')) {
    throw new Error('Control Room security CI evidence path must be a bounded non-empty string');
  }
  return path;
}

export function loadControlRoomSecurityCiEvidenceFile(
  filePath: string,
  expectedSourceCommit: string,
): ControlRoomSecurityCiSnapshot {
  const path = boundedPath(filePath);
  const link = lstatSync(path);
  if (link.isSymbolicLink()) {
    throw new Error('Control Room security CI evidence path must not be a symlink');
  }
  const stat = statSync(path);
  if (!stat.isFile()) {
    throw new Error('Control Room security CI evidence path must be a regular file');
  }
  if (stat.size < 2 || stat.size > CONTROL_ROOM_SECURITY_CI_EVIDENCE_MAX_BYTES) {
    throw new Error('Control Room security CI evidence file exceeds its size boundary');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    throw new Error('Control Room security CI evidence file is not valid JSON');
  }
  return createControlRoomSecurityCiSnapshotFromUnknown(parsed, expectedSourceCommit);
}

const SECURITY_KEYS: readonly (keyof SecurityEvidence)[] = Object.freeze([
  'codeql',
  'secretScan',
  'dependencyAudit',
  'sbom',
  'actionPinning',
  'licenseCompliance',
  'dependencyReview',
]);

export interface ResolvedControlRoomSecurityEvidence {
  readonly security?: SecurityEvidence;
  readonly source: 'none' | 'host' | 'ci' | 'matching';
  readonly conflict: boolean;
}

function sameSecurityEvidence(a: SecurityEvidence, b: SecurityEvidence): boolean {
  return SECURITY_KEYS.every((key) => a[key] === b[key]);
}

/**
 * Resolve the two supported Security evidence sources without silently mixing
 * individual fields. Exact-source CI evidence is authoritative if both sources
 * disagree because it binds every workflow run to the target head SHA.
 */
export function resolveControlRoomSecurityEvidence(
  hostSecurity: SecurityEvidence | undefined,
  ciSecurity: SecurityEvidence | undefined,
): ResolvedControlRoomSecurityEvidence {
  if (hostSecurity === undefined && ciSecurity === undefined) {
    return Object.freeze({ source: 'none', conflict: false });
  }
  if (ciSecurity === undefined) {
    return Object.freeze({ security: hostSecurity!, source: 'host', conflict: false });
  }
  if (hostSecurity === undefined) {
    return Object.freeze({ security: ciSecurity, source: 'ci', conflict: false });
  }
  if (sameSecurityEvidence(hostSecurity, ciSecurity)) {
    return Object.freeze({ security: ciSecurity, source: 'matching', conflict: false });
  }
  return Object.freeze({ security: ciSecurity, source: 'ci', conflict: true });
}
