import { open, readdir, realpath, stat, lstat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  inspectAgentSkillMetadata,
  type AgentSkillStandardMetadata,
} from './agent-skills-standard.js';

export type AgentSkillDiscoveryScope = 'configured' | 'project' | 'user';

export interface AgentSkillConfiguredRoot {
  readonly path: string;
  /**
   * Trust applies only to loading instruction text from this root.
   * It never authorizes bundled scripts, tools, MCP, network, or writes.
   */
  readonly trustedForInstructions?: boolean;
}

export interface AgentSkillDiscoveryOptions {
  readonly projectRoot?: string;
  readonly homeDir?: string;
  readonly projectTrustedForInstructions?: boolean;
  readonly configuredRoots?: readonly AgentSkillConfiguredRoot[];
  readonly maxSkills?: number;
}

export interface DiscoveredAgentSkill {
  readonly format: 'furypipe-discovered-agent-skill/v1';
  readonly name: string;
  readonly description: string;
  readonly metadata: AgentSkillStandardMetadata;
  readonly scope: AgentSkillDiscoveryScope;
  readonly location: string;
  readonly skillDirectory: string;
  readonly activationEligible: boolean;
  /** Instruction activation only. Script/tool execution authority is always false here. */
  readonly executionAuthorized: false;
  readonly sourceRoot: string;
}

export type AgentSkillDiscoveryDiagnosticCode =
  | 'root_unavailable'
  | 'invalid_manifest'
  | 'manifest_too_large'
  | 'symlink_skipped'
  | 'path_escape_blocked'
  | 'name_collision_shadowed'
  | 'skill_limit_reached';

export interface AgentSkillDiscoveryDiagnostic {
  readonly code: AgentSkillDiscoveryDiagnosticCode;
  readonly path: string;
  readonly detail?: string;
}

export interface AgentSkillDiscoveryResult {
  readonly format: 'furypipe-agent-skill-discovery/v1';
  readonly skills: readonly DiscoveredAgentSkill[];
  readonly diagnostics: readonly AgentSkillDiscoveryDiagnostic[];
  readonly rootsScanned: readonly string[];
  readonly executionAuthorized: false;
}

interface RootCandidate {
  readonly path: string;
  readonly scope: AgentSkillDiscoveryScope;
  readonly activationEligible: boolean;
  readonly rank: number;
}

const MAX_SKILLS_DEFAULT = 512;
const MAX_SKILLS_HARD = 2_000;
const MAX_MANIFEST_BYTES = 256 * 1024;
const DISCOVERY_PREFIX_BYTES = 17 * 1024;
const MAX_CONFIGURED_ROOTS = 32;

function boundedMaxSkills(value: number | undefined): number {
  if (value === undefined) return MAX_SKILLS_DEFAULT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SKILLS_HARD) {
    throw new RangeError(`maxSkills must be between 1 and ${MAX_SKILLS_HARD}`);
  }
  return value;
}

function normalizeRoot(value: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new Error('Agent Skill discovery root is invalid');
  }
  return path.resolve(value);
}

