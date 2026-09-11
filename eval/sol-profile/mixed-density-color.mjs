// Local-only GPT Sol render experiment. No fetch, API keys, or model calls.
//
// Compares:
//   1. production 5x8 density
//   2. larger real JetBrains Mono + Unicode fallback
//   3. larger font with stable character-class colors
//   4. larger glyphs with one pixel of horizontal overprint
//   5. mixed density: prose at 5x8, structured text at 9x12, and high-entropy
//      exact strings retained as native text
//
// Run: pnpm run build && node eval/sol-profile/mixed-density-color.mjs

// All artifacts stay under ignored eval/sol-profile/.work/.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import {
  reflow,
  renderCellHeight,
  renderCellWidth,
  renderTextToPngs,
} from '../../dist/core/render.js';
import { resolveGptProfile } from '../../dist/core/gpt-model-profiles.js';
import { visionTokensForModel } from '../../dist/core/openai.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.work', 'mixed-density-color');
const MODEL = 'gpt-5.6-sol';
const PROFILE = resolveGptProfile(MODEL);
const MAX_WIDTH = 768;
const PAD_X = 4;

mkdirSync(OUT, { recursive: true });

const EXACT = {
  fingerprint: '7a09bc4de812',
  runtimeField: 'useDeferredValue',
  manifest: '/srv/releases/green-42/manifest.json',
  port: '47821',
  sha256: 'fd84a1e2c7791d4b6f097e21d8d6fc6ee438fd87dc1dcfa68c2a96bc079ee741',
  unicode: '東京 Καλημέρα مرحبا 한글 → ∑',
};

const PROSE = [
  'Release review summary: the green deployment may proceed after the health checks recover.',
  'Keep the retry budget at three attempts and retain the existing exponential backoff.',
  'The operator explicitly rejected a database migration during this rollout.',
  'If a value is absent from this record, report that it was not stated rather than guessing.',
  ...Array.from({ length: 70 }, (_, i) =>
    `Review note ${String(i + 1).padStart(2, '0')}: shard processing remained healthy and no policy decision changed.`),
].join('\n');

const STRUCTURED = [
  'BEGIN RELEASE STATE',
  `DEPLOYMENT_FINGERPRINT=${EXACT.fingerprint}`,
  `RUNTIME_FIELD=${EXACT.runtimeField}`,
  `ACTIVE_MANIFEST=${EXACT.manifest}`,
  `CONTROL_PORT=${EXACT.port}`,
  `CHECKSUM_SHA256=${EXACT.sha256}`,
  `UNICODE_SAMPLE=${EXACT.unicode}`,
  'LEGACY_PINS=OFF',
  'RETRY_BUDGET=3',
  'ROLLOUT_RESULT=RESUMED_AFTER_HEALTH_RECOVERY',
  ...Array.from({ length: 90 }, (_, i) => JSON.stringify({
    ts: `20:42:${String(i % 60).padStart(2, '0')}`,
    level: i % 9 === 0 ? 'warn' : 'info',
    shard: i % 17,
    cycle: i,
    healthy: true,
    queue: (i * 37) % 997,
  })),
  'END RELEASE STATE',
].join('\n');

const SOURCE = `${PROSE}\n\n${STRUCTURED}`;
const packed = (text) => reflow(text) ?? text;
const textTokens = countTokens(SOURCE);

function colsFor(style) {
  return Math.max(1, Math.floor((MAX_WIDTH - 2 * PAD_X) / renderCellWidth(style)));
}

function imageTokens(images) {
  return images.reduce(
    (sum, image) => sum + visionTokensForModel(MODEL, image.width, image.height),
    0,
  );
}

function sha8(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 8);
}

async function renderSection(name, text, style, cols = colsFor(style)) {
  const images = await renderTextToPngs(packed(text), cols, style, PROFILE.maxHeightPx);
  const dir = join(OUT, name);
  mkdirSync(dir, { recursive: true });
  const pages = [];
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const file = `page-${String(i + 1).padStart(2, '0')}.png`;
    writeFileSync(join(dir, file), image.png);
    pages.push({
      file,
      width: image.width,
      height: image.height,
      bytes: image.png.length,
      sha8: sha8(image.png),
      imageTokens: visionTokensForModel(MODEL, image.width, image.height),
      droppedChars: image.droppedChars,
    });
  }
  return {
    name,
    cols,
    cell: `${renderCellWidth(style)}x${renderCellHeight(style)}`,
    style,
    sourceChars: text.length,
    sourceTokens: countTokens(text),
    pages,
    imageTokens: imageTokens(images),
  };
}

