import fs from 'node:fs';

const [packagePath = 'package.json', sbomPath = 'sbom.spdx.json'] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const sbom = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));

if (sbom.spdxVersion !== 'SPDX-2.3') throw new Error('SBOM must be SPDX-2.3');
if (!Array.isArray(sbom.packages) || sbom.packages.length === 0) throw new Error('SBOM contains no packages');
if (!Array.isArray(sbom.relationships)) throw new Error('SBOM relationships must be an array');

const ids = new Set();
const idsByName = new Map();
for (const item of sbom.packages) {
  if (!item || typeof item !== 'object' || typeof item.SPDXID !== 'string'
    || typeof item.name !== 'string' || typeof item.versionInfo !== 'string') {
    throw new Error('SBOM package entry is malformed');
  }
  if (ids.has(item.SPDXID)) throw new Error('SBOM contains duplicate SPDXID: ' + item.SPDXID);
  ids.add(item.SPDXID);
  const bucket = idsByName.get(item.name) || [];
  bucket.push(item.SPDXID);
  idsByName.set(item.name, bucket);
}

const rootIds = idsByName.get(pkg.name) || [];
if (rootIds.length !== 1) throw new Error('SBOM must contain exactly one root package: ' + pkg.name);
const rootId = rootIds[0];

const directNames = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
]);

for (const name of directNames) {
  const dependencyIds = idsByName.get(name) || [];
  if (dependencyIds.length === 0) throw new Error('SBOM missing declared direct dependency: ' + name);
  const linked = sbom.relationships.some((relationship) =>
    relationship
    && relationship.relationshipType === 'DEPENDS_ON'
    && relationship.spdxElementId === rootId
    && dependencyIds.includes(relationship.relatedSpdxElement)
  );
  if (!linked) throw new Error('SBOM missing root DEPENDS_ON relationship for: ' + name);
}

for (const relationship of sbom.relationships) {
  if (!relationship || relationship.relationshipType !== 'DEPENDS_ON') {
    throw new Error('SBOM contains unsupported relationship');
  }
  if (!ids.has(relationship.spdxElementId) || !ids.has(relationship.relatedSpdxElement)) {
    throw new Error('SBOM relationship references an unknown SPDXID');
  }
}

if (sbom.packages.length < directNames.size + 1) {
  throw new Error('SBOM package count cannot cover root plus declared direct dependencies');
}

console.log('verified SPDX SBOM: ' + sbom.packages.length + ' packages, ' + directNames.size + ' direct dependencies');
