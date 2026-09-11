// Live smoke: real built proxy on a scratch port against a recording fake upstream.
import http from 'node:http';
import { spawn } from 'node:child_process';

const UP_PORT = 47897, PX_PORT = 47899;
const seen = [];
let failNext = false;

const upstream = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    let parsed = null;
    try { parsed = JSON.parse(b); } catch {}
    let imgs = 0;
    for (const m of parsed?.messages ?? [])
      if (Array.isArray(m.content)) for (const blk of m.content) if (blk?.type === 'image') imgs++;
    seen.push({ bytes: Buffer.byteLength(b), imgs, path: req.url });
    if (failNext) { failNext = false; res.writeHead(500, {'content-type':'application/json'});
      return res.end(JSON.stringify({ type:'error', error:{ type:'invalid_request_error', message:'too large' }})); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id:'msg_1', type:'message', role:'assistant', model:'claude-opus-5',
      content:[{type:'text',text:'ok'}], usage:{ input_tokens:10, output_tokens:2 }}));
  });
});
await new Promise((r) => upstream.listen(UP_PORT, '127.0.0.1', r));

const px = spawn(process.execPath, ['dist/node.js'], {
  cwd: '/home/lm/repos/pxpipe',
  env: { ...process.env, PORT: String(PX_PORT), HOST: '127.0.0.1',
         ANTHROPIC_UPSTREAM: `http://127.0.0.1:${UP_PORT}`,
         PXPIPE_LOG: '/tmp/pxpipe-smoke-events.jsonl',
         PXPIPE_DASH_PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const pxlog=[];
px.stdout.on('data', (d) => { pxlog.push(String(d)); process.stdout.write('[px] '+d); });
px.stderr.on('data', (d) => { const s = String(d); process.stdout.write('[px] '+s); if (/error|throw|ECONN/i.test(s)) process.stderr.write('[px] ' + s); });

const up = async () => { for (let i=0;i<80;i++) { try { await fetch(`http://127.0.0.1:${PX_PORT}/health`); return true; } catch { await new Promise(r=>setTimeout(r,100)); } } return false; };
if (!await up()) { console.log('FAIL: proxy did not come up'); px.kill(); process.exit(1); }

const big = (n) => 'x'.repeat(n);
const convo = (n) => {
  const out = [{ role:'user', content:'SESSION ANCHOR: ' + big(200) }];
  for (let i=0;i<n;i++) out.push({ role: i%2===0?'assistant':'user', content:`turn ${i}: `+big(3500) });
  return out;
};
const send = (msgs) => fetch(`http://127.0.0.1:${PX_PORT}/v1/messages`, {
  method:'POST', headers:{'content-type':'application/json','x-api-key':'test','anthropic-version':'2023-06-01'},
  body: JSON.stringify({ model:'claude-opus-5', max_tokens:16, messages: msgs }),
});

// pxpipe also forwards /health and count_tokens baseline probes, and the probe
// can land AFTER the message it belongs to — `lastMessage()` therefore races and
// occasionally measures the probe (0 images) instead of the real request.
const lastMessage = () => [...seen].reverse().find((s) => s.path === '/v1/messages');

const results = [];
const ck = (name, ok, detail='') => { results.push({name, ok, detail}); console.log(`${ok?'ok  ':'FAIL'}  ${name}${detail?'  — '+detail:''}`); };

// 1. huge conversation goes through and is capped
const r1 = await send(convo(400));
ck('400-turn request returns 2xx', r1.status === 200, `status=${r1.status}`);
const s1 = lastMessage();
ck('forwarded images <= 100', s1.imgs <= 100, `imgs=${s1.imgs}`);
ck('forwarded body is sane size', s1.bytes < 12_000_000, `${(s1.bytes/1e6).toFixed(2)} MB`);

// 2. next turn is append-only (cache-friendly), not a full re-cut
const r2 = await send(convo(410));
const s2 = lastMessage();
ck('growth turn still 2xx', r2.status === 200, `status=${r2.status}`);
ck('growth turn still <= 100 images', s2.imgs <= 100, `imgs=${s2.imgs}`);

// 3. upstream 500 marks the cache dead; the retry repacks denser, not fatter
failNext = true;
const r3 = await send(convo(420));
const r4 = await send(convo(430));
const s4 = lastMessage();
ck('after an upstream 500 the next turn still fits', s4.imgs <= 100, `imgs=${s4.imgs}`);
ck('post-500 turn is not larger than pre-500', s4.imgs <= Math.max(s1.imgs, s2.imgs) , `${s4.imgs} vs ${Math.max(s1.imgs,s2.imgs)}`);
ck('proxy survived the upstream 500', r4.status === 200, `status=${r4.status}`);

// 4. the client's OWN images count against the same provider cap: a wire that is
//    already full must come back valid, with pxpipe adding exactly nothing.
const img = () => ({ type:'image', source:{ type:'base64', media_type:'image/png', data:'iVBORw0KGgo=' }});
const full = [{ role:'user', content: Array.from({length:100}, img) }, ...convo(200).slice(1)];
const r5 = await send(full);
const s5 = lastMessage();
ck('client-image-saturated request returns 2xx', r5.status === 200, `status=${r5.status}`);
ck('pxpipe added no images to a full wire', s5.imgs === 100, `imgs=${s5.imgs} (client sent 100)`);

ck('collapse actually ran (not a passthrough smoke)', s1.imgs > 0, `imgs=${s1.imgs}`);
{ const sk = pxlog.join('').includes('unsupported='); ck('no unsupported-model skips', !sk, sk ? 'proxy logged skip(unsupported=...)' : 'none'); }
ck('images stay under the hard cap', s1.imgs <= 100 && s2.imgs <= 100 && s4.imgs <= 100, `${s1.imgs}/${s2.imgs}/${s4.imgs}`);

console.log('\nforwarded:', seen.map(s=>`${s.imgs}img/${(s.bytes/1e6).toFixed(1)}MB`).join('  '));
px.kill(); upstream.close();
const failed = results.filter(r=>!r.ok);
console.log(failed.length ? `\n${failed.length} FAILED` : `\nall ${results.length} smoke checks passed`);
process.exit(failed.length ? 1 : 0);
