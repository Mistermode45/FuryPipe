import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildStudioQaMatrix,
  renderStaticStudioPage,
  runStudioBrowserQa,
  type StudioBrowserObservation,
  type StudioBrowserQaAdapter,
  type StudioProject,
  type StudioQaCase,
} from '../src/web-studio/index.ts';

const HOST = '127.0.0.1';
const REPORT_DIR = join(process.cwd(), 'artifacts', 'web-studio-browser-qa');
const SOURCE_COMMIT = process.env.FURYPIPE_SOURCE_COMMIT ?? 'unknown';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function findChrome(): string {
  const candidates = [
    process.env.CHROME_BIN,
    'google-chrome-stable',
    'google-chrome',
    'chromium',
    'chromium-browser',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (candidate.includes('/')) return candidate;
    const found = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error('No Chromium/Chrome executable found. Set CHROME_BIN explicitly.');
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed to allocate a TCP port'));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

class CdpSession {
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();
  readonly consoleErrors: string[] = [];
  readonly runtimeExceptions: string[] = [];

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', async (event) => {
      const text = typeof event.data === 'string'
        ? event.data
        : Buffer.from(await (event.data as Blob).arrayBuffer()).toString('utf8');
      const message = JSON.parse(text);
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params?.exceptionDetails;
        this.runtimeExceptions.push(detail?.exception?.description ?? detail?.text ?? 'runtime exception');
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        const args = Array.isArray(message.params.args) ? message.params.args : [];
        this.consoleErrors.push(args.map((arg: any) => arg.value ?? arg.description ?? '').join(' '));
      }
      if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
        this.consoleErrors.push(message.params.entry.text ?? 'browser log error');
      }
    });
  }

  static async connect(url: string): Promise<CdpSession> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP websocket connection failed')), { once: true });
    });
    return new CdpSession(socket);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string): Promise<any> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'browser evaluation failed');
    }
    return result.result?.value;
  }

  async waitFor(expression: string, description: string, timeoutMs = 8_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(expression).catch(() => false)) return;
      await delay(75);
    }
    throw new Error(`Timed out waiting for ${description}`);
  }

  close(): void {
    this.socket.close();
  }
}

async function startChrome(chromeBin: string) {
  const debugPort = await freePort();
  const profile = await mkdtemp(join(tmpdir(), 'furypipe-web-studio-qa-'));
  const child = spawn(chromeBin, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-first-run',
    `--remote-debugging-address=${HOST}`,
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const stderr: string[] = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr.push(...String(chunk).split(/\r?\n/u).filter(Boolean));
    if (stderr.length > 80) stderr.splice(0, stderr.length - 80);
  });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chromium exited early: ${stderr.join('\n')}`);
    try {
      const response = await fetch(`http://${HOST}:${debugPort}/json/version`);
      if (response.ok) {
        return {
          debugPort,
          async close() {
            const waitForExit = () => new Promise<void>((resolve) => {
              if (child.exitCode !== null || child.signalCode !== null) resolve();
              else child.once('exit', () => resolve());
            });
            child.kill('SIGTERM');
            let exited = false;
            await Promise.race([waitForExit().then(() => { exited = true; }), delay(2_000)]);
            if (!exited) {
              child.kill('SIGKILL');
              await waitForExit();
            }
            for (let attempt = 0; attempt < 10; attempt += 1) {
              try {
                await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
                break;
              } catch (error) {
                if (attempt === 9) throw error;
                await delay(100 * (attempt + 1));
              }
            }
          },
        };
      }
    } catch {
      // CDP not ready yet.
    }
    await delay(100);
  }
  child.kill('SIGKILL');
  await rm(profile, { recursive: true, force: true });
  throw new Error(`Timed out starting Chromium: ${stderr.join('\n')}`);
}

async function openTarget(debugPort: number): Promise<{ id: string; webSocketDebuggerUrl: string }> {
  const response = await fetch(`http://${HOST}:${debugPort}/json/new?about%3Ablank`, { method: 'PUT' });
  if (!response.ok) throw new Error(`failed to create Chromium target: HTTP ${response.status}`);
  const target = await response.json() as { id?: string; webSocketDebuggerUrl?: string };
  assert(target.id && target.webSocketDebuggerUrl, 'Chromium target has no CDP websocket');
  return { id: target.id, webSocketDebuggerUrl: target.webSocketDebuggerUrl };
}

