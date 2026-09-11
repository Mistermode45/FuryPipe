// JetBrains Mono 12px RGB ordered-stream probe. Local rendering only.
// Each physical row stores three consecutive logical lines at identical
// coordinates: red first, green second, blue third.

import { randomBytes } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = join(HERE, '.work', 'jbmono12-rgb-order');
mkdirSync(OUT, { recursive: true });

GlobalFonts.register(readFileSync(join(ROOT, 'assets/JetBrainsMono-Regular.ttf')), 'PxJBMono');

const FONT_PX = 12;
const WIDTH = 768;
const PAD = 10;
const ROW_H = 17;
const ROWS = 14;
const logical = Array.from({ length: ROWS * 3 }, (_, i) =>
  `L${String(i + 1).padStart(2, '0')} id=${randomBytes(6).toString('hex')} n=${String((i * 7919 + 104729) % 100000).padStart(5, '0')}`,
);

function drawMask(text, width, height, x, baseline, fontPx = FONT_PX) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.font = `${fontPx}px PxJBMono`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, baseline);
  return ctx.getImageData(0, 0, width, height).data;
}

function rgbFromMasks(width, height, masks) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    image.data[i * 4] = masks[0]?.[i * 4] ?? 0;
    image.data[i * 4 + 1] = masks[1]?.[i * 4] ?? 0;
    image.data[i * 4 + 2] = masks[2]?.[i * 4] ?? 0;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function renderRgb(withBanner) {
  const bannerH = withBanner ? 38 : 0;
  const height = PAD * 2 + bannerH + ROWS * ROW_H;
  const masks = [0, 1, 2].map(() => new Uint8ClampedArray(WIDTH * height * 4));
  if (withBanner) {
    const banner = drawMask('ORDER EACH ROW: RED -> GREEN -> BLUE; THEN NEXT ROW', WIDTH, height, PAD, 18, 11);
    // White banner is copied to all channels and does not consume a data stream.
    for (const mask of masks) mask.set(banner);
  }
  for (let row = 0; row < ROWS; row++) {
    const baseline = PAD + bannerH + row * ROW_H + 12;
    for (let channel = 0; channel < 3; channel++) {
      const one = drawMask(logical[row * 3 + channel], WIDTH, height, PAD, baseline);
      const target = masks[channel];
      for (let i = 0; i < target.length; i += 4) {
        if (one[i] > target[i]) target[i] = one[i];
      }
    }
  }
  const canvas = rgbFromMasks(WIDTH, height, masks);
  return { png: canvas.toBuffer('image/png'), width: WIDTH, height };
}

function renderControl() {
  const height = PAD * 2 + logical.length * ROW_H;
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.font = `${FONT_PX}px PxJBMono`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  for (let i = 0; i < logical.length; i++) ctx.fillText(logical[i], PAD, PAD + i * ROW_H + 12);
  return { png: canvas.toBuffer('image/png'), width: WIDTH, height };
}

const variants = {
  banner: renderRgb(true),
  noBanner: renderRgb(false),
  control: renderControl(),
};
for (const [name, image] of Object.entries(variants)) {
  writeFileSync(join(OUT, `${name}.png`), image.png);
}
writeFileSync(join(OUT, 'gold.json'), JSON.stringify(logical, null, 2) + '\n');
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  localOnly: true,
  font: 'JetBrains Mono 12px native rasterization',
  order: 'per physical row: red, green, blue',
  rows: ROWS,
  logicalLines: logical.length,
  variants: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, { width: v.width, height: v.height }])),
}, null, 2) + '\n');
console.log(JSON.stringify({ out: OUT, manifest: JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) }, null, 2));
