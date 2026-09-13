import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DashboardState } from '../src/dashboard.ts';

const HOST = '127.0.0.1';
const REPORT_DIR = join(process.cwd(), 'artifacts', 'dashboard-browser-qa');
const SOURCE_COMMIT = process.env.FURYPIPE_SOURCE_COMMIT ?? 'unknown';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    'google-chrome-stable',
    'google-chrome',
    'chromium',
    'chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes('/')) return candidate;
    const found = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error('No Chromium/Chrome executable found. Set CHROME_BIN explicitly.');
}

async function freePort() {
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

async function writeWebResponse(nodeResponse, webResponse) {
  nodeResponse.statusCode = webResponse.status;
  for (const [name, value] of webResponse.headers) nodeResponse.setHeader(name, value);
  nodeResponse.end(Buffer.from(await webResponse.arrayBuffer()));
}

async function startDashboardServer() {
  const dashboard = new DashboardState(undefined, async () => new Map());
  const fragmentRequests = [];
  const server = createServer(async (request, response) => {
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('dashboard server address unavailable');
      const url = new URL(request.url ?? '/', `http://${HOST}:${address.port}`);
      let result;
      if (url.pathname === '/' || url.pathname === '/dashboard') {
        result = dashboard.serveHtml(
          address.port,
          url.searchParams.get('locale') ?? undefined,
          typeof request.headers['accept-language'] === 'string' ? request.headers['accept-language'] : undefined,
        );
      } else if (url.pathname.startsWith('/fragments/')) {
        fragmentRequests.push(url.toString());
        const name = decodeURIComponent(url.pathname.slice('/fragments/'.length));
        result = await dashboard.serveFragment(name, url, address.port);
      } else {
        result = new Response('not found', { status: 404 });
      }
      await writeWebResponse(response, result);
    } catch (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('dashboard server did not bind');
  return {
    port: address.port,
    fragmentRequests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.exceptions = [];
    socket.addEventListener('message', async (event) => {
      const text = typeof event.data === 'string'
        ? event.data
        : Buffer.from(await event.data.arrayBuffer()).toString('utf8');
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
        this.exceptions.push(detail?.exception?.description ?? detail?.text ?? 'runtime exception');
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP socket closed'));
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP websocket connection failed')), { once: true });
    });
    return new CdpSession(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
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

  async waitFor(expression, description, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression);
        if (last) return last;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`);
  }

  close() {
    this.socket.close();
  }
}

async function startChrome(chromeBin) {
  const debugPort = await freePort();
  const profile = await mkdtemp(join(tmpdir(), 'furypipe-browser-qa-'));
  const stderr = [];
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

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr.push(...String(chunk).split(/\r?\n/u).filter(Boolean));
    if (stderr.length > 80) stderr.splice(0, stderr.length - 80);
  });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Chromium exited before CDP became ready: ${stderr.join('\n')}`);
    }
    try {
      const response = await fetch(`http://${HOST}:${debugPort}/json/version`);
      if (response.ok) {
        return {
          debugPort,
          stderr,
          async close() {
            const waitForExit = () => new Promise((resolve) => {
              if (child.exitCode !== null || child.signalCode !== null) resolve();
              else child.once('exit', resolve);
            });
            child.kill('SIGTERM');
            let exited = false;
            await Promise.race([
              waitForExit().then(() => { exited = true; }),
              delay(2_000),
            ]);
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
      // CDP is not ready yet.
    }
    await delay(100);
  }
  child.kill('SIGKILL');
  await rm(profile, { recursive: true, force: true });
  throw new Error(`Timed out starting Chromium: ${stderr.join('\n')}`);
}

async function openTarget(debugPort) {
  const response = await fetch(`http://${HOST}:${debugPort}/json/new?about%3Ablank`, { method: 'PUT' });
  if (!response.ok) throw new Error(`failed to create Chromium target: HTTP ${response.status}`);
  const target = await response.json();
  if (!target.webSocketDebuggerUrl || !target.id) throw new Error('Chromium target has no CDP websocket');
  return target;
}

async function closeTarget(debugPort, targetId) {
  await fetch(`http://${HOST}:${debugPort}/json/close/${encodeURIComponent(targetId)}`).catch(() => undefined);
}

const BREAKPOINT_WIDTHS = [
  { id: 'desktop', width: 1440, height: 1000 },
  { id: 'above-1000', width: 1001, height: 900 },
  { id: 'at-1000', width: 1000, height: 900 },
  { id: 'above-860', width: 861, height: 900 },
  { id: 'at-860', width: 860, height: 900 },
  { id: 'above-560', width: 561, height: 844 },
  { id: 'at-560', width: 560, height: 844 },
  { id: 'mobile', width: 390, height: 844 },
];

const CASES = [
  ...BREAKPOINT_WIDTHS.map((viewport) => ({
    name: `fr-${viewport.id}`,
    locale: 'fr',
    direction: 'ltr',
    width: viewport.width,
    height: viewport.height,
  })),
  ...BREAKPOINT_WIDTHS.map((viewport) => ({
    name: `rtl-${viewport.id}`,
    locale: 'ar-XB',
    direction: 'rtl',
    width: viewport.width,
    height: viewport.height,
  })),
];

async function runCase(browser, dashboard, testCase) {
  const target = await openTarget(browser.debugPort);
  const cdp = await CdpSession.connect(target.webSocketDebuggerUrl);
  const requestStart = dashboard.fragmentRequests.length;
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: testCase.width,
      height: testCase.height,
      deviceScaleFactor: 1,
      mobile: testCase.width <= 500,
    });

    const pageUrl = `http://${HOST}:${dashboard.port}/?locale=${encodeURIComponent(testCase.locale)}`;
    await cdp.send('Page.navigate', { url: pageUrl });
    await cdp.waitFor('document.readyState === "complete"', 'document.readyState=complete');
    await cdp.waitFor(
      'document.querySelector("#frag-toggle")?.children.length > 0 && document.querySelector("#frag-recent")?.children.length > 0 && document.querySelector("#frag-control-room")?.children.length > 0',
      'initial HTMX fragments',
      12_000,
    );

    const base = await cdp.evaluate(`(() => ({
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      computedDirection: getComputedStyle(document.documentElement).direction,
      innerWidth,
      innerHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      localeStored: localStorage.getItem('furypipe-locale'),
      title: document.title,
      theme: document.documentElement.dataset.theme,
      selectValue: document.querySelector('select.mini-btn')?.value ?? null,
      topbarVisible: !!document.querySelector('.topbar') && getComputedStyle(document.querySelector('.topbar')).display !== 'none',
      sectionCount: document.querySelectorAll('section.section').length,
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
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
          };
        })
        .filter((item) => item.right > document.documentElement.clientWidth + 1 || item.left < -1)
        .sort((a, b) => (b.right - document.documentElement.clientWidth) - (a.right - document.documentElement.clientWidth))
        .slice(0, 12),
    }))()`);

    assert(base.lang === testCase.locale, `${testCase.name}: expected lang=${testCase.locale}, got ${base.lang}`);
    assert(base.dir === testCase.direction, `${testCase.name}: expected dir=${testCase.direction}, got ${base.dir}`);
    assert(base.computedDirection === testCase.direction, `${testCase.name}: computed direction mismatch`);
    assert(base.innerWidth === testCase.width, `${testCase.name}: viewport width mismatch ${base.innerWidth}`);
    assert(base.localeStored === testCase.locale, `${testCase.name}: locale persistence mismatch`);
    assert(base.selectValue === testCase.locale, `${testCase.name}: locale selector mismatch`);
    assert(base.topbarVisible === true, `${testCase.name}: topbar is not visible`);
    assert(base.sectionCount >= 4, `${testCase.name}: expected dashboard sections`);
    assert(base.scrollWidth <= base.clientWidth + 1, `${testCase.name}: root horizontal overflow ${base.scrollWidth} > ${base.clientWidth}; offenders=${JSON.stringify(base.overflowElements)}`);
    assert(base.bodyScrollWidth <= base.clientWidth + 1, `${testCase.name}: body horizontal overflow ${base.bodyScrollWidth} > ${base.clientWidth}`);

    const theme = await cdp.evaluate(`(() => {
      const before = document.documentElement.dataset.theme;
      window.ppTheme();
      const after = document.documentElement.dataset.theme;
      return { before, after };
    })()`);
    assert(theme.before !== theme.after, `${testCase.name}: theme toggle did not change theme`);

    await cdp.evaluate(`(() => {
      for (const detail of document.querySelectorAll('details.models-collapse')) detail.open = true;
      const dialog = document.getElementById('routing-help');
      if (dialog && !dialog.open) dialog.showModal();
      return true;
    })()`);
    await delay(150);

    const expanded = await cdp.evaluate(`(() => {
      const root = document.documentElement;
      const dialog = document.getElementById('routing-help');
      const rect = dialog?.getBoundingClientRect();
      return {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        dialogOpen: !!dialog?.open,
        dialogRect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
        viewport: { width: innerWidth, height: innerHeight },
      };
    })()`);
    assert(expanded.scrollWidth <= expanded.clientWidth + 1, `${testCase.name}: overflow after expanding help`);
    assert(expanded.bodyScrollWidth <= expanded.clientWidth + 1, `${testCase.name}: body overflow after expanding help`);
    assert(expanded.dialogOpen === true && expanded.dialogRect, `${testCase.name}: routing dialog did not open`);
    assert(expanded.dialogRect.left >= -1, `${testCase.name}: dialog escapes left viewport`);
    assert(expanded.dialogRect.right <= expanded.viewport.width + 1, `${testCase.name}: dialog escapes right viewport`);
    assert(expanded.dialogRect.width <= expanded.viewport.width + 1, `${testCase.name}: dialog wider than viewport`);

    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true,
    });
    const screenshotPath = join(REPORT_DIR, `${testCase.name}.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

    const fragmentRequests = dashboard.fragmentRequests.slice(requestStart);
    assert(fragmentRequests.length >= 5, `${testCase.name}: expected HTMX fragment traffic`);
    for (const raw of fragmentRequests) {
      const url = new URL(raw);
      assert(url.searchParams.get('locale') === testCase.locale, `${testCase.name}: fragment lost locale: ${url.pathname}`);
    }

    assert(cdp.exceptions.length === 0, `${testCase.name}: browser runtime exception(s): ${cdp.exceptions.join(' | ')}`);

    return {
      ...testCase,
      sourceCommit: SOURCE_COMMIT,
      pageUrl,
      fragmentRequestCount: fragmentRequests.length,
      base,
      expanded,
      screenshot: screenshotPath.replace(process.cwd() + '/', ''),
      runtimeExceptions: [...cdp.exceptions],
    };
  } finally {
    cdp.close();
    await closeTarget(browser.debugPort, target.id);
  }
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const dashboard = await startDashboardServer();
  const chromeBin = findChrome();
  const browser = await startChrome(chromeBin);
  const report = {
    format: 'furypipe-dashboard-browser-qa/v1',
    sourceCommit: SOURCE_COMMIT,
    chromeBin,
    generatedAt: new Date().toISOString(),
    cases: [],
  };

  try {
    for (const testCase of CASES) {
      const result = await runCase(browser, dashboard, testCase);
      report.cases.push(result);
      console.log(`✓ ${testCase.name}: ${testCase.width}x${testCase.height} ${testCase.locale}/${testCase.direction}`);
    }
    await writeFile(join(REPORT_DIR, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`dashboard browser QA passed: ${CASES.length}/${CASES.length} real Chromium cases`);
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    await writeFile(join(REPORT_DIR, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    throw error;
  } finally {
    await browser.close();
    await dashboard.close();
  }
}

await main();
