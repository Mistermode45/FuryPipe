import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';

import { DashboardState } from '../src/dashboard.ts';
import {
  buildStudioQaMatrix,
  renderStaticStudioPage,
  runStudioBrowserQa,
  type StudioBrowserObservation,
  type StudioProject,
  type StudioQaCase,
} from '../src/web-studio/index.ts';

const HOST = '127.0.0.1';
const REPORT_DIR = join(process.cwd(), 'artifacts', 'cross-browser-qa');
const SOURCE_COMMIT = process.env.FURYPIPE_SOURCE_COMMIT ?? '';
const SHA40 = /^[0-9a-f]{40}$/u;
const expectedStudioPolicyDiagnostics: Record<string, string[]> = {};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectedDirection(locale: string): 'ltr' | 'rtl' {
  return locale === 'ar-XB' ? 'rtl' : 'ltr';
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('browser QA server did not bind to a TCP port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function writeResponse(response: import('node:http').ServerResponse, result: Response): Promise<void> {
  response.statusCode = result.status;
  for (const [name, value] of result.headers) response.setHeader(name, value);
  response.end(Buffer.from(await result.arrayBuffer()));
}

async function startDashboardServer() {
  const dashboard = new DashboardState(undefined, async () => new Map());
  const fragmentRequests: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('dashboard server address unavailable');
      const url = new URL(request.url ?? '/', `http://${HOST}:${address.port}`);
      let result: Response;
      if (url.pathname === '/' || url.pathname === '/dashboard') {
        result = dashboard.serveHtml(
          address.port,
          url.searchParams.get('locale') ?? undefined,
          typeof request.headers['accept-language'] === 'string' ? request.headers['accept-language'] : undefined,
        );
      } else if (url.pathname.startsWith('/fragments/')) {
        fragmentRequests.push(url.toString());
        result = await dashboard.serveFragment(decodeURIComponent(url.pathname.slice('/fragments/'.length)), url, address.port);
      } else {
        result = new Response('not found', { status: 404 });
      }
      await writeResponse(response, result);
    } catch (error) {
      response.statusCode = 500;
      response.end('internal server error');
    }
  });
  const port = await listen(server);
  return { port, fragmentRequests, close: () => close(server) };
}

function studioProject(): StudioProject {
  return {
    id: 'browser-qa-project',
    status: 'APPROVED',
    brief: {
      id: 'browser-qa-brief',
      objective: 'Verify the deterministic FuryPipe Web Studio artifact in real browser engines',
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
        id: 'minimal', name: 'Minimal', rationale: 'Low visual noise and clear hierarchy',
        desktop: 'desktop-contract', tablet: 'tablet-contract', mobile: 'mobile-contract',
        accessibilityRisks: [], performanceRisks: [], implementationComplexity: 'low',
      },
      {
        id: 'premium', name: 'Premium', rationale: 'Visual storytelling with controlled motion',
        desktop: 'desktop-contract', tablet: 'tablet-contract', mobile: 'mobile-contract',
        accessibilityRisks: ['motion'], performanceRisks: ['hero-media'], implementationComplexity: 'medium',
      },
    ],
    selectedVariantId: 'minimal',
    implementationCommit: SOURCE_COMMIT,
    evidence: {
      qa: 'NOT_RUN', accessibility: 'NOT_RUN', security: 'NOT_RUN', seo: 'NOT_RUN',
      performance: 'NOT_RUN', privacy: 'NOT_RUN', deployment: 'NOT_RUN', backup: 'NOT_CHECKED',
    },
  };
}

