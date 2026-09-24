import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolve pnpm without invoking a shell when a native executable is available.
 * The shell fallback is retained only for hosts that expose pnpm exclusively
 * through a command shim.
 */
export function resolvePnpmCommand() {
  if (process.platform !== 'win32') {
    return Object.freeze({ executable: 'pnpm', prefixArgs: [], shell: false });
  }

  const pathEntries = (process.env.PATH ?? process.env.Path ?? '')
    .split(path.delimiter)
    .filter(Boolean);
  const candidates = [];
  if (process.env.PNPM_HOME) candidates.push(path.join(process.env.PNPM_HOME, 'pnpm.exe'));
  for (const entry of pathEntries) {
    candidates.push(path.join(entry, 'pnpm.exe'));
    candidates.push(path.join(entry, 'node_modules', 'pnpm', 'pnpm.exe'));
    candidates.push(path.join(entry, 'pnpm.cjs'));
    candidates.push(path.join(entry, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
  }
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'pnpm', 'pnpm.exe'));
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
  }

  for (const candidate of [...new Set(candidates)]) {
    if (!existsSync(candidate)) continue;
    if (candidate.toLowerCase().endsWith('.cjs')) {
      return Object.freeze({ executable: process.execPath, prefixArgs: [candidate], shell: false });
    }
    return Object.freeze({ executable: candidate, prefixArgs: [], shell: false });
  }
  return Object.freeze({ executable: 'pnpm.cmd', prefixArgs: [], shell: true });
}

export function isPnpmCommand(value) {
  return /(?:^|[\\/])pnpm(?:\.cmd)?$/iu.test(value) || value === 'pnpm';
}
