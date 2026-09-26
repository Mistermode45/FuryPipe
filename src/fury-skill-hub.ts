// FurySkillHub — governed lifecycle over discovered Agent Skills.
//
// Discovery stays in agent-skills-node (bounded, symlink-safe, trust-scoped).
// The hub adds what an operator needs to run skills across harnesses:
//   * a content checksum per skill (every file, sorted, bounded);
//   * enable / disable / pin, where a pinned skill whose content no longer
//     matches the pin is blocked from auto-selection;
//   * governance (DRAFT_ONLY / ASK_BEFORE_WRITE / AUTO_APPLY_LOW_RISK / LOCKED)
//     and type (STATIC / GENERATED / EVOLVING);
//   * install from a local directory (no symlinks, bounded files), with a
//     version snapshot before every overwrite, rollback and compare;
//   * usage stats and runtime-compatible auto-selection.
// Nothing here executes a skill script: selection is instruction routing only.
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { selectAgentSkillsForTask, type AgentSkillSelectionPlan } from './agent-skill-selector.js';
import { discoverAgentSkillsNode, type AgentSkillDiscoveryOptions, type DiscoveredAgentSkill } from './agent-skills-node.js';
import { parseAgentSkillManifest } from './agent-skills-standard.js';
import { createAgentSkillActivationReceipt, type AgentSkillActivationReceipt } from './agent-skill-activation.js';
import { FURY_HARNESS_REGISTRY } from './fury-harness-hub.js';

export const FURY_SKILL_GOVERNANCE = Object.freeze(['DRAFT_ONLY', 'ASK_BEFORE_WRITE', 'AUTO_APPLY_LOW_RISK', 'LOCKED'] as const);
export type FurySkillGovernance = typeof FURY_SKILL_GOVERNANCE[number];
export const FURY_SKILL_TYPES = Object.freeze(['STATIC', 'GENERATED', 'EVOLVING'] as const);
export type FurySkillType = typeof FURY_SKILL_TYPES[number];

const STATE_FORMAT = 'furypipe-skill-hub-state/v1';
const MAX_FILES = 128;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_ACTIVE_INSTRUCTION_BYTES = 48 * 1024;
const MAX_SINGLE_ACTIVE_INSTRUCTION_BYTES = 24 * 1024;
const MAX_DEPTH = 6;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const FURY_KNOWN_HARNESSES = new Set(FURY_HARNESS_REGISTRY.map((h) => h.id));

export class FurySkillHubError extends Error {
  override readonly name = 'FurySkillHubError';
}

interface SkillState {
  enabled: boolean;
  pinned?: string;
  governance: FurySkillGovernance;
  uses: number;
  successes: number;
  failures: number;
  lastUsedAt?: number;
}

interface HubState {
  format: typeof STATE_FORMAT;
  skills: Record<string, SkillState>;
}

export interface FurySkillEntry {
  readonly name: string;
  readonly description: string;
  readonly scope: DiscoveredAgentSkill['scope'];
  readonly location: string;
  readonly checksum: string;
  readonly version: string;
  readonly author: string;
  readonly license: string;
  readonly trust: 'trusted-instructions' | 'untrusted';
  /** Harness ids from `compatibility`/`metadata.harnesses`; empty = any. */
  readonly compatibleHarnesses: readonly string[];
  readonly type: FurySkillType;
  readonly enabled: boolean;
  readonly pinned?: string;
  readonly pinMismatch: boolean;
  readonly governance: FurySkillGovernance;
  readonly stats: { readonly uses: number; readonly successes: number; readonly failures: number; readonly lastUsedAt?: number };
  readonly versions: readonly string[];
  readonly executionAuthorized: false;
}

export interface FurySkillSelection {
  readonly plan: AgentSkillSelectionPlan;
  readonly excluded: readonly { readonly name: string; readonly reason: 'disabled' | 'pin-mismatch' | 'incompatible-runtime' | 'untrusted' }[];
}

