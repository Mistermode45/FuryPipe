import type { McpToolBehaviorHints } from './mcp-tool-risk.js';

export interface ExposedMcpTool {
  readonly name: string;
  readonly serverId?: string;
  readonly toolId?: string;
  readonly exposureEvidence: 'declared_mcp_type' | 'claude_code_name_convention';
  /** Tool exposure is not a transport health check. */
  readonly transportVerified: false;
  /** MCP ToolAnnotations normalized to booleans only; never authority. */
  readonly annotations?: McpToolBehaviorHints;
}

export interface PendingObservedMcpUse {
  readonly toolName: string;
  readonly toolUseIdSha256: string;
  readonly inputSha256: string;
  readonly status: 'selected_no_result_observed';
}

export interface ObservedExternalMcpResultReceipt {
  readonly format: 'furypipe-observed-external-mcp-result/v1';
  readonly toolName: string;
  readonly serverId?: string;
  readonly toolId?: string;
  readonly toolUseIdSha256: string;
  readonly inputSha256: string;
  readonly resultSha256: string;
  readonly isError: boolean;
  /**
   * This is evidence that the request history contains a correlated tool_result.
   * FuryPipe did not execute the tool and must never convert this receipt into an
   * AgentCapabilityExecutionReceipt.
   */
  readonly status: 'observed_result';
  readonly executedByFuryPipe: false;
}

export interface AnthropicMcpObservation {
  readonly format: 'furypipe-anthropic-mcp-observation/v1';
  readonly exposedTools: readonly ExposedMcpTool[];
  readonly pendingUses: readonly PendingObservedMcpUse[];
  readonly observedResults: readonly ObservedExternalMcpResultReceipt[];
  readonly executedByFuryPipe: false;
}

const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_TOOLS = 256;
const MAX_MESSAGES = 2_048;
const MAX_BLOCKS = 8_192;
const MAX_NAME = 256;
const MAX_TOOL_USE_ID = 512;
const SAFE_NAME = /^[^\u0000-\u001f\u007f]{1,256}$/u;

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function parseRoot(body: Uint8Array | string): Record<string, unknown> {
  const text = typeof body === 'string'
    ? body
    : new TextDecoder('utf-8', { fatal: true }).decode(body);
  if (encodedBytes(text) > MAX_BODY_BYTES) {
    throw new Error('MCP observation body exceeds the 16 MiB bound');
  }
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MCP observation requires a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function safeName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name.length <= MAX_NAME && SAFE_NAME.test(name) ? name : undefined;
}

function behaviorHints(value: unknown): McpToolBehaviorHints | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const out: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  } = {};
  if (typeof source.readOnlyHint === 'boolean') out.readOnlyHint = source.readOnlyHint;
  if (typeof source.destructiveHint === 'boolean') out.destructiveHint = source.destructiveHint;
  if (typeof source.idempotentHint === 'boolean') out.idempotentHint = source.idempotentHint;
  if (typeof source.openWorldHint === 'boolean') out.openWorldHint = source.openWorldHint;
  return Object.keys(out).length > 0 ? Object.freeze(out) : undefined;
}

function parseMcpName(name: string): { serverId?: string; toolId?: string } {
  if (!name.startsWith('mcp__')) return {};
  const separator = name.indexOf('__', 5);
  if (separator <= 5 || separator >= name.length - 2) return {};
  const serverId = name.slice(5, separator);
  const toolId = name.slice(separator + 2);
  if (!SAFE_NAME.test(serverId) || !SAFE_NAME.test(toolId)) return {};
  return { serverId, toolId };
}

function exposedTools(root: Record<string, unknown>): readonly ExposedMcpTool[] {
  if (!Array.isArray(root.tools)) return Object.freeze([]);
  const out: ExposedMcpTool[] = [];
  const seen = new Set<string>();

  for (const raw of root.tools.slice(0, MAX_TOOLS)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const tool = raw as Record<string, unknown>;
    const name = safeName(tool.name);
    if (!name || seen.has(name)) continue;

    const type = typeof tool.type === 'string' ? tool.type : '';
    const convention = name.startsWith('mcp__');
    if (type !== 'mcp' && !convention) continue;

    seen.add(name);
    const parsed = parseMcpName(name);
    const annotations = behaviorHints(tool.annotations);
    out.push(Object.freeze({
      name,
      ...parsed,
      exposureEvidence: type === 'mcp'
        ? 'declared_mcp_type' as const
        : 'claude_code_name_convention' as const,
      transportVerified: false as const,
      ...(annotations === undefined ? {} : { annotations }),
    }));
  }

  return Object.freeze(out);
}

async function sha256(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const owned = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(owned).set(encoded);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', owned);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input as object)) throw new Error('MCP observation value must be acyclic');
    seen.add(input as object);
    if (Array.isArray(input)) return input.map(normalize);
    const object = input as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object).sort().map((key) => [key, normalize(object[key])]),
    );
  };
  const serialized = JSON.stringify(normalize(value));
  if (typeof serialized !== 'string') throw new Error('MCP observation value is not serializable');
  return serialized;
}

