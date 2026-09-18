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

export type AgentSkillActivationFailureDetail =
  | 'not_discovered'
  | 'activation_not_eligible'
  | 'path_changed'
  | 'not_regular_file'
  | 'manifest_too_large'
  | 'manifest_invalid'
  | 'identity_changed'
  | 'receipt_failed'
  | 'unknown';

export interface AgentSkillActivationBatch {
  readonly format: 'furypipe-agent-skill-activation-batch/v1';
  readonly activated: readonly ActivatedAgentSkillInstruction[];
  readonly blocked: readonly {
    readonly name: string;
    readonly reason: 'not_discovered' | 'activation_not_eligible' | 'changed_since_discovery' | 'invalid_manifest';
    /** Safe machine diagnostic; never includes SKILL.md content or raw exception text. */
    readonly detail: AgentSkillActivationFailureDetail;
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

class AgentSkillActivationError extends Error {
  constructor(
    readonly code: AgentSkillActivationFailureDetail,
    message: string,
  ) {
    super(message);
    this.name = 'AgentSkillActivationError';
  }
}

async function loadOne(skill: DiscoveredAgentSkill): Promise<ActivatedAgentSkillInstruction> {
  if (!skill.activationEligible) {
    throw new AgentSkillActivationError('activation_not_eligible', 'activation not eligible');
  }

  let recordedDir: string;
  let recordedManifest: string;
  try {
    recordedDir = await realpath(skill.skillDirectory);
    recordedManifest = await realpath(skill.location);
  } catch {
    throw new AgentSkillActivationError('path_changed', 'skill path changed since discovery');
  }
  if (!inside(recordedDir, recordedManifest) || path.dirname(recordedManifest) !== recordedDir) {
    throw new AgentSkillActivationError('path_changed', 'skill path changed since discovery');
  }

  let manifestLstat;
  try {
    manifestLstat = await lstat(recordedManifest);
  } catch {
    throw new AgentSkillActivationError('path_changed', 'skill path changed since discovery');
  }
  if (!manifestLstat.isFile() || manifestLstat.isSymbolicLink()) {
    throw new AgentSkillActivationError('not_regular_file', 'SKILL.md is no longer a regular file');
  }

  const manifestStat = await stat(recordedManifest);
  if (manifestStat.size > MAX_MANIFEST_BYTES) {
    throw new AgentSkillActivationError('manifest_too_large', 'SKILL.md exceeds activation size limit');
  }

  let parsed: ParsedAgentSkillManifest;
  try {
    const content = await readFile(recordedManifest, 'utf8');
    parsed = parseAgentSkillManifest(content, path.basename(recordedDir));
  } catch {
    throw new AgentSkillActivationError('manifest_invalid', 'SKILL.md failed activation validation');
  }

  // Revalidate the identity/description observed at discovery time. A file
  // swapped between discovery and activation must be re-discovered first.
  if (parsed.metadata.name !== skill.name || parsed.metadata.description !== skill.description) {
    throw new AgentSkillActivationError('identity_changed', 'skill identity changed since discovery');
  }

  let receipt: AgentSkillActivationReceipt;
  try {
    receipt = await createAgentSkillActivationReceipt(parsed.metadata, parsed.instructions);
  } catch {
    throw new AgentSkillActivationError('receipt_failed', 'activation receipt creation failed');
  }

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

function activationFailure(error: unknown): {
  readonly reason: AgentSkillActivationBatch['blocked'][number]['reason'];
  readonly detail: AgentSkillActivationFailureDetail;
} {
  const detail = error instanceof AgentSkillActivationError ? error.code : 'unknown';
  if (detail === 'activation_not_eligible') {
    return { reason: 'activation_not_eligible', detail };
  }
  if (detail === 'path_changed' || detail === 'not_regular_file' || detail === 'identity_changed') {
    return { reason: 'changed_since_discovery', detail };
  }
  return { reason: 'invalid_manifest', detail };
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
      blocked.push(Object.freeze({
        name: selected.name,
        reason: 'not_discovered',
        detail: 'not_discovered',
      }));
      continue;
    }
    try {
      activated.push(await loadOne(skill));
    } catch (error) {
      const failure = activationFailure(error);
      blocked.push(Object.freeze({
        name: selected.name,
        reason: failure.reason,
        detail: failure.detail,
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