export interface FurySkillCompare {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

export interface FurySkillActivation {
  readonly name: string;
  readonly instructions: string;
  readonly checksum: string;
  readonly allowedTools?: string;
  readonly receipt: AgentSkillActivationReceipt;
  readonly executionAuthorized: false;
}

interface FileSet {
  readonly files: ReadonlyMap<string, Buffer>;
  readonly checksum: string;
}

/** Read a skill directory into memory: regular files only, no symlinks, bounded. */
async function readSkillFiles(root: string): Promise<FileSet> {
  const files = new Map<string, Buffer>();
  let total = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) throw new FurySkillHubError(`skill directory nests deeper than ${MAX_DEPTH}`);
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw new FurySkillHubError(`symlink refused: ${path.relative(root, full)}`);
      if (info.isDirectory()) await walk(full, depth + 1);
      else if (info.isFile()) {
        if (files.size >= MAX_FILES) throw new FurySkillHubError(`skill exceeds ${MAX_FILES} files`);
        total += info.size;
        if (total > MAX_TOTAL_BYTES) throw new FurySkillHubError(`skill exceeds ${MAX_TOTAL_BYTES} bytes`);
        files.set(path.relative(root, full).split(path.sep).join('/'), await readFile(full));
      } else throw new FurySkillHubError(`special file refused: ${path.relative(root, full)}`);
    }
  };
  await walk(root, 0);
  const hash = createHash('sha256');
  for (const [rel, content] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    hash.update(`${rel}\0${content.byteLength}\0`).update(content);
  }
  return { files, checksum: hash.digest('hex') };
}

function listField(value: string | undefined): string[] {
  return (value ?? '').split(/[\s,]+/u).map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9][a-z0-9-]*$/u.test(s));
}

