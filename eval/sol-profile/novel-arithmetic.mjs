// GPT-5.6 Sol novel arithmetic: text baseline vs pure image vs production image+factsheet.
// Fresh random numbers; exact final-number grading.
// SOL_QUALITY_LIVE=1 N=20 node eval/sol-profile/novel-arithmetic.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTextToPngs } from '../../dist/core/render.js';
import { resolveGptProfile } from '../../dist/core/gpt-model-profiles.js';
import { factSheetText } from '../../dist/core/factsheet.js';
import { visionTokensForModel } from '../../dist/core/openai.js';
import { callResponses } from './responses-client.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const MODEL=process.env.SOL_QUALITY_MODEL||process.env.MODEL||'gpt-5.6-sol';
const LIVE=process.env.SOL_QUALITY_LIVE==='1';
const N=Math.max(1,Number(process.env.N||20));
const SEED=Number(process.env.SEED||20260711);
const CONCURRENCY=Math.max(1,Number(process.env.CONCURRENCY||3));
const TIMEOUT=Number(process.env.SOL_QUALITY_TIMEOUT_MS||180000);
const profile=resolveGptProfile(MODEL);
const RESULT=join(HERE,(MODEL==='gpt-5.6-sol'?'':`model-${MODEL.replace(/[^a-zA-Z0-9._-]+/g,'_')}-`)+'novel-arithmetic-results.json');
const RETRY_ERRORS=process.env.RETRY_ERRORS==='1';
function lcg(seed){let s=seed>>>0;return()=>s=(Math.imul(s,1664525)+1013904223)>>>0}function ri(r,a,b){return a+(r()%(b-a+1))}
function num(text){const m=String(text??'').match(/ANSWER:\s*(-?\d+)/i);return m?Number(m[1]):NaN}
function problems(n,seed){const r=lcg(seed),out=[];for(let i=0;i<n;i++){const k=r()%4;let question,answer;if(k===0){const a=ri(r,1000,9999),b=ri(r,1000,9999),c=ri(r,1000,9999);question=`A factory produced ${a} units on Monday, ${b} units on Tuesday, and ${c} units on Wednesday. How many units did it produce in total over the three days?`;answer=a+b+c}else if(k===1){const a=ri(r,3000,9999),b=ri(r,100,999),c=ri(r,100,999);question=`A reservoir contains ${a} gallons of water. ${b} gallons are pumped out, and later ${c} gallons flow in. How many gallons are in the reservoir now?`;answer=a-b+c}else if(k===2){const a=ri(r,11,99),b=ri(r,11,99),c=ri(r,100,999);question=`A warehouse has ${a} shelves, each holding ${b} boxes, plus ${c} loose boxes. How many boxes are there in total?`;answer=a*b+c}else{const a=ri(r,5000,9999),b=ri(r,1000,4999);question=`A stadium has ${a} seats. ${b} are already sold. How many seats remain unsold?`;answer=a-b}out.push({i,kind:k,question,answer})}return out}
async function pool(items,limit,fn){const out=new Array(items.length);let next=0;async function w(){while(next<items.length){const i=next++;out[i]=await fn(items[i])}}await Promise.all(Array.from({length:Math.min(limit,items.length)},w));return out}
const START=Math.max(0,Number(process.env.START||0));
const ps=problems(N+START,SEED).slice(START);console.log(`novel arithmetic · model=${MODEL} · live=${LIVE} · N=${N}`);
if(!LIVE){for(const p of ps){const imgs=await renderTextToPngs(p.question,profile.stripCols,profile.style,profile.maxHeightPx);console.log(`q${p.i} pages=${imgs.length} tok=${imgs.reduce((n,im)=>n+visionTokensForModel(MODEL,im.width,im.height),0)} gold=${p.answer}`)}process.exit(0)}
const previousRows=RETRY_ERRORS&&existsSync(RESULT)
  ? new Map(JSON.parse(readFileSync(RESULT,'utf8')).rows.map(row=>[row.i,row]))
  : new Map();
