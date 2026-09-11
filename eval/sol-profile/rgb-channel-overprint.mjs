// True RGB-channel multiplex probe for GPT Sol. Local rendering only.
// Three different strings occupy the exact same glyph cells: one in each of
// the red, green, and blue planes. No adjacent-character/color-class shortcut.
//
// Run: pnpm run build && node eval/sol-profile/rgb-channel-overprint.mjs

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATLAS_GRAY_CELL_H,
  ATLAS_GRAY_CELL_W,
  ATLAS_GRAY_OFFSETS,
  ATLAS_GRAY_PIXELS,
  atlasGrayRank,
} from '../../dist/core/atlas-gray-jbmono10.js';
import { encodeRgbPng } from '../../dist/core/png.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.work', 'rgb-channel-overprint');
mkdirSync(OUT, { recursive: true });

const payload = () => randomBytes(12).toString('hex');
const streams = {
  red: payload(),
  green: payload(),
  blue: payload(),
};

const textByChannel = [
  `RED=${streams.red}`,
  `GREEN=${streams.green}`,
  `BLUE=${streams.blue}`,
];
const maxChars = Math.max(...textByChannel.map((s) => s.length));

function glyphCoverage(codepoint) {
  const rank = atlasGrayRank(codepoint);
  if (rank < 0) throw new Error(`missing glyph U+${codepoint.toString(16)}`);
  const offset = ATLAS_GRAY_OFFSETS[rank];
  return ATLAS_GRAY_PIXELS.subarray(offset, offset + ATLAS_GRAY_CELL_W * ATLAS_GRAY_CELL_H);
}

async function render(scale) {
  const pad = 12;
  const cellW = ATLAS_GRAY_CELL_W * scale;
  const cellH = ATLAS_GRAY_CELL_H * scale;
  const width = pad * 2 + maxChars * cellW;
  const height = pad * 2 + cellH;
  const rgb = new Uint8Array(width * height * 3); // black paper

  for (let channel = 0; channel < 3; channel++) {
    const text = textByChannel[channel];
    for (let col = 0; col < text.length; col++) {
      const coverage = glyphCoverage(text.codePointAt(col));
      for (let gy = 0; gy < ATLAS_GRAY_CELL_H; gy++) {
        for (let gx = 0; gx < ATLAS_GRAY_CELL_W; gx++) {
          const ink = coverage[gy * ATLAS_GRAY_CELL_W + gx];
          if (ink === 0) continue;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const x = pad + col * cellW + gx * scale + sx;
              const y = pad + gy * scale + sy;
              const idx = (y * width + x) * 3 + channel;
              if (ink > rgb[idx]) rgb[idx] = ink;
            }
          }
        }
      }
    }
  }

  const png = await encodeRgbPng(rgb, width, height);
  const file = `overprint-${scale}x.png`;
  writeFileSync(join(OUT, file), png);
  return { file, scale, width, height, cell: `${cellW}x${cellH}`, bytes: png.length };
}

const variants = [];
for (const scale of [1, 2, 3, 4]) variants.push(await render(scale));

writeFileSync(join(OUT, 'gold.json'), JSON.stringify(streams, null, 2) + '\n');
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  localOnly: true,
  networkCalls: 0,
  encoding: 'black background; independent R/G/B intensity planes; identical cell coordinates',
  font: 'JetBrains Mono 10 grayscale atlas',
  variants,
}, null, 2) + '\n');

console.log('True RGB channel-overprint probes written:');
for (const v of variants) console.log(`${v.file}: ${v.width}x${v.height}, cell ${v.cell}`);
console.log(`Artifacts: ${OUT}`);
