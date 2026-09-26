import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

export const FURY_SUPPLY_CHAIN_FORMAT = 'furypipe-supply-chain-evidence/v1' as const;
export const FURY_CYCLONEDX_SPEC_VERSION = '1.6' as const;

export const FURY_SUPPLY_CHAIN_SIGNATURE_FORMAT = 'furypipe-supply-chain-signature/v1' as const;
export const FURY_SUPPLY_CHAIN_SIGNATURE_ALGORITHM = 'Ed25519' as const;

export interface FurySupplyChainSignature {
  readonly format: typeof FURY_SUPPLY_CHAIN_SIGNATURE_FORMAT;
  readonly algorithm: typeof FURY_SUPPLY_CHAIN_SIGNATURE_ALGORITHM;
  readonly keyId: string;
  readonly evidenceDigestSha256: string;
  readonly signatureBase64: string;
  readonly authority: 'detached-integrity-attestation-only';
  readonly executionAuthorized: false;
}

export interface FurySupplyChainSignedAttestation {
  readonly evidence: FurySupplyChainEvidence;
  readonly signature: FurySupplyChainSignature;
}


export interface FuryResolvedPackageInput {
  readonly name: string;
  readonly version: string;
  readonly dependencies?: readonly string[];
  readonly license?: string | null;
  readonly direct?: boolean;
  readonly dev?: boolean;
  readonly optional?: boolean;
}

export interface FurySupplyChainComponent {
  readonly key: string;
  readonly bomRef: string;
  readonly name: string;
  readonly version: string;
  readonly license: string | null;
  readonly direct: boolean;
  readonly dev: boolean;
  readonly optional: boolean;
  readonly dependencies: readonly string[];
}

export interface FurySupplyChainEvidenceInput {
  readonly sourceCommit: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packageJsonSha256: string;
  readonly lockfileSha256: string;
  readonly resolvedPackages: readonly FuryResolvedPackageInput[];
  readonly resolver: {
    readonly tool: string;
    readonly version: string;
    readonly command: readonly string[];
  };
}

export interface FurySupplyChainEvidence {
  readonly format: typeof FURY_SUPPLY_CHAIN_FORMAT;
  readonly sourceCommit: string;
  readonly package: {
    readonly name: string;
    readonly version: string;
    readonly packageJsonSha256: string;
    readonly lockfileSha256: string;
  };
  readonly resolver: FurySupplyChainEvidenceInput['resolver'];
  readonly summary: {
    readonly components: number;
    readonly dependencyEdges: number;
    readonly withLicense: number;
    readonly unknownLicense: number;
    readonly directComponents: number;
    readonly devComponents: number;
    readonly optionalComponents: number;
  };
  readonly components: readonly FurySupplyChainComponent[];
  readonly evidenceDigestSha256: string;
  readonly authority: 'supply-chain-observation-only';
  readonly signingStatus: 'UNSIGNED';
  readonly executionAuthorized: false;
}

export interface FuryCycloneDxBom {
  readonly bomFormat: 'CycloneDX';
  readonly specVersion: typeof FURY_CYCLONEDX_SPEC_VERSION;
  readonly version: 1;
  readonly metadata: {
    readonly component: {
      readonly type: 'application';
      readonly 'bom-ref': string;
      readonly name: string;
      readonly version: string;
    };
    readonly properties: readonly {
      readonly name: string;
      readonly value: string;
    }[];
  };
  readonly components: readonly {
    readonly type: 'library';
    readonly 'bom-ref': string;
    readonly name: string;
    readonly version: string;
    readonly licenses?: readonly { readonly license: { readonly id?: string; readonly name?: string } }[];
    readonly properties: readonly {
      readonly name: string;
      readonly value: string;
    }[];
  }[];
  readonly dependencies: readonly {
    readonly ref: string;
    readonly dependsOn: readonly string[];
  }[];
  readonly compositions: readonly {
    readonly aggregate: 'unknown';
    readonly dependencies: readonly { readonly ref: string }[];
  }[];
}

