import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { DashboardState } from '../dist/dashboard.js';
import { createFuryBetaControlPlaneSnapshot } from '../dist/beta-control-plane.js';
import { inspectBetaConfigValue } from '../dist/beta-config.js';
import { collectFuryBetaReadiness } from '../dist/beta-readiness-runtime.js';
import path from 'node:path';

const HOST = '127.0.0.1';
const OUTPUT_DIR = path.resolve(
  process.env.FURYPIPE_VALIDATION_OUTPUT_DIR?.trim() || 'artifacts/final-validation',
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function responseFrom(response, nodeResponse) {
  nodeResponse.statusCode = response.status;
  for (const [name, value] of response.headers) nodeResponse.setHeader(name, value);
  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}

async function startDashboard() {
  const observedAt = Date.now();
  const configText = JSON.stringify({ models: ['keep'] });
  const readiness = collectFuryBetaReadiness({
    configText,
    configFile: 'accessibility-automation.json',
    observedAt,
    nodeVersion: process.versions.node,
    gatewayRunning: true,
    env: {},
  }).snapshot;
  const betaSnapshot = createFuryBetaControlPlaneSnapshot({
    generatedAt: observedAt,
    config: inspectBetaConfigValue(JSON.parse(configText), 'accessibility-automation.json'),
    readiness,
    onboardingInput: { observedAt, readiness },
  });
  const dashboard = new DashboardState(
    undefined,
    async () => new Map(),
    undefined,
    undefined,
    undefined,
    () => betaSnapshot,
  );
  const degradedDashboard = new DashboardState(undefined, async () => new Map());
  const server = createServer(async (request, nodeResponse) => {
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('dashboard address unavailable');
      const url = new URL(request.url ?? '/', `http://${HOST}:${address.port}`);
      if (url.pathname === '/' || url.pathname === '/dashboard') {
        await responseFrom(dashboard.serveHtml(
          address.port,
          url.searchParams.get('locale') ?? undefined,
          typeof request.headers['accept-language'] === 'string' ? request.headers['accept-language'] : undefined,
        ), nodeResponse);
        return;
      }
      if (url.pathname.startsWith('/fragments/')) {
        await responseFrom(await dashboard.serveFragment(
          decodeURIComponent(url.pathname.slice('/fragments/'.length)),
          url,
          address.port,
        ), nodeResponse);
        return;
      }
      if (url.pathname === '/api/beta.json') {
        await responseFrom(await dashboard.serveBetaJson(), nodeResponse);
        return;
      }
      if (url.pathname === '/degraded/api/beta.json') {
        await responseFrom(await degradedDashboard.serveBetaJson(), nodeResponse);
        return;
      }
      if (url.pathname === '/degraded/fragments/beta') {
        await responseFrom(await degradedDashboard.serveFragment('beta', url, address.port), nodeResponse);
        return;
      }
      nodeResponse.statusCode = 404;
      nodeResponse.end('not found');
    } catch {
      nodeResponse.statusCode = 500;
      nodeResponse.end('internal server error');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object', 'dashboard did not bind');
  return {
    url: `http://${HOST}:${address.port}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const dashboard = await startDashboard();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  const startedAt = Date.now();
  try {
    await page.goto(dashboard.url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    const report = await page.evaluate(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const nameOf = (element) => {
        const labelled = element.getAttribute('aria-label') || element.getAttribute('title');
        if (labelled?.trim()) return labelled.trim();
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) return labelledBy.split(/\s+/u).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim();
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
          const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : element.closest('label');
          if (label?.textContent?.trim()) return label.textContent.trim();
        }
        return element.textContent?.trim() ?? '';
      };
      const focusables = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
        .filter(visible)
        .filter((element) => !element.hasAttribute('disabled'));
      const unnamed = focusables
        .filter((element) => !nameOf(element))
        .map((element) => `${element.tagName.toLowerCase()}#${element.id}`);
      const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((element) => Number(element.tagName.slice(1)));
      const headingJumps = headings.slice(1).filter((level, index) => level - headings[index] > 1);
      const landmarks = {
        main: document.querySelectorAll('main,[role="main"]').length,
        nav: document.querySelectorAll('nav,[role="navigation"]').length,
        banner: document.querySelectorAll('header,[role="banner"]').length,
      };
      const invalidAriaHiddenFocus = [...document.querySelectorAll('[aria-hidden="true"] *')]
        .filter((element) => element.matches('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])') && visible(element))
        .map((element) => `${element.tagName.toLowerCase()}#${element.id}`);
      const contrastPairs = focusables.map((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, background: style.backgroundColor };
      });
      const equalContrast = contrastPairs.filter((pair) => pair.color === pair.background).length;
      return {
        title: document.title,
        landmarks,
        focusableCount: focusables.length,
        unnamed,
        headings,
        headingJumps,
        invalidAriaHiddenFocus,
        equalContrast,
        dialogs: [...document.querySelectorAll('dialog,[role="dialog"]')].map((element) => ({
          labelled: Boolean(element.getAttribute('aria-label') || element.getAttribute('aria-labelledby')),
          modal: element.getAttribute('aria-modal') === 'true' || element.tagName.toLowerCase() === 'dialog',
        })),
      };
    });
    assert(report.title.length > 0, 'dashboard has no document title');
    assert(report.landmarks.main >= 1, 'dashboard has no main landmark');
    assert(report.unnamed.length === 0, `dashboard has unnamed controls: ${report.unnamed.join(', ')}`);
    assert(report.headingJumps.length === 0, `dashboard heading hierarchy skips a level: ${report.headings.join(' -> ')}`);
    assert(report.invalidAriaHiddenFocus.length === 0, 'dashboard hides focusable content with aria-hidden');
    assert(report.equalContrast === 0, 'dashboard has controls with identical foreground/background colors');
    for (const dialog of report.dialogs) assert(dialog.labelled && dialog.modal, 'dashboard dialog lacks a name or modal semantics');

    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
    });
    const tabOrder = [];
    for (let i = 0; i < 32; i += 1) {
      await page.keyboard.press('Tab');
      const active = await page.evaluate(() => {
        const element = document.activeElement;
        return element && element !== document.body
          ? `${element.tagName.toLowerCase()}#${element.id}`
          : '';
      });
      if (active) tabOrder.push(active);
    }
    assert(tabOrder.length > 0, 'keyboard traversal did not reach a focusable control');
    await page.reload({ waitUntil: 'networkidle' });
    const beta = await page.evaluate(async () => {
      const response = await fetch('/api/beta.json');
      return { status: response.status, body: await response.json() };
    });
    assert(beta.status === 200, `beta dashboard API returned ${beta.status}`);
    assert(JSON.stringify(beta.body).includes('executionAuthority'), 'beta dashboard API omitted execution boundary');
    const fragment = await page.evaluate(async () => {
      const response = await fetch('/fragments/beta');
      return { status: response.status, text: await response.text() };
    });
    assert(fragment.status === 200 && fragment.text.length > 0, 'beta degraded/empty fragment was not rendered');
    assert(consoleErrors.length === 0, `browser console errors before expected failure probes: ${consoleErrors.join(' | ')}`);
    const degraded = await page.evaluate(async () => {
      const api = await fetch('/degraded/api/beta.json');
      const fragmentResponse = await fetch('/degraded/fragments/beta');
      return {
        apiStatus: api.status,
        fragmentStatus: fragmentResponse.status,
        fragmentText: await fragmentResponse.text(),
      };
    });
    assert(degraded.apiStatus === 503, `degraded beta API returned ${degraded.apiStatus} instead of 503`);
    assert(degraded.fragmentStatus === 200 && /unavailable|not available/iu.test(degraded.fragmentText), 'degraded beta fragment did not expose an unavailable state');
    const missing = await page.evaluate(async () => (await fetch('/does-not-exist')).status);
    assert(missing === 404, `frontend missing-route contract returned ${missing}`);
    const expectedFailureConsoleMessages = consoleErrors.filter((message) =>
      /status of 503 \(Service Unavailable\)|status of 404 \(Not Found\)/u.test(message));
    const unexpectedConsoleErrors = consoleErrors.filter((message) =>
      !/status of 503 \(Service Unavailable\)|status of 404 \(Not Found\)/u.test(message));
    assert(unexpectedConsoleErrors.length === 0, `browser console errors: ${unexpectedConsoleErrors.join(' | ')}`);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'accessibility-dashboard.png'), fullPage: true });
    const evidence = {
      format: 'furypipe-final-accessibility-automation/v1',
      status: 'PASS',
      generatedAt: new Date().toISOString(),
      scope: {
        browser: 'Chromium headless',
        viewport: '1440x900',
        domContract: 'PASS',
        keyboardReachability: 'PASS',
        focusOrder: 'bounded-tab-observed',
        landmarks: 'PASS',
        labelsAndNames: 'PASS',
        aria: 'PASS',
        contrast: 'bounded-equality-check-pass',
        dialogSemantics: 'PASS',
        reloadAndApiReconnect: 'PASS',
        degradedFragment: 'PASS',
        missingRoute: 'PASS',
        axeEquivalent: 'bounded-purpose-built-dom-rules',
        screenReader: 'MANUAL_REQUIRED',
        humanVisualReview: 'MANUAL_REQUIRED',
      },
      observed: report,
      tabOrderCount: tabOrder.length,
      consoleErrors: unexpectedConsoleErrors.length,
      expectedFailureConsoleMessages: expectedFailureConsoleMessages.length,
      durationMs: Date.now() - startedAt,
    };
    await writeFile(path.join(OUTPUT_DIR, 'accessibility.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    await dashboard.close().catch(() => undefined);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
