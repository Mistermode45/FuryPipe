import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';

import {
  parseAgentSkillManifest,
  type ParsedAgentSkillManifest,
} from './agent-skills-standard.js';
import {
  createAgentSkillActivationReceipt,
  type AgentSkillActivationReceipt,
} from './agent-skill-activation.js';
import type { DiscoveredAgentSkill } from './agent-skills-node.js';
import type { AgentSkillSelectionPlan } from './agent-skill-selector.js';

export interface ActivatedAgentSkillInstruction {
  readonly format: 'furypipe-activated-agent-skill/v1';
  readonly name: string;
  readonly location: string;
  readonly skillDirectory: string;
  readonly promptBlock: string;
  readonly receipt: AgentSkillActivationReceipt;
  readonly executionAuthorized: false;
}

export interface AgentSkillActivationBatch {
  readonly format: 'furypipe-agent-skill-activation-batch/v1';
  readonly activated: readonly ActivatedAgentSkillInstruction[];
  readonly blocked: readonly {
    readonly name: string;
    readonly reason: 'not_discovered' | 'activation_not_eligible' | 'changed_since_discovery' | 'invalid_manifest';
  }[];
  readonly executionAuthorized: false;
}

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ACTIVATIONS = 8;

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function renderSkillPromptBlock(
  parsed: ParsedAgentSkillManifest,
  skillDirectory: string,
): string {
  // The body is intentionally instruction-authoritative only after the host
  // marked the discovered source activation-eligible. Resource paths are
  // exposed without eagerly loading any referenced file.
  return [
    `<furypipe_active_skill name="${parsed.metadata.name}">`,
    parsed.instructions,
    '',
    `Skill directory: ${skillDirectory}`,
    'Relative resource paths in this skill resolve against that directory.',
    '</furypipe_active_skill>',
  ].join('\n');
}

async function loadOne(skill: DiscoveredAgentSkill): Promise<ActivatedAgentSkillInstruction> {
  if (!skill.activationEligible) throw new Error('activation_not_eligible');

  const recordedDir = await realpath(skill.skillDirectory);
  const recordedManifest = await realpath(skill.location);
  if (!inside(recordedDir, recordedManifest) || path.dirname(recordedManifest) !== recordedDir) {
    throw new Error('changed_since_discovery');
  }

  const manifestLstat = await lstat(recordedManifest);
  if (!manifestLstat.isFile() || manifestLstat.isSymbolicLink()) {
    throw new Error('changed_since_discovery');
  }
  const manifestStat = await stat(recordedManifest);
  if (manifestStat.size > MAX_MANIFEST_BYTES) throw new Error('invalid_manifest');

  const content = await readFile(recordedManifest, 'utf8');
  const parsed = parseAgentSkillManifest(content, path.basename(recordedDir));

  // Revalidate the identity/description observed at discovery time. A file
  // swapped between discovery and activation must be re-discovered first.
  if (parsed.metadata.name !== skill.name || parsed.metadata.description !== skill.description) {
    throw new Error('changed_since_discovery');
  }

  const receipt = await createAgentSkillActivationReceipt(parsed.metadata, parsed.instructions);
  return Object.freeze({
    format: 'furypipe-activated-agent-skill/v1',
    name: skill.name,
    location: recordedManifest,
    skillDirectory: recordedDir,
    promptBlock: renderSkillPromptBlock(parsed, recordedDir),
    receipt,
    executionAuthorized: false,
  });
}

function activationFailureReason(error: unknown): AgentSkillActivationBatch['blocked'][number]['reason'] {
  const message = error instanceof Error ? error.message : '';
  if (message === 'activation_not_eligible') return 'activation_not_eligible';
  if (message === 'changed_since_discovery') return 'changed_since_discovery';
  return 'invalid_manifest';
}

/**
 * Activate only the names selected by a prior selection plan.
 *
 * This reads SKILL.md instruction bodies but never reads/executes bundled
 * scripts, references or assets and never creates an execution receipt.
 */
export async function activateSelectedAgentSkillsNode(
  plan: AgentSkillSelectionPlan,
  discovered: readonly DiscoveredAgentSkill[],
): Promise<AgentSkillActivationBatch> {
  if (!plan || plan.format !== 'furypipe-agent-skill-selection/v1') {
    throw new TypeError('Agent Skill activation requires a selection plan');
  }
  if (plan.selected.length > MAX_ACTIVATIONS) throw new Error('Agent Skill activation selection exceeds its bound');

  const byName = new Map(discovered.map((skill) => [skill.name, skill] as const));
  const activated: ActivatedAgentSkillInstruction[] = [];
  const blocked: Array<AgentSkillActivationBatch['blocked'][number]> = [];

  for (const selected of plan.selected) {
    const skill = byName.get(selected.name);
    if (!skill) {
      blocked.push(Object.freeze({ name: selected.name, reason: 'not_discovered' }));
      continue;
    }
    try {
      activated.push(await loadOne(skill));
    } catch (error) {
      blocked.push(Object.freeze({
        name: selected.name,
        reason: activationFailureReason(error),
      }));
    }
  }

  return Object.freeze({
    format: 'furypipe-agent-skill-activation-batch/v1',
    activated: Object.freeze(activated),
    blocked: Object.freeze(blocked),
    executionAuthorized: false,
  });
}
