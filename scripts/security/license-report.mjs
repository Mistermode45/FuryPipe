import fs from 'node:fs';

const [inputPath, outputPath = 'license-summary.json'] = process.argv.slice(2);
if (!inputPath) {
  console.error('usage: node license-report.mjs <pnpm-licenses.json> [summary.json]');
  process.exit(2);
}

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const counts = new Map();

function add(license, count = 1) {
  const key = typeof license === 'string' && license.trim() ? license.trim() : 'UNKNOWN_OR_MISSING';
  counts.set(key, (counts.get(key) ?? 0) + count);
}

if (Array.isArray(raw)) {
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      add('UNKNOWN_OR_MISSING');
      continue;
    }
    const license = item.license ?? item.licenses ?? item.licenseName;
    if (Array.isArray(license)) {
      for (const value of license) add(String(value));
    } else {
      add(typeof license === 'string' ? license : 'UNKNOWN_OR_MISSING');
    }
  }
} else if (raw && typeof raw === 'object') {
  for (const [license, entries] of Object.entries(raw)) {
    if (Array.isArray(entries)) add(license, entries.length);
    else if (entries && typeof entries === 'object') add(license, Object.keys(entries).length || 1);
    else add(license, 1);
  }
} else {
  throw new Error('pnpm license report must be an object or array');
}

const licenses = [...counts.entries()]
  .map(([license, packages]) => ({ license, packages }))
  .sort((a, b) => a.license.localeCompare(b.license));

const totalPackages = licenses.reduce((sum, item) => sum + item.packages, 0);
if (licenses.length === 0 || totalPackages === 0) {
  throw new Error('license report is empty');
}

const summary = {
  schema_version: 'furypipe-license-report/v1',
  source: 'pnpm licenses list --json',
  total_packages: totalPackages,
  license_groups: licenses.length,
  licenses,
  review_required: licenses
    .filter((item) => item.license === 'UNKNOWN_OR_MISSING' || /UNLICENSED|UNKNOWN/i.test(item.license))
    .map((item) => item.license),
};

fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2) + '\n');
console.log(`license report: ${totalPackages} package record(s), ${licenses.length} license group(s)`);
if (summary.review_required.length) {
  console.error(`license review required: ${summary.review_required.join(', ')}`);
  process.exit(1);
}
