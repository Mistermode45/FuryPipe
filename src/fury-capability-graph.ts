import { createHash } from 'node:crypto';

import {
  isGeneratedFuryRequestBlueprint,
  type FuryRequestBlueprint,
  type FuryRequestDecisionFamily,
} from './fury-request-blueprint.js';

export const FURY_CAPABILITY_GRAPH_FORMAT = 'furypipe-capability-graph/v1' as const;

export type FuryCapabilityGraphNodeKind =
  | 'request'
  | 'decision'
  | 'capability'
  | 'advisory'
  | 'blocked';

export type FuryCapabilityGraphEdgeKind =
  | 'routes'
  | 'selects'
  | 'configures'
  | 'advises'
  | 'blocks';

export interface FuryCapabilityGraphNode {
  readonly id: string;
  readonly kind: FuryCapabilityGraphNodeKind;
  readonly label: string;
  readonly family?: FuryRequestDecisionFamily;
  readonly capabilityKind?: string;
  readonly capabilityId?: string;
  readonly reason?: string;
  readonly executionAuthority: false;
}

export interface FuryCapabilityGraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: FuryCapabilityGraphEdgeKind;
  readonly executionAuthority: false;
}

export interface FuryCapabilityGraph {
  readonly format: typeof FURY_CAPABILITY_GRAPH_FORMAT;
  readonly requestDigestSha256: string;
  readonly selectionDigestSha256: string;
  readonly nodes: readonly FuryCapabilityGraphNode[];
  readonly edges: readonly FuryCapabilityGraphEdge[];
  readonly unresolved: FuryRequestBlueprint['unresolved'];
  readonly authority: 'visualization-only';
  readonly executionAuthorized: false;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function nodeId(prefix: string, value: string): string {
  return `${prefix}:${digest(value).slice(0, 24)}`;
}

/**
 * Build a bounded, explainable runtime capability graph from a process-local
 * request blueprint. This is a visualization/provenance projection only:
 * graph edges never grant execution authority.
 *
 * Repository/code relationships remain owned by FuryGraph. This module covers
 * request-routing relationships and is intentionally additive rather than a
 * replacement for the code graph.
 */
export function buildFuryCapabilityGraph(
  blueprint: FuryRequestBlueprint,
): FuryCapabilityGraph {
  if (!isGeneratedFuryRequestBlueprint(blueprint)) {
    throw new TypeError('capability graph requires a process-local FuryPipe request blueprint');
  }
  if (blueprint.executionAuthorized !== false || blueprint.capabilities.executionAuthority !== false) {
    throw new TypeError('capability graph requires a non-authoritative request blueprint');
  }

  const nodes: FuryCapabilityGraphNode[] = [];
  const edges: FuryCapabilityGraphEdge[] = [];
  const requestId = `request:${blueprint.objectiveDigestSha256.slice(0, 24)}`;

  nodes.push(Object.freeze({
    id: requestId,
    kind: 'request',
    label: 'Request',
    executionAuthority: false,
  }));

  for (const decision of blueprint.decisions) {
    const decisionId = `decision:${decision.family}`;
    nodes.push(Object.freeze({
      id: decisionId,
      kind: 'decision',
      label: decision.family,
      family: decision.family,
      reason: decision.reason,
      executionAuthority: false,
    }));
    edges.push(Object.freeze({
      id: nodeId('edge', `${requestId}|routes|${decisionId}`),
      from: requestId,
      to: decisionId,
      kind: 'routes',
      executionAuthority: false,
    }));

    const edgeKind: FuryCapabilityGraphEdgeKind =
      decision.status === 'advisory'
        ? 'advises'
        : decision.status === 'configured'
          ? 'configures'
          : 'selects';

    for (const id of decision.ids) {
      const capabilityNodeId = nodeId('capability', `${decision.family}|${id}`);
      nodes.push(Object.freeze({
        id: capabilityNodeId,
        kind: decision.status === 'advisory' ? 'advisory' : 'capability',
        label: id,
        family: decision.family,
        capabilityId: id,
        reason: decision.reason,
        executionAuthority: false,
      }));
      edges.push(Object.freeze({
        id: nodeId('edge', `${decisionId}|${edgeKind}|${capabilityNodeId}`),
        from: decisionId,
        to: capabilityNodeId,
        kind: edgeKind,
        executionAuthority: false,
      }));
    }
  }

  for (const blocked of blueprint.capabilities.blocked) {
    const blockedId = nodeId('blocked', `${blocked.kind}|${blocked.id}|${blocked.reason}`);
    nodes.push(Object.freeze({
      id: blockedId,
      kind: 'blocked',
      label: blocked.id,
      capabilityKind: blocked.kind,
      capabilityId: blocked.id,
      reason: blocked.reason,
      executionAuthority: false,
    }));
    edges.push(Object.freeze({
      id: nodeId('edge', `${requestId}|blocks|${blockedId}`),
      from: requestId,
      to: blockedId,
      kind: 'blocks',
      executionAuthority: false,
    }));
  }

  if (nodes.length > 512 || edges.length > 1024) {
    throw new RangeError('capability graph exceeds bounded projection limits');
  }

  const dedupedNodes = new Map<string, FuryCapabilityGraphNode>();
  for (const node of nodes) dedupedNodes.set(node.id, node);
  const dedupedEdges = new Map<string, FuryCapabilityGraphEdge>();
  for (const edge of edges) dedupedEdges.set(edge.id, edge);

  return Object.freeze({
    format: FURY_CAPABILITY_GRAPH_FORMAT,
    requestDigestSha256: blueprint.objectiveDigestSha256,
    selectionDigestSha256: blueprint.capabilities.selectionDigestSha256,
    nodes: Object.freeze([...dedupedNodes.values()]),
    edges: Object.freeze([...dedupedEdges.values()]),
    unresolved: blueprint.unresolved,
    authority: 'visualization-only' as const,
    executionAuthorized: false as const,
  });
}