async function startStudioServer() {
  const server = createServer((request, response) => {
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('studio server address unavailable');
      const url = new URL(request.url ?? '/', `http://${HOST}:${address.port}`);
      if (url.pathname === '/favicon.ico') {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (url.pathname !== '/') {
        response.statusCode = 404;
        response.end('not found');
        return;
      }
      const page = renderStaticStudioPage(studioProject(), {
        locale: url.searchParams.get('locale') ?? 'en',
        path: '/',
        title: 'FuryPipe Web Studio QA',
        description: 'Deterministic browser-quality evidence for FuryPipe Web Studio structural and responsive validation.',
        heading: 'FuryPipe Web Studio',
        paragraphs: [
          'Real browser engines check the generated artifact across bounded viewports and QA locales.',
          'Machine evidence stays separate from production deployment and field performance claims.',
        ],
        canonicalUrl: 'https://example.test/',
      });
      response.statusCode = 200;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(page.html);
    } catch (error) {
      response.statusCode = 500;
      response.end('internal server error');
    }
  });
  const port = await listen(server);
  return { port, close: () => close(server) };
}

type EngineName = 'chromium' | 'firefox' | 'webkit';

const dashboardViewports = [
  { id: 'fhd', width: 1920, height: 1080 },
  { id: 'desktop', width: 1440, height: 900 },
  { id: 'laptop', width: 1366, height: 768 },
  { id: 'tablet', width: 1024, height: 768 },
  { id: 'tablet-portrait', width: 768, height: 1024 },
  { id: 'mobile-wide', width: 640, height: 960 },
  { id: 'above-1000', width: 1001, height: 900 },
  { id: 'at-1000', width: 1000, height: 900 },
  { id: 'above-860', width: 861, height: 900 },
  { id: 'at-860', width: 860, height: 900 },
  { id: 'above-560', width: 561, height: 844 },
  { id: 'at-560', width: 560, height: 844 },
  { id: 'mobile', width: 390, height: 844 },
] as const;