async function closeTarget(debugPort: number, targetId: string): Promise<void> {
  await fetch(`http://${HOST}:${debugPort}/json/close/${encodeURIComponent(targetId)}`).catch(() => undefined);
}

function project(): StudioProject {
  return {
    id: 'browser-qa-project',
    status: 'APPROVED',
    brief: {
      id: 'browser-qa-brief',
      objective: 'Verify the deterministic FuryPipe Web Studio artifact in a real Chromium runtime',
      audience: ['operators'],
      conversionGoals: ['signup'],
      targetLocales: ['en', 'fr', 'en-XA', 'ar-XB'],
      targetDevices: ['mobile', 'tablet', 'desktop'],
      constraints: ['WCAG 2.2 AA'],
    },
    sources: [{
      id: 'wcag',
      canonicalUrl: 'https://www.w3.org/TR/WCAG22/',
      decision: 'REFERENCE_ONLY',
      licenseStatus: 'NOT_APPLICABLE',
      trust: 'REFERENCE',
    }],
    variants: [
      {
        id: 'minimal',
        name: 'Minimal',
        rationale: 'Low visual noise and clear hierarchy',
        desktop: 'desktop-contract',
        tablet: 'tablet-contract',
        mobile: 'mobile-contract',
        accessibilityRisks: [],
        performanceRisks: [],
        implementationComplexity: 'low',
      },
      {
        id: 'premium',
        name: 'Premium',
        rationale: 'Visual storytelling with controlled motion',
        desktop: 'desktop-contract',
        tablet: 'tablet-contract',
        mobile: 'mobile-contract',
        accessibilityRisks: ['motion'],
        performanceRisks: ['hero-media'],
        implementationComplexity: 'medium',
      },
    ],
    selectedVariantId: 'minimal',
    implementationCommit: SOURCE_COMMIT === 'unknown' ? null : SOURCE_COMMIT,
    evidence: {
      qa: 'NOT_RUN',
      accessibility: 'NOT_RUN',
      security: 'NOT_RUN',
      seo: 'NOT_RUN',
      performance: 'NOT_RUN',
      privacy: 'NOT_RUN',
      deployment: 'NOT_RUN',
      backup: 'NOT_CHECKED',
    },
  };
}

async function startStudioServer() {
  const server = createServer((request, response) => {
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('studio server address unavailable');
      const url = new URL(request.url ?? '/', `http://${HOST}:${address.port}`);
      if (url.pathname !== '/') {
        response.statusCode = 404;
        response.end('not found');
        return;
      }
      const locale = url.searchParams.get('locale') ?? 'en';
      const artifact = renderStaticStudioPage(project(), {
        locale,
        path: '/',
        title: 'FuryPipe Web Studio QA',
        description: 'Deterministic browser-quality evidence for FuryPipe Web Studio structural and responsive validation.',
        heading: 'FuryPipe Web Studio',
        paragraphs: [
          'Real Chromium checks the generated artifact across bounded viewports and QA locales.',
          'Machine evidence stays separate from production deployment and field performance claims.',
        ],
        canonicalUrl: 'https://example.test/',
      });
      response.statusCode = 200;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(artifact.html);
    } catch (error) {
      response.statusCode = 500;
      response.end('internal server error');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('studio server did not bind');
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function runObservation(
  browser: { debugPort: number },
  testCase: StudioQaCase,
  targetUrl: string,
): Promise<StudioBrowserObservation> {
  const target = await openTarget(browser.debugPort);
  const cdp = await CdpSession.connect(target.webSocketDebuggerUrl);
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: testCase.viewport.width,
      height: testCase.viewport.height,
      deviceScaleFactor: 1,
      mobile: testCase.browserProject.startsWith('mobile-'),
    });
    await cdp.send('Page.navigate', { url: targetUrl });
    await cdp.waitFor('document.readyState === "complete"', 'studio document load');

    const observation = await cdp.evaluate(`(async () => {
      const root = document.documentElement;
      const anchors = [...document.querySelectorAll('a[href]')];
      let brokenLinks = 0;
      for (const anchor of anchors) {
        const href = anchor.getAttribute('href');
        if (!href) continue;
        if (href.startsWith('#')) {
          if (href.length > 1 && !document.getElementById(href.slice(1))) brokenLinks += 1;
          continue;
        }
        const resolved = new URL(href, location.href);
        if (resolved.origin !== location.origin) continue;
        try {
          const response = await fetch(resolved.href, { method: 'GET', redirect: 'manual' });
          if (!response.ok) brokenLinks += 1;
        } catch {
          brokenLinks += 1;
        }
      }
      const interactive = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        });
      const keyboardReachable = interactive.every((element) => element.tabIndex >= 0);
      const externalScriptOrigins = [...document.querySelectorAll('script[src]')]
        .map((script) => new URL(script.src, location.href).origin)
        .filter((origin) => origin !== location.origin);
      return {
        loaded: document.readyState === 'complete' && !!document.body,
        horizontalOverflow: root.scrollWidth > root.clientWidth + 1 || document.body.scrollWidth > root.clientWidth + 1,
        keyboardReachable,
        singleH1: document.querySelectorAll('h1').length === 1,
        lang: root.lang,
        direction: getComputedStyle(root).direction,
        hasTitle: document.title.trim().length > 0,
        hasMetaDescription: !!document.querySelector('meta[name="description"][content]')?.getAttribute('content')?.trim(),
        hasCanonical: !!document.querySelector('link[rel="canonical"][href]')?.getAttribute('href')?.trim(),
        brokenLinks,
        externalScriptOrigins,
      };
    })()`);

    const consoleErrors = cdp.consoleErrors.length + cdp.runtimeExceptions.length;
    return {
      caseId: testCase.id,
      loaded: observation.loaded,
      horizontalOverflow: observation.horizontalOverflow,
      keyboardReachable: observation.keyboardReachable,
      singleH1: observation.singleH1,
      lang: observation.lang,
      direction: observation.direction,
      hasTitle: observation.hasTitle,
      hasMetaDescription: observation.hasMetaDescription,
      hasCanonical: observation.hasCanonical,
      brokenLinks: observation.brokenLinks,
      consoleErrors,
      externalScriptOrigins: observation.externalScriptOrigins,
    };
  } finally {
    cdp.close();
    await closeTarget(browser.debugPort, target.id);
  }
}

