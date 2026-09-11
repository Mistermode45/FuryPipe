import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ?? '.github/workflows';
const files = fs.readdirSync(root)
  .filter((name) => /\.ya?ml$/i.test(name))
  .sort();

const failures = [];
let checked = 0;

for (const name of files) {
  const file = path.join(root, name);
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)) {
    const spec = match[1];
    checked += 1;

    if (spec.startsWith('./')) continue;

    if (spec.startsWith('docker://')) {
      if (!/@sha256:[0-9a-f]{64}$/i.test(spec)) {
        failures.push(`${file}: docker action is not pinned by sha256 digest: ${spec}`);
      }
      continue;
    }

    const at = spec.lastIndexOf('@');
    const ref = at >= 0 ? spec.slice(at + 1) : '';
    if (!/^[0-9a-f]{40}$/i.test(ref)) {
      failures.push(`${file}: action is not pinned to a full 40-character commit SHA: ${spec}`);
    }
  }
}

if (checked === 0) {
  console.error('no GitHub Actions uses: entries found');
  process.exit(1);
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  console.error(`action pinning check: FAIL (${failures.length} issue(s), ${checked} action reference(s) checked)`);
  process.exit(1);
}

console.log(`action pinning check: PASS (${checked} action reference(s) checked across ${files.length} workflow(s))`);
