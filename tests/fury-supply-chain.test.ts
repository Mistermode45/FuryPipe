import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createFuryCycloneDxBom,
  createFurySupplyChainEvidence,
  createFurySupplyChainSignedAttestation,
  normalizeFurySupplyChainComponents,
  signFurySupplyChainEvidence,
  verifyFurySupplyChainEvidenceSignature,
} from '../src/fury-supply-chain.js';

const sha = (char: string) => char.repeat(64);

describe('Fury supply-chain evidence', () => {
  it('normalizes duplicate dependency observations deterministically', () => {
    const components = normalizeFurySupplyChainComponents([
      {
        name: '@scope/a',
        version: '1.0.0',
        direct: true,
        dev: true,
        optional: true,
        license: null,
        dependencies: ['b@2.0.0'],
      },
      {
        name: '@scope/a',
        version: '1.0.0',
        direct: false,
        dev: false,
        optional: false,
        license: 'MIT',
        dependencies: ['c@3.0.0', 'b@2.0.0'],
      },
      { name: 'b', version: '2.0.0', license: 'Apache-2.0' },
      { name: 'c', version: '3.0.0' },
    ]);

    expect(components.map((component) => component.key)).toEqual([
      '@scope/a@1.0.0',
      'b@2.0.0',
      'c@3.0.0',
    ]);
    expect(components[0]).toMatchObject({
      direct: true,
      dev: false,
      optional: false,
      license: 'MIT',
      dependencies: ['b@2.0.0', 'c@3.0.0'],
    });
    expect(components[0]?.bomRef).toMatch(/^urn:furypipe:npm:[a-f0-9]{64}$/u);
  });

  it('creates deterministic unsigned evidence with no execution authority', () => {
    const input = {
      sourceCommit: 'a'.repeat(40),
      packageName: 'furypipe',
      packageVersion: '0.16.0',
      packageJsonSha256: sha('b'),
      lockfileSha256: sha('c'),
      resolvedPackages: [
        {
          name: 'zod',
          version: '4.6.2',
          direct: true,
          license: 'MIT',
          dependencies: [],
        },
        {
          name: 'ws',
          version: '8.21.3',
          direct: true,
          license: 'MIT',
          dependencies: [],
        },
      ],
      resolver: {
        tool: 'pnpm',
        version: '10.21.0',
        command: ['pnpm', 'list', '--json', '--depth', 'Infinity'],
      },
    } as const;

    const first = createFurySupplyChainEvidence(input);
    const second = createFurySupplyChainEvidence({
      ...input,
      resolvedPackages: [...input.resolvedPackages].reverse(),
    });

    expect(first.evidenceDigestSha256).toBe(second.evidenceDigestSha256);
    expect(first).toMatchObject({
      signingStatus: 'UNSIGNED',
      authority: 'supply-chain-observation-only',
      executionAuthorized: false,
      summary: {
        components: 2,
        directComponents: 2,
        withLicense: 2,
        unknownLicense: 0,
      },
    });
  });

  it('binds the evidence digest to manifest and lockfile bytes', () => {
    const base = {
      sourceCommit: 'd'.repeat(40),
      packageName: 'furypipe',
      packageVersion: '0.16.0',
      packageJsonSha256: sha('1'),
      lockfileSha256: sha('2'),
      resolvedPackages: [{ name: 'zod', version: '4.6.2', direct: true }],
      resolver: { tool: 'pnpm', version: '10.21.0', command: ['pnpm', 'list'] },
    } as const;

    const original = createFurySupplyChainEvidence(base);
    const changedLock = createFurySupplyChainEvidence({
      ...base,
      lockfileSha256: sha('3'),
    });
    expect(changedLock.evidenceDigestSha256).not.toBe(original.evidenceDigestSha256);
  });

  it('builds a bounded CycloneDX 1.6 graph without claiming complete dependency knowledge', () => {
    const evidence = createFurySupplyChainEvidence({
      sourceCommit: 'e'.repeat(40),
      packageName: 'furypipe',
      packageVersion: '0.16.0',
      packageJsonSha256: sha('4'),
      lockfileSha256: sha('5'),
      resolvedPackages: [
        {
          name: 'alpha',
          version: '1.0.0',
          direct: true,
          license: 'MIT',
          dependencies: ['beta@2.0.0'],
        },
        {
          name: 'beta',
          version: '2.0.0',
          license: null,
          dependencies: [],
        },
      ],
      resolver: {
        tool: 'pnpm',
        version: '10.21.0',
        command: ['pnpm', 'list', '--json', '--depth', 'Infinity'],
      },
    });

    const bom = createFuryCycloneDxBom(evidence);
    expect(bom).toMatchObject({
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      version: 1,
      compositions: [{ aggregate: 'unknown' }],
    });
    expect(bom.components).toHaveLength(2);
    const alpha = bom.components.find((component) => component.name === 'alpha');
    expect(alpha?.licenses).toEqual([{ license: { id: 'MIT' } }]);
    const alphaDependency = bom.dependencies.find((dependency) => dependency.ref === alpha?.['bom-ref']);
    expect(alphaDependency?.dependsOn).toHaveLength(1);
    expect(bom.metadata.properties).toContainEqual({
      name: 'furypipe:signingStatus',
      value: 'UNSIGNED',
    });
  });


  it('signs and verifies exact supply-chain evidence with detached Ed25519 attestations', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const evidence = createFurySupplyChainEvidence({
      sourceCommit: 'f'.repeat(40),
      packageName: 'furypipe',
      packageVersion: '0.16.0',
      packageJsonSha256: sha('6'),
      lockfileSha256: sha('7'),
      resolvedPackages: [{ name: 'zod', version: '4.6.2', direct: true, license: 'MIT' }],
      resolver: { tool: 'pnpm', version: '10.21.0', command: ['pnpm', 'list'] },
    });

    const signature = signFurySupplyChainEvidence(
      evidence,
      privateKey.export({ format: 'pem', type: 'pkcs8' }),
      'release-key-2026',
    );
    expect(signature).toMatchObject({
      format: 'furypipe-supply-chain-signature/v1',
      algorithm: 'Ed25519',
      keyId: 'release-key-2026',
      evidenceDigestSha256: evidence.evidenceDigestSha256,
      authority: 'detached-integrity-attestation-only',
      executionAuthorized: false,
    });
    expect(verifyFurySupplyChainEvidenceSignature(
      evidence,
      signature,
      publicKey.export({ format: 'pem', type: 'spki' }),
    )).toBe(true);

    const changed = createFurySupplyChainEvidence({
      sourceCommit: 'f'.repeat(40),
      packageName: 'furypipe',
      packageVersion: '0.16.0',
      packageJsonSha256: sha('6'),
      lockfileSha256: sha('8'),
      resolvedPackages: [{ name: 'zod', version: '4.6.2', direct: true, license: 'MIT' }],
      resolver: { tool: 'pnpm', version: '10.21.0', command: ['pnpm', 'list'] },
    });
    expect(verifyFurySupplyChainEvidenceSignature(
      changed,
      signature,
      publicKey.export({ format: 'pem', type: 'spki' }),
    )).toBe(false);

    const attestation = createFurySupplyChainSignedAttestation(
      evidence,
      privateKey.export({ format: 'pem', type: 'pkcs8' }),
      'release-key-2026',
    );
    expect(attestation.evidence).toBe(evidence);
    expect(verifyFurySupplyChainEvidenceSignature(
      attestation.evidence,
      attestation.signature,
      publicKey.export({ format: 'pem', type: 'spki' }),
    )).toBe(true);
  });

  it('rejects non-Ed25519 signing keys and malformed detached signatures', () => {
    const evidence = createFurySupplyChainEvidence({
      sourceCommit: 'a'.repeat(40),
      packageName: 'furypipe',
      packageVersion: '0.16.0',
      packageJsonSha256: sha('9'),
      lockfileSha256: sha('0'),
      resolvedPackages: [],
      resolver: { tool: 'pnpm', version: '10.21.0', command: ['pnpm', 'list'] },
    });
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() => signFurySupplyChainEvidence(
      evidence,
      rsa.privateKey.export({ format: 'pem', type: 'pkcs8' }),
      'rsa-key',
    )).toThrow(/Ed25519/u);

    const ed = generateKeyPairSync('ed25519');
    const signature = signFurySupplyChainEvidence(
      evidence,
      ed.privateKey.export({ format: 'pem', type: 'pkcs8' }),
      'release-key',
    );
    expect(verifyFurySupplyChainEvidenceSignature(
      evidence,
      { ...signature, signatureBase64: 'not-a-signature' },
      ed.publicKey.export({ format: 'pem', type: 'spki' }),
    )).toBe(false);
  });

  it('rejects malformed package and digest evidence fail closed', () => {
    expect(() => createFurySupplyChainEvidence({
      sourceCommit: 'not-a-sha',
      packageName: 'furypipe',
      packageVersion: '0.16.0',
      packageJsonSha256: sha('a'),
      lockfileSha256: sha('b'),
      resolvedPackages: [],
      resolver: { tool: 'pnpm', version: '10.21.0', command: ['pnpm', 'list'] },
    })).toThrow(/sourceCommit/u);

    expect(() => normalizeFurySupplyChainComponents([
      { name: '../escape', version: '1.0.0' },
    ])).toThrow(/name is invalid/u);
  });
});
