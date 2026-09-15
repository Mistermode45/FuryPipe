import { createHash } from 'node:crypto';
import { directionForLocale } from '../i18n/index.js';

export type StudioStatus =
  | 'DRAFT'
  | 'RESEARCHED'
  | 'DESIGNED'
  | 'APPROVED'
  | 'IMPLEMENTED'
  | 'VERIFIED'
  | 'DEPLOYMENT_VERIFIED';

export type GateStatus = 'NOT_RUN' | 'PARTIAL' | 'FAILED' | 'VERIFIED';
export type SourceDecision = 'REFERENCE_ONLY' | 'WRAP' | 'ADAPT' | 'ADOPT' | 'REJECT';
export type Direction = 'ltr' | 'rtl';

export interface StudioBrief {
  id: string;
  objective: string;
  audience: readonly string[];
  conversionGoals: readonly string[];
  targetLocales: readonly string[];
  targetDevices: readonly ('mobile' | 'tablet' | 'desktop')[];
  constraints: readonly string[];
}

export interface ResearchSource {
  id: string;
  canonicalUrl: string;
  decision: SourceDecision;
  licenseStatus: 'UNKNOWN' | 'REVIEWED' | 'NOT_APPLICABLE';
  trust: 'UNTRUSTED_INPUT' | 'REFERENCE' | 'PINNED_DEPENDENCY';
  notes?: string;
}

export interface DesignVariant {
  id: string;
  name: string;
  rationale: string;
  desktop: string;
  tablet: string;
  mobile: string;
  accessibilityRisks: readonly string[];
  performanceRisks: readonly string[];
  implementationComplexity: 'low' | 'medium' | 'high';
}

export interface StudioEvidence {
  qa: GateStatus;
  accessibility: GateStatus;
  security: GateStatus;
  seo: GateStatus;
  performance: GateStatus;
  privacy: GateStatus;
  deployment: GateStatus;
  backup: 'NOT_CHECKED' | 'BACKUP_EXISTS' | 'RESTORE_VERIFIED';
}

export interface StudioProject {
  id: string;
  status: StudioStatus;
  brief: StudioBrief;
  sources: readonly ResearchSource[];
  variants: readonly DesignVariant[];
  selectedVariantId: string | null;
  implementationCommit: string | null;
  evidence: StudioEvidence;
}

export interface ValidationIssue {
  code: string;
  message: string;
  path: string;
}

export const CORE_WEB_VITALS = Object.freeze({
  lcpMsP75Max: 2500,
  inpMsP75Max: 200,
  clsP75Max: 0.1,
});

export const REQUIRED_QA_PROJECTS = Object.freeze([
  'desktop-chromium',
  'desktop-firefox',
  'desktop-webkit',
  'mobile-chromium',
  'mobile-webkit',
] as const);

export const REQUIRED_VIEWPORTS = Object.freeze([
  Object.freeze({ id: 'mobile-small', width: 320, height: 568 }),
  Object.freeze({ id: 'mobile', width: 390, height: 844 }),
  Object.freeze({ id: 'tablet-portrait', width: 768, height: 1024 }),
  Object.freeze({ id: 'tablet-landscape', width: 1024, height: 768 }),
  Object.freeze({ id: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ id: 'desktop-large', width: 1920, height: 1080 }),
] as const);

export const REQUIRED_TEST_LOCALES = Object.freeze(['en', 'fr', 'en-XA', 'ar-XB'] as const);

