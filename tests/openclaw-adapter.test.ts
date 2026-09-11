import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverOpenClaw, resolveOpenClawPaths } from '../src/openclaw.js';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-openclaw-'));
  temporaryDirectories.push(root);
  return root;
}

describe('OpenClaw adapter', () => {
  it('discovers JSON5 config/workspace and reports secret paths without values', () => {
    const root = fixture();
    const state = path.join(root, '.openclaw');
    const workspace = path.join(root, 'workspace');
    fs.mkdirSync(state, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '# fixture\n');
    fs.writeFileSync(path.join(state, 'openclaw.json'), `// OpenClaw JSON5 fixture\n{
      agents: { defaults: { workspace: '${workspace.replaceAll('\\', '\\\\')}' }, entries: { main: {}, helper: {} }, },
      gateway: { bind: 'lan', auth: { mode: 'token', token: 'do-not-return-this' } },
    }`);

    const report = discoverOpenClaw({ env: { OPENCLAW_HOME: root }, home: root, checkRuntime: false });
    expect(report.config.status).toBe('valid');
    expect(report.config.agentEntryCount).toBe(2);
    expect(report.workspace).toMatchObject({ exists: true, path: workspace, files: { 'AGENTS.md': 'present' } });
    expect(report.security).toMatchObject({ configContainsSecretBearingFields: true, nonLoopbackWithoutAuth: false });
    expect(JSON.stringify(report)).not.toContain('do-not-return-this');
    expect(report.config.secretBearingPaths).toEqual(['$.gateway.auth.token']);
  });

  it('honours explicit path overrides and keeps unknown/missing state honest', () => {
    const root = fixture();
    const configPath = path.join(root, 'custom.json5');
    const workspacePath = path.join(root, 'custom-workspace');
    fs.writeFileSync(configPath, `{ agents: { defaults: { workspace: '${path.join(root, 'config-workspace').replaceAll('\\', '\\\\')}' } } }`);
    const paths = resolveOpenClawPaths({
      home: root,
      env: { OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_WORKSPACE_DIR: workspacePath },
    });
    expect(paths.configPath).toBe(configPath);
    expect(paths.workspaceDir).toBe(workspacePath);
    const report = discoverOpenClaw({ home: root, env: { OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_WORKSPACE_DIR: workspacePath }, checkRuntime: false });
    expect(report.config.status).toBe('valid');
    expect(report.paths.sources.workspaceDir).toBe('environment');
    expect(report.workspace.path).toBe(workspacePath);
    expect(report.workspace.exists).toBe(false);
  });

  it('marks invalid JSON5 as invalid without exposing file content', () => {
    const root = fixture();
    const configPath = path.join(root, 'invalid.json5');
    fs.writeFileSync(configPath, `{ gateway: { token: 'secret-fixture', `);
    const report = discoverOpenClaw({ home: root, env: { OPENCLAW_CONFIG_PATH: configPath }, checkRuntime: false });
    expect(report.config.status).toBe('invalid');
    expect(JSON.stringify(report)).not.toContain('secret-fixture');
    expect(report.security.warnings).toContain('config is not valid JSON5');
  });
});
