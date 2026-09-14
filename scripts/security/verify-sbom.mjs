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

const rootNameIds = idsByName.get(pkg.name) || [];
const rootIds = rootNameIds.filter((id) =>
  sbom.packages.find((item) => item.SPDXID === id)?.versionInfo === pkg.version
);
if (rootNameIds.length > 0 && rootIds.length === 0) {
  throw new Error('SBOM root package version does not match package.json');
}
if (rootIds.length !== 1) throw new Error('SBOM must contain exactly one root package: ' + pkg.name);
const rootId = rootIds[0];

const sourceCommit = process.env.FURYPIPE_SOURCE_COMMIT || process.env.GITHUB_SHA || '';
if (sourceCommit && !/^[0-9a-f]{40}$/u.test(sourceCommit)) {
  throw new Error('FURYPIPE_SOURCE_COMMIT/GITHUB_SHA must be an exact lowercase 40-character commit SHA');
}
if (sourceCommit && sbom.documentNamespace !== `https://github.com/Mistermode45/FuryPipe/sbom/${sourceCommit}`) {
  throw new Error('SBOM document namespace does not match the exact source commit');
}

function packageNameFromAlias(name, spec) {
  if (typeof spec !== 'string' || !spec.startsWith('npm:')) return name;
  const reference = spec.slice(4);
  const match = reference.startsWith('@')
    ? /^(@[^\/]+\/[^@\/]+)(?:@.*)?$/u.exec(reference)
    : /^([^@/]+)(?:@.*)?$/u.exec(reference);
  return match?.[1] || name;
}

const directNames = new Set([
  ...Object.entries(pkg.dependencies || {}).map(([name, spec]) => packageNameFromAlias(name, spec)),
  ...Object.entries(pkg.devDependencies || {}).map(([name, spec]) => packageNameFromAlias(name, spec)),
  ...Object.entries(pkg.optionalDependencies || {}).map(([name, spec]) => packageNameFromAlias(name, spec)),
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

const reachable = new Set([rootId]);
let expanded = true;
while (expanded) {
  expanded = false;
  for (const relationship of sbom.relationships) {
    if (reachable.has(relationship.spdxElementId) && !reachable.has(relationship.relatedSpdxElement)) {
      reachable.add(relationship.relatedSpdxElement);
      expanded = true;
    }
  }
}
if (reachable.size !== sbom.packages.length) {
  throw new Error('SBOM contains packages unreachable from its root dependency graph');
}

if (sbom.packages.length < directNames.size + 1) {
  throw new Error('SBOM package count cannot cover root plus declared direct dependencies');
}

console.log('verified SPDX SBOM: ' + sbom.packages.length + ' packages, ' + directNames.size + ' direct dependencies');