function nonEmpty(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCommitSha(value: string | null): boolean {
  return value === null || /^[0-9a-f]{40}$/.test(value);
}

export function validateStudioProject(project: StudioProject): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });

  if (!nonEmpty(project.id)) add('PROJECT_ID_REQUIRED', 'id', 'project id is required');
  if (!nonEmpty(project.brief.id)) add('BRIEF_ID_REQUIRED', 'brief.id', 'brief id is required');
  if (!nonEmpty(project.brief.objective)) add('OBJECTIVE_REQUIRED', 'brief.objective', 'objective is required');
  if (project.brief.audience.length === 0) add('AUDIENCE_REQUIRED', 'brief.audience', 'at least one audience is required');
  if (project.brief.targetLocales.length === 0) add('LOCALE_REQUIRED', 'brief.targetLocales', 'at least one target locale is required');
  if (project.brief.targetDevices.length === 0) add('DEVICE_REQUIRED', 'brief.targetDevices', 'at least one target device is required');

  const sourceIds = new Set<string>();
  for (const [index, source] of project.sources.entries()) {
    if (!nonEmpty(source.id)) add('SOURCE_ID_REQUIRED', `sources[${index}].id`, 'source id is required');
    if (sourceIds.has(source.id)) add('SOURCE_ID_DUPLICATE', `sources[${index}].id`, 'source id must be unique');
    sourceIds.add(source.id);
    if (!/^https:\/\//.test(source.canonicalUrl)) {
      add('SOURCE_URL_HTTPS_REQUIRED', `sources[${index}].canonicalUrl`, 'source URL must use HTTPS');
    }
    if (source.decision !== 'REFERENCE_ONLY' && source.decision !== 'REJECT' && source.licenseStatus !== 'REVIEWED') {
      add('SOURCE_LICENSE_REVIEW_REQUIRED', `sources[${index}].licenseStatus`, 'adopted/wrapped/adapted sources require license review');
    }
    if (source.decision !== 'REFERENCE_ONLY' && source.decision !== 'REJECT' && source.trust !== 'PINNED_DEPENDENCY') {
      add('SOURCE_PIN_REQUIRED', `sources[${index}].trust`, 'integrated sources must be pinned dependencies');
    }
  }

  const variantIds = new Set<string>();
  for (const [index, variant] of project.variants.entries()) {
    if (!nonEmpty(variant.id)) add('VARIANT_ID_REQUIRED', `variants[${index}].id`, 'variant id is required');
    if (variantIds.has(variant.id)) add('VARIANT_ID_DUPLICATE', `variants[${index}].id`, 'variant id must be unique');
    variantIds.add(variant.id);
    if (!nonEmpty(variant.rationale)) add('VARIANT_RATIONALE_REQUIRED', `variants[${index}].rationale`, 'variant rationale is required');
    for (const surface of ['desktop', 'tablet', 'mobile'] as const) {
      if (!nonEmpty(variant[surface])) add('VARIANT_SURFACE_REQUIRED', `variants[${index}].${surface}`, `${surface} design contract is required`);
    }
  }

  if (['DESIGNED', 'APPROVED', 'IMPLEMENTED', 'VERIFIED', 'DEPLOYMENT_VERIFIED'].includes(project.status)) {
    if (project.variants.length < 2 || project.variants.length > 4) {
      add('VARIANT_COUNT_INVALID', 'variants', 'designed projects require 2 to 4 variants');
    }
  }

  if (['APPROVED', 'IMPLEMENTED', 'VERIFIED', 'DEPLOYMENT_VERIFIED'].includes(project.status)) {
    if (!project.selectedVariantId || !variantIds.has(project.selectedVariantId)) {
      add('SELECTED_VARIANT_REQUIRED', 'selectedVariantId', 'approved projects require a selected existing variant');
    }
  }

  if (!isCommitSha(project.implementationCommit)) {
    add('IMPLEMENTATION_COMMIT_INVALID', 'implementationCommit', 'implementation commit must be a lowercase 40-character git SHA');
  }

  if (['IMPLEMENTED', 'VERIFIED', 'DEPLOYMENT_VERIFIED'].includes(project.status) && project.implementationCommit === null) {
    add('IMPLEMENTATION_COMMIT_REQUIRED', 'implementationCommit', 'implemented projects require an implementation commit');
  }

  if (project.status === 'VERIFIED' || project.status === 'DEPLOYMENT_VERIFIED') {
    for (const gate of ['qa', 'accessibility', 'security', 'seo', 'performance', 'privacy'] as const) {
      if (project.evidence[gate] !== 'VERIFIED') {
        add('VERIFICATION_GATE_INCOMPLETE', `evidence.${gate}`, `${gate} must be VERIFIED`);
      }
    }
  }

  if (project.status === 'DEPLOYMENT_VERIFIED') {
    if (project.evidence.deployment !== 'VERIFIED') {
      add('DEPLOYMENT_GATE_INCOMPLETE', 'evidence.deployment', 'deployment must be VERIFIED');
    }
    if (project.evidence.backup === 'BACKUP_EXISTS') {
      add('BACKUP_NOT_RESTORE_VERIFIED', 'evidence.backup', 'backup existence is not restore verification');
    }
  }

  return issues;
}

