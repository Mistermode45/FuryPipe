import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { collectDoctorReport, renderDoctorReport, resolveDoctorLocale, type DoctorReport } from '../src/doctor.js';

const report: DoctorReport = {
  platform: { os: 'test 1', arch: 'x64', shell: 'powershell', cwd: 'C:\\work', executable: 'node' },
  runtime: {
    node: '26.8.2',
    npm: { status: 'available', value: '11.14.1' },
    pnpm: { status: 'available', value: '12.3.4' },
  },
  network: { host: '127.0.0.1', port: 48721, upstream: 'https://api.example.test' },
  paths: { config: 'C:\\Users\\test\\config.json', events: 'C:\\Users\\test\\events.jsonl' },
  modelScope: { mode: 'automatic', source: 'automatic_default', effectiveModels: [], visualPolicy: 'auto' },
  tools: {
    docker: { status: 'unavailable' },
    browser: { status: 'available', value: 'explorer.exe' },
    claude: { status: 'unavailable' },
    codex: { status: 'available', value: 'codex 1' },
    openclaw: { status: 'unavailable' },
  },
};

describe('furypipe doctor renderer', () => {
  it('renders safe human output without credential fields', () => {
    const output = renderDoctorReport(report);
    expect(output).toContain('Node: 26.8.2');
    expect(output).toContain('OpenClaw: unavailable');
    expect(output).not.toContain('API_KEY');
    expect(output).not.toContain('token');
  });

  it('supports machine-readable output', () => {
    const parsed = JSON.parse(renderDoctorReport(report, true)) as DoctorReport;
    expect(parsed.network.port).toBe(48721);
    expect(parsed.runtime.pnpm.value).toBe('12.3.4');
  });

  it('wires the locale option into human-readable output while keeping protocol values intact', () => {
    const output = renderDoctorReport(report, false, 'fr-FR');
    expect(output).toContain('Configuration: C:\\Users\\test\\config.json');
    expect(output).toContain('Écoute: 127.0.0.1:48721');
    expect(output).toContain('Node: 26.8.2');
  });

  it('auto-detects French from POSIX locale variables when no explicit locale is supplied', () => {
    expect(resolveDoctorLocale(undefined, {
      env: { LANG: 'fr_FR.UTF-8' },
      intlLocale: 'en-US',
    })).toBe('fr');

    expect(resolveDoctorLocale(undefined, {
      env: { LC_ALL: 'fr_CA.UTF-8', LANG: 'en_US.UTF-8' },
      intlLocale: 'en-US',
    })).toBe('fr');
  });

  it('uses LANGUAGE ordering, ignores C/POSIX and falls back to the Intl OS locale', () => {
    expect(resolveDoctorLocale(undefined, {
      env: { LC_ALL: 'C.UTF-8', LANGUAGE: 'de_DE:fr_FR:en_US' },
      intlLocale: 'en-US',
    })).toBe('fr');

    expect(resolveDoctorLocale(undefined, {
      env: { LANG: 'POSIX' },
      intlLocale: 'fr-FR',
    })).toBe('fr');
  });

  it('keeps explicit locale authoritative and rejects malformed explicit tags', () => {
    expect(resolveDoctorLocale('en-XA', {
      env: { LANG: 'fr_FR.UTF-8' },
      intlLocale: 'fr-FR',
    })).toBe('en-XA');
    expect(() => resolveDoctorLocale('not_a_locale')).toThrow(/invalid BCP-47 locale/);
  });

  it('bounds hostile environment locale values and defaults to English', () => {
    expect(resolveDoctorLocale(undefined, {
      env: {
        LANGUAGE: 'x'.repeat(1025),
        LANG: 'not_a_locale',
      },
      intlLocale: 'not_a_locale',
    })).toBe('en');
  });

  it('reports the effective model scope from config without mutating the environment', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-doctor-'));
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({ modelScopeMode: 'explicit', models: ['claude-opus-5'], visualPolicy: 'safe_exact' }));
    try {
      const result = collectDoctorReport({
        env: { FURYPIPE_CONFIG: file },
      });
      expect(result.modelScope).toEqual({
        mode: 'explicit',
        source: 'config',
        effectiveModels: ['claude-opus-5'],
        visualPolicy: 'safe_exact',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports environment scope as authoritative over persisted config', () => {
    const result = collectDoctorReport({
      env: { FURYPIPE_MODELS: 'off', FURYPIPE_VISUAL_POLICY: 'text_only' },
    });
    expect(result.modelScope).toEqual({
      mode: 'off',
      source: 'environment',
      effectiveModels: [],
      visualPolicy: 'text_only',
    });
  });
});
