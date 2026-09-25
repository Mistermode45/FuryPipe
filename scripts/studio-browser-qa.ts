// Real-browser QA for FuryPipe Studio (Chromium, Firefox, WebKit).
//
// Serves the real Studio page and API (src/studio/*) with deterministic
// discovery and a fake local OpenAI-compatible backend, then drives each
// engine through navigation, keyboard focus, the 404 view, chat streaming,
// dispatch preview, graph, empty and error states and a narrow viewport.
// Console errors (including CSP violations) fail the run.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium, firefox, webkit, type BrowserType, type Page } from 'playwright';

import { FURY_HARNESS_REGISTRY, type FuryHarnessDiscovery } from '../src/fury-harness-hub.js';
import { discoverFuryAiConnections } from '../src/fury-ai-connections.js';
import type { FuryLocalBackendStatus } from '../src/fury-local-fabric.js';
import { createRecoveryStore } from '../src/core/recovery-store.js';
import { createFuryMcpHub } from '../src/fury-mcp-hub.js';
import { createMemoryVNextStore } from '../src/memory-vnext.js';
import { createFurySkillHub } from '../src/fury-skill-hub.js';
import { createStudioApi, studioApiRoute } from '../src/studio/studio-api.js';
import { studioHtmlResponse } from '../src/studio/studio-page.js';

const HOST = '127.0.0.1';
const OUT = path.resolve(process.env.FURYPIPE_VALIDATION_OUTPUT_DIR?.trim() || 'artifacts/studio-browser-qa');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, HOST, resolve));
  return (server.address() as AddressInfo).port;
}

async function toNode(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
}

function toWeb(req: IncomingMessage, origin: string): Request {
  const chunks: Buffer[] = [];
  const body = new Promise<Buffer>((resolve) => {
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
  return new Request(new URL(req.url ?? '/', origin), {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])) as [string, string][],
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : new ReadableStream({ async start(c) { c.enqueue(new Uint8Array(await body)); c.close(); } }),
    // @ts-expect-error Node fetch requires duplex for streamed bodies
    duplex: 'half',
  });
}

async function startBackend(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const part of ['Hello', ' from', ' a local', ' model.']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(404).end();
  });
  return { server, baseUrl: `http://${HOST}:${await listen(server)}` };
}

const harnesses: FuryHarnessDiscovery = {
  format: 'furypipe-harness-discovery/v1', platform: 'linux',
  harnesses: FURY_HARNESS_REGISTRY.map((definition) => ({
    id: definition.id, displayName: definition.displayName, authentication: 'not-probed' as const, definition,
    installed: ['furypipe-native', 'claude-code', 'codex'].includes(definition.id),
    ...(definition.id === 'claude-code' ? { version: '2.1.282' } : {}),
    versionStatus: definition.id === 'furypipe-native' ? 'builtin' as const : ['claude-code', 'codex'].includes(definition.id) ? 'ok' as const : 'not-installed' as const,
  })),
};

