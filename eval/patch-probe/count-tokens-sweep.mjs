/**
 * Probe 1: billing-staircase sweep against /v1/messages/count_tokens (free, unbilled).
 *
 * Sends blank PNGs of swept dimensions and records input_tokens. If image cost
 * quantizes as ceil(W/P)*ceil(H/P)*k, step positions in the W (or H) direction
 * reveal the vision patch size P (28 vs 32 hypothesis). If cost is smooth
 * ~(W*H)/750, billing is decoupled from the encoder grid and this channel is silent.
 *
 * Usage:
 *   CC_OAUTH_TOKEN=... node count-tokens-sweep.mjs <model> <axis W|H> <fixed> <from> <to>
 * Output: CSV  w,h,input_tokens,image_tokens  (image_tokens = delta vs no-image baseline)
 */
import sharp from 'sharp';

const TOKEN = process.env.CC_OAUTH_TOKEN;
if (!TOKEN) {
  console.error('CC_OAUTH_TOKEN not set');
  process.exit(1);
}

const API = 'https://api.anthropic.com/v1/messages/count_tokens';

async function count(model, content) {
  const body = {
    model,
    // Constant across all calls -> cancels in the baseline delta.
    system: [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }],
    messages: [{ role: 'user', content }],
  };
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'oauth-2025-04-20',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).input_tokens;
}

const blankPng = (w, h) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .png()
    .toBuffer();

const model = process.argv[2] ?? 'claude-fable-5';
const axis = (process.argv[3] ?? 'W').toUpperCase();
const fixed = parseInt(process.argv[4] ?? '56', 10);
const from = parseInt(process.argv[5] ?? '20', 10);
const to = parseInt(process.argv[6] ?? '100', 10);

const baseline = await count(model, [{ type: 'text', text: 'x' }]);
console.log(`# model=${model} axis=${axis} fixed=${fixed} baseline=${baseline}`);
console.log('w,h,input_tokens,image_tokens');

for (let v = from; v <= to; v++) {
  const [w, h] = axis === 'W' ? [v, fixed] : [fixed, v];
  const data = (await blankPng(w, h)).toString('base64');
  let t;
  for (let attempt = 0; ; attempt++) {
    try {
      t = await count(model, [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
        { type: 'text', text: 'x' },
      ]);
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); // ride out RPM 429s
    }
  }
  console.log(`${w},${h},${t},${t - baseline}`);
  await new Promise((r) => setTimeout(r, 60));
}