export function canPromoteToVerified(project: StudioProject): boolean {
  const copy: StudioProject = { ...project, status: 'VERIFIED' };
  return validateStudioProject(copy).length === 0;
}

export function canPromoteToDeploymentVerified(project: StudioProject): boolean {
  const copy: StudioProject = { ...project, status: 'DEPLOYMENT_VERIFIED' };
  return validateStudioProject(copy).length === 0;
}

export interface FieldVitals {
  lcpMsP75: number | null;
  inpMsP75: number | null;
  clsP75: number | null;
}

export function evaluateCoreWebVitals(vitals: FieldVitals): GateStatus {
  if (vitals.lcpMsP75 === null || vitals.inpMsP75 === null || vitals.clsP75 === null) return 'PARTIAL';
  const finite = [vitals.lcpMsP75, vitals.inpMsP75, vitals.clsP75].every((value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  );
  if (!finite) return 'FAILED';
  return vitals.lcpMsP75 <= CORE_WEB_VITALS.lcpMsP75Max
    && vitals.inpMsP75 <= CORE_WEB_VITALS.inpMsP75Max
    && vitals.clsP75 <= CORE_WEB_VITALS.clsP75Max
    ? 'VERIFIED'
    : 'FAILED';
}

export interface FigmaAdapter {
  readonly id: string;
  readonly version: string;
  readApprovedDesign(projectId: string): Promise<unknown>;
  exportApprovedAssets(projectId: string): Promise<readonly { id: string; sha256: string }[]>;
}

export function assertSafeFigmaAdapter(adapter: FigmaAdapter): void {
  if (!nonEmpty(adapter.id)) throw new Error('Figma adapter id is required');
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(adapter.version)) {
    throw new Error('Figma adapter version must be pinned semver');
  }
}


export interface StaticStudioPageInput {
  readonly locale: string;
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly canonicalUrl: string;
}

export interface StaticStudioPageArtifact {
  readonly format: 'furypipe-web-studio-page/v1';
  readonly projectId: string;
  readonly variantId: string;
  readonly locale: string;
  readonly direction: Direction;
  readonly path: string;
  readonly canonicalUrl: string;
  readonly html: string;
  readonly sha256: string;
  readonly externalScripts: readonly string[];
}

export interface StudioQaCase {
  readonly id: string;
  readonly browserProject: typeof REQUIRED_QA_PROJECTS[number];
  readonly viewport: typeof REQUIRED_VIEWPORTS[number];
  readonly locale: typeof REQUIRED_TEST_LOCALES[number];
}

export interface StudioBrowserObservation {
  readonly caseId: string;
  readonly loaded: boolean;
  readonly horizontalOverflow: boolean;
  readonly keyboardReachable: boolean;
  readonly singleH1: boolean;
  readonly lang: string;
  readonly direction: Direction;
  readonly hasTitle: boolean;
  readonly hasMetaDescription: boolean;
  readonly hasCanonical: boolean;
  readonly brokenLinks: number;
  readonly consoleErrors: number;
  readonly externalScriptOrigins: readonly string[];
}

export interface StudioBrowserQaAdapter {
  readonly id: string;
  readonly version: string;
  run(testCase: StudioQaCase, targetUrl: string): Promise<StudioBrowserObservation>;
}

export interface StudioBrowserQaReport {
  readonly format: 'furypipe-web-studio-browser-qa/v1';
  readonly adapter: { readonly id: string; readonly version: string };
  readonly totalCases: number;
  readonly browserQa: GateStatus;
  readonly structuralAccessibility: GateStatus;
  readonly structuralSeo: GateStatus;
  readonly thirdPartyScriptSurface: GateStatus;
  readonly productionPerformance: 'NOT_RUN';
  readonly deployment: 'NOT_RUN';
  readonly promotionEvidenceCompatible: false;
  readonly failures: readonly { readonly caseId: string; readonly reasons: readonly string[] }[];
}

function boundedStudioText(value: string, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength || value.includes('\0')) {
    throw new Error(`${label} must be a bounded non-empty string`);
  }
  return value.trim();
}

function escapeStudioHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function canonicalStudioLocale(locale: string): string {
  try {
    const [canonical] = Intl.getCanonicalLocales(locale.trim());
    if (!canonical) throw new Error('empty canonical locale');
    return canonical;
  } catch {
    throw new Error('studio page locale must be a valid BCP-47 tag');
  }
}