async function observeStudioPage(
  page: Page,
  testCase: StudioQaCase,
  targetUrl: string,
  diagnostics: Record<string, string[]>,
): Promise<StudioBrowserObservation> {
  const localOrigin = new URL(targetUrl).origin;
  const errors: string[] = [];
  const expectedPolicy: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('Content-Security-Policy') && text.includes('/favicon.ico') && text.includes(localOrigin)) {
      expectedPolicy.push(text.slice(0, 300));
      expectedStudioPolicyDiagnostics[testCase.browserProject] = expectedPolicy.slice(0, 32);
      return;
    }
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).origin === localOrigin) errors.push(`request failed: ${request.url()}`);
  });
  page.on('response', (response) => {
    if (new URL(response.url()).origin === localOrigin && response.status() >= 400) {
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  const recordDiagnostics = () => {
    diagnostics[testCase.id] = errors.slice(0, 8).map((error) => error.slice(0, 300));
  };
  page.on('console', recordDiagnostics);
  page.on('pageerror', recordDiagnostics);
  page.on('requestfailed', recordDiagnostics);
  page.on('response', recordDiagnostics);

  await page.goto(targetUrl, { waitUntil: 'load' });
  const observation = await page.evaluate(async () => {
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
    return {
      loaded: document.readyState === 'complete' && !!document.body,
      horizontalOverflow: root.scrollWidth > root.clientWidth + 1 || document.body.scrollWidth > root.clientWidth + 1,
      keyboardReachable: interactive.every((element) => element.tabIndex >= 0),
      singleH1: document.querySelectorAll('h1').length === 1,
      lang: root.lang,
      direction: getComputedStyle(root).direction as 'ltr' | 'rtl',
      hasTitle: document.title.trim().length > 0,
      hasMetaDescription: !!document.querySelector('meta[name="description"][content]')?.getAttribute('content')?.trim(),
      hasCanonical: !!document.querySelector('link[rel="canonical"][href]')?.getAttribute('href')?.trim(),
      brokenLinks,
      externalScriptOrigins: [...document.querySelectorAll('script[src]')]
        .map((script) => new URL(script.src, location.href).origin)
        .filter((origin) => origin !== location.origin),
    };
  });
  const mobile = testCase.browserProject.startsWith('mobile-');
  const webkitProject = testCase.browserProject.endsWith('webkit');
  if (testCase.viewport.width <= 500) {
    const screenshotPath = join(REPORT_DIR, `${testCase.browserProject}-${testCase.viewport.id}-${testCase.locale}.png`);
    if (testCase.locale === 'ar-XB' && !webkitProject) {
      await page.screenshot({ path: screenshotPath, caret: 'initial' });
    }
  } else if (!mobile && testCase.viewport.id === 'desktop' && testCase.locale === 'en') {
    const screenshotPath = join(REPORT_DIR, `${testCase.browserProject}-${testCase.viewport.id}-${testCase.locale}.png`);
    if (!webkitProject) await page.screenshot({ path: screenshotPath, caret: 'initial' });
  }
  return {
    caseId: testCase.id,
    ...observation,
    consoleErrors: errors.length,
  };
}

async function runDashboardCase(
  browser: Browser,
  engine: EngineName,
  dashboard: Awaited<ReturnType<typeof startDashboardServer>>,
  viewport: typeof dashboardViewports[number],
  locale: 'en' | 'fr' | 'ar-XB',
) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const runtimeErrors: string[] = [];
  const origin = `http://${HOST}:${dashboard.port}`;
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') runtimeErrors.push(message.text()); });
  const requestStart = dashboard.fragmentRequests.length;
  const name = `${engine}-${locale === 'ar-XB' ? 'rtl' : 'ltr'}-${viewport.id}`;
  try {
    await page.goto(`${origin}/?locale=${encodeURIComponent(locale)}`, { waitUntil: 'load' });
    await page.waitForFunction(() =>
      document.querySelector('#frag-toggle')?.children.length > 0
      && document.querySelector('#frag-recent')?.children.length > 0
      && document.querySelector('#frag-control-room')?.children.length > 0
      && document.querySelector('#frag-control-plane')?.children.length > 0,
    undefined, { timeout: 12_000 });

    const base = await page.evaluate(() => {
      const root = document.documentElement;
      return {
        lang: root.lang,
        dir: root.dir,
        computedDirection: getComputedStyle(root).direction,
        innerWidth,
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        localeStored: localStorage.getItem('furypipe-locale'),
        selectValue: document.querySelector<HTMLSelectElement>('select.mini-btn')?.value ?? null,
        topbarVisible: !!document.querySelector('.topbar')
          && getComputedStyle(document.querySelector('.topbar') as HTMLElement).display !== 'none',
        sectionCount: document.querySelectorAll('section.section').length,
        controlPlaneLoaded: !!document.querySelector('#frag-control-plane .cp-summary'),
        overflowElements: [...document.querySelectorAll('*')]
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              id: element.id || '',
              cls: typeof element.className === 'string' ? element.className.slice(0, 120) : '',
              left: Math.round(rect.left * 10) / 10,
              right: Math.round(rect.right * 10) / 10,
              width: Math.round(rect.width * 10) / 10,
            };
          })
          .filter((item) => item.right > document.documentElement.clientWidth + 1 || item.left < -1)
          .slice(0, 12),
      };
    });
    const direction = expectedDirection(locale);
    assert(base.lang === locale, `${name}: wrong document language ${base.lang}`);
    assert(base.dir === direction && base.computedDirection === direction, `${name}: direction mismatch`);
    assert(base.innerWidth === viewport.width, `${name}: viewport width mismatch`);
    assert(base.localeStored === locale && base.selectValue === locale, `${name}: locale persistence/selector mismatch`);
    assert(base.topbarVisible && base.sectionCount >= 4, `${name}: dashboard structure missing`);
    assert(base.controlPlaneLoaded, `${name}: Control Plane V2 fragment did not load`);
    assert(base.scrollWidth <= base.clientWidth + 1 && base.bodyScrollWidth <= base.clientWidth + 1,
      `${name}: horizontal overflow (${base.scrollWidth}/${base.clientWidth}, body ${base.bodyScrollWidth}); offenders=${JSON.stringify(base.overflowElements)}`);

    const captureThemeEvidence = engine === 'chromium' && locale === 'en'
      && ['desktop', 'tablet', 'mobile-wide', 'at-560', 'mobile'].includes(viewport.id);
    const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? 'unknown');
    if (captureThemeEvidence) {
      await page.screenshot({
        path: join(REPORT_DIR, `dashboard-${name}-${initialTheme}.png`),
        fullPage: true,
      });
    }

    const theme = await page.evaluate(() => {
      const before = document.documentElement.dataset.theme;
      (window as Window & { furyTheme?: () => void }).furyTheme?.();
      return { before, after: document.documentElement.dataset.theme };
    });
    assert(theme.before !== theme.after, `${name}: theme toggle did not change theme`);
    if (captureThemeEvidence) {
      await page.screenshot({
        path: join(REPORT_DIR, `dashboard-${name}-${theme.after ?? 'unknown'}.png`),
        fullPage: true,
      });
    }

    const explorer = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.cp-explorer');
      const search = root?.querySelector<HTMLInputElement>('[data-cp-search-input]');
      const filter = root?.querySelector<HTMLSelectElement>('[data-cp-filter]');
      const sort = root?.querySelector<HTMLSelectElement>('select:not([data-cp-filter])');
      if (!root || !search || !filter || !sort) return null;
      search.value = 'fury';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      const searchVisible = [...root.querySelectorAll<HTMLElement>('[data-cp-card]')]
        .filter((card) => !card.hidden)
        .map((card) => card.querySelector('h3')?.textContent?.trim() ?? '');
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      filter.value = 'AVAILABLE';
      filter.dispatchEvent(new Event('change', { bubbles: true }));
      const availableOnly = [...root.querySelectorAll<HTMLElement>('[data-cp-card]')]
        .filter((card) => !card.hidden)
        .every((card) => card.dataset.cpStatus === 'AVAILABLE');
      filter.value = 'ALL';
      filter.dispatchEvent(new Event('change', { bubbles: true }));
      sort.value = 'status';
      sort.dispatchEvent(new Event('change', { bubbles: true }));
      const statuses = [...root.querySelectorAll<HTMLElement>('[data-cp-card]')]
        .map((card) => card.dataset.cpStatus ?? '');
      return { searchVisible, availableOnly, statuses };
    });
    assert(explorer !== null && explorer.searchVisible.includes('FuryLink'), `${name}: capability search did not filter observed cards`);
    assert(explorer.availableOnly, `${name}: lifecycle filter did not restrict cards to AVAILABLE`);
    assert(explorer.statuses.every((status, index) => index === 0 || explorer.statuses[index - 1]!.localeCompare(status) <= 0),
      `${name}: capability status sort did not order cards`);

    const tooltipWidths = await page.evaluate(async () => {
      const tips = [...document.querySelectorAll<HTMLElement>('.q')];
      const indexes = tips.length > 1 ? [0, tips.length - 1] : (tips.length === 1 ? [0] : []);
      const results: Array<{
        index: number;
        scrollWidth: number;
        clientWidth: number;
        tooltipRect: { left: number; right: number };
        tooltipStyle: { left: string; right: string; width: string; display: string; content: string };
      }> = [];
      for (const index of indexes) {
        const tip = tips[index]!;
        tip.focus();
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const rect = tip.getBoundingClientRect();
        const style = getComputedStyle(tip, '::after');
        results.push({
          index,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          tooltipRect: { left: rect.left, right: rect.right },
          tooltipStyle: {
            left: style.left,
            right: style.right,
            width: style.width,
            display: style.display,
            content: style.content,
          },
        });
        tip.blur();
      }
      return results;
    });
    assert(tooltipWidths.every((item) => item.scrollWidth <= item.clientWidth + 1),
      `${name}: tooltip overflow at client width ${base.clientWidth}: ${JSON.stringify(tooltipWidths)}`);

    await page.evaluate(() => {
      for (const detail of document.querySelectorAll<HTMLDetailsElement>('details.models-collapse')) detail.open = true;
      const dialog = document.getElementById('routing-help') as HTMLDialogElement | null;
      if (dialog && !dialog.open) dialog.showModal();
    });
    const expanded = await page.evaluate(() => {
      const dialog = document.getElementById('routing-help') as HTMLDialogElement | null;
      const rect = dialog?.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        open: dialog?.open ?? false,
        rect: rect ? { left: rect.left, right: rect.right, width: rect.width } : null,
        viewportWidth: innerWidth,
      };
    });
    assert(expanded.scrollWidth <= expanded.clientWidth + 1 && expanded.bodyScrollWidth <= expanded.clientWidth + 1,
      `${name}: overflow after opening routing dialog`);
    assert(expanded.open && expanded.rect, `${name}: routing dialog did not open`);
    assert(expanded.rect.left >= -1 && expanded.rect.right <= expanded.viewportWidth + 1
      && expanded.rect.width <= expanded.viewportWidth + 1, `${name}: routing dialog escapes viewport`);

    const observedRequests = dashboard.fragmentRequests.slice(requestStart);
    assert(observedRequests.length >= 5, `${name}: expected HTMX fragment traffic, got ${observedRequests.length}`);
    for (const raw of observedRequests) {
      assert(new URL(raw).searchParams.get('locale') === locale, `${name}: fragment did not preserve locale`);
    }
    assert(runtimeErrors.length === 0, `${name}: browser errors: ${runtimeErrors.join(' | ')}`);

    if (viewport.id === 'desktop' || viewport.id === 'mobile') {
      await page.screenshot({ path: join(REPORT_DIR, `dashboard-${name}.png`), fullPage: true });
    }
    return { name, engine, locale, direction, ...viewport, base, expanded, fragmentRequests: observedRequests.length, runtimeErrors };
  } finally {
    await context.close();
  }
}