const SHA256_RE = /^[a-f0-9]{64}$/u;
const SOURCE_COMMIT_RE = /^(?:[a-f0-9]{40,64}|local-head|not-bound)$/u;
const PACKAGE_NAME_RE = /^(?:@[a-z0-9._~-]+\/)?[a-z0-9][a-z0-9._~-]*$/u;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/u;
const LICENSE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-.+]{0,63}$/u;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function boundedText(value: string, label: string, max: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new Error(`${label} is invalid`);
  }
  return trimmed;
}

function packageKey(name: string, version: string): string {
  return `${name}@${version}`;
}

function bomRef(name: string, version: string): string {
  return `urn:furypipe:npm:${sha256(packageKey(name, version))}`;
}

function normalizeLicense(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256 || /[\u0000-\u001f\u007f]/u.test(trimmed)) return null;
  return trimmed;
}

export function normalizeFurySupplyChainComponents(
  packages: readonly FuryResolvedPackageInput[],
): readonly FurySupplyChainComponent[] {
  if (!Array.isArray(packages) || packages.length > 100_000) {
    throw new Error('resolved package inventory must be a bounded array');
  }
  const byKey = new Map<string, FurySupplyChainComponent>();
  for (const [index, item] of packages.entries()) {
    if (!item || typeof item !== 'object') throw new Error(`resolvedPackages[${index}] is invalid`);
    const name = boundedText(item.name, `resolvedPackages[${index}].name`, 214).toLowerCase();
    const version = boundedText(item.version, `resolvedPackages[${index}].version`, 128);
    if (!PACKAGE_NAME_RE.test(name)) throw new Error(`resolvedPackages[${index}].name is invalid`);
    if (!VERSION_RE.test(version)) throw new Error(`resolvedPackages[${index}].version is invalid`);
    const key = packageKey(name, version);
    const dependencies = Object.freeze([...(item.dependencies ?? [])]
      .map((value, depIndex) => boundedText(value, `resolvedPackages[${index}].dependencies[${depIndex}]`, 384))
      .filter((value, depIndex, all) => all.indexOf(value) === depIndex)
      .sort((a, b) => a.localeCompare(b)));
    const normalized = Object.freeze({
      key,
      bomRef: bomRef(name, version),
      name,
      version,
      license: normalizeLicense(item.license),
      direct: item.direct === true,
      dev: item.dev === true,
      optional: item.optional === true,
      dependencies,
    });
    const existing = byKey.get(key);
    if (existing) {
      const merged = Object.freeze({
        ...existing,
        license: existing.license ?? normalized.license,
        direct: existing.direct || normalized.direct,
        dev: existing.dev && normalized.dev,
        optional: existing.optional && normalized.optional,
        dependencies: Object.freeze([...new Set([...existing.dependencies, ...normalized.dependencies])].sort((a, b) => a.localeCompare(b))),
      });
      byKey.set(key, merged);
    } else {
      byKey.set(key, normalized);
    }
  }
  const keys = new Set(byKey.keys());
  return Object.freeze([...byKey.values()]
    .map((component) => Object.freeze({
      ...component,
      dependencies: Object.freeze(component.dependencies.filter((dependency) => keys.has(dependency))),
    }))
    .sort((a, b) => a.key.localeCompare(b.key)));
}

function evidencePayload(input: Omit<FurySupplyChainEvidence, 'evidenceDigestSha256'>): string {
  return JSON.stringify(input);
}

