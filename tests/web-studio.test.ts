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
  assertSafeStudioBrowserAdapter,
  buildStudioQaMatrix,
  renderStaticStudioPage,
  runStudioBrowserQa,
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


  it('renders a deterministic approved static page with escaped content and strict metadata', () => {
    const artifact = renderStaticStudioPage(project(), {
      locale: 'fr-FR',
      path: '/fr/',
      title: 'FuryPipe Studio',
      description: 'Une description suffisamment longue pour produire des métadonnées SEO locales vérifiables.',
      heading: '<Approved & safe>',
      paragraphs: ['Body <script>alert(1)</script> content'],
      canonicalUrl: 'https://example.test/fr/',
    });

    expect(artifact).toMatchObject({
      format: 'furypipe-web-studio-page/v1',
      projectId: 'project-1',
      variantId: 'minimal',
      locale: 'fr-FR',
      direction: 'ltr',
      path: '/fr/',
      externalScripts: [],
    });
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.html).toContain('<html lang="fr-FR" dir="ltr">');
    expect(artifact.html).toContain('&lt;Approved &amp; safe&gt;');
    expect(artifact.html).toContain('Body &lt;script&gt;alert(1)&lt;/script&gt; content');
    expect(artifact.html).not.toContain('<script>');
    expect(artifact.html).toContain('Content-Security-Policy');
    expect(artifact.html).not.toContain('frame-ancestors');
  });

  it('refuses static generation before explicit design approval and unsafe canonical URLs', () => {
    const draft = project();
    draft.status = 'DESIGNED';
    draft.selectedVariantId = null;
    expect(() => renderStaticStudioPage(draft, {
      locale: 'en',
      path: '/',
      title: 'Site',
      description: 'A sufficiently long description for deterministic structural SEO validation.',
      heading: 'Heading',
      paragraphs: ['Paragraph'],
      canonicalUrl: 'https://example.test/',
    })).toThrow();

    expect(() => renderStaticStudioPage(project(), {
      locale: 'en',
      path: '/',
      title: 'Site',
      description: 'A sufficiently long description for deterministic structural SEO validation.',
      heading: 'Heading',
      paragraphs: ['Paragraph'],
      canonicalUrl: 'http://user:pass@example.test/',
    })).toThrow(/credential-free HTTPS/);
  });

  it('builds the full deterministic browser/viewport/locale QA matrix', () => {
    const matrix = buildStudioQaMatrix();
    expect(matrix).toHaveLength(
      REQUIRED_QA_PROJECTS.length * REQUIRED_VIEWPORTS.length * REQUIRED_TEST_LOCALES.length,
    );
    expect(new Set(matrix.map((item) => item.id)).size).toBe(matrix.length);
    expect(matrix.some((item) => item.locale === 'ar-XB')).toBe(true);
  });

  it('keeps a passing browser subset partial until the complete required matrix is covered', async () => {
    const adapter = {
      id: 'playwright-host',
      version: '1.0.0',
      async run(testCase: ReturnType<typeof buildStudioQaMatrix>[number]) {
        return {
          caseId: testCase.id,
          loaded: true,
          horizontalOverflow: false,
          keyboardReachable: true,
          singleH1: true,
          lang: testCase.locale,
          direction: testCase.locale === 'ar-XB' ? 'rtl' as const : 'ltr' as const,
          hasTitle: true,
          hasMetaDescription: true,
          hasCanonical: true,
          brokenLinks: 0,
          consoleErrors: 0,
          externalScriptOrigins: [],
        };
      },
    };

    const cases = buildStudioQaMatrix().slice(0, 8);
    const report = await runStudioBrowserQa(adapter, 'http://127.0.0.1:4173', cases);
    expect(report).toMatchObject({
      totalCases: 8,
      browserQa: 'PARTIAL',
      structuralAccessibility: 'PARTIAL',
      structuralSeo: 'PARTIAL',
      thirdPartyScriptSurface: 'PARTIAL',
      productionPerformance: 'NOT_RUN',
      deployment: 'NOT_RUN',
      promotionEvidenceCompatible: false,
      failures: [],
    });
  });

  it('marks the complete browser, viewport and locale matrix VERIFIED', async () => {
    const adapter = {
      id: 'complete-matrix-fixture',
      version: '1.0.0',
      async run(testCase: ReturnType<typeof buildStudioQaMatrix>[number]) {
        return {
          caseId: testCase.id,
          loaded: true,
          horizontalOverflow: false,
          keyboardReachable: true,
          singleH1: true,
          lang: testCase.locale,
          direction: testCase.locale === 'ar-XB' ? 'rtl' as const : 'ltr' as const,
          hasTitle: true,
          hasMetaDescription: true,
          hasCanonical: true,
          brokenLinks: 0,
          consoleErrors: 0,
          externalScriptOrigins: [],
        };
      },
    };

    const report = await runStudioBrowserQa(adapter, 'http://127.0.0.1:4173');
    expect(report).toMatchObject({
      totalCases: 120,
      browserQa: 'VERIFIED',
      structuralAccessibility: 'VERIFIED',
      structuralSeo: 'VERIFIED',
      thirdPartyScriptSurface: 'VERIFIED',
      failures: [],
    });
  });

  it('fails visible on browser QA defects and external script origins', async () => {
    const testCase = buildStudioQaMatrix()[0]!;
    const report = await runStudioBrowserQa({
      id: 'browser-adapter',
      version: '1.2.3',
      async run() {
        return {
          caseId: testCase.id,
          loaded: true,
          horizontalOverflow: true,
          keyboardReachable: false,
          singleH1: false,
          lang: 'en',
          direction: 'ltr' as const,
          hasTitle: true,
          hasMetaDescription: false,
          hasCanonical: false,
          brokenLinks: 2,
          consoleErrors: 1,
          externalScriptOrigins: ['https://third-party.example'],
        };
      },
    }, 'https://preview.example.test', [testCase]);

    expect(report.browserQa).toBe('FAILED');
    expect(report.structuralAccessibility).toBe('FAILED');
    expect(report.structuralSeo).toBe('FAILED');
    expect(report.thirdPartyScriptSurface).toBe('FAILED');
    expect(report.failures[0]?.reasons).toEqual(expect.arrayContaining([
      'horizontal overflow',
      'broken links',
      'console errors',
      'structural accessibility mismatch',
      'SEO structure incomplete',
      'external script origin observed',
    ]));
  });

  it('requires pinned browser QA adapters and bounded unique case IDs', async () => {
    expect(() => assertSafeStudioBrowserAdapter({
      id: 'playwright',
      version: 'latest',
      async run() { throw new Error('never'); },
    })).toThrow(/pinned semver/);

    const testCase = buildStudioQaMatrix()[0]!;
    await expect(runStudioBrowserQa({
      id: 'adapter',
      version: '1.0.0',
      async run(input) {
        return {
          caseId: input.id,
          loaded: true,
          horizontalOverflow: false,
          keyboardReachable: true,
          singleH1: true,
          lang: input.locale,
          direction: input.locale === 'ar-XB' ? 'rtl' : 'ltr',
          hasTitle: true,
          hasMetaDescription: true,
          hasCanonical: true,
          brokenLinks: 0,
          consoleErrors: 0,
          externalScriptOrigins: [],
        };
      },
    }, 'http://localhost:4173', [testCase, testCase])).rejects.toThrow(/duplicate studio QA case id/);
  });
});