interface UseRecord {
  readonly id: string;
  readonly name: string;
  readonly inputJson: string;
}

function messageBlocks(root: Record<string, unknown>): readonly {
  readonly role: string;
  readonly blocks: readonly Record<string, unknown>[];
}[] {
  if (!Array.isArray(root.messages) || root.messages.length > MAX_MESSAGES) {
    if (Array.isArray(root.messages) && root.messages.length > MAX_MESSAGES) {
      throw new Error('MCP observation message count exceeds its bound');
    }
    return Object.freeze([]);
  }

  let totalBlocks = 0;
  const messages: Array<{ role: string; blocks: readonly Record<string, unknown>[] }> = [];
  for (const raw of root.messages) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const message = raw as Record<string, unknown>;
    if (typeof message.role !== 'string' || !Array.isArray(message.content)) continue;
    const blocks = message.content.flatMap((rawBlock) => {
      if (!rawBlock || typeof rawBlock !== 'object' || Array.isArray(rawBlock)) return [];
      return [rawBlock as Record<string, unknown>];
    });
    totalBlocks += blocks.length;
    if (totalBlocks > MAX_BLOCKS) throw new Error('MCP observation block count exceeds its bound');
    messages.push(Object.freeze({ role: message.role, blocks: Object.freeze(blocks) }));
  }
  return Object.freeze(messages);
}

/**
 * Observe MCP activity already present in an Anthropic Messages request.
 *
 * This function never calls a tool. It only proves what the current client
 * declared and what prior request history contains.
 */
export async function observeAnthropicMcpRuntime(
  body: Uint8Array | string,
): Promise<AnthropicMcpObservation> {
  const root = parseRoot(body);
  const exposed = exposedTools(root);
  const exposedByName = new Map(exposed.map((tool) => [tool.name, tool] as const));
  const uses = new Map<string, UseRecord>();
  const allResultIds = new Set<string>();
  const latestResults = new Map<string, { readonly contentJson: string; readonly isError: boolean }>();
  const messages = messageBlocks(root);
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      latestUserIndex = index;
      break;
    }
  }

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]!;
    for (const block of message.blocks) {
      if (message.role === 'assistant' && block.type === 'tool_use') {
        const id = typeof block.id === 'string' ? block.id : undefined;
        const name = safeName(block.name);
        if (!id || id.length > MAX_TOOL_USE_ID || id.includes('\0') || !name || !exposedByName.has(name)) {
          continue;
        }
        if (!uses.has(id)) {
          let inputJson: string;
          try {
            inputJson = stableJson(block.input ?? null);
          } catch {
            continue;
          }
          uses.set(id, { id, name, inputJson });
        }
      }

      if (message.role === 'user' && block.type === 'tool_result') {
        const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined;
        if (!id || id.length > MAX_TOOL_USE_ID || id.includes('\0')) continue;
        allResultIds.add(id);

        // Emit a receipt only for results newly carried by this request's
        // latest user turn. Older history remains completion evidence for
        // pending-state calculation but is not counted again.
        if (messageIndex !== latestUserIndex || latestResults.has(id)) continue;
        let contentJson: string;
        try {
          contentJson = stableJson({
            content: block.content ?? null,
            is_error: block.is_error === true,
          });
        } catch {
          continue;
        }
        latestResults.set(id, { contentJson, isError: block.is_error === true });
      }
    }
  }

  const pending: PendingObservedMcpUse[] = [];
  const observed: ObservedExternalMcpResultReceipt[] = [];

  for (const use of uses.values()) {
    const [toolUseIdSha256, inputSha256] = await Promise.all([
      sha256(use.id),
      sha256(use.inputJson),
    ]);
    const result = latestResults.get(use.id);
    if (!result) {
      if (!allResultIds.has(use.id)) {
        pending.push(Object.freeze({
          toolName: use.name,
          toolUseIdSha256,
          inputSha256,
          status: 'selected_no_result_observed' as const,
        }));
      }
      continue;
    }

    const tool = exposedByName.get(use.name)!;
    observed.push(Object.freeze({
      format: 'furypipe-observed-external-mcp-result/v1' as const,
      toolName: use.name,
      ...(tool.serverId === undefined ? {} : { serverId: tool.serverId }),
      ...(tool.toolId === undefined ? {} : { toolId: tool.toolId }),
      toolUseIdSha256,
      inputSha256,
      resultSha256: await sha256(result.contentJson),
      isError: result.isError,
      status: 'observed_result' as const,
      executedByFuryPipe: false as const,
    }));
  }

  return Object.freeze({
    format: 'furypipe-anthropic-mcp-observation/v1',
    exposedTools: exposed,
    pendingUses: Object.freeze(pending),
    observedResults: Object.freeze(observed),
    executedByFuryPipe: false,
  });
}