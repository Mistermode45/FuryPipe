import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  detectSetupLocale,
  parseSetupArgs,
  persistSetupLocale,
  renderSetupScreen,
} from '../src/setup-tui.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempConfig(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-setup-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'config.json');
}

describe('FuryPipe setup TUI', () => {
  it('renders a branded bilingual setup screen without ANSI when color is disabled', () => {
    const rendered = renderSetupScreen({
      selectedLocale: 'fr',
      version: '0.13.2',
      width: 100,
      color: false,
      configFile: '/tmp/furypipe/config.json',
    });

    expect(rendered).toContain('FURYPIPE');
    expect(rendered).toContain('GOVERNED AI WORKFLOWS');
    expect(rendered).toContain('Bienvenue dans FuryPipe');
    expect(rendered).toContain('Français');
    expect(rendered).toContain('English');
    expect(rendered).toContain('[1] Langue');
    expect(rendered).toContain('[5] Terminé');
    expect(rendered).not.toContain('\x1b[');
  });

  it('renders the completion state in the selected language', () => {
    const rendered = renderSetupScreen({
      selectedLocale: 'en',
      stage: 'done',
      version: '0.13.2',
      width: 96,
      color: false,
      configFile: '/tmp/furypipe/config.json',
    });

    expect(rendered).toContain('FuryPipe setup saved');
    expect(rendered).toContain('furypipe doctor');
    expect(rendered).toContain('furypipe start');
    expect(rendered).toContain('READY // FuryPipe is configured.');
  });

  it('parses supported setup arguments and rejects unknown languages', () => {
    expect(parseSetupArgs(['--lang=fr', '--plain', '--no-color', '--yes'])).toEqual({
      locale: 'fr',
      plain: true,
      color: false,
      yes: true,
      help: false,
    });
    expect(() => parseSetupArgs(['--lang=de'])).toThrow(/unsupported setup language/);
    expect(() => parseSetupArgs(['--wat'])).toThrow(/unknown setup option/);
  });

  it('detects French and otherwise falls back to English', () => {
    expect(detectSetupLocale({ LANG: 'fr_FR.UTF-8' })).toBe('fr');
    expect(detectSetupLocale({ LC_ALL: 'en_US.UTF-8' })).toBe('en');
  });

  it('persists locale atomically while preserving existing config keys', () => {
    const file = tempConfig();
    fs.writeFileSync(file, JSON.stringify({ models: ['claude-fable-5', 'gemini'], custom: 42 }));

    persistSetupLocale(file, 'fr', '0.13.2', () => new Date('2026-09-15T18:30:00.000Z'));

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(parsed.models).toEqual(['claude-fable-5', 'gemini']);
    expect(parsed.custom).toBe(42);
    expect(parsed.locale).toBe('fr');
    expect(parsed.setup).toEqual({
      completed: true,
      completedAt: '2026-09-15T18:30:00.000Z',
      version: '0.13.2',
    });
  });

  it('refuses to overwrite an invalid existing config', () => {
    const file = tempConfig();
    fs.writeFileSync(file, '[]\n');
    expect(() => persistSetupLocale(file, 'en')).toThrow(/not a JSON object/);
    expect(fs.readFileSync(file, 'utf8')).toBe('[]\n');
  });
});