async function startStudio(mode: 'normal' | 'empty' | 'error', backendUrl: string, projectRoot: string, run: string): Promise<{ server: Server; origin: string }> {
  // State is per engine run: one engine's actions (trust, pins, chats, memory) must not leak into the next.
  const state = `${mode}-${run}`;
  const local = (): FuryLocalBackendStatus[] => mode === 'empty'
    ? [{ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', reachable: false, protocols: [], models: [], error: 'unreachable' }]
    : [{ kind: 'ollama', baseUrl: backendUrl, reachable: true, version: '0.14.2', protocols: ['native', 'openai-chat', 'anthropic-messages'], models: [{ backend: 'ollama', baseUrl: backendUrl, id: 'qwen2.5-coder:7b', sizeBytes: 4_700_000_000, parameterSize: '7.6B', quantization: 'Q4_K_M' }, { backend: 'ollama', baseUrl: backendUrl, id: 'llama3.2:3b', sizeBytes: 2_000_000_000 }] }];
  const api = createStudioApi({
    projectRoot,
    // Isolated hub state: QA never touches the operator's ~/.furypipe.
    knowledgeDir: path.join(projectRoot, '.qa-knowledge', state),
    chatsDir: path.join(projectRoot, '.qa-chats', state),
    memory: mode === 'empty' ? { enabled: false, reason: 'Memory is off. Set FURYPIPE_WEBCHAT_MEMORY_CONFIG to an encrypted memory config to turn it on.' } : { enabled: true, store: createMemoryVNextStore({ recovery: createRecoveryStore(path.join(projectRoot, '.qa-memory', state), { namespace: 'studio-qa' }), authorize: () => true }) },
    mcpHub: createFuryMcpHub({ projectRoot, homeDir: path.join(projectRoot, '.qa-home'), stateDir: path.join(projectRoot, '.qa-mcp-hub', state) }),
    skillHub: createFurySkillHub({ projectRoot, homeDir: path.join(projectRoot, '.qa-home'), stateDir: path.join(projectRoot, '.qa-skill-hub', state), projectTrustedForInstructions: true }),
    discoverHarnesses: async () => harnesses,
    discoverConnections: async () => discoverFuryAiConnections(harnesses, { ANTHROPIC_API_KEY: 'qa-secret-never-render', CODEX_ACCESS_TOKEN: 'qa-codex-secret-never-render' }),
    discoverLocal: async () => {
      if (mode === 'error') throw new Error('probe failed');
      return { backends: local() };
    },
    discoverHardware: async () => ({ platform: 'linux', arch: 'x64', cpuModel: 'qa', cpuCount: 8, totalMemoryBytes: 32 * 1024 ** 3, freeMemoryBytes: 1, unifiedMemory: false, gpus: [{ name: 'QA GPU', memoryBytes: 12 * 1024 ** 3 }] }),
  });
  let origin = '';
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', origin);
      if (url.pathname === '/') return toNode(studioHtmlResponse(), res);
      if (url.pathname === '/control-plane') return toNode(new Response('<!doctype html><title>Control Plane</title><h1>Control Plane</h1>', { headers: { 'content-type': 'text/html' } }), res);
      const match = studioApiRoute(url.pathname);
      if (match && req.method === match.method) return toNode(await api.handle(match.route, toWeb(req, origin)), res);
      res.writeHead(404).end();
    })().catch(() => { res.statusCode = 500; res.end(); });
  });
  origin = `http://${HOST}:${await listen(server)}`;
  return { server, origin };
}

async function setMode(page: Page, mode: string): Promise<void> {
  await page.locator('#mode-button').click();
  await page.locator(`#mode-menu [role=menuitemradio][data-mode="${mode}"]`).click();
  await page.waitForFunction((m) => document.body.dataset.mode === m, mode);
}

async function visible(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).isVisible();
}