async function launch(engine: EngineName): Promise<Browser> {
  const engineType = engine === 'chromium' ? chromium : engine === 'firefox' ? firefox : webkit;
  return engineType.launch({
    headless: true,
    ...(engine === 'chromium' ? { channel: 'chromium' } : {}),
  });
}

async function main() {
  assert(SHA40.test(SOURCE_COMMIT), 'FURYPIPE_SOURCE_COMMIT must be the exact 40-character source SHA');
  await mkdir(REPORT_DIR, { recursive: true });
  const dashboard = await startDashboardServer();
  const studio = await startStudioServer();
  const browsers = new Map<EngineName, Browser>();
  const dashboardCases: unknown[] = [];
  const webStudioMatrix = buildStudioQaMatrix();
  const webStudioDiagnostics: Record<string, string[]> = {};
  let webStudioReport: Awaited<ReturnType<typeof runStudioBrowserQa>> | undefined;
  const versionRecord = JSON.parse(await readFile(join(process.cwd(), 'node_modules/playwright/package.json'), 'utf8')) as { version?: string };
  assert(versionRecord.version === '1.63.0', `expected exact Playwright 1.63.0, got ${versionRecord.version ?? 'unknown'}`);

  const browserFor = async (engine: EngineName): Promise<Browser> => {
    const present = browsers.get(engine);
    if (present) return present;
    const browser = await launch(engine);
    browsers.set(engine, browser);
    return browser;
  };

  const saveFailureReport = async (error: unknown) => {
    await writeFile(join(REPORT_DIR, 'report.json'), JSON.stringify({
      format: 'furypipe-cross-browser-qa/v1',
      sourceCommit: SOURCE_COMMIT,
      playwrightVersion: versionRecord.version,
      dashboard: { status: dashboardCases.length === dashboardViewports.length * 9 ? 'VERIFIED' : 'PARTIAL', totalCases: dashboardCases.length, cases: dashboardCases },
      webStudio: webStudioReport
        ? { status: webStudioReport.browserQa, totalCases: webStudioReport.totalCases, report: webStudioReport }
        : { status: 'NOT_EXECUTED', plannedCases: webStudioMatrix.length },
      webStudioDiagnostics,
      expectedStudioPolicyDiagnostics,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2) + '\n');
  };

  try {
    for (const engine of ['chromium', 'firefox', 'webkit'] as const) {
      const browser = await browserFor(engine);
      const view = browser.version();
      for (const locale of ['en', 'fr', 'ar-XB'] as const) {
        for (const viewport of dashboardViewports) {
          const result = await runDashboardCase(browser, engine, dashboard, viewport, locale);
          dashboardCases.push(result);
          console.log(`✓ Dashboard ${engine} ${result.width}x${result.height} ${locale}`);
        }
      }
      console.log(`Dashboard engine ${engine}: ${view}`);
    }
    const expectedDashboardCases = dashboardViewports.length * 3 * 3;
    assert(dashboardCases.length === expectedDashboardCases, `expected ${expectedDashboardCases} dashboard engine/locale/viewport cases, got ${dashboardCases.length}`);

    webStudioReport = await runStudioBrowserQa({
      id: 'playwright-cross-engine',
      version: versionRecord.version,
      async run(testCase, targetUrl) {
        const engine: EngineName = testCase.browserProject.endsWith('chromium') || testCase.browserProject === 'mobile-chromium'
          ? 'chromium'
          : testCase.browserProject.endsWith('firefox')
            ? 'firefox'
            : 'webkit';
        const browser = await browserFor(engine);
        const mobile = testCase.browserProject.startsWith('mobile-');
        const context = await browser.newContext({
          viewport: { width: testCase.viewport.width, height: testCase.viewport.height },
          deviceScaleFactor: 1,
          locale: testCase.locale,
          ...(mobile ? { isMobile: true, hasTouch: true } : {}),
        });
        try {
          return await observeStudioPage(await context.newPage(), testCase, targetUrl, webStudioDiagnostics);
        } finally {
          await context.close();
        }
      },
    }, `http://${HOST}:${studio.port}`, webStudioMatrix);
    assert(webStudioReport.totalCases === 120, `expected 120 complete Web Studio cases, got ${webStudioReport.totalCases}`);
    assert(webStudioReport.browserQa === 'VERIFIED'
      && webStudioReport.structuralAccessibility === 'VERIFIED'
      && webStudioReport.structuralSeo === 'VERIFIED'
      && webStudioReport.thirdPartyScriptSurface === 'VERIFIED', 'complete Web Studio matrix did not verify');
    assert(webStudioReport.productionPerformance === 'NOT_RUN' && webStudioReport.deployment === 'NOT_RUN'
      && !webStudioReport.promotionEvidenceCompatible, 'browser proof must not promote performance/deployment evidence');

    const report = {
      format: 'furypipe-cross-browser-qa/v1',
      sourceCommit: SOURCE_COMMIT,
      playwrightVersion: versionRecord.version,
      generatedAt: new Date().toISOString(),
      browserVersions: Object.fromEntries([...browsers].map(([engine, browser]) => [engine, browser.version()])),
      dashboard: { status: 'VERIFIED', totalCases: dashboardCases.length, cases: dashboardCases },
      webStudio: {
        status: webStudioReport.browserQa,
        totalCases: webStudioReport.totalCases,
        executedBrowserProjects: ['desktop-chromium', 'desktop-firefox', 'desktop-webkit', 'mobile-chromium', 'mobile-webkit'],
        unexecutedBrowserProjects: [],
        report: webStudioReport,
      },
      expectedStudioPolicyDiagnostics,
      externalSystems: { provider: 'NOT_EXECUTED', oauth: 'NOT_EXECUTED', hostedMcp: 'NOT_EXECUTED', openclaw: 'NOT_EXECUTED', figma: 'NOT_EXECUTED' },
    };
    await writeFile(join(REPORT_DIR, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`Dashboard cross-engine QA passed: ${dashboardCases.length}/${dashboardCases.length}`);
    console.log('Web Studio cross-engine QA passed: 120/120');
    console.log('Provider/OAuth/hosted MCP/OpenClaw/Figma external checks were not executed by browser QA.');
  } catch (error) {
    await saveFailureReport(error);
    throw error;
  } finally {
    await Promise.all([...browsers.values()].map((browser) => browser.close()));
    await Promise.all([dashboard.close(), studio.close()]);
  }
}

await main();
