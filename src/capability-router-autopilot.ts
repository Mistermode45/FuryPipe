import {
  isGeneratedFuryCapabilityIndex,
  type FuryCapabilityIndex,
} from './capability-index.js';
import {
  selectFuryCapabilitiesForTask,
  type FuryCapabilityExplicitRequest,
  type FuryCapabilitySelectionOptions,
} from './capability-autopilot.js';
import {
  isGeneratedFuryCapabilitySignalRegistry,
  type FuryCapabilitySignalRegistry,
} from './capability-signals.js';
import type {
  FuryUniversalCapabilityAnalysis,
  FuryUniversalCapabilityAnalyzer,
  FuryUniversalCapabilityAnalyzerInput,
} from './capability-router.js';

export const FURY_CAPABILITY_ROUTER_AUTOPILOT_DOMAIN =
  'capability-index-autopilot' as const;

export interface FuryCapabilityRouterAutopilotOptions {
  readonly index: FuryCapabilityIndex;
  readonly signals?: FuryCapabilitySignalRegistry;
  readonly explicitRequests?: readonly FuryCapabilityExplicitRequest[];
  readonly hostCompatibility?: readonly string[];
  readonly availablePermissions?: readonly string[];
  readonly requiredFamilies?: readonly string[];
  readonly selectionOptions?: FuryCapabilitySelectionOptions;
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)]);
}

/**
 * Bridges Capability Autopilot V2 into the existing Capability Router.
 *
 * The Capability Index remains routing metadata only. The Router immediately
 * re-resolves selected skill/plugin IDs against its current registered
 * inventories. A stale selection therefore fails closed instead of silently
 * becoming executable.
 *
 * MCP/model selections are intentionally not converted into automatic calls or
 * provider permits here. Their governed runtime lifecycles remain separate.
 */
export function createFuryCapabilityRouterAutopilot(
  options: FuryCapabilityRouterAutopilotOptions,
): FuryUniversalCapabilityAnalyzer {
  if (!options || typeof options !== 'object') {
    throw new TypeError('Capability Router Autopilot options are required');
  }
  if (!isGeneratedFuryCapabilityIndex(options.index)) {
    throw new TypeError(
      'Capability Router Autopilot requires a process-local FuryPipe capability index',
    );
  }
  if (
    options.signals !== undefined
    && !isGeneratedFuryCapabilitySignalRegistry(options.signals)
  ) {
    throw new TypeError(
      'Capability Router Autopilot requires a process-local FuryPipe signal registry',
    );
  }

  const index = options.index;
  const signals = options.signals;

  return Object.freeze({
    async analyze(
      input: FuryUniversalCapabilityAnalyzerInput,
    ): Promise<FuryUniversalCapabilityAnalysis> {
      const selection = selectFuryCapabilitiesForTask({
        objective: input.objective,
        index,
        ...(signals === undefined ? {} : { signals }),
        ...(options.explicitRequests === undefined
          ? {}
          : { explicitRequests: options.explicitRequests }),
        ...(options.hostCompatibility === undefined
          ? {}
          : { hostCompatibility: options.hostCompatibility }),
        ...(options.availablePermissions === undefined
          ? {}
          : { availablePermissions: options.availablePermissions }),
        ...(options.requiredFamilies === undefined
          ? {}
          : { requiredFamilies: options.requiredFamilies }),
        ...(options.selectionOptions === undefined
          ? {}
          : { options: options.selectionOptions }),
      });

      const availableSkills = new Map(
        input.availableSkills.map((skill) => [skill.id, skill] as const),
      );
      const availablePlugins = new Set(input.availablePluginIds);

      const preferredSkillIds: string[] = [];
      const requiredSkillCategories: FuryUniversalCapabilityAnalysis['requiredSkillCategories'][number][] = [];
      const pluginBundleIds: string[] = [];

      for (const selected of selection.selected) {
        if (selected.kind === 'skill') {
          const skill = availableSkills.get(selected.id);
          if (!skill) {
            throw new Error(
              'Capability Autopilot selected a stale skill not present in the current Capability Router inventory: '
                + selected.id,
            );
          }
          preferredSkillIds.push(selected.id);
          requiredSkillCategories.push(skill.category);
          continue;
        }

        if (selected.kind === 'plugin') {
          if (!availablePlugins.has(selected.id)) {
            throw new Error(
              'Capability Autopilot selected a stale plugin not present in the current Capability Router inventory: '
                + selected.id,
            );
          }
          pluginBundleIds.push(selected.id);
        }
      }

      return Object.freeze({
        domainId: FURY_CAPABILITY_ROUTER_AUTOPILOT_DOMAIN,
        requiredSkillCategories: unique(requiredSkillCategories),
        preferredSkillIds: unique(preferredSkillIds),
        pluginBundleIds: unique(pluginBundleIds),
      });
    },
  });
}