async function runEngine(name: string, type: BrowserType, origins: Record<'normal' | 'empty' | 'error', string>): Promise<Record<string, unknown>> {
  const browser = await type.launch();
  const errors: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${origins.normal}/`, { waitUntil: 'load' });
    assert(await page.title() === 'Chat · FuryPipe Studio', `${name}: title ${await page.title()}`);
    assert(await page.evaluate(() => document.activeElement === document.body), `${name}: focus moved on first load`);
    // Keyboard: skip link is the first tab stop and moves focus to main.
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.activeElement?.className) === 'skip', `${name}: skip link is not first tab stop`);

    // Chat streams from the local backend; Fury Auto routes and the route chip shows locality.
    await page.locator('#chat-form').waitFor({ state: 'visible' });
    assert(await page.locator('#chat').evaluate((n) => n.classList.contains('is-empty')), `${name}: new chat hero not shown`);
    assert((await page.locator('#model-button').textContent())?.includes('Fury Auto'), `${name}: default model is not Fury Auto`);
    const sideResizer = page.locator('#side-resizer');
    await sideResizer.focus();
    await page.keyboard.press('Home');
    const widthBefore = Number(await sideResizer.getAttribute('aria-valuenow'));
    await page.keyboard.press('ArrowRight');
    const widthAfter = Number(await sideResizer.getAttribute('aria-valuenow'));
    assert(widthAfter > widthBefore, `${name}: keyboard sidebar resize did not increase width`);
    assert(await page.evaluate(() => localStorage.getItem('furypipe.studio.sidebarWidth')) === String(widthAfter), `${name}: sidebar width was not persisted`);
    await page.locator('#chat-input').fill('Say hello');
    await page.locator('#chat-send').click();
    await page.locator('#chat-log .msg:not(.user)').filter({ hasText: 'Hello from a local model.' }).waitFor();
    assert(!(await page.locator('#chat').evaluate((n) => n.classList.contains('is-empty'))), `${name}: hero did not collapse into the conversation`);
    // A general prompt is routed to the general model, not the coder model.
    await page.locator('#chat-log .msg .who').filter({ hasText: 'llama3.2:3b · ollama · local' }).waitFor();
    await page.locator('#route-chip').filter({ hasText: 'llama3.2:3b' }).filter({ hasText: 'Local' }).waitFor();
    await page.locator('#route-chip').click();
    await page.locator('#route-pop').filter({ hasText: 'Why this route?' }).filter({ hasText: 'Fury Auto (2 models considered)' }).waitFor();
    await page.keyboard.press('Escape');
    assert(await page.locator('#route-pop').isHidden(), `${name}: route inspector did not close on Escape`);
    // Conversations persist; retry with another model branches and records the model.
    await page.locator('#chat-list button.conv').filter({ hasText: 'Say hello' }).first().waitFor();
    await page.locator('#model-button').click();
    await page.locator('#model-search').fill('qwen');
    await page.locator('#model-pop [role=option]').filter({ hasText: 'qwen2.5-coder:7b' }).click();
    assert((await page.locator('#model-button').textContent())?.includes('qwen2.5-coder:7b'), `${name}: model picker did not select`);
    await page.getByRole('button', { name: 'Retry with selected model' }).click();
    await page.locator('#chat-log .msg .who').filter({ hasText: 'qwen2.5-coder:7b · ollama · local' }).waitFor();
    await page.locator('#chat-list button.conv').filter({ hasText: 'Say hello (branch)' }).first().waitFor();
    await page.locator('#chat-list button.conv').filter({ hasText: /^Say hello$/u }).first().click();
    await page.locator('#chat-log .msg .who').filter({ hasText: 'llama3.2:3b · ollama · local' }).waitFor();
    assert(await page.locator('#chat-log .msg .who').filter({ hasText: 'qwen2.5-coder:7b' }).count() === 0, `${name}: retry changed the original conversation`);
    // Rename through the conversation menu (persisted by the chat store).
    await page.locator('#chat-list .conv-item').filter({ hasText: 'Say hello (branch)' }).locator('.conv-more').click();
    await page.locator('#conv-rename').click();
    await page.locator('#chat-list input.conv-edit').fill(`QA ${name} branch`);
    await page.locator('#chat-list input.conv-edit').press('Enter');
    await page.locator('#chat-list button.conv').filter({ hasText: `QA ${name} branch` }).waitFor();
    await page.locator('#model-button').click();
    await page.locator('#model-pop [role=option]').filter({ hasText: 'Fury Auto' }).click();

    // Progressive UX: Simple hides engineer/expert surfaces; Expert shows all.
    assert(await page.evaluate(() => document.body.dataset.mode) === 'simple', `${name}: default mode is not Simple`);
    assert(!(await page.locator('.side-nav a[data-view="agents"]').isVisible()), `${name}: Agents visible in Simple mode`);
    await setMode(page, 'expert');
    assert(await page.locator('.side-nav a[data-view="automations"]').isVisible(), `${name}: Automations hidden in Expert mode`);

    // Navigation via the keyboard.
    await page.locator('.side-nav a[data-view="agents"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'h-agents');
    assert(await page.locator('.side-nav a[data-view="agents"]').getAttribute('aria-current') === 'page', `${name}: aria-current`);
    await page.locator('#dispatch-mode').selectOption('SPECIALISTS');
    await page.locator('#dispatch-form button[type=submit]').click();
    await page.locator('#dispatch-out table tbody tr').first().waitFor();
    const rows = await page.locator('#dispatch-out table tbody tr').count();
    const status = await page.locator('#dispatch-status').textContent();
    assert(rows === 6 && /PLANNED/u.test(status ?? '') && /NOT_EXECUTED/u.test(status ?? ''), `${name}: dispatch preview rows=${rows} status=${status}`);

    // Cowork → Agents handoff keeps the chosen permissions.
    await page.goto(`${origins.normal}/#/cowork`);
    // Cowork run: ASK permissions raise an approval before anything starts.
    await page.locator('#cowork-intent').fill('Tidy the docs folder');
    await page.locator('#cowork-files').fill('docs/');
    await page.locator('#cowork-confirm').check();
    let approvalPrompt = '';
    page.once('dialog', (d) => { approvalPrompt = d.message(); void d.accept(); });
    await page.locator('#cowork-run').click();
    await page.waitForFunction(() => /Not started: project root is not a git repository/u.test(document.querySelector('#cowork-status')?.textContent ?? ''));
    assert(/WRITE, EXECUTE/u.test(approvalPrompt), `${name}: Cowork approval prompt: ${approvalPrompt}`);
    await page.locator('#perm-NETWORK').selectOption('ASK');
    await page.locator('#cowork-plan').click();
    await page.waitForFunction(() => location.hash === '#/agents');
    assert((await page.locator('#dispatch-ir').inputValue()).includes('"NETWORK": "ASK"'), `${name}: cowork permissions not carried`);

    await page.goto(`${origins.normal}/#/connections`);
    await page.locator('#connections-grid .connection-card').filter({ hasText: 'Claude / Anthropic' }).filter({ hasText: 'Credential configured' }).waitFor();
    assert(!(await page.locator('#connections-grid').textContent())?.includes('qa-secret-never-render'), `${name}: Anthropic secret leaked in Connections`);
    assert(!(await page.locator('#connections-grid').textContent())?.includes('qa-codex-secret-never-render'), `${name}: Codex secret leaked in Connections`);
    await page.goto(`${origins.normal}/#/models`);
    await page.locator('#backends .model-row .fit.ok').filter({ hasText: 'FITS' }).first().waitFor();
    assert(await page.locator('#backends .backend.up').count() === 1, `${name}: running backend card`);
    await page.goto(`${origins.normal}/#/runtimes`);
    await page.locator('#runtimes-body tr').filter({ hasText: 'Claude Code' }).filter({ hasText: '2.1.282' }).waitFor();
    await page.goto(`${origins.normal}/#/skills`);
    await page.locator('#skills-body tr').filter({ hasText: 'sql-review' }).filter({ hasText: 'trusted' }).waitFor();
    await page.getByRole('button', { name: 'Pin sql-review' }).click();
    await page.getByRole('button', { name: 'Unpin sql-review' }).waitFor();
    await page.locator('#skill-objective').fill('Review the SQL migration for locking');
    await page.locator('#skill-harness').selectOption('codex');
    await page.locator('#skill-select-form button[type=submit]').click();
    await page.locator('#skill-select-out p').filter({ hasText: 'Selected: sql-review' }).waitFor();
    await page.goto(`${origins.normal}/#/mcp`);
    await page.locator('#mcp-list h2').filter({ hasText: 'qa-fixture' }).waitFor();
    assert(!(await page.locator('#mcp-list').textContent())?.includes('qa-secret-value'), `${name}: MCP secret leaked`);
    // Untrusted project command: the probe is refused until the operator trusts the source.
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Health check qa-fixture' }).click();
    await page.waitForFunction(() => /mark the source trusted/u.test(document.querySelector('#mcp-status')?.textContent ?? ''));
    await page.getByRole('button', { name: 'Trust qa-fixture' }).click();
    await page.locator('#mcp-list .badge.ok').filter({ hasText: 'trusted' }).waitFor();
    let probePrompt = '';
    page.once('dialog', (d) => { probePrompt = d.message(); void d.accept(); });
    await page.getByRole('button', { name: 'Health check qa-fixture' }).click();
    await page.locator('#mcp-list .badge.ok').filter({ hasText: 'healthy · 1 tool(s)' }).waitFor({ timeout: 20_000 });
    await page.locator('#mcp-list td').filter({ hasText: 'inventory-proof' }).waitFor();
    assert(probePrompt.includes('mcp-direct-stdio-server.mjs') && probePrompt.includes('.mcp.json'), `${name}: probe confirmation must show the command: ${probePrompt}`);
    await page.goto(`${origins.normal}/#/knowledge`);
    await page.waitForFunction(() => /keyword search only/u.test(document.querySelector('#kb-stats')?.textContent ?? ''));
    await page.locator('#kb-dir').fill('src');
    await page.locator('#kb-ingest-form button').click();
    await page.waitForFunction(() => /Indexed \d+ new or changed file/u.test(document.querySelector('#kb-ingest-status')?.textContent ?? ''));
    await page.locator('#kb-query').fill('session');
    await page.locator('#kb-mode').selectOption('lexical');
    await page.locator('#kb-search-form button').click();
    await page.locator('#kb-results li b').filter({ hasText: 'src/auth/session.ts:' }).first().waitFor();
    await page.getByRole('button', { name: 'Ask a local model with these sources' }).click();
    await page.waitForFunction(() => location.hash === '#/chat' && (document.querySelector('#chat-input') as HTMLTextAreaElement | null)?.value.includes('[1] src/auth/session.ts:'));
    await page.goto(`${origins.normal}/#/web`);
    await page.locator('#web-input').fill('http://127.0.0.1/admin');
    await page.locator('#web-form button').click();
    await page.waitForFunction(() => /Refused: .*private, loopback/u.test(document.querySelector('#web-status')?.textContent ?? ''));
    await page.locator('#web-action').selectOption('SEARCH');
    await page.locator('#web-input').fill('furypipe');
    await page.locator('#web-form button').click();
    await page.waitForFunction(() => /Refused: no search adapter configured/u.test(document.querySelector('#web-status')?.textContent ?? ''));
    await page.goto(`${origins.normal}/#/memory`);
    await page.locator('#mem-text').fill(`QA ${name} deploys on Tuesdays only`);
    await page.locator('#mem-add-form button').click();
    await page.locator('#mem-body tr').filter({ hasText: 'active' }).first().waitFor();
    await page.locator('#mem-query').fill(`when does QA ${name} deploy`);
    await page.locator('#mem-search-form button').click();
    await page.locator('#mem-results li').filter({ hasText: `QA ${name} deploys on Tuesdays only` }).filter({ hasText: 'why:' }).waitFor();
    await page.goto(`${origins.empty}/#/memory`);
    await page.waitForFunction(() => /Memory is off/u.test(document.querySelector('#mem-status')?.textContent ?? ''));
    assert(await page.locator('#mem-forms').isHidden(), `${name}: memory forms visible while off`);
    await page.goto(`${origins.normal}/#/integrations`);
    await page.locator('#int-body tr').filter({ hasText: 'qa-fixture' }).filter({ hasText: 'MCP' }).waitFor();
    await page.locator('#int-body tr').filter({ hasText: 'qa-status-api' }).filter({ hasText: 'READ_ONLY' }).waitFor();
    await page.goto(`${origins.normal}/#/code`);
    await page.waitForFunction(() => document.querySelector('#graph-provider')?.textContent === 'graphify');
    await page.locator('#blast-files').fill('src/auth/session.ts');
    await page.locator('#blast-form button').click();
    await page.locator('#blast-out li').filter({ hasText: 'tests/login.test.ts' }).waitFor();
    await page.locator('#tree button').filter({ hasText: /^src\/$/u }).click();
    await page.locator('#tree button').filter({ hasText: /^auth\/$/u }).click();
    await page.locator('#tree button').filter({ hasText: /^session\.ts$/u }).click();
    await page.waitForFunction(() => (document.querySelector('#file-view')?.textContent ?? '').includes('createSession'));
    // The QA project is not a git repository: worktrees report that plainly.
    await page.waitForFunction(() => /Worktrees unavailable/u.test(document.querySelector('#wt-status')?.textContent ?? ''));

    await page.goto(`${origins.normal}/#/mission`);
    await page.locator('#runs .empty').waitFor();
    await page.locator('#run-intent').fill('Fix login');
    await page.locator('#run-files').fill('src/auth/login.ts');
    await page.locator('#run-confirm').check();
    await page.locator('#run-form button[type=submit]').click();
    // The QA project is not a git repository: the run must be refused, visibly.
    await page.waitForFunction(() => /Not started: project root is not a git repository/u.test(document.querySelector('#run-status')?.textContent ?? ''));

    await page.goto(`${origins.normal}/#/automations`);
    await page.locator('#flow-form button[type=submit]').click();
    await page.locator('#flow-canvas svg g.node').first().waitFor();
    assert(await page.locator('#flow-canvas svg g.node').count() === 7, `${name}: flow canvas node count`);
    assert(await page.locator('#flow-canvas svg g.node.agentic').count() === 2, `${name}: agentic zone count`);
    await page.locator('#flow-dry').click();
    await page.locator('#flow-trace li').filter({ hasText: 'Paused at human approval: approve' }).waitFor();

    await page.goto(`${origins.normal}/#/does-not-exist`);
    assert(await visible(page, '#h-notfound'), `${name}: 404 view`);
    await page.goto(`${origins.normal}/#/settings`);
    await page.locator('a[href="/control-plane"]').click();
    await page.waitForURL(`${origins.normal}/control-plane`);

    // Empty and error states.
    await page.goto(`${origins.empty}/#/chat`);
    await page.locator('#chat-empty').waitFor({ state: 'visible' });
    await page.goto(`${origins.error}/#/models`);
    await page.waitForFunction(() => /Local discovery failed/u.test(document.querySelector('#models-status')?.textContent ?? ''));

    // Responsive: desktop, narrow desktop, tablet and phone widths, every view, no horizontal page overflow.
    await page.goto(`${origins.normal}/#/chat`);
    await setMode(page, 'expert');
    for (const width of [1280, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const view of ['chat', 'cowork', 'code', 'agents', 'mission', 'knowledge', 'web', 'memory', 'automations', 'models', 'connections', 'runtimes', 'skills', 'mcp', 'integrations', 'settings']) {
        await page.goto(`${origins.normal}/#/${view}`);
        await page.locator(`section[data-view="${view}"] h1`).waitFor();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(overflow <= 1, `${name}: horizontal overflow ${overflow}px on ${view} at ${width}px`);
      }
    }

    // Locale: browser language is detected automatically; a persisted override wins.
    const frContext = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'fr-FR' });
    const frPage = await frContext.newPage();
    await frPage.goto(`${origins.normal}/#/chat`, { waitUntil: 'load' });
    assert(await frPage.evaluate(() => localStorage.getItem('furypipe.studio.languageV2')) === null, `${name}: locale test unexpectedly has a stored override`);
    await frPage.locator('.hero h2').filter({ hasText: 'Comment FuryPipe peut-il vous aider ?' }).waitFor();
    assert(await frPage.locator('html').getAttribute('lang') === 'fr', `${name}: French browser locale was not applied`);
    await frPage.goto(`${origins.normal}/#/settings`);
    await frPage.locator('#set-general').filter({ hasText: 'Langue' }).waitFor();
    await frPage.evaluate(() => localStorage.setItem('furypipe.studio.languageV2', 'en'));
    await frPage.reload({ waitUntil: 'load' });
    assert(await frPage.locator('html').getAttribute('lang') === 'en', `${name}: explicit English language override was not applied`);
    await frPage.goto(`${origins.normal}/#/chat`);
    await frPage.locator('.hero h2').filter({ hasText: 'How can FuryPipe help?' }).waitFor();
    await frContext.close();

    // Expected: 503 discovery-failed (error-state server), 409 not-runnable / web search not configured, 403 web SSRF refusal.
    const unexpected = errors.filter((e) => !/Failed to load resource: the server responded with a status of (503|409|403|422)/u.test(e));
    assert(unexpected.length === 0, `${name}: console errors: ${unexpected.join(' | ')}`);
    return { engine: name, status: 'PASS', dispatchRows: rows, consoleErrors: 0 };
  } finally {
    await browser.close();
  }
}