export function createFurySkillHub(options: {
  readonly projectRoot: string;
  /** Directory for hub state and version snapshots (e.g. <project>/.furypipe/skill-hub). */
  readonly stateDir: string;
  readonly homeDir?: string;
  readonly projectTrustedForInstructions?: boolean;
  readonly configuredRoots?: AgentSkillDiscoveryOptions['configuredRoots'];
  readonly now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const statePath = path.join(options.stateDir, 'state.json');
  const versionsDir = path.join(options.stateDir, 'versions');
  const installRoot = path.join(options.projectRoot, '.furypipe', 'skills');

  const load = async (): Promise<HubState> => {
    try {
      const parsed = JSON.parse(await readFile(statePath, 'utf8')) as HubState;
      if (parsed?.format !== STATE_FORMAT || typeof parsed.skills !== 'object') throw new FurySkillHubError('skill hub state has an unknown format');
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { format: STATE_FORMAT, skills: {} };
      throw error;
    }
  };
  const save = async (state: HubState): Promise<void> => {
    await mkdir(options.stateDir, { recursive: true });
    const tmp = `${statePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, statePath);
  };
  const stateOf = (state: HubState, name: string): SkillState => (state.skills[name] ??= { enabled: true, governance: 'ASK_BEFORE_WRITE', uses: 0, successes: 0, failures: 0 });
  const assertName = (name: unknown): string => {
    if (typeof name !== 'string' || !NAME.test(name) || name.length > 64) throw new FurySkillHubError('invalid skill name');
    return name;
  };
  const versionsOf = async (name: string): Promise<string[]> => {
    try {
      return (await readdir(path.join(versionsDir, name))).filter((d) => DIGEST.test(d)).sort();
    } catch {
      return [];
    }
  };

  const discover = () => discoverAgentSkillsNode({
    projectRoot: options.projectRoot,
    ...(options.homeDir ? { homeDir: options.homeDir } : {}),
    ...(options.projectTrustedForInstructions !== undefined ? { projectTrustedForInstructions: options.projectTrustedForInstructions } : {}),
    ...(options.configuredRoots ? { configuredRoots: options.configuredRoots } : {}),
  });

  const list = async (): Promise<{ readonly skills: readonly FurySkillEntry[]; readonly diagnostics: readonly { code: string; path: string }[] }> => {
    const [discovery, state] = await Promise.all([discover(), load()]);
    const skills: FurySkillEntry[] = [];
    const diagnostics: { code: string; path: string }[] = discovery.diagnostics.map((d) => ({ code: d.code, path: d.path }));
    for (const skill of discovery.skills) {
      let checksum: string;
      try {
        checksum = (await readSkillFiles(skill.skillDirectory)).checksum;
      } catch (error) {
        diagnostics.push({ code: 'checksum_failed', path: `${skill.skillDirectory}: ${(error as Error).message}` });
        continue;
      }
      const s = state.skills[skill.name];
      const meta = skill.metadata.metadata ?? {};
      const type = (meta['furypipe-type'] ?? '').toUpperCase();
      skills.push(Object.freeze({
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        location: skill.location,
        checksum,
        version: meta.version ?? 'unversioned',
        author: meta.author ?? 'unknown',
        license: skill.metadata.license ?? 'unspecified',
        trust: skill.activationEligible ? 'trusted-instructions' : 'untrusted',
        compatibleHarnesses: Object.freeze([...new Set([...listField(meta.harnesses), ...listField(skill.metadata.compatibility).filter((h) => FURY_KNOWN_HARNESSES.has(h))])]),
        type: (FURY_SKILL_TYPES as readonly string[]).includes(type) ? type as FurySkillType : 'STATIC',
        enabled: s?.enabled ?? true,
        ...(s?.pinned ? { pinned: s.pinned } : {}),
        pinMismatch: Boolean(s?.pinned && s.pinned !== checksum),
        governance: s?.governance ?? 'ASK_BEFORE_WRITE',
        stats: Object.freeze({ uses: s?.uses ?? 0, successes: s?.successes ?? 0, failures: s?.failures ?? 0, ...(s?.lastUsedAt !== undefined ? { lastUsedAt: s.lastUsedAt } : {}) }),
        versions: Object.freeze(await versionsOf(skill.name)),
        executionAuthorized: false,
      }));
    }
    return Object.freeze({ skills: Object.freeze(skills), diagnostics: Object.freeze(diagnostics) });
  };

  const find = async (name: string): Promise<FurySkillEntry> => {
    const entry = (await list()).skills.find((s) => s.name === name);
    if (!entry) throw new FurySkillHubError(`unknown skill: ${name}`);
    return entry;
  };

  const mutate = async (name: string, change: (s: SkillState, entry: FurySkillEntry) => void): Promise<FurySkillEntry> => {
    const entry = await find(assertName(name));
    const state = await load();
    change(stateOf(state, name), entry);
    await save(state);
    return find(name);
  };

  const snapshot = async (name: string, dir: string): Promise<string> => {
    const { checksum } = await readSkillFiles(dir);
    const target = path.join(versionsDir, name, checksum);
    try {
      await lstat(target);
    } catch {
      await mkdir(path.dirname(target), { recursive: true });
      await cp(dir, target, { recursive: true, errorOnExist: false, verbatimSymlinks: true });
    }
    return checksum;
  };

  const lockedGuard = async (name: string) => {
    const s = (await load()).skills[name];
    if (s?.governance === 'LOCKED') throw new FurySkillHubError(`skill ${name} is LOCKED: unlock it before changing its content`);
  };

  const replaceInstalled = async (name: string, source: FileSet): Promise<void> => {
    const dest = path.join(installRoot, name);
    try {
      if ((await lstat(dest)).isDirectory()) await snapshot(name, dest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const staging = path.join(installRoot, `.${name}.staging-${process.pid}`);
    await rm(staging, { recursive: true, force: true });
    for (const [rel, content] of source.files) {
      const file = path.join(staging, ...rel.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, { mode: 0o644 });
    }
    await rm(dest, { recursive: true, force: true });
    await rename(staging, dest);
  };

  return Object.freeze({
    list,
    setEnabled: (name: string, enabled: boolean) => mutate(name, (s) => { s.enabled = enabled; }),
    /** Pin the current content; a later content change blocks auto-selection until re-pinned. */
    pin: (name: string) => mutate(name, (s, entry) => { s.pinned = entry.checksum; }),
    unpin: (name: string) => mutate(name, (s) => { delete s.pinned; }),
    setGovernance: async (name: string, governance: FurySkillGovernance) => {
      if (!(FURY_SKILL_GOVERNANCE as readonly string[]).includes(governance)) throw new FurySkillHubError('unknown governance level');
      return mutate(name, (s) => { s.governance = governance; });
    },
    recordUse: (name: string, outcome: 'success' | 'failure') => mutate(name, (s) => {
      s.uses += 1;
      if (outcome === 'success') s.successes += 1;
      else s.failures += 1;
      s.lastUsedAt = now();
    }),
    /** Install (or update) a skill from a local directory into <project>/.furypipe/skills/<name>. */
    async install(sourceDir: string): Promise<FurySkillEntry> {
      const source = await readSkillFiles(path.resolve(sourceDir));
      const manifest = source.files.get('SKILL.md');
      if (!manifest) throw new FurySkillHubError('source has no SKILL.md');
      let parsedName: string;
      try {
        parsedName = parseAgentSkillManifest(manifest.toString('utf8'), path.basename(path.resolve(sourceDir))).metadata.name;
      } catch (error) {
        throw new FurySkillHubError(`invalid SKILL.md: ${(error as Error).message}`);
      }
      const name = assertName(parsedName);
      await lockedGuard(name);
      await replaceInstalled(name, source);
      await snapshot(name, path.join(installRoot, name));
      return find(name);
    },
    versions: async (name: string) => versionsOf(assertName(name)),
    /** Restore a snapshotted version (the current content is snapshotted first). */
    async rollback(name: string, checksum: string): Promise<FurySkillEntry> {
      assertName(name);
      if (!DIGEST.test(checksum) || !(await versionsOf(name)).includes(checksum)) throw new FurySkillHubError(`no snapshot ${checksum.slice(0, 12)} for ${name}`);
      await lockedGuard(name);
      const source = await readSkillFiles(path.join(versionsDir, name, checksum));
      if (source.checksum !== checksum) throw new FurySkillHubError('snapshot content does not match its checksum');
      await replaceInstalled(name, source);
      return find(name);
    },
    async compare(name: string, a: string, b: string): Promise<FurySkillCompare> {
      assertName(name);
      const known = await versionsOf(name);
      if (![a, b].every((v) => DIGEST.test(v) && known.includes(v))) throw new FurySkillHubError('unknown version');
      const [x, y] = await Promise.all([readSkillFiles(path.join(versionsDir, name, a)), readSkillFiles(path.join(versionsDir, name, b))]);
      const added = [...y.files.keys()].filter((f) => !x.files.has(f)).sort();
      const removed = [...x.files.keys()].filter((f) => !y.files.has(f)).sort();
      const changed = [...x.files.keys()].filter((f) => y.files.has(f) && !x.files.get(f)!.equals(y.files.get(f)!)).sort();
      return Object.freeze({ added, removed, changed });
    },
    /**
     * Load only the validated SKILL.md bodies selected for one turn.
     *
     * This is progressive instruction activation, not capability activation:
     * allowed-tools remains metadata and executionAuthorized stays false.
     */
    async activateSelection(names: readonly string[], select: { readonly harnessId?: string } = {}): Promise<readonly FurySkillActivation[]> {
      if (!Array.isArray(names) || names.length > 8) throw new FurySkillHubError('at most 8 skills may be activated for one turn');
      const requested = [...new Set(names.map((name) => assertName(name)))];
      const entries = (await list()).skills;
      const activated: FurySkillActivation[] = [];
      let totalBytes = 0;
      for (const name of requested) {
        const entry = entries.find((candidate) => candidate.name === name);
        if (!entry) throw new FurySkillHubError(`unknown skill: ${name}`);
        if (!entry.enabled) throw new FurySkillHubError(`skill ${name} is disabled`);
        if (entry.pinMismatch) throw new FurySkillHubError(`skill ${name} changed after it was pinned`);
        if (entry.trust !== 'trusted-instructions') throw new FurySkillHubError(`skill ${name} is not trusted for instruction activation`);
        if (select.harnessId && entry.compatibleHarnesses.length && !entry.compatibleHarnesses.includes(select.harnessId)) {
          throw new FurySkillHubError(`skill ${name} is not compatible with runtime ${select.harnessId}`);
        }
        const raw = await readFile(entry.location, 'utf8');
        const manifest = parseAgentSkillManifest(raw, name);
        const bytes = Buffer.byteLength(manifest.instructions, 'utf8');
        if (bytes > MAX_SINGLE_ACTIVE_INSTRUCTION_BYTES) throw new FurySkillHubError(`skill ${name} instructions exceed the per-skill activation bound`);
        totalBytes += bytes;
        if (totalBytes > MAX_ACTIVE_INSTRUCTION_BYTES) throw new FurySkillHubError('activated skill instructions exceed the per-turn bound');
        const receipt = await createAgentSkillActivationReceipt(manifest.metadata, manifest.instructions);
        activated.push(Object.freeze({
          name,
          instructions: manifest.instructions,
          checksum: entry.checksum,
          ...(manifest.metadata.allowedTools ? { allowedTools: manifest.metadata.allowedTools } : {}),
          receipt,
          executionAuthorized: false,
        }));
      }
      return Object.freeze(activated);
    },
    /** Route an objective to skills that are enabled, trusted, pin-consistent and runtime-compatible. */
    async autoSelect(objective: string, select: { readonly harnessId?: string; readonly maxActive?: number } = {}): Promise<FurySkillSelection> {
      const { skills } = await list();
      const excluded: FurySkillSelection['excluded'][number][] = [];
      const candidates = skills.map((s) => {
        let reason: FurySkillSelection['excluded'][number]['reason'] | undefined;
        if (!s.enabled) reason = 'disabled';
        else if (s.pinMismatch) reason = 'pin-mismatch';
        else if (select.harnessId && s.compatibleHarnesses.length && !s.compatibleHarnesses.includes(select.harnessId)) reason = 'incompatible-runtime';
        else if (s.trust !== 'trusted-instructions') reason = 'untrusted';
        if (reason) excluded.push(Object.freeze({ name: s.name, reason }));
        return { name: s.name, description: s.description, activationEligible: !reason };
      });
      const plan = selectAgentSkillsForTask(objective, candidates, select.maxActive !== undefined ? { maxActive: select.maxActive } : {});
      return Object.freeze({ plan, excluded: Object.freeze(excluded) });
    },
  });
}

export type FurySkillHub = ReturnType<typeof createFurySkillHub>;
