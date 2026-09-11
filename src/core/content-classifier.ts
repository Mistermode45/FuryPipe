import { detectProtectedSpans, type ExactnessClass } from './exact-guard.js';

export type ClassifiedContentKind = 'plain_text' | 'json' | 'code' | 'log' | 'tool_output' | 'markdown';
export type ClassifiedSensitivity = 'public' | 'internal' | 'confidential' | 'secret';
export type ClassifiedEligibility = 'allow' | 'guarded' | 'deny';

export interface ContentClassifierHints {
  readonly filename?: string;
  readonly role?: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  readonly toolName?: string;
}

export interface ClassifiedContent {
  readonly format: 'furypipe-content-classification/v1';
  readonly kind: ClassifiedContentKind;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly language?: string;
  readonly bytes: number;
  readonly lines: number;
  readonly tokenEstimate: number;
  readonly exactnessClasses: readonly ExactnessClass[];
  readonly sensitivity: ClassifiedSensitivity;
  readonly compressionEligibility: ClassifiedEligibility;
  /** Bounded, value-free evidence explaining the classification. */
  readonly signals: readonly string[];
}

const CODE_EXTENSIONS: Readonly<Record<string, string>> = {
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.go': 'go',
  '.java': 'java',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.kt': 'kotlin',
  '.php': 'php',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sh': 'shell',
  '.sql': 'sql',
  '.swift': 'swift',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.vue': 'vue',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

const SECRET_CLASSES = new Set<ExactnessClass>(['secret', 'auth_header', 'jwt']);

function extensionOf(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const match = /(?:^|[\\/])[^\\/]+(\.[A-Za-z0-9]+)$/.exec(filename);
  return match?.[1]?.toLowerCase();
}

function looksLikeLog(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return false;
  const logLine = /^(?:\[[^\]\r\n]{2,80}\]|\d{4}-\d{2}-\d{2}[T ][^ ]+|(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b)/;
  return lines.filter((line) => logLine.test(line)).length >= Math.max(2, Math.ceil(lines.length / 2));
}

function looksLikeCode(text: string, language: string | undefined): boolean {
  if (language) return true;
  if (/```[A-Za-z0-9_+-]*\s*\r?\n/.test(text)) return true;
  const lines = text.split(/\r?\n/);
  const codeSignals = lines.filter((line) =>
    /^(?:\s*(?:import|export|class|interface|function|const|let|var|def|fn|public|private|SELECT|INSERT|UPDATE|#!\/)|\s*[\{\}\(\)\[\];]+\s*$)/.test(line),
  ).length;
  return codeSignals >= 2;
}

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isToolOutput(parsed: unknown, hints: ContentClassifierHints): boolean {
  if (hints.role === 'tool' || hints.toolName !== undefined) return true;
  if (!parsed || typeof parsed !== 'object') return false;
  const record = parsed as Record<string, unknown>;
  return typeof record.tool_result === 'object'
    || typeof record.tool_use === 'object'
    || record.type === 'tool_result'
    || record.type === 'tool_use'
    || typeof record.tool_call_id === 'string';
}

/** Classify a content block without retaining source plaintext or extracted values. */
export function classifyContent(text: string, hints: ContentClassifierHints = {}): ClassifiedContent {
  const bytes = new TextEncoder().encode(text).byteLength;
  const lines = text.length === 0 ? 0 : text.split(/\r?\n/).length;
  const parsed = parseJson(text);
  const language = CODE_EXTENSIONS[extensionOf(hints.filename) ?? ''];
  const protectedSpans = detectProtectedSpans(text);
  const exactnessClasses = [...new Set(protectedSpans.map((span) => span.class))];
  const hasSecret = exactnessClasses.some((item) => SECRET_CLASSES.has(item));
  const hasProtected = exactnessClasses.length > 0;
  const log = looksLikeLog(text);
  const code = looksLikeCode(text, language);
  const markdown = /^\s{0,3}#{1,6}\s+|```/m.test(text);
  const toolOutput = isToolOutput(parsed, hints);

  let kind: ClassifiedContentKind = 'plain_text';
  let confidence: ClassifiedContent['confidence'] = 'medium';
  const signals: string[] = [];
  if (toolOutput) {
    kind = 'tool_output';
    confidence = hints.role === 'tool' || hints.toolName !== undefined ? 'high' : 'medium';
    signals.push('tool-shape');
  } else if (parsed !== undefined) {
    kind = 'json';
    confidence = 'high';
    signals.push('json-parse');
  } else if (log) {
    kind = 'log';
    confidence = 'high';
    signals.push('repeated-log-prefix');
  } else if (code) {
    kind = 'code';
    confidence = language ? 'high' : 'medium';
    signals.push(language ? 'filename-extension' : 'code-syntax');
  } else if (markdown) {
    kind = 'markdown';
    confidence = 'high';
    signals.push('markdown-marker');
  } else {
    signals.push('fallback-text');
  }
  if (hasSecret) signals.push('secret-like-span');
  else if (hasProtected) signals.push('protected-span');
  if (hints.role) signals.push(`role:${hints.role}`);

  return {
    format: 'furypipe-content-classification/v1',
    kind,
    confidence,
    ...(language === undefined ? {} : { language }),
    bytes,
    lines,
    tokenEstimate: Math.ceil(text.length / 4),
    exactnessClasses,
    sensitivity: hasSecret ? 'secret' : hasProtected ? 'internal' : 'public',
    compressionEligibility: hasSecret ? 'deny' : hasProtected ? 'guarded' : 'allow',
    signals,
  };
}
