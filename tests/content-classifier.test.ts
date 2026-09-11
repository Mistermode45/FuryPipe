import { describe, expect, it } from 'vitest';
import { classifyContent } from '../src/core/index.js';

describe('content classifier', () => {
  it('classifies structured tool output without retaining values', () => {
    const value = 'opaque-player-id-123';
    const result = classifyContent(JSON.stringify({ type: 'tool_result', output: value }), { role: 'tool' });
    expect(result.kind).toBe('tool_output');
    expect(result.confidence).toBe('high');
    expect(result.signals).toContain('tool-shape');
    expect(JSON.stringify(result)).not.toContain(value);
  });

  it('classifies code from a filename and keeps protected content guarded', () => {
    const result = classifyContent('const endpoint = "https://example.com/token";\nexport function run() { return endpoint; }', {
      filename: 'src/example.ts',
    });
    expect(result.kind).toBe('code');
    expect(result.language).toBe('typescript');
    expect(result.compressionEligibility).toBe('guarded');
    expect(result.exactnessClasses.length).toBeGreaterThan(0);
  });

  it('classifies repeated log lines and denies secret-like content', () => {
    const result = classifyContent([
      '[2026-09-11T12:00:00Z] INFO request started',
      '[2026-09-11T12:00:01Z] ERROR Authorization: Bearer abc.def.ghi',
    ].join('\n'));
    expect(result.kind).toBe('log');
    expect(result.sensitivity).toBe('secret');
    expect(result.compressionEligibility).toBe('deny');
  });
});
