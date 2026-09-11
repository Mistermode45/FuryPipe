import { describe, expect, it } from 'vitest';
import {
  assertSafeFigmaAdapter,
  canPromoteToDeploymentVerified,
  canPromoteToVerified,
  CORE_WEB_VITALS,
  evaluateCoreWebVitals,
  REQUIRED_QA_PROJECTS,
  REQUIRED_TEST_LOCALES,
  REQUIRED_VIEWPORTS,
  validateStudioProject,
  type StudioProject,
} from '../src/web-studio/index.js';

function project(): StudioProject {
  return {
    id: 'project-1',
    status: 'APPROVED',
    brief: {
      id: 'brief-1',
      objective: 'Ship a high-quality localized product site',
      audience: ['operators'],
      conversionGoals: ['signup'],
      targetLocales: ['en', 'fr'],
      targetDevices: ['mobile', 'tablet', 'desktop'],
      constraints: ['WCAG 2.2 AA'],
    },
    sources: [
      {
        id: 'wcag',
        canonicalUrl: 'https://www.w3.org/TR/WCAG22/',
        decision: 'REFERENCE_ONLY',
        licenseStatus: 'NOT_APPLICABLE',
        trust: 'REFERENCE',
      },
    ],
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
        rationale: 'More visual storytelling with controlled motion',
        desktop: 'desktop-contract',
        tablet: 'tablet-contract',
        mobile: 'mobile-contract',
        accessibilityRisks: ['motion'],
        performanceRisks: ['hero-media'],
        implementationComplexity: 'medium',
      },
    ],
    selectedVariantId: 'minimal',
    implementationCommit: null,
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

describe('Web/Figma Studio kernel', () => {
  it('accepts a valid approved project contract', () => {
    expect(validateStudioProject(project())).toEqual([]);
  });

  it('requires 2 to 4 genuinely modeled variants once designed', () => {
    const p = project();
    p.variants = [p.variants[0]];
    expect(validateStudioProject(p).map((issue) => issue.code)).toContain('VARIANT_COUNT_INVALID');
  });

  it('fails integrated third-party sources that are not reviewed and pinned', () => {
    const p = project();
    p.sources = [{
      id: 'component',
      canonicalUrl: 'https://example.com/component',
      decision: 'ADOPT',
      licenseStatus: 'UNKNOWN',
      trust: 'UNTRUSTED_INPUT',
    }];
    const codes = validateStudioProject(p).map((issue) => issue.code);
    expect(codes).toContain('SOURCE_LICENSE_REVIEW_REQUIRED');
    expect(codes).toContain('SOURCE_PIN_REQUIRED');
  });

  it('does not promote an implementation to verified without all evidence gates', () => {
    const p = project();
    p.status = 'IMPLEMENTED';
    p.implementationCommit = 'a'.repeat(40);
    expect(canPromoteToVerified(p)).toBe(false);
    p.evidence = {
      ...p.evidence,
      qa: 'VERIFIED',
      accessibility: 'VERIFIED',
      security: 'VERIFIED',
      seo: 'VERIFIED',
      performance: 'VERIFIED',
      privacy: 'VERIFIED',
    };
    expect(canPromoteToVerified(p)).toBe(true);
  });

  it('keeps BACKUP_EXISTS distinct from RESTORE_VERIFIED at deployment gate', () => {
    const p = project();
    p.status = 'VERIFIED';
    p.implementationCommit = 'b'.repeat(40);
    p.evidence = {
      qa: 'VERIFIED',
      accessibility: 'VERIFIED',
      security: 'VERIFIED',
      seo: 'VERIFIED',
      performance: 'VERIFIED',
      privacy: 'VERIFIED',
      deployment: 'VERIFIED',
      backup: 'BACKUP_EXISTS',
    };
    expect(canPromoteToDeploymentVerified(p)).toBe(false);
    p.evidence = { ...p.evidence, backup: 'RESTORE_VERIFIED' };
    expect(canPromoteToDeploymentVerified(p)).toBe(true);
  });

  it('encodes the required 2026 browser, viewport and locale coverage', () => {
    expect(REQUIRED_QA_PROJECTS).toEqual([
      'desktop-chromium',
      'desktop-firefox',
      'desktop-webkit',
      'mobile-chromium',
      'mobile-webkit',
    ]);
    expect(REQUIRED_VIEWPORTS).toHaveLength(6);
    expect(REQUIRED_TEST_LOCALES).toEqual(['en', 'fr', 'en-XA', 'ar-XB']);
  });

  it('evaluates field Core Web Vitals without fabricating missing values', () => {
    expect(CORE_WEB_VITALS).toEqual({ lcpMsP75Max: 2500, inpMsP75Max: 200, clsP75Max: 0.1 });
    expect(evaluateCoreWebVitals({ lcpMsP75: null, inpMsP75: 120, clsP75: 0.02 })).toBe('PARTIAL');
    expect(evaluateCoreWebVitals({ lcpMsP75: 2200, inpMsP75: 180, clsP75: 0.08 })).toBe('VERIFIED');
    expect(evaluateCoreWebVitals({ lcpMsP75: 2800, inpMsP75: 180, clsP75: 0.08 })).toBe('FAILED');
  });

  it('requires a pinned adapter version', () => {
    expect(() => assertSafeFigmaAdapter({
      id: 'figma',
      version: '1.2.3',
      async readApprovedDesign() { return {}; },
      async exportApprovedAssets() { return []; },
    })).not.toThrow();

    expect(() => assertSafeFigmaAdapter({
      id: 'figma',
      version: 'latest',
      async readApprovedDesign() { return {}; },
      async exportApprovedAssets() { return []; },
    })).toThrow(/pinned semver/);
  });
});