// Visual evidence: the key surfaces at desktop, narrow desktop and phone widths.
async function captureScreens(type: BrowserType, origins: Record<'normal' | 'empty' | 'error', string>): Promise<string[]> {
  const dir = path.join(OUT, 'screens');
  mkdirSync(dir, { recursive: true });
  const browser = await type.launch();
  const shots: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const shot = async (file: string): Promise<void> => {
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(dir, file) });
      shots.push(file);
    };
    await page.goto(`${origins.normal}/#/chat`);
    await page.locator('#model-button').filter({ hasText: 'Fury Auto' }).waitFor();
    await shot('01-new-chat-1440.png');
    await page.locator('#model-button').click();
    await page.locator('#model-pop [role=option]').first().waitFor();
    await shot('02-model-picker.png');
    await page.keyboard.press('Escape');
    await page.locator('#attach-input').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\nShip the Studio rework.\n') });
    await page.locator('#chat-input').fill('Summarise these notes in one line');
    await page.locator('#attach-tray .att').waitFor();
    await shot('03-attachment.png');
    await page.locator('#chat-send').click();
    await page.locator('#chat-log .msg:not(.user)').filter({ hasText: 'Hello from a local model.' }).waitFor();
    await shot('04-conversation.png');
    await page.locator('#route-chip').click();
    await page.locator('#route-pop').waitFor();
    await shot('05-why-this-route.png');
    await page.keyboard.press('Escape');
    await page.goto(`${origins.normal}/#/models`);
    await page.locator('#backends .model-row').first().waitFor();
    await shot('06-models.png');
    await page.goto(`${origins.normal}/#/settings`);
    await shot('07-settings.png');
    await setMode(page, 'expert');
    await page.goto(`${origins.normal}/#/mission`);
    await page.locator('section[data-view="mission"] h1').waitFor();
    await shot('08-expert-mission-control.png');
    // Browser-level Ctrl+K can be intercepted by the browser chrome in CI.
    // Dispatch the same bubbling DOM KeyboardEvent to verify FuryPipe's handler.
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })));
    await page.locator('#palette-overlay').waitFor({ state: 'visible' });
    await page.locator('#palette-list [role=option]').first().waitFor();
    await shot('09-command-palette.png');
    await page.keyboard.press('Escape');
    await page.goto(`${origins.empty}/#/chat`);
    await page.locator('#chat-empty').waitFor({ state: 'visible' });
    await shot('10-no-local-model.png');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`${origins.normal}/#/chat`);
    await page.locator('#chat-list button.conv').first().waitFor();
    await shot('11-chat-1024.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origins.normal}/#/chat`);
    await page.locator('#model-button').waitFor();
    await shot('12-chat-390.png');
    await page.locator('#side-open').click();
    await shot('13-drawer-390.png');
    await context.close();
    const light = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' });
    const lp = await light.newPage();
    await lp.goto(`${origins.normal}/#/settings`);
    await lp.locator('input[name="pref-theme"][value="system"]').check({ force: true });
    await lp.goto(`${origins.normal}/#/chat`);
    await lp.locator('#model-button').filter({ hasText: 'Fury Auto' }).waitFor();
    await lp.waitForTimeout(150);
    await lp.screenshot({ path: path.join(dir, '14-new-chat-light-system.png') });
    shots.push('14-new-chat-light-system.png');
  } finally {
    await browser.close();
  }
  return shots;
}