async function main(): Promise<void> {
  await mkdir(REPORT_DIR, { recursive: true });
  const chromeBin = findChrome();
  const browser = await startChrome(chromeBin);
  const server = await startStudioServer();
  try {
    const chromiumCases = buildStudioQaMatrix().filter((testCase) =>
      testCase.browserProject === 'desktop-chromium' || testCase.browserProject === 'mobile-chromium'
    );
    assert(chromiumCases.length === 48, `expected 48 real Chromium cases, got ${chromiumCases.length}`);

    const adapter: StudioBrowserQaAdapter = {
      id: 'chromium-cdp',
      version: '1.0.0',
      run: (testCase, targetUrl) => runObservation(browser, testCase, targetUrl),
    };
    const report = await runStudioBrowserQa(adapter, `http://${HOST}:${server.port}`, chromiumCases);
    assert(report.totalCases === 48, 'unexpected Web Studio QA case count');
    assert(report.browserQa === 'PARTIAL', 'a Chromium-only subset must remain partial');
    assert(report.structuralAccessibility === 'PARTIAL', 'a Chromium-only subset must remain partial');
    assert(report.structuralSeo === 'PARTIAL', 'a Chromium-only subset must remain partial');
    assert(report.thirdPartyScriptSurface === 'PARTIAL', 'a Chromium-only subset must remain partial');
    assert(report.productionPerformance === 'NOT_RUN', 'production performance must remain NOT_RUN');
    assert(report.deployment === 'NOT_RUN', 'deployment must remain NOT_RUN');
    assert(report.promotionEvidenceCompatible === false, 'browser QA must not auto-promote release evidence');
    assert(report.failures.length === 0, 'Web Studio browser QA has failures');

    const evidence = {
      format: 'furypipe-web-studio-chromium-evidence/v1',
      sourceCommit: SOURCE_COMMIT,
      chromeBin,
      generatedAt: new Date().toISOString(),
      executedBrowserProjects: ['desktop-chromium', 'mobile-chromium'],
      unexecutedBrowserProjects: ['desktop-firefox', 'desktop-webkit', 'mobile-webkit'],
      report,
    };
    await writeFile(join(REPORT_DIR, 'report.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log('web-studio Chromium subset passed: 48/48 real Chromium cases; overall matrix remains PARTIAL');
    console.log('This Chromium-only run omits Firefox/WebKit; the separate Cross-Browser QA workflow owns those engines');
  } finally {
    await browser.close();
    await server.close();
  }
}

await main();
