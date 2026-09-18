export interface AgentSkillStandardMetadata {
  readonly name: string;
  readonly description: string;
  readonly license?: string;
  readonly compatibility?: string;
  readonly metadata?: Readonly<Record<string, string>>;
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
const MAX_METADATA_ITEMS = 64;
const MAX_METADATA_KEY = 128;
const MAX_METADATA_VALUE = 2048;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

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
  if (trimmed === '|' || trimmed === '>') {
    throw new Error('Agent Skill multiline YAML scalars are unsupported by the bounded parser');
  }
  return trimmed;
}

interface ParsedFrontmatter {
  readonly fields: Readonly<Record<string, string>>;
  readonly metadata: Readonly<Record<string, string>>;
}

function parseFrontmatter(text: string): ParsedFrontmatter {
  const lines = text.split(/\r?\n/u);
  const fields: Record<string, string> = {};
  const metadata: Record<string, string> = {};
  let metadataMode = false;

  for (const raw of lines) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;

    if (/^\s/u.test(raw)) {
      if (!metadataMode) {
        throw new Error('Agent Skill nested YAML is only supported for the metadata mapping');
      }
      const child = /^ {2,}([^:#][^:]{0,127}):\s*(.*)$/u.exec(raw);
      if (!child) throw new Error('Agent Skill metadata entry is invalid');
      const key = child[1]!.trim();
      const value = unquoteYamlScalar(child[2]!);
      if (!key || key.length > MAX_METADATA_KEY || CONTROL.test(key)) {
        throw new Error('Agent Skill metadata key is invalid');
      }
      if (!value || value.length > MAX_METADATA_VALUE || CONTROL.test(value)) {
        throw new Error('Agent Skill metadata value is invalid');
      }
      if (metadata[key] !== undefined) throw new Error('Agent Skill metadata contains duplicate keys');
      if (Object.keys(metadata).length >= MAX_METADATA_ITEMS) {
        throw new Error('Agent Skill metadata exceeds its item limit');
      }
      metadata[key] = value;
      continue;
    }

    metadataMode = false;
    const separator = raw.indexOf(':');
    if (separator <= 0) throw new Error('Agent Skill frontmatter line is invalid');
    const key = raw.slice(0, separator).trim();
    const rawValue = raw.slice(separator + 1);
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(key)) {
      throw new Error('Agent Skill frontmatter key is invalid');
    }
    if (fields[key] !== undefined) throw new Error('Agent Skill frontmatter contains duplicate keys');

    if (key === 'metadata' && rawValue.trim() === '') {
      metadataMode = true;
      fields[key] = '';
      continue;
    }

    const value = unquoteYamlScalar(rawValue);
    fields[key] = value;
  }

  return Object.freeze({
    fields: Object.freeze({ ...fields }),
    metadata: Object.freeze({ ...metadata }),
  });
}

function validateMetadata(parsed: ParsedFrontmatter): AgentSkillStandardMetadata {
  const { fields, metadata } = parsed;
  const name = fields.name;
  const description = fields.description;
  if (!name || name.length > 64 || !NAME.test(name)) {
    throw new Error('Agent Skill name must be 1-64 lowercase letters/numbers/hyphens');
  }
  if (!description || description.length > 1024 || CONTROL.test(description)) {
    throw new Error('Agent Skill description must be 1-1024 safe characters');
  }

  const license = fields.license;
  if (license !== undefined && (!license || license.length > 1024 || CONTROL.test(license))) {
    throw new Error('Agent Skill license field is invalid');
  }

  const compatibility = fields.compatibility;
  if (compatibility !== undefined
    && (!compatibility || compatibility.length > 500 || CONTROL.test(compatibility))) {
    throw new Error('Agent Skill compatibility must be 1-500 safe characters');
  }

  const allowedTools = fields['allowed-tools'];
  if (allowedTools !== undefined && (allowedTools.length > 4096 || CONTROL.test(allowedTools))) {
    throw new Error('Agent Skill allowed-tools metadata is invalid');
  }

  return Object.freeze({
    name,
    description,
    ...(license === undefined ? {} : { license }),
    ...(compatibility === undefined ? {} : { compatibility }),
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
    ...(allowedTools === undefined ? {} : { allowedTools }),
  });
}

function frontmatterFrom(content: string): {
  readonly metadata: AgentSkillStandardMetadata;
  readonly bodyStart: number;
} {
  const normalized = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const open = normalized.match(/^---\r?\n/u);
  if (!open) throw new Error('Agent Skill manifest must start with YAML frontmatter');
  const start = open[0].length;
  const closeMatch = /\r?\n---(?:\r?\n|$)/u.exec(normalized.slice(start));
  if (!closeMatch) throw new Error('Agent Skill frontmatter is not terminated');
  if (encodedBytes(normalized.slice(start, start + closeMatch.index)) > MAX_FRONTMATTER_BYTES) {
    throw new Error('Agent Skill frontmatter exceeds its bound');
  }
  const frontmatter = normalized.slice(start, start + closeMatch.index);
  return Object.freeze({
    metadata: validateMetadata(parseFrontmatter(frontmatter)),
    bodyStart: start + closeMatch.index + closeMatch[0].length,
  });
}

function assertDirectoryName(metadata: AgentSkillStandardMetadata, expectedDirectoryName?: string): void {
  if (expectedDirectoryName !== undefined && metadata.name !== expectedDirectoryName) {
    throw new Error('Agent Skill directory name must match frontmatter name');
  }
}

/**
 * Parse the full bounded SKILL.md when a routed task activates the skill.
 *
 * This does not read references/scripts/assets and never executes anything.
 */
export function parseAgentSkillManifest(
  content: string,
  expectedDirectoryName?: string,
): ParsedAgentSkillManifest {
  if (typeof content !== 'string') throw new TypeError('Agent Skill manifest must be text');
  const byteLength = encodedBytes(content);
  if (byteLength < 1 || byteLength > MAX_SKILL_BYTES) {
    throw new Error('Agent Skill manifest exceeds the bounded size');
  }

  const normalized = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const parsed = frontmatterFrom(normalized);
  assertDirectoryName(parsed.metadata, expectedDirectoryName);
  const instructions = normalized.slice(parsed.bodyStart).trim();
  if (!instructions) throw new Error('Agent Skill instructions must not be empty');

  return Object.freeze({
    format: 'furypipe-agent-skill-manifest/v1',
    metadata: parsed.metadata,
    instructions,
  });
}

/**
 * Metadata-only discovery path.
 *
 * A host may pass only a bounded prefix containing the terminated frontmatter;
 * the Markdown body is not required and is not parsed. This is the startup
 * progressive-disclosure layer described by the Agent Skills specification.
 */
export function inspectAgentSkillMetadata(
  frontmatterPrefix: string,
  expectedDirectoryName?: string,
): AgentSkillStandardMetadata {
  if (typeof frontmatterPrefix !== 'string') {
    throw new TypeError('Agent Skill metadata prefix must be text');
  }
  if (encodedBytes(frontmatterPrefix) > MAX_FRONTMATTER_BYTES + 1024) {
    throw new Error('Agent Skill metadata prefix exceeds its discovery bound');
  }
  const parsed = frontmatterFrom(frontmatterPrefix);
  assertDirectoryName(parsed.metadata, expectedDirectoryName);
  return parsed.metadata;
}
