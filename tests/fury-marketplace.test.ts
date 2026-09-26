import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createFuryMarketplaceManifest,
  planFuryMarketplaceTransition,
  signFuryMarketplaceManifest,
  verifyFuryMarketplaceSignature,
} from '../src/fury-marketplace.js';

const permissions = Object.freeze({
  network: 'none' as const,
  filesystem: 'none' as const,
  subprocess: 'none' as const,
  credentials: 'none' as const,
  externalWrites: Object.freeze([]),
  database: 'none' as const,
  browser: 'none' as const,
  provider: 'none' as const,
  cloud: 'none' as const,
});

function fixture() {
  return createFuryMarketplaceManifest({
    id: 'example-skill',
    name: 'Example Skill',
    version: '1.2.3',
    capabilityType: 'skill',
    sourceUrl: 'https://github.com/example/example-skill/archive/0123456789abcdef.tar.gz',
    sourceSha256: 'a'.repeat(64),
    license: 'MIT',
    author: 'Example',
    permissions,
    dependencies: ['core-runtime@1'],
    documentation: ['https://github.com/example/example-skill'],
    trust: 'VERIFIED',
  });
}

describe('Fury Marketplace foundation', () => {
  it('creates deterministic non-executable manifests', () => {
    const a = fixture();
    const b = fixture();
    expect(a.manifestDigestSha256).toBe(b.manifestDigestSha256);
    expect(a).toMatchObject({
      format: 'furypipe-marketplace-manifest/v1',
      executionAuthorized: false,
      trust: 'VERIFIED',
    });
  });

  it('verifies trusted Ed25519 signatures and still requires operator approval', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const manifest = fixture();
    const signature = signFuryMarketplaceManifest(
      manifest,
      privateKey.export({ format: 'pem', type: 'pkcs8' }),
      'marketplace-root-2026',
    );
    const trustedKeys = [{
      keyId: 'marketplace-root-2026',
      publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }),
      trust: 'VERIFIED' as const,
    }];

    expect(verifyFuryMarketplaceSignature(manifest, signature, trustedKeys)).toMatchObject({
      verified: true,
      trust: 'VERIFIED',
    });

    const plan = planFuryMarketplaceTransition({
      action: 'INSTALL',
      manifest,
      signature,
      trustedKeys,
    });
    expect(plan).toMatchObject({
      state: 'READY_FOR_APPROVAL',
      signatureVerified: true,
      requiresOperatorApproval: true,
      networkAuthorized: false,
      filesystemAuthorized: false,
      executionAuthorized: false,
    });
  });

  it('rejects untrusted signatures and restricted packages', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const base = fixture();
    const signature = signFuryMarketplaceManifest(
      base,
      privateKey.export({ format: 'pem', type: 'pkcs8' }),
      'unknown-key',
    );
    expect(planFuryMarketplaceTransition({
      action: 'INSTALL',
      manifest: base,
      signature,
      trustedKeys: [],
    }).state).toBe('REJECTED');

    const restricted = createFuryMarketplaceManifest({
      ...base,
      trust: 'RESTRICTED',
    });
    const keys = generateKeyPairSync('ed25519');
    const restrictedSignature = signFuryMarketplaceManifest(
      restricted,
      keys.privateKey.export({ format: 'pem', type: 'pkcs8' }),
      'verified-key',
    );
    expect(planFuryMarketplaceTransition({
      action: 'INSTALL',
      manifest: restricted,
      signature: restrictedSignature,
      trustedKeys: [{
        keyId: 'verified-key',
        publicKeyPem: keys.publicKey.export({ format: 'pem', type: 'spki' }),
        trust: 'VERIFIED',
      }],
    }).state).toBe('REJECTED');
  });

  it('rejects unsafe sources, malformed hashes and invalid lifecycle transitions', () => {
    expect(() => createFuryMarketplaceManifest({
      ...fixture(),
      sourceUrl: 'http://example.test/skill.tgz',
    })).toThrow(/HTTPS/u);
    expect(() => createFuryMarketplaceManifest({
      ...fixture(),
      sourceSha256: 'abc',
    })).toThrow(/SHA-256/u);
    expect(() => createFuryMarketplaceManifest({
      ...fixture(),
      capabilityType: 'root-shell' as never,
    })).toThrow(/capabilityType/u);
    expect(() => createFuryMarketplaceManifest({
      ...fixture(),
      permissions: { ...permissions, network: 'root' as never },
    })).toThrow(/permissions\.network/u);

    const keys = generateKeyPairSync('ed25519');
    const manifest = fixture();
    const signature = signFuryMarketplaceManifest(
      manifest,
      keys.privateKey.export({ format: 'pem', type: 'pkcs8' }),
      'root',
    );
    const trustedKeys = [{
      keyId: 'root',
      publicKeyPem: keys.publicKey.export({ format: 'pem', type: 'spki' }),
      trust: 'VERIFIED' as const,
    }];
    expect(() => planFuryMarketplaceTransition({
      action: 'UPDATE',
      manifest,
      signature,
      trustedKeys,
    })).toThrow(/current version/u);
  });
});
