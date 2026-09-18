export type ProxyTaskWire =
  | 'anthropic-messages'
  | 'openai-chat'
  | 'openai-responses'
  | 'google-generate-content';

export interface ProxyToolMetadata {
  readonly name: string;
  readonly kind: 'function' | 'mcp' | 'unknown';
}

export interface ProxyTaskEnvelope {
  readonly format: 'furypipe-proxy-task-envelope/v1';
  readonly wire: ProxyTaskWire;
  readonly objective: string;
  readonly structuredOutput: boolean;
  readonly tools: readonly ProxyToolMetadata[];
}

const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_OBJECTIVE_CHARS = 64_000;
const MAX_TOOLS = 256;
const MAX_TOOL_NAME = 256;

function parseBody(body: Uint8Array | string): Record<string, unknown> {
  const text = typeof body === 'string' ? body : new TextDecoder('utf-8', { fatal: true }).decode(body);
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new Error('proxy task envelope body exceeds the 16 MiB bound');
  }
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('proxy task envelope requires a JSON object');
  }
  return value as Record<string, unknown>;
}

function textFromContent(value: unknown, allowedTypes: ReadonlySet<string>): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const block = item as Record<string, unknown>;
    const type = typeof block.type === 'string' ? block.type : '';
    if (!allowedTypes.has(type)) continue;
    const text = block.text;
    if (typeof text === 'string' && text.trim()) out.push(text);
  }
  return out;
}

function latestRoleText(
  messages: unknown,
  role: string,
  allowedTypes: ReadonlySet<string>,
): string {
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const raw = messages[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const message = raw as Record<string, unknown>;
    if (message.role !== role) continue;
    const parts = textFromContent(message.content, allowedTypes);
    if (parts.length > 0) return parts.join('\n').slice(0, MAX_OBJECTIVE_CHARS);
  }
  return '';
}

function googleObjective(contents: unknown): string {
  if (!Array.isArray(contents)) return '';
  for (let index = contents.length - 1; index >= 0; index -= 1) {
    const raw = contents[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const message = raw as Record<string, unknown>;
    if (message.role !== 'user') continue;
    if (!Array.isArray(message.parts)) continue;
    const parts: string[] = [];
    for (const rawPart of message.parts) {
      if (!rawPart || typeof rawPart !== 'object' || Array.isArray(rawPart)) continue;
      const text = (rawPart as Record<string, unknown>).text;
      if (typeof text === 'string' && text.trim()) parts.push(text);
    }
    if (parts.length > 0) return parts.join('\n').slice(0, MAX_OBJECTIVE_CHARS);
  }
  return '';
}

function normalizeToolName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (!name || name.length > MAX_TOOL_NAME || /[\u0000-\u001f\u007f]/u.test(name)) return undefined;
  return name;
}

function toolsFrom(value: unknown): readonly ProxyToolMetadata[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const tools: ProxyToolMetadata[] = [];
  for (const raw of value.slice(0, MAX_TOOLS)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const tool = raw as Record<string, unknown>;
    const directName = normalizeToolName(tool.name);
    const functionDef = tool.function && typeof tool.function === 'object' && !Array.isArray(tool.function)
      ? tool.function as Record<string, unknown>
      : undefined;
    const functionName = normalizeToolName(functionDef?.name);
    const name = directName ?? functionName;
    if (!name) continue;
    const rawType = typeof tool.type === 'string' ? tool.type : '';
    const kind: ProxyToolMetadata['kind'] =
      rawType === 'mcp' || /^mcp__/u.test(name) ? 'mcp'
        : rawType === 'function' || functionName !== undefined ? 'function'
          : 'unknown';
    tools.push(Object.freeze({ name, kind }));
  }
  return Object.freeze(tools);
}

function openAIResponsesStructured(root: Record<string, unknown>): boolean {
  const text = root.text;
  if (text && typeof text === 'object' && !Array.isArray(text)) {
    const format = (text as Record<string, unknown>).format;
    if (format && typeof format === 'object' && !Array.isArray(format)) {
      const type = (format as Record<string, unknown>).type;
      if (type === 'json_schema' || type === 'json_object') return true;
    }
  }
  const responseFormat = root.response_format;
  if (responseFormat && typeof responseFormat === 'object' && !Array.isArray(responseFormat)) return true;
  return false;
}

function googleStructured(root: Record<string, unknown>): boolean {
  const config = root.generationConfig;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const record = config as Record<string, unknown>;
  return record.responseSchema !== undefined
    || record.responseJsonSchema !== undefined
    || record.responseMimeType === 'application/json';
}

export function extractProxyTaskEnvelope(
  body: Uint8Array | string,
  wire: ProxyTaskWire,
): ProxyTaskEnvelope | undefined {
  const root = parseBody(body);
  let objective = '';
  let structuredOutput = false;

  switch (wire) {
    case 'anthropic-messages':
      objective = latestRoleText(root.messages, 'user', new Set(['text']));
      structuredOutput = root.output_config !== undefined;
      break;
    case 'openai-chat':
      objective = latestRoleText(root.messages, 'user', new Set(['text', 'input_text']));
      structuredOutput = root.response_format !== undefined;
      break;
    case 'openai-responses':
      if (typeof root.input === 'string') objective = root.input.slice(0, MAX_OBJECTIVE_CHARS);
      else objective = latestRoleText(root.input, 'user', new Set(['input_text', 'text']));
      structuredOutput = openAIResponsesStructured(root);
      break;
    case 'google-generate-content':
      objective = googleObjective(root.contents);
      structuredOutput = googleStructured(root);
      break;
  }

  objective = objective.trim();
  if (!objective) return undefined;

  return Object.freeze({
    format: 'furypipe-proxy-task-envelope/v1',
    wire,
    objective,
    structuredOutput,
    tools: toolsFrom(root.tools),
  });
}
