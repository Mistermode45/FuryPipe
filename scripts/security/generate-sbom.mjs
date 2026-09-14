import { createHash } from 'node:crypto';
import fs from 'node:fs';

const [inputPath, outputPath = 'sbom.spdx.json'] = process.argv.slice(2);
if (!inputPath) {
  console.error('usage: node generate-sbom.mjs <pnpm-list.json> [output.json]');
  process.exit(2);
}

const roots = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!Array.isArray(roots)) {
  throw new Error('pnpm list JSON must be an array');
}

const packages = new Map();
const relationships = new Set();

function spdxId(name, version) {
  const identity = `${name}\0${version}`;
  const safe = `${name}-${version}`.replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
  const suffix = createHash('sha256').update(identity, 'utf8').digest('hex');
  return `SPDXRef-Package-${safe || 'unknown'}-${suffix}`;
}

function packageNameFromReference(reference) {
  if (typeof reference !== 'string') return undefined;
  const value = reference.startsWith('npm:') ? reference.slice(4) : reference;
  const match = value.startsWith('@')
    ? /^(@[^\/]+\/[^@\/]+)(?:@.*)?$/u.exec(value)
    : /^([^@/]+)(?:@.*)?$/u.exec(value);
  return match?.[1];
}

function addNode(node, parentId, fallbackName) {
  if (!node || typeof node !== 'object') return;
  // pnpm list --json stores dependency names as object keys. Dependency
  // records commonly contain version/from/path but no explicit name field.
  // Preserve that key as the package identity instead of silently dropping
  // the entire dependency subtree from the SBOM.
  const name = typeof node.name === 'string' && node.name.length > 0
    ? node.name
    : packageNameFromReference(node.from) || fallbackName;
  const version = typeof node.version === 'string' ? node.version : undefined;
  let currentId = parentId;

  if (name && version) {
    currentId = spdxId(name, version);
    if (!packages.has(currentId)) {
      packages.set(currentId, {
        SPDXID: currentId,
        name,
        versionInfo: version,
        downloadLocation: 'NOASSERTION',
        filesAnalyzed: false,
        licenseConcluded: 'NOASSERTION',
        licenseDeclared: 'NOASSERTION',
        copyrightText: 'NOASSERTION',
      });
    }
    if (parentId && parentId !== currentId) {
      relationships.add(JSON.stringify({
        spdxElementId: parentId,
        relationshipType: 'DEPENDS_ON',
        relatedSpdxElement: currentId,
      }));
    }
  }

  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const deps = node[group];
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
    for (const [depName, dep] of Object.entries(deps)) addNode(dep, currentId, depName);
  }
}

for (const root of roots) addNode(root, undefined, undefined);

const sourceCommit = process.env.FURYPIPE_SOURCE_COMMIT || process.env.GITHUB_SHA || '';
if (sourceCommit && !/^[0-9a-f]{40}$/u.test(sourceCommit)) {
  throw new Error('FURYPIPE_SOURCE_COMMIT/GITHUB_SHA must be an exact lowercase 40-character commit SHA');
}
const sha = /^[0-9a-f]{40}$/u.test(sourceCommit) ? sourceCommit : 'local';
const namespace = `https://github.com/Mistermode45/FuryPipe/sbom/${sha}`;

const document = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: 'FuryPipe dependency SBOM',
  documentNamespace: namespace,
  creationInfo: {
    created: new Date(0).toISOString(),
    creators: ['Tool: FuryPipe scripts/security/generate-sbom.mjs'],
  },
  packages: [...packages.values()].sort((a, b) => a.SPDXID.localeCompare(b.SPDXID)),
  relationships: [...relationships].map((item) => JSON.parse(item)).sort((a, b) =>
    `${a.spdxElementId}:${a.relatedSpdxElement}`.localeCompare(`${b.spdxElementId}:${b.relatedSpdxElement}`),
  ),
};

if (document.packages.length === 0) throw new Error('SBOM contains no packages');
fs.writeFileSync(outputPath, JSON.stringify(document, null, 2) + '\n');
console.log(`wrote ${document.packages.length} packages to ${outputPath}`);
