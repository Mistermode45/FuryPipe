import { createHash } from 'node:crypto';

export interface McpDirectJsonOptions {
  readonly maxBytes?: number;
  readonly maxDepth?: number;
  readonly label?: string;
}

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_DEPTH = 64;

function positiveBound(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return resolved;
}

function canonicalValue(
  value: unknown,
  depth: number,
  maxDepth: number,
  ancestors: Set<object>,
  label: string,
): string {
  if (depth > maxDepth) throw new Error(`${label} exceeds the depth bound`);
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number`);
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new Error(`${label} contains a non-JSON value`);
    case 'object':
      break;
    default:
      throw new Error(`${label} contains an unsupported value`);
  }

  const object = value as object;
  if (ancestors.has(object)) throw new Error(`${label} contains a cycle`);
  ancestors.add(object);
  try {
    if (Array.isArray(value)) {
      const parts: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new Error(`${label} contains a sparse array`);
        parts.push(canonicalValue(value[index], depth + 1, maxDepth, ancestors, label));
      }
      const ownNames = Object.getOwnPropertyNames(value);
      if (ownNames.some((name) => name !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(name))) {
        throw new Error(`${label} array contains non-index properties`);
      }
      return `[${parts.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} contains a non-plain object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`${label} contains symbol keys`);
    }

    const record = value as Record<string, unknown>;
    const names = Object.getOwnPropertyNames(record).sort();
    const parts: string[] = [];
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(record, name);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new Error(`${label} contains hidden or accessor properties`);
      }
      parts.push(
        `${JSON.stringify(name)}:${canonicalValue(descriptor.value, depth + 1, maxDepth, ancestors, label)}`,
      );
    }
    return `{${parts.join(',')}}`;
  } finally {
    ancestors.delete(object);
  }
}

export function canonicalizeMcpDirectJson(
  value: unknown,
  options: McpDirectJsonOptions = {},
): string {
  const maxBytes = positiveBound(options.maxBytes, DEFAULT_MAX_BYTES, 'MCP JSON maxBytes');
  const maxDepth = positiveBound(options.maxDepth, DEFAULT_MAX_DEPTH, 'MCP JSON maxDepth');
  const label = options.label ?? 'MCP JSON value';
  const canonical = canonicalValue(value, 0, maxDepth, new Set<object>(), label);
  const byteLength = Buffer.byteLength(canonical, 'utf8');
  if (byteLength > maxBytes) throw new Error(`${label} exceeds the byte bound`);
  return canonical;
}

export function digestMcpDirectJson(
  value: unknown,
  options: McpDirectJsonOptions = {},
): string {
  return createHash('sha256')
    .update(canonicalizeMcpDirectJson(value, options), 'utf8')
    .digest('hex');
}

export function cloneMcpDirectJson<T>(
  value: T,
  options: McpDirectJsonOptions = {},
): T {
  return JSON.parse(canonicalizeMcpDirectJson(value, options)) as T;
}
