#!/usr/bin/env node
import fs from 'node:fs';
import { compareTriplet } from './contract.mjs';

const files = process.argv.slice(2);
if (files.length !== 3) {
  console.error('usage: node bench/v5/compare.mjs <raw.json> <pxpipe.json> <furypipe.json>');
  process.exit(2);
}

try {
  const results = files.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
  const comparison = compareTriplet(results);
  process.stdout.write(JSON.stringify(comparison, null, 2) + '\n');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
