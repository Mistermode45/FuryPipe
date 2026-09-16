/**
 * Minimal PNG encoder (lossless grayscale + RGB, adaptive bit depth, fast
 * Average/Up filtering, single IDAT).
 *
 * Pure Uint8Array — uses CompressionStream (Node 18+, Workers, browsers); no
 * Buffer/node:zlib.
 *
 * Grayscale text pages often contain only exact black/white pixels. Encoding
 * those as legal PNG bit-depth 1 rather than always bit-depth 8 reduces the raw
 * scanline surface by up to 8× before DEFLATE without changing one decoded
 * pixel. 2-bit/4-bit grayscale are also selected only when every sample is
 * exactly representable at that depth; anti-aliased pages remain 8-bit.
 */

// ---- CRC32 ---------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- Helpers -------------------------------------------------------------

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

const TYPE_BYTES = (s: string): Uint8Array => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
};

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeB = TYPE_BYTES(type);
  const crcSrc = concat([typeB, data]);
  return concat([u32be(data.length), typeB, data, u32be(crc32(crcSrc))]);
}

// ---- Deflate via Web Streams ---------------------------------------------

async function deflateZlib(input: Uint8Array): Promise<Uint8Array> {
  // 'deflate' = RFC 1950 zlib-wrapped — what PNG IDAT needs. 'deflate-raw' (RFC 1951) would be wrong.
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  // TS 5.7 narrows Uint8Array<ArrayBufferLike> away from BufferSource; safe since we never use SharedArrayBuffer.
  void writer.write(input as Uint8Array<ArrayBuffer>);
  void writer.close();

  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return concat(chunks);
}

// ---- Encode --------------------------------------------------------------

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Fast adaptive filtering for FuryPipe's text pages.
 *
 * Average (PNG filter 3) stays the production default because it was already
 * measured as a strong fit for anti-aliased glyphs. The only adaptive branch is
 * evidence-cheap and deterministic: when a row is byte-identical to the row
 * above, switch that row to Up (filter 2), whose residual becomes all zeroes.
 * Text pages contain many repeated paper/background rows, so this gives deflate
 * an easier stream without evaluating all five PNG predictors for every byte.
 *
 * This deliberately replaced the exhaustive five-filter scorer: CI showed that
 * variant roughly doubled render-heavy test time and did not reliably reduce
 * wire bytes. The fast path is one pass per row plus an occasional zero-fill,
 * while decoded pixels remain byte-identical to the framebuffer.
 */
function filterAdaptive(pixels: Uint8Array, rowBytes: number, height: number, bpp: number): Uint8Array {
  if (pixels.length !== rowBytes * height) {
    throw new Error('filterAdaptive: packed scanline length mismatch');
  }
  const stride = rowBytes + 1;
  const out = new Uint8Array(stride * height);

  for (let y = 0; y < height; y++) {
    const src = y * rowBytes;
    const dst = y * stride;
    let sameAsAbove = y > 0;

    // Default to Average, preserving the proven baseline byte-for-byte on every
    // non-repeated row.
    out[dst] = 3;
    for (let x = 0; x < rowBytes; x++) {
      const value = pixels[src + x]!;
      const left = x >= bpp ? pixels[src + x - bpp]! : 0;
      const up = y > 0 ? pixels[src - rowBytes + x]! : 0;
      if (sameAsAbove && value !== up) sameAsAbove = false;
      out[dst + 1 + x] = (value - ((left + up) >> 1)) & 0xff;
    }

    if (sameAsAbove) {
      // Up on an identical row is exactly zero for every byte. Zero-fill is
      // cheaper than running another predictor pass and compresses extremely
      // well across blank/paper bands.
      out[dst] = 2;
      out.fill(0, dst + 1, dst + 1 + rowBytes);
    }
  }

  return out;
}


type GrayBitDepth = 1 | 2 | 4 | 8;

function grayBitDepth(pixels: Uint8Array): GrayBitDepth {
  let fits1 = true;
  let fits2 = true;
  let fits4 = true;

  for (let i = 0; i < pixels.length; i++) {
    const value = pixels[i]!;
    if (value !== 0 && value !== 255) fits1 = false;
    if (value % 85 !== 0) fits2 = false;
    if (value % 17 !== 0) fits4 = false;
    if (!fits4) return 8;
  }

  if (fits1) return 1;
  if (fits2) return 2;
  if (fits4) return 4;
  return 8;
}

function packGraySamples(
  pixels: Uint8Array,
  width: number,
  height: number,
  bitDepth: GrayBitDepth,
): { readonly packed: Uint8Array; readonly rowBytes: number } {
  if (bitDepth === 8) {
    return { packed: pixels, rowBytes: width };
  }

  const samplesPerByte = 8 / bitDepth;
  const rowBytes = Math.ceil(width / samplesPerByte);
  const packed = new Uint8Array(rowBytes * height);
  const maxSample = (1 << bitDepth) - 1;

  for (let y = 0; y < height; y++) {
    const srcRow = y * width;
    const dstRow = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const value = pixels[srcRow + x]!;
      const sample = Math.round((value * maxSample) / 255);
      // grayBitDepth() already proved exact representability. Keep the guard
      // local so this packing helper cannot silently quantize if reused later.
      if (Math.round((sample * 255) / maxSample) !== value) {
        throw new Error('packGraySamples: sample is not exactly representable');
      }
      const slot = x % samplesPerByte;
      const shift = 8 - bitDepth * (slot + 1);
      packed[dstRow + Math.floor(x / samplesPerByte)]! |= sample << shift;
    }
  }

  return { packed, rowBytes };
}

/** Encode a single-channel (grayscale) buffer as PNG bytes. pixels is row-major, length = width × height. */
export async function encodeGrayPng(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  if (pixels.length !== width * height) {
    throw new Error(`encodeGrayPng: pixels.length=${pixels.length} != ${width}×${height}=${width * height}`);
  }

  const bitDepth = grayBitDepth(pixels);
  const { packed, rowBytes } = packGraySamples(pixels, width, height, bitDepth);

  // IHDR: width(4) height(4) bitDepth={1,2,4,8} colorType=0(gray)
  // compress=0 filter=0 interlace=0.
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = bitDepth;
  ihdr[9] = 0; // colorType 0 = grayscale; bytes 10-12 already zero

  // For packed grayscale (<8-bit), PNG filtering operates on packed bytes and
  // bytes-per-pixel rounds up to one byte per the PNG specification.
  const compressed = await deflateZlib(filterAdaptive(packed, rowBytes, height, 1));

  return concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Encode an RGB (3 bytes/pixel, R,G,B) buffer as PNG bytes (colorType 2 = truecolor). length = width × height × 3. */
export async function encodeRgbPng(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  if (pixels.length !== width * height * 3) {
    throw new Error(`encodeRgbPng: pixels.length=${pixels.length} != ${width}×${height}×3=${width * height * 3}`);
  }

  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8; // bit depth per channel
  ihdr[9] = 2; // colorType 2 = truecolor RGB; bytes 10-12 already zero

  const compressed = await deflateZlib(filterAdaptive(pixels, width * 3, height, 3));

  return concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Base64-encode bytes. Chunks to avoid call-stack blow-up from String.fromCharCode(...bigArray). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
