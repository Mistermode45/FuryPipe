// Eval-only JetBrains Mono 12 RGB-overprint renderer.
// Three consecutive logical lines share one physical row in red, green, blue order.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const FONT_FAMILY = 'PxJBMono12RgbResearch';
const FONT_PX = 12;
const CELL_W = 8;
const CELL_H = 13;
const ASCENT = 11;
const PAD = 4;
const CHANNEL_COUNT = 3;
const BANNER_ROWS = 2;
const BANNER = 'RGB OVERPRINT: EACH ROW READ RED > GREEN > BLUE; THEN NEXT ROW';

let registered = false;
function registerFont() {
  if (registered) return;
  GlobalFonts.register(readFileSync(join(ROOT, 'assets/JetBrainsMono-Regular.ttf')), FONT_FAMILY);
  registered = true;
}

function wrap(text, cols) {
  const lines = [];
  for (const sourceLine of String(text).split('\n')) {
    if (!sourceLine) {
      lines.push('');
      continue;
    }
    for (let i = 0; i < sourceLine.length; i += cols) lines.push(sourceLine.slice(i, i + cols));
  }
  return lines;
}

export function renderRgbMultiplex(text, { cols = 95, maxHeightPx = 1932 } = {}) {
  registerFont();
  const logicalLines = wrap(text, cols);
  const physicalRowsPerPage = Math.max(1, Math.floor((maxHeightPx - 2 * PAD) / CELL_H) - BANNER_ROWS);
  const logicalRowsPerPage = physicalRowsPerPage * CHANNEL_COUNT;
  const width = 2 * PAD + cols * CELL_W;
  const images = [];

  for (let start = 0; start < logicalLines.length; start += logicalRowsPerPage) {
    const page = logicalLines.slice(start, start + logicalRowsPerPage);
    const physicalRows = Math.max(1, Math.ceil(page.length / CHANNEL_COUNT));
    const height = Math.min(maxHeightPx, 2 * PAD + (BANNER_ROWS + physicalRows) * CELL_H);
    const masks = Array.from({ length: CHANNEL_COUNT }, () => {
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${FONT_PX}px ${FONT_FAMILY}`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#fff';
      ctx.fillText(BANNER, PAD, PAD + ASCENT);
      return ctx;
    });

    for (let row = 0; row < physicalRows; row++) {
      const baseline = PAD + (BANNER_ROWS + row) * CELL_H + ASCENT;
      for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
        const line = page[row * CHANNEL_COUNT + channel];
        if (line === undefined) continue;
        masks[channel].fillText(line, PAD, baseline);
      }
    }

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const rgb = ctx.createImageData(width, height);
    const maskData = masks.map((mask) => mask.getImageData(0, 0, width, height).data);
    for (let i = 0; i < width * height; i++) {
      rgb.data[i * 4] = maskData[0][i * 4];
      rgb.data[i * 4 + 1] = maskData[1][i * 4];
      rgb.data[i * 4 + 2] = maskData[2][i * 4];
      rgb.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(rgb, 0, 0);

    images.push({
      png: canvas.toBuffer('image/png'),
      width,
      height,
      charsRendered: page.reduce((sum, line) => sum + line.length, 0),
    });
  }
  return images;
}
