export interface AgentSkillStandardMetadata {
  readonly name: string;
  readonly description: string;
  /**
   * Experimental Agent Skills field. FuryPipe treats this as routing metadata
   * only; it never grants tool authority.
   */
  readonly allowedTools?: string;
}

export interface ParsedAgentSkillManifest {
  readonly format: 'furypipe-agent-skill-manifest/v1';
  readonly metadata: AgentSkillStandardMetadata;
  /** Markdown after frontmatter. Loading this is activation, not execution. */
  readonly instructions: string;
}

const MAX_SKILL_BYTES = 256 * 1024;
const MAX_FRONTMATTER_BYTES = 16 * 1024;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (first === '"' && last === '"') {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (typeof parsed === 'string') return parsed;
      } catch {
        throw new Error('Agent Skill frontmatter contains an invalid quoted scalar');
      }
    }
    if (first === "'" && last === "'") {
      return trimmed.slice(1, -1).replaceAll("''", "'");
    }
  }
  return trimmed;
}

function parseFrontmatter(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/u);
  const fields: Record<string, string> = {};
  for (const raw of lines) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (/^\s/u.test(raw)) {
      throw new Error('Agent Skill frontmatter multiline/nested YAML is unsupported by the bounded parser');
    }
    const separator = raw.indexOf(':');
    if (separator <= 0) throw new Error('Agent Skill frontmatter line is invalid');
    const key = raw.slice(0, separator).trim();
    const value = unquoteYamlScalar(raw.slice(separator + 1));
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(key)) {
      throw new Error('Agent Skill frontmatter key is invalid');
    }
    if (fields[key] !== undefined) throw new Error('Agent Skill frontmatter contains duplicate keys');
    if (value === '|' || value === '>') {
      throw new Error('Agent Skill multiline YAML scalars are unsupported by the bounded parser');
    }
    fields[key] = value;
  }
  return fields;
}

function validateMetadata(fields: Record<string, string>): AgentSkillStandardMetadata {
  const name = fields.name;
  const description = fields.description;
  if (!name || name.length > 64 || !NAME.test(name)) {
    throw new Error('Agent Skill name must be 1-64 lowercase letters/numbers/hyphens');
  }
  if (!description || description.length > 1024 || CONTROL.test(description)) {
    throw new Error('Agent Skill description must be 1-1024 safe characters');
  }
  const allowedTools = fields['allowed-tools'];
  if (allowedTools !== undefined && (allowedTools.length > 4096 || CONTROL.test(allowedTools))) {
    throw new Error('Agent Skill allowed-tools metadata is invalid');
  }
  return Object.freeze({
    name,
    description,
    ...(allowedTools === undefined ? {} : { allowedTools }),
  });
}

/**
 * Parse the bounded metadata + body needed for FuryPipe progressive disclosure.
 *
 * This does not read references/scripts/assets and never executes anything.
 */
export function parseAgentSkillManifest(
  content: string,
  expectedDirectoryName?: string,
): ParsedAgentSkillManifest {
  if (typeof content !== 'string') throw new TypeError('Agent Skill manifest must be text');
  const byteLength = new TextEncoder().encode(content).byteLength;
  if (byteLength < 1 || byteLength > MAX_SKILL_BYTES) {
    throw new Error('Agent Skill manifest exceeds the bounded size');
  }

  const normalized = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const open = normalized.match(/^---\r?\n/u);
  if (!open) throw new Error('Agent Skill manifest must start with YAML frontmatter');
  const start = open[0].length;
  const closeMatch = /\r?\n---(?:\r?\n|$)/u.exec(normalized.slice(start));
  if (!closeMatch) throw new Error('Agent Skill frontmatter is not terminated');
  if (closeMatch.index > MAX_FRONTMATTER_BYTES) throw new Error('Agent Skill frontmatter exceeds its bound');

  const frontmatter = normalized.slice(start, start + closeMatch.index);
  const bodyStart = start + closeMatch.index + closeMatch[0].length;
  const instructions = normalized.slice(bodyStart).trim();
  const metadata = validateMetadata(parseFrontmatter(frontmatter));

  if (expectedDirectoryName !== undefined && metadata.name !== expectedDirectoryName) {
    throw new Error('Agent Skill directory name must match frontmatter name');
  }
  if (!instructions) throw new Error('Agent Skill instructions must not be empty');

  return Object.freeze({
    format: 'furypipe-agent-skill-manifest/v1',
    metadata,
    instructions,
  });
}

/** Metadata-only projection suitable for startup discovery indexes. */
export function inspectAgentSkillMetadata(
  content: string,
  expectedDirectoryName?: string,
): AgentSkillStandardMetadata {
  return parseAgentSkillManifest(content, expectedDirectoryName).metadata;
}
