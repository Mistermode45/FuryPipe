import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const SHA40 = /^[0-9a-f]{40}$/u;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeTarget(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('hosted Web Studio target must use HTTPS');
  if (url.username || url.password || url.hash || url.search) throw new Error('hosted Web Studio URL must be credential-free and contain no query/fragment');
  if (url.pathname !== '/studio-qa') throw new Error('hosted Web Studio target must use exact /studio-qa path');
  return url;
}

function forbiddenResolvedAddress(address) {
  const value = address.trim().toLowerCase().replace(/^\[|\]$/gu, '');
  const family = isIP(value);
  if (family === 4) {
    const octets = value.split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
    const [a, b, c] = octets;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }
  if (family === 6) {
    return value === '::'
      || value === '::1'
      || value.startsWith('::ffff:')
      || value.startsWith('fc')
      || value.startsWith('fd')
      || /^fe[89ab]/u.test(value)
      || value.startsWith('ff')
      || value.startsWith('2001:db8:');
  }
  return true;
}

function expectedDirection(locale) {
  return locale === 'ar-XB' ? 'rtl' : 'ltr';
}

function canonicalLocale(locale) {
  const [value] = Intl.getCanonicalLocales(locale);
  if (!value) throw new Error(`invalid locale: ${locale}`);
  return value;
}

function isKnownFirefoxFaviconCspNoise(project, message) {
  if (!project.includes('firefox') || message.type() !== 'error') return false;
  const location = message.location();
  const text = message.text();
  return location.url.startsWith('resource:')
    && location.url.endsWith('/FaviconLoader.sys.mjs')
    && text.includes('Content-Security-Policy')
    && text.includes('/favicon.ico')
    && text.includes("default-src 'none'");
}

const sourceCommit = requiredEnv('FURYPIPE_SOURCE_COMMIT');
assert(SHA40.test(sourceCommit), 'FURYPIPE_SOURCE_COMMIT must be an exact lowercase 40-character SHA');
const target = safeTarget(requiredEnv('FURYPIPE_HOSTED_WEB_STUDIO_URL'));
const candidateRoot = resolve(requiredEnv('FURYPIPE_CANDIDATE_ROOT'));
const outputDir = resolve(requiredEnv('FURYPIPE_HOSTED_WEB_STUDIO_OUTPUT_DIR'));

const targetIpFamily = isIP(target.hostname.replace(/^\[|\]$/gu, ''));
const resolvedAddresses = targetIpFamily
  ? [{ address: target.hostname.replace(/^\[|\]$/gu, ''), family: targetIpFamily }]
  : await lookup(target.hostname, { all: true });

assert(resolvedAddresses.length > 0, 'hosted Web Studio target did not resolve');
assert(resolvedAddresses.every(({ address }) => !forbiddenResolvedAddress(address)),
  'hosted Web Studio target must resolve only to public-routable addresses');

const probe = new URL(target);
probe.searchParams.set('locale', 'en');
const probeResponse = await fetch(probe, { redirect: 'error' });
assert(probeResponse.status === 200, `hosted Web Studio probe returned HTTP ${probeResponse.status}`);
assert(probeResponse.headers.get('x-furypipe-source-commit') === sourceCommit,
  'hosted Web Studio source-binding header does not match the candidate SHA');
assert((probeResponse.headers.get('content-type') ?? '').toLowerCase().includes('text/html'),
  'hosted Web Studio target did not return HTML');

const candidateModule = await import(pathToFileURL(join(candidateRoot, 'dist', 'web-studio', 'index.js')).href);
const {
  REQUIRED_QA_PROJECTS,
  REQUIRED_VIEWPORTS,
  REQUIRED_TEST_LOCALES,
} = candidateModule;

assert(Array.isArray(REQUIRED_QA_PROJECTS) && REQUIRED_QA_PROJECTS.length === 5, 'unexpected Web Studio browser project contract');
assert(Array.isArray(REQUIRED_VIEWPORTS) && REQUIRED_VIEWPORTS.length === 6, 'unexpected Web Studio viewport contract');
assert(Array.isArray(REQUIRED_TEST_LOCALES) && REQUIRED_TEST_LOCALES.length === 4, 'unexpected Web Studio locale contract');

const requireFromCandidate = createRequire(join(candidateRoot, 'package.json'));
const { chromium, firefox, webkit } = requireFromCandidate('playwright');
const browserForProject = {
  'desktop-chromium': chromium,
  'mobile-chromium': chromium,
  'desktop-firefox': firefox,
  'desktop-webkit': webkit,
  'mobile-webkit': webkit,
};

const launched = new Map();
const failures = [];
let totalCases = 0;
let ignoredKnownFirefoxFaviconCspNoise = 0;

