import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { encodeGrayPng, encodeRgbPng } from '../src/core/png.js';

/**
 * The encoder adaptively selects among PNG's five lossless scanline filters.
 * Every selection must remain bit-exact reversible: the model has to see the
 * pixels the renderer drew, not an approximation. Verified with skia (@napi-rs/canvas) rather than a hand-rolled
 * decoder, so a bug in the filter can't be masked by the same bug in the check.
 *
 * `loadImage` awaits the decode. `new Image()` + `.src` does NOT, and silently
 * yields a blank canvas that passes any comparison against blank expectations.
 */
async function decode(png: Uint8Array): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const img = await loadImage(Buffer.from(png));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
}

// Deliberately not a multiple of 8, so the last partial byte-group is exercised.
const W = 259;
const H = 131;

describe('PNG encoder is lossless', () => {
  it('round-trips grayscale pixels bit-for-bit', async () => {
    // Includes 0 and 255 (filter residuals wrap past both) and the mid greys
    // the antialiased atlas actually emits.
    const pixels = new Uint8Array(W * H);
    const palette = [0, 31, 68, 119, 255, 1, 254, 128];
    for (let i = 0; i < pixels.length; i++) pixels[i] = palette[i % palette.length]!;

    const out = await decode(await encodeGrayPng(pixels, W, H));
    expect([out.w, out.h]).toEqual([W, H]);

    let firstDiff = -1;
    for (let i = 0; i < W * H; i++) {
      if (out.data[i * 4] !== pixels[i]) { firstDiff = i; break; }
    }
    // Row 0 has no upper neighbour and column 0 no left neighbour; both are
    // defined as zero by the spec, and both are covered by scanning from index 0.
    expect(firstDiff).toBe(-1);
  });

  it('round-trips RGB pixels bit-for-bit', async () => {
    const pixels = new Uint8Array(W * H * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37 + (i % 5)) & 255;

    const out = await decode(await encodeRgbPng(pixels, W, H));
    expect([out.w, out.h]).toEqual([W, H]);

    let firstDiff = -1;
    outer: for (let i = 0; i < W * H; i++) {
      for (let c = 0; c < 3; c++) {
        // Filtering is per-channel at bpp=3: the left neighbour is 3 bytes back,
        // so a wrong bpp shows up as channel bleed rather than a whole-image break.
        if (out.data[i * 4 + c] !== pixels[i * 3 + c]) { firstDiff = i * 3 + c; break outer; }
      }
    }
    expect(firstDiff).toBe(-1);
  });

  it('preserves a solid run and a single-pixel image', async () => {
    const solid = new Uint8Array(64 * 4).fill(200);
    const s = await decode(await encodeGrayPng(solid, 64, 4));
    expect([...new Set(Array.from({ length: 64 * 4 }, (_, i) => s.data[i * 4]))]).toEqual([200]);

    const one = await decode(await encodeGrayPng(new Uint8Array([137]), 1, 1));
    expect(one.data[0]).toBe(137);
  });
  it('selects the smallest exact grayscale PNG bit depth without quantization', async () => {
    const bitDepthAt = (png: Uint8Array): number => png[24]!;

    const binary = new Uint8Array(W * H);
    for (let i = 0; i < binary.length; i++) binary[i] = i % 3 === 0 ? 255 : 0;
    const binaryPng = await encodeGrayPng(binary, W, H);
    expect(bitDepthAt(binaryPng)).toBe(1);
    const binaryDecoded = await decode(binaryPng);
    for (let i = 0; i < binary.length; i++) expect(binaryDecoded.data[i * 4]).toBe(binary[i]);

    const gray2 = new Uint8Array(W * H);
    const palette2 = [0, 85, 170, 255];
    for (let i = 0; i < gray2.length; i++) gray2[i] = palette2[i % palette2.length]!;
    const gray2Png = await encodeGrayPng(gray2, W, H);
    expect(bitDepthAt(gray2Png)).toBe(2);
    const gray2Decoded = await decode(gray2Png);
    for (let i = 0; i < gray2.length; i++) expect(gray2Decoded.data[i * 4]).toBe(gray2[i]);

    const gray4 = new Uint8Array(W * H);
    const palette4 = [0, 17, 34, 85, 153, 238, 255];
    for (let i = 0; i < gray4.length; i++) gray4[i] = palette4[i % palette4.length]!;
    const gray4Png = await encodeGrayPng(gray4, W, H);
    expect(bitDepthAt(gray4Png)).toBe(4);
    const gray4Decoded = await decode(gray4Png);
    for (let i = 0; i < gray4.length; i++) expect(gray4Decoded.data[i * 4]).toBe(gray4[i]);

    const gray8 = new Uint8Array(W * H);
    const palette8 = [0, 31, 68, 119, 255];
    for (let i = 0; i < gray8.length; i++) gray8[i] = palette8[i % palette8.length]!;
    const gray8Png = await encodeGrayPng(gray8, W, H);
    expect(bitDepthAt(gray8Png)).toBe(8);
    const gray8Decoded = await decode(gray8Png);
    for (let i = 0; i < gray8.length; i++) expect(gray8Decoded.data[i * 4]).toBe(gray8[i]);
  });

  it('uses an indexed palette for limited-color RGB pages without changing pixels', async () => {
    const pixels = new Uint8Array(W * H * 3);
    const palette = [
      [255, 255, 255],
      [0, 0, 0],
      [79, 124, 255],
    ] as const;

    for (let i = 0; i < W * H; i++) {
      const color = palette[i % palette.length]!;
      pixels[i * 3] = color[0];
      pixels[i * 3 + 1] = color[1];
      pixels[i * 3 + 2] = color[2];
    }

    const png = await encodeRgbPng(pixels, W, H);
    expect(png[24]).toBe(2); // smallest legal depth for three palette entries
    expect(png[25]).toBe(3); // indexed-color

    const out = await decode(png);
    for (let i = 0; i < W * H; i++) {
      expect(out.data[i * 4]).toBe(pixels[i * 3]);
      expect(out.data[i * 4 + 1]).toBe(pixels[i * 3 + 1]);
      expect(out.data[i * 4 + 2]).toBe(pixels[i * 3 + 2]);
    }
  });

  it('falls back to truecolor when an RGB page needs more than 256 exact colors', async () => {
    const width = 300;
    const height = 1;
    const pixels = new Uint8Array(width * 3);
    for (let i = 0; i < width; i++) {
      pixels[i * 3] = i & 0xff;
      pixels[i * 3 + 1] = (i >>> 8) & 0xff;
      pixels[i * 3 + 2] = (i * 17) & 0xff;
    }

    const png = await encodeRgbPng(pixels, width, height);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(2);

    const out = await decode(png);
    for (let i = 0; i < width; i++) {
      expect(out.data[i * 4]).toBe(pixels[i * 3]);
      expect(out.data[i * 4 + 1]).toBe(pixels[i * 3 + 1]);
      expect(out.data[i * 4 + 2]).toBe(pixels[i * 3 + 2]);
    }
  });

});
