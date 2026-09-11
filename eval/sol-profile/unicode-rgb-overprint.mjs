// Native Unicode RGB multiplex probe. Local rendering only.
// Three equal-length Chinese strings are drawn at exactly the same coordinates,
// one per RGB plane. Isolated controls use the same Unifont face and size.
//
// Run: node eval/sol-profile/unicode-rgb-overprint.mjs

import { randomInt } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = join(HERE, '.work', 'unicode-rgb-overprint');
mkdirSync(OUT, { recursive: true });

GlobalFonts.register(readFileSync(join(ROOT, 'assets/Unifont-16.0.04.otf')), 'PxUnifont');

// Common Chinese characters avoid testing rare-glyph language knowledge while
// still exercising real CJK fallback coverage. Drawn values are random per run.
const ALPHABET = Array.from('天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏山川湖海风云雷电星光明夜春花木石金水火土东西南北中大小上下左右前后高低远近红绿蓝白黑青云雨雪');
const LENGTH = 12;
const randomText = () => Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const truth = { red: randomText(), green: randomText(), blue: randomText() };
const SIZES = [16, 24, 32, 44];

function textMask(text, fontPx, width, height, x, baseline) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.font = `${fontPx}px PxUnifont`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, baseline);
  return ctx.getImageData(0, 0, width, height).data;
}

function encodeRgb(width, height, channels) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    image.data[i * 4] = channels[0]?.[i * 4] ?? 0;
    image.data[i * 4 + 1] = channels[1]?.[i * 4] ?? 0;
    image.data[i * 4 + 2] = channels[2]?.[i * 4] ?? 0;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toBuffer('image/png');
}

const variants = [];
for (const fontPx of SIZES) {
  // Unifont CJK is full-width: 12 glyphs at roughly fontPx each. Keep generous
  // fixed padding while remaining below the 768px short-side target.
  const width = Math.min(768, 32 + LENGTH * fontPx);
  const height = fontPx + 32;
  const x = 16;
  const baseline = 16 + Math.ceil(fontPx * 0.85);
  const masks = [truth.red, truth.green, truth.blue].map((text) =>
    textMask(text, fontPx, width, height, x, baseline));

  const overprint = encodeRgb(width, height, masks);
  const overprintFile = `overprint-${fontPx}px.png`;
  writeFileSync(join(OUT, overprintFile), overprint);

  const controls = {};
  for (let channel = 0; channel < 3; channel++) {
    const name = ['red', 'green', 'blue'][channel];
    const planes = [null, null, null];
    planes[channel] = masks[channel];
    const file = `control-${name}-${fontPx}px.png`;
    writeFileSync(join(OUT, file), encodeRgb(width, height, planes));
    controls[name] = file;
  }
  variants.push({ fontPx, width, height, overprint: overprintFile, controls });
}

writeFileSync(join(OUT, 'gold.json'), JSON.stringify(truth, null, 2) + '\n');
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  localOnly: true,
  networkCalls: 0,
  font: 'GNU Unifont 16.0.04 OTF, native rasterization',
  glyphsPerChannel: LENGTH,
  coordinatePolicy: 'all channels use identical x, baseline, font, and cell sequence',
  variants,
}, null, 2) + '\n');

console.log('Native Unicode RGB probes written:');
for (const v of variants) console.log(`${v.fontPx}px: ${v.width}x${v.height} ${v.overprint}`);
console.log(`Artifacts: ${OUT}`);
