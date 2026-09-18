import type { AgentSkillStandardMetadata } from './agent-skills-standard.js';

export interface AgentSkillActivationReceipt {
  readonly format: 'furypipe-agent-skill-activation/v1';
  readonly skillId: string;
  readonly status: 'activated';
  readonly instructionBytes: number;
  readonly instructionSha256: string;
  readonly executionAuthorized: false;
}

const MAX_INSTRUCTION_BYTES = 256 * 1024;

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Proof that an instruction skill body was loaded for a run.
 *
 * Activation is intentionally not execution and never grants tool/script
 * authority. A separate AgentCapabilityExecutionReceipt is required when a
 * real executable callback or MCP method runs.
 */
export async function createAgentSkillActivationReceipt(
  metadata: AgentSkillStandardMetadata,
  instructions: string,
): Promise<AgentSkillActivationReceipt> {
  if (!metadata || typeof metadata.name !== 'string' || !metadata.name) {
    throw new TypeError('skill activation requires validated metadata');
  }
  if (typeof instructions !== 'string' || !instructions.trim()) {
    throw new TypeError('skill activation requires instruction text');
  }
  const bytes = new TextEncoder().encode(instructions);
  if (bytes.byteLength > MAX_INSTRUCTION_BYTES) {
    throw new Error('skill activation instructions exceed the bounded size');
  }
  return Object.freeze({
    format: 'furypipe-agent-skill-activation/v1',
    skillId: metadata.name,
    status: 'activated',
    instructionBytes: bytes.byteLength,
    instructionSha256: await sha256Hex(bytes),
    executionAuthorized: false,
  });
}
