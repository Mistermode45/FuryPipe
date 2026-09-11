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
