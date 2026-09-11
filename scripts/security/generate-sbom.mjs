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
  const safe = `${name}-${version}`.replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
  return `SPDXRef-Package-${safe || 'unknown'}`;
}

function addNode(node, parentId) {
  if (!node || typeof node !== 'object') return;
  const name = typeof node.name === 'string' ? node.name : undefined;
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
    if (!deps || typeof deps !== 'object') continue;
    for (const dep of Object.values(deps)) addNode(dep, currentId);
  }
}

for (const root of roots) addNode(root, undefined);

const sha = (process.env.GITHUB_SHA || 'local').replace(/[^A-Fa-f0-9]/g, '').slice(0, 40) || 'local';
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