export function createFurySupplyChainEvidence(input: FurySupplyChainEvidenceInput): FurySupplyChainEvidence {
  const sourceCommit = boundedText(input.sourceCommit, 'sourceCommit', 64);
  if (!SOURCE_COMMIT_RE.test(sourceCommit)) throw new Error('sourceCommit is invalid');
  const packageName = boundedText(input.packageName, 'packageName', 214).toLowerCase();
  const packageVersion = boundedText(input.packageVersion, 'packageVersion', 128);
  if (!PACKAGE_NAME_RE.test(packageName) || !VERSION_RE.test(packageVersion)) throw new Error('package identity is invalid');
  if (!SHA256_RE.test(input.packageJsonSha256) || !SHA256_RE.test(input.lockfileSha256)) {
    throw new Error('package and lockfile digests must be lowercase SHA-256');
  }
  const tool = boundedText(input.resolver.tool, 'resolver.tool', 64);
  const resolverVersion = boundedText(input.resolver.version, 'resolver.version', 64);
  const command = Object.freeze(input.resolver.command.map((part, index) => boundedText(part, `resolver.command[${index}]`, 256)));
  if (command.length < 1 || command.length > 32) throw new Error('resolver command is invalid');

  const components = normalizeFurySupplyChainComponents(input.resolvedPackages);
  const dependencyEdges = components.reduce((sum, component) => sum + component.dependencies.length, 0);
  const unsigned = Object.freeze({
    format: FURY_SUPPLY_CHAIN_FORMAT,
    sourceCommit,
    package: Object.freeze({
      name: packageName,
      version: packageVersion,
      packageJsonSha256: input.packageJsonSha256,
      lockfileSha256: input.lockfileSha256,
    }),
    resolver: Object.freeze({ tool, version: resolverVersion, command }),
    summary: Object.freeze({
      components: components.length,
      dependencyEdges,
      withLicense: components.filter((component) => component.license !== null).length,
      unknownLicense: components.filter((component) => component.license === null).length,
      directComponents: components.filter((component) => component.direct).length,
      devComponents: components.filter((component) => component.dev).length,
      optionalComponents: components.filter((component) => component.optional).length,
    }),
    components,
    authority: 'supply-chain-observation-only' as const,
    signingStatus: 'UNSIGNED' as const,
    executionAuthorized: false as const,
  });
  return Object.freeze({
    ...unsigned,
    evidenceDigestSha256: sha256(evidencePayload(unsigned)),
  });
}

function cycloneLicense(value: string | null): readonly { readonly license: { readonly id?: string; readonly name?: string } }[] | undefined {
  if (value === null) return undefined;
  return Object.freeze([Object.freeze({
    license: Object.freeze(LICENSE_ID_RE.test(value) ? { id: value } : { name: value }),
  })]);
}


function signaturePayload(evidenceDigestSha256: string): Buffer {
  if (!SHA256_RE.test(evidenceDigestSha256)) {
    throw new Error('evidenceDigestSha256 must be lowercase SHA-256');
  }
  return Buffer.from(`${FURY_SUPPLY_CHAIN_SIGNATURE_FORMAT}\0${evidenceDigestSha256}`, 'utf8');
}

function boundedKeyId(value: string): string {
  const keyId = boundedText(value, 'keyId', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@+~-]{0,127}$/u.test(keyId)) {
    throw new Error('keyId is invalid');
  }
  return keyId;
}

/**
 * Creates a detached Ed25519 attestation for immutable supply-chain evidence.
 * The private key is never stored in the evidence or signature object.
 */
export function signFurySupplyChainEvidence(
  evidence: FurySupplyChainEvidence,
  privateKeyPem: string | Buffer,
  keyId: string,
): FurySupplyChainSignature {
  if (evidence.format !== FURY_SUPPLY_CHAIN_FORMAT || evidence.executionAuthorized !== false) {
    throw new Error('valid FuryPipe supply-chain evidence is required');
  }
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('supply-chain signatures require an Ed25519 private key');
  }
  const signature = sign(null, signaturePayload(evidence.evidenceDigestSha256), privateKey);
  return Object.freeze({
    format: FURY_SUPPLY_CHAIN_SIGNATURE_FORMAT,
    algorithm: FURY_SUPPLY_CHAIN_SIGNATURE_ALGORITHM,
    keyId: boundedKeyId(keyId),
    evidenceDigestSha256: evidence.evidenceDigestSha256,
    signatureBase64: signature.toString('base64'),
    authority: 'detached-integrity-attestation-only',
    executionAuthorized: false,
  });
}

/**
 * Verifies a detached supply-chain attestation against the exact evidence
 * digest and the operator-provided Ed25519 public key.
 */