function selectedVariant(project: StudioProject): DesignVariant {
  const issues = validateStudioProject(project);
  if (issues.length > 0) throw new Error(`studio project is invalid: ${issues[0]!.code}`);
  if (!['APPROVED', 'IMPLEMENTED', 'VERIFIED', 'DEPLOYMENT_VERIFIED'].includes(project.status)) {
    throw new Error('static site generation requires an approved project');
  }
  const id = project.selectedVariantId;
  const variant = id === null ? undefined : project.variants.find((candidate) => candidate.id === id);
  if (!variant) throw new Error('approved project has no selected variant');
  return variant;
}

export function renderStaticStudioPage(
  project: StudioProject,
  input: StaticStudioPageInput,
): StaticStudioPageArtifact {
  const variant = selectedVariant(project);
  const locale = canonicalStudioLocale(input.locale);
  const path = boundedStudioText(input.path, 'studio page path', 512);
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('?') || path.includes('#')) {
    throw new Error('studio page path must be an absolute site path without query or fragment');
  }
  const title = boundedStudioText(input.title, 'studio page title', 70);
  const description = boundedStudioText(input.description, 'studio page description', 180);
  if (description.length < 40) throw new Error('studio page description must contain at least 40 characters');
  const heading = boundedStudioText(input.heading, 'studio page heading', 200);
  if (!Array.isArray(input.paragraphs) || input.paragraphs.length < 1 || input.paragraphs.length > 64) {
    throw new Error('studio page paragraphs must contain between 1 and 64 items');
  }
  const paragraphs = input.paragraphs.map((paragraph, index) =>
    boundedStudioText(paragraph, `studio paragraph ${index}`, 16_384)
  );

  let canonical: URL;
  try {
    canonical = new URL(input.canonicalUrl);
  } catch {
    throw new Error('studio canonicalUrl must be a valid URL');
  }
  if (canonical.protocol !== 'https:' || canonical.username || canonical.password || canonical.hash) {
    throw new Error('studio canonicalUrl must be credential-free HTTPS');
  }

  const direction = directionForLocale(locale);
  const html = [
    '<!doctype html>',
    `<html lang="${escapeStudioHtml(locale)}" dir="${direction}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeStudioHtml(title)}</title>`,
    `<meta name="description" content="${escapeStudioHtml(description)}">`,
    `<link rel="canonical" href="${escapeStudioHtml(canonical.toString())}">`,
    // frame-ancestors is intentionally absent here: browsers ignore it in a CSP meta element.
    // Hosts that need anti-framing must send frame-ancestors as an HTTP response header.
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">',
    '</head>',
    `<body data-studio-project="${escapeStudioHtml(project.id)}" data-studio-variant="${escapeStudioHtml(variant.id)}">`,
    '<main>',
    `<h1>${escapeStudioHtml(heading)}</h1>`,
    ...paragraphs.map((paragraph) => `<p>${escapeStudioHtml(paragraph)}</p>`),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');

  return Object.freeze({
    format: 'furypipe-web-studio-page/v1',
    projectId: project.id,
    variantId: variant.id,
    locale,
    direction,
    path,
    canonicalUrl: canonical.toString(),
    html,
    sha256: createHash('sha256').update(html, 'utf8').digest('hex'),
    externalScripts: Object.freeze([]),
  });
}

export function buildStudioQaMatrix(): readonly StudioQaCase[] {
  const cases: StudioQaCase[] = [];
  for (const browserProject of REQUIRED_QA_PROJECTS) {
    for (const viewport of REQUIRED_VIEWPORTS) {
      for (const locale of REQUIRED_TEST_LOCALES) {
        cases.push(Object.freeze({
          id: `${browserProject}:${viewport.id}:${locale}`,
          browserProject,
          viewport,
          locale,
        }));
      }
    }
  }
  return Object.freeze(cases);
}

export function assertSafeStudioBrowserAdapter(adapter: StudioBrowserQaAdapter): void {
  if (!adapter || typeof adapter !== 'object' || !nonEmpty(adapter.id) || typeof adapter.run !== 'function') {
    throw new Error('studio browser QA adapter is invalid');
  }
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(adapter.version)) {
    throw new Error('studio browser QA adapter version must be pinned semver');
  }
}

function safeQaBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('studio QA baseUrl must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('studio QA baseUrl must be credential-free HTTP(S) without query or fragment');
  }
  return url;
}