try {
  for (const project of REQUIRED_QA_PROJECTS) {
    const launcher = browserForProject[project];
    assert(launcher, `unsupported browser project: ${project}`);
    const engineName = project.includes('chromium') ? 'chromium' : project.includes('firefox') ? 'firefox' : 'webkit';
    if (!launched.has(engineName)) launched.set(engineName, await launcher.launch({ headless: true }));
    const browser = launched.get(engineName);

    for (const viewport of REQUIRED_VIEWPORTS) {
      for (const locale of REQUIRED_TEST_LOCALES) {
        totalCases += 1;
        const caseId = `${project}:${viewport.id}:${locale}`;
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          locale,
          isMobile: project.startsWith('mobile-'),
        });
        const page = await context.newPage();
        let consoleErrors = 0;
        const consoleErrorDetails = [];
        page.on('console', (message) => {
          if (message.type() !== 'error') return;
          if (isKnownFirefoxFaviconCspNoise(project, message)) {
            ignoredKnownFirefoxFaviconCspNoise += 1;
            return;
          }
          consoleErrors += 1;
          consoleErrorDetails.push(`console: ${message.text().slice(0, 500)}`);
        });
        page.on('pageerror', (error) => {
          consoleErrors += 1;
          consoleErrorDetails.push(`pageerror: ${error.message.slice(0, 500)}`);
        });

        const reasons = [];
        try {
          const url = new URL(target);
          url.searchParams.set('locale', locale);
          const response = await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 20_000 });
          if (!response || response.status() !== 200) reasons.push('HTTP response is not 200');
          if (response?.headers()['x-furypipe-source-commit'] !== sourceCommit) reasons.push('source-binding header mismatch');

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
                const res = await fetch(resolved.href, { method: 'GET', redirect: 'manual' });
                if (!res.ok) brokenLinks += 1;
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
              direction: getComputedStyle(root).direction,
              hasTitle: document.title.trim().length > 0,
              hasMetaDescription: !!document.querySelector('meta[name="description"][content]')?.getAttribute('content')?.trim(),
              hasCanonical: !!document.querySelector('link[rel="canonical"][href]')?.getAttribute('href')?.trim(),
              brokenLinks,
              externalScriptOrigins: [...document.querySelectorAll('script[src]')]
                .map((script) => new URL(script.src, location.href).origin)
                .filter((origin) => origin !== location.origin),
            };
          });

          if (!observation.loaded) reasons.push('page did not load');
          if (observation.horizontalOverflow) reasons.push('horizontal overflow');
          if (!observation.keyboardReachable) reasons.push('keyboard reachability mismatch');
          if (!observation.singleH1) reasons.push('single H1 invariant failed');
          if (canonicalLocale(observation.lang) !== canonicalLocale(locale)) reasons.push('locale mismatch');
          if (observation.direction !== expectedDirection(locale)) reasons.push('direction mismatch');
          if (!observation.hasTitle || !observation.hasMetaDescription || !observation.hasCanonical) reasons.push('SEO structure incomplete');
          if (observation.brokenLinks !== 0) reasons.push('broken links observed');
          if (observation.externalScriptOrigins.length !== 0) reasons.push('external script origin observed');
          if (consoleErrors !== 0) {
            reasons.push(`console/page errors observed: ${consoleErrorDetails.slice(0, 3).join(' | ')}`);
          }
        } catch (error) {
          reasons.push(error instanceof Error ? error.message : String(error));
        } finally {
          await context.close();
        }
        if (reasons.length > 0) failures.push({ caseId, reasons });
      }
    }
  }
} finally {
  await Promise.all([...launched.values()].map((browser) => browser.close()));
}

assert(totalCases === 120, `expected 120 hosted Web Studio cases, got ${totalCases}`);
assert(failures.length === 0, `hosted Web Studio conformance failed: ${JSON.stringify(failures.slice(0, 10))}`);

const evidence = {
  format: 'furypipe-hosted-web-studio-conformance/v1',
  generatedAt: new Date().toISOString(),
  sourceCommit,
  target: {
    url: target.toString(),
    hostname: target.hostname,
    resolvedAddresses,
    publicRoutableBoundary: true,
    tls: 'VERIFIED',
    sourceBinding: 'VERIFIED',
  },
  matrix: {
    totalCases,
    ignoredKnownBrowserNoise: {
      firefoxFaviconCsp: ignoredKnownFirefoxFaviconCspNoise,
    },
    browserProjects: [...REQUIRED_QA_PROJECTS],
    viewports: REQUIRED_VIEWPORTS.map((viewport) => ({ id: viewport.id, width: viewport.width, height: viewport.height })),
    locales: [...REQUIRED_TEST_LOCALES],
  },
  checks: {
    publicNetworkBoundary: 'VERIFIED',
    tls: 'VERIFIED',
    sourceBinding: 'VERIFIED',
    browserMatrix: 'VERIFIED',
    structuralAccessibility: 'VERIFIED',
    structuralSeo: 'VERIFIED',
    thirdPartyScriptSurface: 'VERIFIED',
  },
  hostedWebStudio: 'VERIFIED',
  figmaConnectivity: 'NOT_EXECUTED',
  productionPerformance: 'NOT_EXECUTED',
  deployment: 'NOT_EXECUTED',
  github: {
    repository: requiredEnv('GITHUB_REPOSITORY'),
    runId: Number(requiredEnv('GITHUB_RUN_ID')),
    runAttempt: Number(requiredEnv('GITHUB_RUN_ATTEMPT')),
    validatorCommit: requiredEnv('FURYPIPE_VALIDATOR_COMMIT'),
    runnerEnvironment: requiredEnv('FURYPIPE_GITHUB_RUNNER_ENVIRONMENT'),
  },
};

await mkdir(outputDir, { recursive: true });
const json = JSON.stringify(evidence, null, 2) + '\n';
const jsonPath = join(outputDir, 'hosted-web-studio-conformance.json');
const shaPath = join(outputDir, 'hosted-web-studio-conformance.json.sha256');
await writeFile(jsonPath, json, 'utf8');
const digest = createHash('sha256').update(json, 'utf8').digest('hex');
await writeFile(shaPath, `${digest}  hosted-web-studio-conformance.json\n`, 'utf8');
console.log(JSON.stringify({ status: 'VERIFIED', sourceCommit, totalCases, digest }));