async function main(): Promise<void> {
  const project = mkdtempSync(path.join(tmpdir(), 'furypipe-studio-qa-'));
  cpSync(path.resolve('tests/fixtures/graphify-0.9.67'), project, { recursive: true });
  const { readFileSync, utimesSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(path.join(project, 'graphify-out', 'manifest.json'), 'utf8')) as Record<string, { mtime: number }>;
  for (const [file, meta] of Object.entries(manifest)) utimesSync(path.join(project, file), meta.mtime - 10, meta.mtime - 10);
  mkdirSync(path.join(project, '.claude', 'skills', 'sql-review'), { recursive: true });
  writeFileSync(path.join(project, '.claude', 'skills', 'sql-review', 'SKILL.md'), '---\nname: sql-review\ndescription: Review SQL migrations for locking and data loss.\n---\n\nCheck locks.\n');
  writeFileSync(path.join(project, '.mcp.json'), JSON.stringify({ mcpServers: { 'qa-fixture': { command: process.execPath, args: [path.resolve('tests/fixtures/mcp-direct-stdio-server.mjs')], env: { QA_TOKEN: 'qa-secret-value' } } } }));
  mkdirSync(path.join(project, '.furypipe'), { recursive: true });
  writeFileSync(path.join(project, 'status-api.json'), JSON.stringify({ openapi: '3.1.0', info: { title: 'Status' }, servers: [{ url: 'https://status.example.com' }], paths: { '/status': { get: { operationId: 'getStatus' } } } }));
  writeFileSync(path.join(project, '.furypipe', 'integrations.json'), JSON.stringify({ format: 'furypipe-integrations/v1', integrations: [{ id: 'qa-status-api', kind: 'OPENAPI', spec: 'status-api.json' }] }));
  const backend = await startBackend();
  const engines = (process.env.FURYPIPE_STUDIO_QA_ENGINES ?? 'chromium,firefox,webkit').split(',').map((s) => s.trim());
  const types: Record<string, BrowserType> = { chromium, firefox, webkit };
  const results: Record<string, unknown>[] = [];
  const servers: Server[] = [backend.server];
  try {
    for (const [index, engine] of engines.entries()) {
      const type = types[engine];
      assert(type, `unknown engine ${engine}`);
      const run = `${engine}-${index}`;
      const normal = await startStudio('normal', backend.baseUrl, project, run);
      const empty = await startStudio('empty', backend.baseUrl, project, run);
      const error = await startStudio('error', backend.baseUrl, project, run);
      servers.push(normal.server, empty.server, error.server);
      results.push(await runEngine(engine, type, { normal: normal.origin, empty: empty.origin, error: error.origin }));
      if (engine === 'chromium' && process.env.FURYPIPE_STUDIO_QA_SCREENS !== '0') results[results.length - 1]!.screens = await captureScreens(type, { normal: normal.origin, empty: empty.origin, error: error.origin });
      console.log(`✓ studio ${engine}`);
    }
  } finally {
    for (const s of servers) await new Promise((r) => s.close(r));
    rmSync(project, { recursive: true, force: true });
  }
  mkdirSync(OUT, { recursive: true });
  const evidence = { format: 'furypipe-studio-browser-qa/v1', status: 'PASS', sourceCommit: process.env.FURYPIPE_SOURCE_COMMIT ?? 'not-bound', engines: results };
  writeFileSync(path.join(OUT, 'studio-browser-qa.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`studio browser QA passed: ${results.length} engine(s)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