function rootCandidates(options: AgentSkillDiscoveryOptions): readonly RootCandidate[] {
  const projectRoot = normalizeRoot(options.projectRoot ?? process.cwd());
  const homeDir = normalizeRoot(options.homeDir ?? os.homedir());
  const configured = options.configuredRoots ?? [];
  if (!Array.isArray(configured) || configured.length > MAX_CONFIGURED_ROOTS) {
    throw new Error(`configuredRoots accepts at most ${MAX_CONFIGURED_ROOTS} roots`);
  }

  const roots: RootCandidate[] = [];
  let rank = 10_000;

  // Explicit operator configuration wins deterministic collisions.
  for (const entry of configured) {
    if (!entry || typeof entry !== 'object') throw new Error('configured Agent Skill root is invalid');
    roots.push(Object.freeze({
      path: normalizeRoot(entry.path),
      scope: 'configured',
      activationEligible: entry.trustedForInstructions === true,
      rank: rank--,
    }));
  }

  const projectTrusted = options.projectTrustedForInstructions === true;
  for (const relative of [
    ['.furypipe', 'skills'],
    ['.agents', 'skills'],
    ['.claude', 'skills'],
    ['.github', 'skills'],
  ] as const) {
    roots.push(Object.freeze({
      path: path.join(projectRoot, ...relative),
      scope: 'project',
      activationEligible: projectTrusted,
      rank: rank--,
    }));
  }

  for (const relative of [
    ['.furypipe', 'skills'],
    ['.agents', 'skills'],
    ['.claude', 'skills'],
  ] as const) {
    roots.push(Object.freeze({
      path: path.join(homeDir, ...relative),
      scope: 'user',
      activationEligible: true,
      rank: rank--,
    }));
  }

  // Duplicate physical path aliases are wasteful and make collision behavior
  // harder to explain. Preserve only the highest-ranked occurrence.
  const seen = new Set<string>();
  return Object.freeze(roots.filter((root) => {
    const key = process.platform === 'win32' ? root.path.toLowerCase() : root.path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function inside(rootReal: string, candidateReal: string): boolean {
  const relative = path.relative(rootReal, candidateReal);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function readMetadataPrefix(file: string): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(DISCOVERY_PREFIX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function detail(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown error';
  return message.slice(0, 512);
}

/**
 * Discover Agent Skills metadata from bounded, deterministic local roots.
 *
 * Security properties:
 * - scans one skill-directory level only;
 * - never follows symlink skill directories or SKILL.md files;
 * - verifies real paths remain inside the configured root;
 * - reads only a small frontmatter prefix during discovery;
 * - never loads scripts/references/assets;
 * - never grants execution authority.
 */
export async function discoverAgentSkillsNode(
  options: AgentSkillDiscoveryOptions = {},
): Promise<AgentSkillDiscoveryResult> {
  const maxSkills = boundedMaxSkills(options.maxSkills);
  const roots = rootCandidates(options);
  const diagnostics: AgentSkillDiscoveryDiagnostic[] = [];
  const selected = new Map<string, { readonly skill: DiscoveredAgentSkill; readonly rank: number }>();
  const rootsScanned: string[] = [];

  for (const root of roots) {
    let rootReal: string;
    let entries: Dirent[];
    try {
      rootReal = await realpath(root.path);
      entries = await readdir(rootReal, { withFileTypes: true });
      rootsScanned.push(root.path);
    } catch (error) {
      // Missing optional compatibility roots are normal and should not flood
      // diagnostics. Record only paths that exist but cannot be inspected.
      try {
        await lstat(root.path);
        diagnostics.push(Object.freeze({
          code: 'root_unavailable',
          path: root.path,
          detail: detail(error),
        }));
      } catch {
        // Optional root does not exist.
      }
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (selected.size >= maxSkills) {
        diagnostics.push(Object.freeze({
          code: 'skill_limit_reached',
          path: root.path,
          detail: `discovery stopped at maxSkills=${maxSkills}`,
        }));
        return Object.freeze({
          format: 'furypipe-agent-skill-discovery/v1',
          skills: Object.freeze([...selected.values()].map((item) => item.skill)),
          diagnostics: Object.freeze(diagnostics),
          rootsScanned: Object.freeze(rootsScanned),
          executionAuthorized: false,
        });
      }

      const skillDir = path.join(rootReal, entry.name);
      if (entry.isSymbolicLink()) {
        diagnostics.push(Object.freeze({ code: 'symlink_skipped', path: skillDir }));
        continue;
      }
      if (!entry.isDirectory()) continue;

      const manifest = path.join(skillDir, 'SKILL.md');
      let manifestStat;
      try {
        const dirReal = await realpath(skillDir);
        if (!inside(rootReal, dirReal)) {
          diagnostics.push(Object.freeze({ code: 'path_escape_blocked', path: skillDir }));
          continue;
        }

        const manifestLstat = await lstat(manifest);
        if (manifestLstat.isSymbolicLink()) {
          diagnostics.push(Object.freeze({ code: 'symlink_skipped', path: manifest }));
          continue;
        }
        if (!manifestLstat.isFile()) continue;

        const manifestReal = await realpath(manifest);
        if (!inside(rootReal, manifestReal)) {
          diagnostics.push(Object.freeze({ code: 'path_escape_blocked', path: manifest }));
          continue;
        }
        manifestStat = await stat(manifestReal);
        if (manifestStat.size > MAX_MANIFEST_BYTES) {
          diagnostics.push(Object.freeze({
            code: 'manifest_too_large',
            path: manifest,
            detail: `${manifestStat.size} bytes > ${MAX_MANIFEST_BYTES}`,
          }));
          continue;
        }

        const prefix = await readMetadataPrefix(manifestReal);
        const metadata = inspectAgentSkillMetadata(prefix, entry.name);
        const skill: DiscoveredAgentSkill = Object.freeze({
          format: 'furypipe-discovered-agent-skill/v1',
          name: metadata.name,
          description: metadata.description,
          metadata,
          scope: root.scope,
          location: manifestReal,
          skillDirectory: dirReal,
          activationEligible: root.activationEligible,
          executionAuthorized: false,
          sourceRoot: root.path,
        });

        const prior = selected.get(skill.name);
        if (prior === undefined) {
          selected.set(skill.name, { skill, rank: root.rank });
        } else if (root.rank > prior.rank) {
          diagnostics.push(Object.freeze({
            code: 'name_collision_shadowed',
            path: prior.skill.location,
            detail: `shadowed by higher-precedence ${skill.location}`,
          }));
          selected.set(skill.name, { skill, rank: root.rank });
        } else {
          diagnostics.push(Object.freeze({
            code: 'name_collision_shadowed',
            path: skill.location,
            detail: `shadowed by higher-precedence ${prior.skill.location}`,
          }));
        }
      } catch (error) {
        // Missing SKILL.md means the directory simply is not a skill. Other
        // failures remain visible without leaking manifest contents.
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === 'ENOENT') continue;
        diagnostics.push(Object.freeze({
          code: 'invalid_manifest',
          path: manifest,
          detail: detail(error),
        }));
      }
    }
  }

  return Object.freeze({
    format: 'furypipe-agent-skill-discovery/v1',
    skills: Object.freeze(
      [...selected.values()]
        .map((item) => item.skill)
        .sort((a, b) => a.name.localeCompare(b.name)),
    ),
    diagnostics: Object.freeze(diagnostics),
    rootsScanned: Object.freeze(rootsScanned),
    executionAuthorized: false,
  });
}