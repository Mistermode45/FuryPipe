import { createHash } from 'node:crypto';

import {
  isGeneratedFuryCapabilitySelectionPlan,
  type FuryBlockedCapability,
  type FuryCapabilitySelectionPlan,
  type FurySelectedCapability,
} from './capability-autopilot.js';
import type {
  FuryAutopilotEffort,
  FuryAutopilotMcpCandidate,
  FuryInstructionProfileId,
} from './fury-autopilot.js';

export const FURY_REQUEST_BLUEPRINT_FORMAT = 'furypipe-request-blueprint/v1' as const;

export interface FuryRequestBlueprintInput {
  readonly objective: string;
  readonly profile: {
    readonly id: FuryInstructionProfileId;
    readonly label: string;
  };
  readonly effort: {
    readonly requested: FuryAutopilotEffort;
    readonly recommended: Exclude<FuryAutopilotEffort, 'auto'>;
    readonly effective: Exclude<FuryAutopilotEffort, 'auto'>;
    readonly reason: string;
  };
  readonly communicationStyle: 'STANDARD' | 'CAVEMAN';
  readonly contextMode: 'TEXT_FIRST' | 'VISUAL_COMPRESS_AUTO';
  readonly capabilitySelection: FuryCapabilitySelectionPlan;
  readonly instructionFacetIds: readonly string[];
  readonly instructionProfileIds: readonly string[];
  readonly qualityGates: readonly string[];
  readonly mcpSuggestions: readonly FuryAutopilotMcpCandidate[];
  readonly budgets: {
    readonly skillInstructionBytes: number;
    readonly systemPromptBytes: number;
  };
}

export interface FuryRequestBlueprint {
  readonly format: typeof FURY_REQUEST_BLUEPRINT_FORMAT;
  readonly objectiveDigestSha256: string;
  readonly routing: {
    readonly profile: FuryRequestBlueprintInput['profile'];
    readonly effort: FuryRequestBlueprintInput['effort'];
    readonly communicationStyle: FuryRequestBlueprintInput['communicationStyle'];
    readonly contextMode: FuryRequestBlueprintInput['contextMode'];
  };
  readonly capabilities: {
    readonly indexDigestSha256: string;
    readonly selectionDigestSha256: string;
    readonly selected: readonly FurySelectedCapability[];
    readonly blocked: readonly FuryBlockedCapability[];
    readonly authority: 'selection-only';
    readonly executionAuthority: false;
  };
  readonly instructions: {
    readonly facetIds: readonly string[];
    readonly profileIds: readonly string[];
    readonly qualityGates: readonly string[];
  };
  readonly mcp: {
    /**
     * Advisory candidates may require approval and are not equivalent to
     * Capability Autopilot selected/exposable capabilities.
     */
    readonly advisory: readonly FuryAutopilotMcpCandidate[];
    readonly executionAuthority: false;
  };
  readonly budgets: FuryRequestBlueprintInput['budgets'];
  readonly unresolved: readonly ('model' | 'agent' | 'tool')[];
  readonly authority: 'planning-only';
  readonly executionAuthorized: false;
}

const MAX_OBJECTIVE_CHARS = 64_000;
const MAX_LIST = 128;
const MAX_TEXT = 256;

function boundedList(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values) || values.length > MAX_LIST) {
    throw new RangeError(`${label} exceeds its bound`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (
      typeof value !== 'string'
      || value.length < 1
      || value.length > MAX_TEXT
      || /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      throw new TypeError(`${label} contains invalid text`);
    }
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return Object.freeze(out);
}

function boundedBytes(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 16 * 1024 * 1024) {
    throw new RangeError(`${label} is out of range`);
  }
  return value;
}

function objectiveDigest(objective: string): string {
  if (
    typeof objective !== 'string'
    || !objective.trim()
    || objective.length > MAX_OBJECTIVE_CHARS
    || objective.includes('\0')
  ) {
    throw new TypeError('request blueprint objective must be bounded non-empty text');
  }
  return createHash('sha256').update(objective.trim(), 'utf8').digest('hex');
}

/**
 * Build the explainable, non-authoritative request blueprint.
 *
 * The blueprint deliberately separates:
 * - selected capabilities (passed Capability Autopilot gates),
 * - blocked capabilities,
 * - advisory MCP candidates that may still need approval,
 * - unresolved decision families that have not yet converged on this surface.
 *
 * It never turns planning metadata into execution authority.
 */
export function createFuryRequestBlueprint(
  input: FuryRequestBlueprintInput,
): FuryRequestBlueprint {
  if (
    !isGeneratedFuryCapabilitySelectionPlan(input.capabilitySelection)
    || input.capabilitySelection.executionAuthority !== false
  ) {
    throw new TypeError('request blueprint requires a process-local selection-only capability plan');
  }
  const facetIds = boundedList(input.instructionFacetIds, 'instructionFacetIds');
  const profileIds = boundedList(input.instructionProfileIds, 'instructionProfileIds');
  const qualityGates = boundedList(input.qualityGates, 'qualityGates');
  const skillInstructionBytes = boundedBytes(input.budgets.skillInstructionBytes, 'skillInstructionBytes');
  const systemPromptBytes = boundedBytes(input.budgets.systemPromptBytes, 'systemPromptBytes');

  const selected = input.capabilitySelection.selected;
  const unresolved: Array<'model' | 'agent' | 'tool'> = [];
  if (!selected.some((item) => item.kind === 'model')) unresolved.push('model');
  // Agent capabilities are not represented in capability-index/v1 yet.
  unresolved.push('agent');
  if (!selected.some((item) => item.kind === 'mcp-tool')) unresolved.push('tool');

  return Object.freeze({
    format: FURY_REQUEST_BLUEPRINT_FORMAT,
    objectiveDigestSha256: objectiveDigest(input.objective),
    routing: Object.freeze({
      profile: Object.freeze({ ...input.profile }),
      effort: Object.freeze({ ...input.effort }),
      communicationStyle: input.communicationStyle,
      contextMode: input.contextMode,
    }),
    capabilities: Object.freeze({
      indexDigestSha256: input.capabilitySelection.indexDigestSha256,
      selectionDigestSha256: input.capabilitySelection.selectionDigestSha256,
      selected,
      blocked: input.capabilitySelection.blocked,
      authority: 'selection-only' as const,
      executionAuthority: false as const,
    }),
    instructions: Object.freeze({
      facetIds,
      profileIds,
      qualityGates,
    }),
    mcp: Object.freeze({
      advisory: Object.freeze([...input.mcpSuggestions]),
      executionAuthority: false as const,
    }),
    budgets: Object.freeze({
      skillInstructionBytes,
      systemPromptBytes,
    }),
    unresolved: Object.freeze(unresolved),
    authority: 'planning-only' as const,
    executionAuthorized: false as const,
  });
}
