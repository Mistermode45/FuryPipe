// Constant-COST render-style A/B (the paused Task #7 arms, finally run).
// Holds the glyph cell at prod 5x8 and varies ONLY the render STYLE.
// Every arm is the SAME pixel dimensions => SAME image-token cost as prod.
// Question the size-sweep never answered: at fixed 5x8 cost, does any style
// beat the prod ~10% exact-read baseline? If none does, "resolution not shape"
// is finally earned rather than asserted.
//
// SAME content across arms (only style changes), mirroring gen_sweep.mjs so the
// grader and method carry over 1:1.
import { renderTextToPngs } from '../../../dist/core/render.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = '/tmp/style'; mkdirSync(OUT, { recursive: true });

const PAGES = Number(process.env.PAGES || 4);

// All arms fixed at prod cell (cellWBonus:0, cellHBonus:0 => 5x8). Vary style only.
const STYLES = [
  ['prod',   { aa: true }],                                         // control = current default
  ['onebit', { aa: false }],                                        // crisp 1-bit (no grey AA)
  ['color',  { aa: true, colorCycle: true }],                       // per-char hue boundary cues
  ['grid',   { aa: true, grid: true, gridCols: 1 }],                // per-char + row rules
  ['cgrid',  { aa: true, colorCycle: true, grid: true, gridCols: 1 }], // color + grid
];

function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const rnd = mulberry32(20260616); // SAME seed as gen_sweep so content matches the size sweep
const hex = (n)=>Array.from({length:n},()=>'0123456789abcdef'[(rnd()*16)|0]).join('');
const ri = (lo,hi)=>lo+Math.floor(rnd()*(hi-lo+1));

function line(label){
  const id = hex(12);
  const rec = label ? {label, id, dur: ri(100,9999)} : {lvl:['info','warn','dbg'][ri(0,2)], id, dur: ri(100,9999)};
  return { text: JSON.stringify(rec), id };
}

const golds = {}; STYLES.forEach(([k])=>golds[k]=[]);
const pageTexts = [];
for (let p=0; p<PAGES; p++){
  const pos = new Set(); while(pos.size<5) pos.add(ri(0,7));
  const labelAt=[...pos]; const labels=['A','B','C','D','E']; const gold={}; const rows=[];
  for (let r=0; r<8; r++){
    const idx=labelAt.indexOf(r);
    if(idx>=0){ const {text,id}=line(labels[idx]); gold[labels[idx]]=id; rows.push(text);}
    else rows.push(line(null).text);
  }
  pageTexts.push(rows.join('\n'));
  STYLES.forEach(([k])=>golds[k].push(gold));
}

const dims = {};
for (const [k, style] of STYLES){
  for (let p=0; p<PAGES; p++){
    const pngs = await renderTextToPngs(pageTexts[p], 72, { cellWBonus:0, cellHBonus:0, ...style });
    if (pngs.length!==1) console.error(`WARN ${k}_${p}: ${pngs.length} pages`);
    writeFileSync(`${OUT}/${k}_${p}.png`, pngs[0].png);
    if (p===0) dims[k] = { w:pngs[0].width, h:pngs[0].height, tok: Math.round(pngs[0].width*pngs[0].height/750) };
  }
}
writeFileSync(`${OUT}/golds.json`, JSON.stringify(golds));

console.log('style    page0_dims     img_tokens   (all must match prod = constant cost)');
const base = dims['prod'].tok;
for (const [k] of STYLES){
  const d = dims[k];
  const flag = (d.w===dims['prod'].w && d.h===dims['prod'].h) ? 'OK same px' : '*** DIFFERENT PX ***';
  console.log(`${k.padEnd(8)} ${(d.w+'x'+d.h).padEnd(12)} ~${String(d.tok).padStart(4)}tok   ${flag}`);
}
console.log(`\n${STYLES.length} styles x ${PAGES} pages -> ${OUT}/  (golds.json identical across arms)`);