const rows=await pool(ps,CONCURRENCY,async p=>{
  const ask=process.env.SOL_ARITH_PROMPT||"Solve the math word problem. Show brief reasoning and end with exactly 'ANSWER: <number>'.";
  const previous=previousRows.get(p.i);
  if(RETRY_ERRORS&&previous){
    const row={...previous};
    if(row.textError){
      try{const r=await callResponses({model:MODEL,content:[{type:'input_text',text:`${ask}\n\n${p.question}`}],maxOutputTokens:256,timeoutMs:TIMEOUT});row.textGot=num(r.text);row.textOk=row.textGot===p.answer;row.textUsage=r.usage||null;row.textError=null}catch(e){row.textError=String(e.message||e)}
    }
    if(row.pureError||row.prodError){
      const imgs=await renderTextToPngs(p.question,profile.stripCols,profile.style,profile.maxHeightPx);
      const urls=imgs.map(im=>({type:'input_image',image_url:`data:image/png;base64,${Buffer.from(im.png).toString('base64')}`,detail:'original'}));
      if(row.pureError)try{const r=await callResponses({model:MODEL,content:[...urls,{type:'input_text',text:`The problem is in the image. ${ask}`}],maxOutputTokens:256,timeoutMs:TIMEOUT});row.pureGot=num(r.text);row.pureOk=row.pureGot===p.answer;row.pureUsage=r.usage||null;row.pureError=null}catch(e){row.pureError=String(e.message||e)}
      if(row.prodError)try{const fs=factSheetText(p.question,profile.factSheetFormat),r=await callResponses({model:MODEL,content:[...urls,...(fs?[{type:'input_text',text:fs}]:[]),{type:'input_text',text:`The problem is in the image; use the exact-number factsheet if present. ${ask}`}],maxOutputTokens:256,timeoutMs:TIMEOUT});row.prodGot=num(r.text);row.prodOk=row.prodGot===p.answer;row.prodUsage=r.usage||null;row.prodError=null}catch(e){row.prodError=String(e.message||e)}
    }
    console.log(`q${p.i} retry text=${row.textOk?'Y':'N'} pure=${row.pureOk?'Y':'N'} prod=${row.prodOk?'Y':'N'}`);
    return row;
  }
  const imgs=await renderTextToPngs(p.question,profile.stripCols,profile.style,profile.maxHeightPx);
  const urls=imgs.map(im=>({type:'input_image',image_url:`data:image/png;base64,${Buffer.from(im.png).toString('base64')}`,detail:'original'}));
  const imageTokens=imgs.reduce((n,im)=>n+visionTokensForModel(MODEL,im.width,im.height),0);
  let text,pure,prod;
  try{text=await callResponses({model:MODEL,content:[{type:'input_text',text:`${ask}\n\n${p.question}`}],maxOutputTokens:256,timeoutMs:TIMEOUT})}catch(e){text={text:'',error:String(e.message||e)}}
  try{pure=await callResponses({model:MODEL,content:[...urls,{type:'input_text',text:`The problem is in the image. ${ask}`}],maxOutputTokens:256,timeoutMs:TIMEOUT})}catch(e){pure={text:'',error:String(e.message||e)}}
  try{const fs=factSheetText(p.question,profile.factSheetFormat);prod=await callResponses({model:MODEL,content:[...urls,...(fs?[{type:'input_text',text:fs}]:[]),{type:'input_text',text:`The problem is in the image; use the exact-number factsheet if present. ${ask}`}],maxOutputTokens:256,timeoutMs:TIMEOUT})}catch(e){prod={text:'',error:String(e.message||e)}}
  const textGot=num(text.text),pureGot=num(pure.text),prodGot=num(prod.text);
  const row={...p,imageTokens,textGot,pureGot,prodGot,textOk:textGot===p.answer,pureOk:pureGot===p.answer,prodOk:prodGot===p.answer,textUsage:text.usage||null,pureUsage:pure.usage||null,prodUsage:prod.usage||null,textError:text.error||null,pureError:pure.error||null,prodError:prod.error||null};
  console.log(`q${p.i} text=${row.textOk?'Y':'N'}(${textGot}) pure=${row.pureOk?'Y':'N'}(${pureGot}) prod=${row.prodOk?'Y':'N'}(${prodGot}) gold=${p.answer}`);
  return row;
});
const count=k=>rows.filter(r=>r[k]).length,usageTotal=k=>rows.reduce((n,r)=>n+(r[k]?.input_tokens||0),0),summary={generatedAt:new Date().toISOString(),model:MODEL,live:true,n:N,seed:SEED,recipe:{cols:profile.stripCols,maxH:profile.maxHeightPx,style:profile.style,factsheet:true},textCorrect:count('textOk'),pureCorrect:count('pureOk'),prodCorrect:count('prodOk'),textPct:100*count('textOk')/N,purePct:100*count('pureOk')/N,prodPct:100*count('prodOk')/N,inputTokens:{text:usageTotal('textUsage'),pure:usageTotal('pureUsage'),production:usageTotal('prodUsage')},rows};writeFileSync(RESULT,JSON.stringify(summary,null,2));console.log(`\nSUMMARY text ${summary.textCorrect}/${N} (${summary.textPct}%) · pure ${summary.pureCorrect}/${N} (${summary.purePct}%) · prod ${summary.prodCorrect}/${N} (${summary.prodPct}%)`);
