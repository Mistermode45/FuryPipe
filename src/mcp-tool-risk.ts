export interface McpToolBehaviorHints {
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

export type McpToolTrust = 'trusted' | 'untrusted';

export type McpToolRiskClass =
  | 'untrusted_unknown'
  | 'trusted_read_only_closed_world'
  | 'trusted_read_only_open_world'
  | 'trusted_mutating_additive'
  | 'trusted_mutating_destructive';

export interface McpResolvedToolHints {
  /** MCP 2026-07-28 default: false. */
  readonly readOnly: boolean;
  /** MCP 2026-07-28 default: true; meaningful only when readOnly=false. */
  readonly destructive: boolean | 'not_applicable';
  /** MCP 2026-07-28 default: false; meaningful only when readOnly=false. */
  readonly idempotent: boolean | 'not_applicable';
  /** MCP 2026-07-28 default: true. */
  readonly openWorld: boolean;
}

export interface McpToolRiskAssessment {
  readonly format: 'furypipe-mcp-tool-risk/v1';
  readonly trust: McpToolTrust;
  readonly resolvedHints: McpResolvedToolHints;
  readonly riskClass: McpToolRiskClass;
  /**
   * Candidate for a later host policy to auto-run as a read operation.
   * This is deliberately narrower than readOnlyHint=true: open-world reads can
   * disclose user data to external entities.
   */
  readonly closedWorldReadCandidate: boolean;
  /**
   * Retry semantics inferred from trusted hints only. This is not permission to
   * replay a call; billing, external side effects and request-level idempotency
   * still require a separate policy.
   */
  readonly replayHint:
    | 'trusted_read_only'
    | 'trusted_idempotent_mutation'
    | 'unsafe_or_unknown';
  /** Tool annotations never grant runtime authority by themselves. */
  readonly authorizationGranted: false;
  readonly requiresPolicyGate: true;
}

function hint(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Normalize MCP 2026-07-28 ToolAnnotations without turning descriptive hints
 * into security authority.
 *
 * Spec defaults:
 *   readOnlyHint=false
 *   destructiveHint=true
 *   idempotentHint=false
 *   openWorldHint=true
 *
 * Untrusted-server annotations are retained for diagnostics only. Risk stays
 * unknown and no automation candidate is produced.
 */
export function assessMcpToolRisk(
  annotations: McpToolBehaviorHints | undefined,
  trust: McpToolTrust,
): McpToolRiskAssessment {
  if (trust !== 'trusted' && trust !== 'untrusted') {
    throw new Error('MCP tool trust must be trusted or untrusted');
  }
  if (annotations !== undefined && (!annotations || typeof annotations !== 'object' || Array.isArray(annotations))) {
    throw new TypeError('MCP tool annotations must be an object when provided');
  }

  const readOnly = hint(annotations?.readOnlyHint, false);
  const destructiveRaw = hint(annotations?.destructiveHint, true);
  const idempotentRaw = hint(annotations?.idempotentHint, false);
  const openWorld = hint(annotations?.openWorldHint, true);

  const resolvedHints: McpResolvedToolHints = Object.freeze({
    readOnly,
    destructive: readOnly ? 'not_applicable' : destructiveRaw,
    idempotent: readOnly ? 'not_applicable' : idempotentRaw,
    openWorld,
  });

  if (trust === 'untrusted') {
    return Object.freeze({
      format: 'furypipe-mcp-tool-risk/v1',
      trust,
      resolvedHints,
      riskClass: 'untrusted_unknown',
      closedWorldReadCandidate: false,
      replayHint: 'unsafe_or_unknown',
      authorizationGranted: false,
      requiresPolicyGate: true,
    });
  }

  let riskClass: McpToolRiskClass;
  if (readOnly) {
    riskClass = openWorld
      ? 'trusted_read_only_open_world'
      : 'trusted_read_only_closed_world';
  } else if (destructiveRaw) {
    riskClass = 'trusted_mutating_destructive';
  } else {
    riskClass = 'trusted_mutating_additive';
  }

  return Object.freeze({
    format: 'furypipe-mcp-tool-risk/v1',
    trust,
    resolvedHints,
    riskClass,
    closedWorldReadCandidate: readOnly && !openWorld,
    replayHint: readOnly
      ? 'trusted_read_only'
      : idempotentRaw
        ? 'trusted_idempotent_mutation'
        : 'unsafe_or_unknown',
    authorizationGranted: false,
    requiresPolicyGate: true,
  });
}