const productionStyle = { ...PROFILE.style };
// JetBrains Mono 10 has a native 6x11 atlas. Padding creates an effective 9x12
// cell while missing glyphs fall back to the broad production Unicode atlas.
const largeStyle = {
  ...PROFILE.style,
  font: 'jetbrains-mono-10',
  cellWBonus: 3,
  cellHBonus: 1,
  aa: true,
};
const classColorStyle = { ...largeStyle, colorByClass: true, classTick: true };
// Larger 6x11 glyph ink at a 5px horizontal pitch. This deliberately overlaps
// neighbors by one pixel and is an experimental arm, not a production proposal.
const overlapStyle = {
  ...PROFILE.style,
  font: 'jetbrains-mono-10',
  cellWBonus: -1,
  cellHBonus: 0,
  aa: true,
  colorByClass: true,
};

const variants = [];
variants.push(await renderSection('01-production-5x8', SOURCE, productionStyle));
variants.push(await renderSection('02-large-real-font-9x12', SOURCE, largeStyle));
variants.push(await renderSection('03-large-class-color-9x12', SOURCE, classColorStyle));
// Reserve the atlas's one-pixel right overhang so the output remains <=768px.
variants.push(await renderSection('04-colored-overprint-5x11', SOURCE, overlapStyle, 151));

const mixedProse = await renderSection('05-mixed/prose-5x8', PROSE, productionStyle);
const mixedStructured = await renderSection(
  '05-mixed/structured-9x12-color',
  STRUCTURED,
  classColorStyle,
);
// Preserve values that are especially unsafe to reconstruct from pixels.
const nativeExact = [
  `DEPLOYMENT_FINGERPRINT=${EXACT.fingerprint}`,
  `RUNTIME_FIELD=${EXACT.runtimeField}`,
  `ACTIVE_MANIFEST=${EXACT.manifest}`,
  `CONTROL_PORT=${EXACT.port}`,
  `CHECKSUM_SHA256=${EXACT.sha256}`,
].join('\n');
const nativeTokens = countTokens(nativeExact);
writeFileSync(join(OUT, '05-mixed', 'native-exact.txt'), nativeExact + '\n');

const mixedImageTokens = mixedProse.imageTokens + mixedStructured.imageTokens;
variants.push({
  name: '05-mixed-density-color-native-exact',
  sections: [mixedProse, mixedStructured],
  nativeExact,
  nativeTokens,
  imageTokens: mixedImageTokens,
  totalTokens: mixedImageTokens + nativeTokens,
});

for (const variant of variants) {
  const total = variant.totalTokens ?? variant.imageTokens;
  variant.totalTokens = total;
  variant.savingsTokens = textTokens - total;
  variant.savingsPct = Math.round((1 - total / textTokens) * 1000) / 10;
}

const result = {
  generatedAt: new Date().toISOString(),
  localOnly: true,
  networkCalls: 0,
  model: MODEL,
  maxWidthPx: MAX_WIDTH,
  maxHeightPx: PROFILE.maxHeightPx,
  sourceChars: SOURCE.length,
  sourceTokens: textTokens,
  exactValues: EXACT,
  variants,
};

writeFileSync(join(OUT, 'source.txt'), SOURCE + '\n');
writeFileSync(join(OUT, 'results.json'), JSON.stringify(result, null, 2) + '\n');

console.log(`Local-only Sol render experiment: ${SOURCE.length} chars / ${textTokens} o200k tokens`);
console.log('variant                                  pages   cell(s)       total tok   saved');
for (const variant of variants) {
  const sections = variant.sections ?? [variant];
  const pages = sections.reduce((n, section) => n + section.pages.length, 0);
  const cells = sections.map((section) => section.cell).join('+');
  console.log(
    `${variant.name.padEnd(40)} ${String(pages).padStart(3)}   ${cells.padEnd(13)} ` +
    `${String(variant.totalTokens).padStart(9)}   ${String(variant.savingsPct).padStart(5)}%`,
  );
}
console.log(`\nArtifacts: ${OUT}`);
console.log('These numbers measure density/cost only; readability requires a later model-scored run.');
