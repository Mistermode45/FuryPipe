import { describe, expect, it } from 'vitest';
import { renderDoctorReport, type DoctorReport } from '../src/doctor.js';

const report: DoctorReport = {
  platform: { os: 'test 1', arch: 'x64', shell: 'powershell', cwd: 'C:\\work', executable: 'node' },
  runtime: {
    node: '26.8.2',
    npm: { status: 'available', value: '11.14.1' },
    pnpm: { status: 'available', value: '12.3.4' },
  },
  network: { host: '127.0.0.1', port: 47821, upstream: 'https://api.example.test' },
  paths: { config: 'C:\\Users\\test\\config.json', events: 'C:\\Users\\test\\events.jsonl' },
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
    expect(parsed.network.port).toBe(47821);
    expect(parsed.runtime.pnpm.value).toBe('12.3.4');
  });

  it('wires the locale option into human-readable output while keeping protocol values intact', () => {
    const output = renderDoctorReport(report, false, 'fr-FR');
    expect(output).toContain('Configuration: C:\\Users\\test\\config.json');
    expect(output).toContain('Écoute: 127.0.0.1:47821');
    expect(output).toContain('Node: 26.8.2');
  });
});