export async function runStudioBrowserQa(
  adapter: StudioBrowserQaAdapter,
  baseUrl: string,
  cases: readonly StudioQaCase[] = buildStudioQaMatrix(),
): Promise<StudioBrowserQaReport> {
  assertSafeStudioBrowserAdapter(adapter);
  const origin = safeQaBaseUrl(baseUrl);
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > 500) {
    throw new Error('studio QA cases must contain between 1 and 500 items');
  }
  const ids = new Set<string>();
  const requiredCases = new Map(buildStudioQaMatrix().map((testCase) => [testCase.id, testCase]));
  const failures: Array<{ caseId: string; reasons: readonly string[] }> = [];
  let qaOk = true;
  let accessibilityOk = true;
  let seoOk = true;
  let scriptsOk = true;

  for (const testCase of cases) {
    const requiredCase = requiredCases.get(testCase.id);
    if (!requiredCase
      || testCase.browserProject !== requiredCase.browserProject
      || testCase.viewport.id !== requiredCase.viewport.id
      || testCase.viewport.width !== requiredCase.viewport.width
      || testCase.viewport.height !== requiredCase.viewport.height
      || testCase.locale !== requiredCase.locale) {
      throw new Error(`studio QA case is not part of the required browser matrix: ${testCase.id}`);
    }
    if (ids.has(testCase.id)) throw new Error(`duplicate studio QA case id: ${testCase.id}`);
    ids.add(testCase.id);
    const target = new URL('/', origin);
    target.searchParams.set('locale', testCase.locale);

    const observation = await adapter.run(testCase, target.toString());
    if (!observation || observation.caseId !== testCase.id) {
      throw new Error(`studio QA adapter returned mismatched case evidence: ${testCase.id}`);
    }
    if (!Number.isSafeInteger(observation.brokenLinks) || observation.brokenLinks < 0
      || !Number.isSafeInteger(observation.consoleErrors) || observation.consoleErrors < 0
      || !Array.isArray(observation.externalScriptOrigins)) {
      throw new Error(`studio QA adapter returned invalid counters: ${testCase.id}`);
    }

    const reasons: string[] = [];
    const caseQaOk = observation.loaded
      && !observation.horizontalOverflow
      && observation.brokenLinks === 0
      && observation.consoleErrors === 0;
    if (!caseQaOk) {
      qaOk = false;
      if (!observation.loaded) reasons.push('page did not load');
      if (observation.horizontalOverflow) reasons.push('horizontal overflow');
      if (observation.brokenLinks > 0) reasons.push('broken links');
      if (observation.consoleErrors > 0) reasons.push('console errors');
    }

    const expectedDirection = directionForLocale(testCase.locale);
    const caseAccessibilityOk = observation.keyboardReachable
      && observation.singleH1
      && observation.direction === expectedDirection
      && canonicalStudioLocale(observation.lang) === canonicalStudioLocale(testCase.locale);
    if (!caseAccessibilityOk) {
      accessibilityOk = false;
      reasons.push('structural accessibility mismatch');
    }

    const caseSeoOk = observation.hasTitle && observation.hasMetaDescription && observation.hasCanonical;
    if (!caseSeoOk) {
      seoOk = false;
      reasons.push('SEO structure incomplete');
    }

    if (observation.externalScriptOrigins.length > 0) {
      scriptsOk = false;
      reasons.push('external script origin observed');
    }

    if (reasons.length > 0) failures.push(Object.freeze({ caseId: testCase.id, reasons: Object.freeze(reasons) }));
  }

  const completeMatrix = ids.size === requiredCases.size
    && [...requiredCases.keys()].every((id) => ids.has(id));
  const status = (passed: boolean): GateStatus => passed
    ? (completeMatrix ? 'VERIFIED' : 'PARTIAL')
    : 'FAILED';

  return Object.freeze({
    format: 'furypipe-web-studio-browser-qa/v1',
    adapter: Object.freeze({ id: adapter.id, version: adapter.version }),
    totalCases: cases.length,
    browserQa: status(qaOk),
    structuralAccessibility: status(accessibilityOk),
    structuralSeo: status(seoOk),
    thirdPartyScriptSurface: status(scriptsOk),
    productionPerformance: 'NOT_RUN',
    deployment: 'NOT_RUN',
    promotionEvidenceCompatible: false,
    failures: Object.freeze(failures),
  });
}