export function verifyFurySupplyChainEvidenceSignature(
  evidence: FurySupplyChainEvidence,
  signatureRecord: FurySupplyChainSignature,
  publicKeyPem: string | Buffer,
): boolean {
  if (
    evidence.format !== FURY_SUPPLY_CHAIN_FORMAT
    || evidence.executionAuthorized !== false
    || signatureRecord.format !== FURY_SUPPLY_CHAIN_SIGNATURE_FORMAT
    || signatureRecord.algorithm !== FURY_SUPPLY_CHAIN_SIGNATURE_ALGORITHM
    || signatureRecord.authority !== 'detached-integrity-attestation-only'
    || signatureRecord.executionAuthorized !== false
    || signatureRecord.evidenceDigestSha256 !== evidence.evidenceDigestSha256
    || !SHA256_RE.test(signatureRecord.evidenceDigestSha256)
    || typeof signatureRecord.signatureBase64 !== 'string'
    || signatureRecord.signatureBase64.length < 16
    || signatureRecord.signatureBase64.length > 1024
  ) return false;
  boundedKeyId(signatureRecord.keyId);
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('supply-chain signatures require an Ed25519 public key');
  }
  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(signatureRecord.signatureBase64, 'base64');
  } catch {
    return false;
  }
  if (signatureBytes.length !== 64) return false;
  return verify(null, signaturePayload(evidence.evidenceDigestSha256), publicKey, signatureBytes);
}

export function createFurySupplyChainSignedAttestation(
  evidence: FurySupplyChainEvidence,
  privateKeyPem: string | Buffer,
  keyId: string,
): FurySupplyChainSignedAttestation {
  return Object.freeze({
    evidence,
    signature: signFurySupplyChainEvidence(evidence, privateKeyPem, keyId),
  });
}

export function createFuryCycloneDxBom(evidence: FurySupplyChainEvidence): FuryCycloneDxBom {
  if (evidence.format !== FURY_SUPPLY_CHAIN_FORMAT || evidence.executionAuthorized !== false) {
    throw new Error('valid FuryPipe supply-chain evidence is required');
  }
  const applicationRef = `urn:furypipe:application:${sha256(`${evidence.package.name}@${evidence.package.version}`)}`;
  const refByKey = new Map(evidence.components.map((component) => [component.key, component.bomRef] as const));
  const directNames = new Set(evidence.components.filter((component) => component.direct).map((component) => component.key));
  return Object.freeze({
    bomFormat: 'CycloneDX',
    specVersion: FURY_CYCLONEDX_SPEC_VERSION,
    version: 1,
    metadata: Object.freeze({
      component: Object.freeze({
        type: 'application',
        'bom-ref': applicationRef,
        name: evidence.package.name,
        version: evidence.package.version,
      }),
      properties: Object.freeze([
        Object.freeze({ name: 'furypipe:evidenceDigestSha256', value: evidence.evidenceDigestSha256 }),
        Object.freeze({ name: 'furypipe:sourceCommit', value: evidence.sourceCommit }),
        Object.freeze({ name: 'furypipe:dependencyGraphCompleteness', value: 'observed-resolver-tree; not asserted complete beyond resolver output' }),
        Object.freeze({ name: 'furypipe:signingStatus', value: evidence.signingStatus }),
      ]),
    }),
    components: Object.freeze(evidence.components.map((component) => Object.freeze({
      type: 'library' as const,
      'bom-ref': component.bomRef,
      name: component.name,
      version: component.version,
      ...(cycloneLicense(component.license) === undefined ? {} : { licenses: cycloneLicense(component.license)! }),
      properties: Object.freeze([
        Object.freeze({ name: 'furypipe:direct', value: String(component.direct) }),
        Object.freeze({ name: 'furypipe:dev', value: String(component.dev) }),
        Object.freeze({ name: 'furypipe:optional', value: String(component.optional) }),
      ]),
    }))),
    dependencies: Object.freeze([
      Object.freeze({
        ref: applicationRef,
        dependsOn: Object.freeze([...directNames].map((key) => refByKey.get(key)).filter((ref): ref is string => ref !== undefined).sort()),
      }),
      ...evidence.components.map((component) => Object.freeze({
        ref: component.bomRef,
        dependsOn: Object.freeze(component.dependencies.map((key) => refByKey.get(key)).filter((ref): ref is string => ref !== undefined).sort()),
      })),
    ]),
    compositions: Object.freeze([
      Object.freeze({
        aggregate: 'unknown' as const,
        dependencies: Object.freeze([{ ref: applicationRef }]),
      }),
    ]),
  });
}
