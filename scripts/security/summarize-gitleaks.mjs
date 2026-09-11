import fs from 'node:fs';

const [reportPath] = process.argv.slice(2);
if (!reportPath) {
  console.error('usage: node summarize-gitleaks.mjs <report.json>');
  process.exit(2);
}

const findings = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (!Array.isArray(findings)) throw new Error('gitleaks report must be a JSON array');

const safe = findings.map((finding) => ({
  rule: String(finding.RuleID ?? 'unknown'),
  file: String(finding.File ?? 'unknown'),
  line: Number.isInteger(finding.StartLine) ? finding.StartLine : null,
  commit: typeof finding.Commit === 'string' ? finding.Commit.slice(0, 12) : null,
  fingerprint: typeof finding.Fingerprint === 'string' ? finding.Fingerprint : null,
}));

const counts = new Map();
for (const item of safe) {
  const key = `${item.rule} :: ${item.file}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

console.log(`gitleaks findings: ${safe.length}`);
for (const [key, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`${count}x ${key}`);
}

console.log('safe finding metadata:');
for (const item of safe) console.log(JSON.stringify(item));
