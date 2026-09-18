import type { AgentSkillActivationReceipt } from './agent-skill-activation.js';
import type { ProxyTaskEnvelope } from './proxy-task-envelope.js';

export interface ProxyCapabilityInstructionBlock {
  readonly kind: 'agent-skill' | 'native-profile';
  readonly id: string;
  readonly text: string;
}

export interface ProxyCapabilityRuntimeEvidence {
  readonly format: 'furypipe-proxy-capability-evidence/v1';
  readonly selectedSkillIds: readonly string[];
  readonly activatedSkills: readonly AgentSkillActivationReceipt[];
  readonly blockedSkillIds: readonly string[];
  readonly executionAuthorized: false;
}

export interface ProxyCapabilityInstructionPlan {
  readonly format: 'furypipe-proxy-capability-instructions/v1';
  readonly blocks: readonly ProxyCapabilityInstructionBlock[];
  readonly evidence: ProxyCapabilityRuntimeEvidence;
}

export type ProxyCapabilityPlanner = (
  task: ProxyTaskEnvelope,
) => Promise<ProxyCapabilityInstructionPlan | undefined>;

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const MAX_BLOCKS = 8;
const MAX_BLOCK_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024;

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Validate host-produced capability instructions before they can enter a provider request. */
export function validateProxyCapabilityInstructionPlan(
  plan: ProxyCapabilityInstructionPlan,
): ProxyCapabilityInstructionPlan {
  if (!plan || plan.format !== 'furypipe-proxy-capability-instructions/v1'
    || !plan.evidence || plan.evidence.format !== 'furypipe-proxy-capability-evidence/v1'
    || plan.evidence.executionAuthorized !== false) {
    throw new Error('proxy capability instruction plan is invalid');
  }
  if (!Array.isArray(plan.blocks) || plan.blocks.length > MAX_BLOCKS) {
    throw new Error('proxy capability instruction blocks exceed their bound');
  }

  let total = 0;
  const blockIds = new Set<string>();
  for (const block of plan.blocks) {
    if (!block || !['agent-skill', 'native-profile'].includes(block.kind)
      || typeof block.id !== 'string' || !ID.test(block.id)
      || blockIds.has(block.id)
      || typeof block.text !== 'string' || !block.text.trim() || block.text.includes('\0')) {
      throw new Error('proxy capability instruction block is invalid');
    }
    blockIds.add(block.id);
    const blockBytes = bytes(block.text);
    if (blockBytes > MAX_BLOCK_BYTES) throw new Error('proxy capability instruction block exceeds its byte bound');
    total += blockBytes;
    if (total > MAX_TOTAL_BYTES) throw new Error('proxy capability instructions exceed their total byte bound');
  }

  const selected = plan.evidence.selectedSkillIds;
  const activated = plan.evidence.activatedSkills;
  const blocked = plan.evidence.blockedSkillIds;
  if (!Array.isArray(selected) || selected.length > 64 || new Set(selected).size !== selected.length
    || selected.some((id) => typeof id !== 'string' || !ID.test(id))) {
    throw new Error('proxy selected skill evidence is invalid');
  }
  if (!Array.isArray(blocked) || blocked.length > 64 || new Set(blocked).size !== blocked.length
    || blocked.some((id) => typeof id !== 'string' || !ID.test(id))) {
    throw new Error('proxy blocked skill evidence is invalid');
  }
  if (!Array.isArray(activated) || activated.length > MAX_BLOCKS) {
    throw new Error('proxy activated skill evidence exceeds its bound');
  }
  for (const receipt of activated) {
    if (!receipt || receipt.format !== 'furypipe-agent-skill-activation/v1'
      || receipt.status !== 'activated' || receipt.executionAuthorized !== false
      || !ID.test(receipt.skillId)
      || !Number.isSafeInteger(receipt.instructionBytes) || receipt.instructionBytes < 1
      || !/^[0-9a-f]{64}$/u.test(receipt.instructionSha256)) {
      throw new Error('proxy activated skill receipt is invalid');
    }
  }

  return plan;
}
