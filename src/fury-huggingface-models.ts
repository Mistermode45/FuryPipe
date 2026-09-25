// Public Hugging Face GGUF discovery for FuryPipe Local Lab.
//
// Network boundary:
// - only the fixed https://huggingface.co origin is contacted;
// - no cookies, auth headers or locally stored HF tokens are used;
// - redirects are refused;
// - bodies and time are bounded;
// - requests happen only after an explicit Studio action.
import { classifyFuryModelFit, type FuryHardwareProfile, type FuryModelFit } from './fury-local-fabric.js';

export const FURY_HF_CATALOG_FORMAT = 'furypipe-hf-catalog/v1' as const;
const HF_ORIGIN = 'https://huggingface.co';
const MAX_BODY = 2 * 1024 * 1024;

export class FuryHuggingFaceError extends Error {
  constructor(message: string) { super(message); this.name = 'FuryHuggingFaceError'; }
}

export interface FuryGgufVariant {
  readonly name: string;
  readonly files: readonly string[];
  readonly sizeBytes?: number;
  readonly quantization?: string;
  readonly fit: FuryModelFit;
}

export interface FuryHuggingFaceModel {
  readonly format: typeof FURY_HF_CATALOG_FORMAT;
  readonly id: string;
  readonly url: string;
  readonly downloads?: number;
  readonly likes?: number;
  readonly license?: string;
  readonly lastModified?: string;
  readonly tags: readonly string[];
  readonly variants: readonly FuryGgufVariant[];
  readonly recommended?: FuryGgufVariant;
  readonly recommendationBasis: 'hardware-fit-only';
}

export type FuryHuggingFaceRecommendation = Omit<FuryHuggingFaceModel, 'recommendationBasis'> & {
  readonly score: number;
  readonly recommendationBasis: 'hardware-fit-plus-hub-signals';
};

function safePart(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
}

export function parseHuggingFaceModelRef(input: string): string {
  const raw = input.trim();
  if (!raw || raw.length > 512) throw new FuryHuggingFaceError('model reference is required');
  let path = raw;
  if (/^https?:\/\//iu.test(raw)) {
    let u: URL;
    try { u = new URL(raw); } catch { throw new FuryHuggingFaceError('invalid model URL'); }
    if (u.protocol !== 'https:' || (u.hostname !== 'huggingface.co' && u.hostname !== 'www.huggingface.co')) throw new FuryHuggingFaceError('only public huggingface.co model URLs are supported');
    path = u.pathname.replace(/^\/+|\/+$/gu, '');
  } else {
    path = path.replace(/^hf\.co\//iu, '').replace(/^\/+|\/+$/gu, '');
  }
  const parts = path.split('/');
  if (parts.length < 2 || !safePart(parts[0]!) || !safePart(parts[1]!)) throw new FuryHuggingFaceError('use owner/model or a public huggingface.co model URL');
  return `${parts[0]}/${parts[1]}`;
}

async function boundedJson(url: URL, fetchFn: typeof fetch, timeoutMs: number): Promise<unknown> {
  if (url.origin !== HF_ORIGIN) throw new FuryHuggingFaceError('unexpected Hugging Face origin');
  const res = await fetchFn(url, {
    method: 'GET',
    redirect: 'manual',
    credentials: 'omit',
    headers: { accept: 'application/json', 'user-agent': 'FuryPipe/0.16 local-model-catalog' },
    signal: AbortSignal.timeout(Math.min(Math.max(timeoutMs, 1000), 15000)),
  });
  if (res.status >= 300 && res.status < 400) { await res.body?.cancel(); throw new FuryHuggingFaceError('Hugging Face redirect refused'); }
  if (res.status !== 200) { await res.body?.cancel(); throw new FuryHuggingFaceError(`Hugging Face answered HTTP ${res.status}`); }
  const reader = res.body?.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) { await reader.cancel(); throw new FuryHuggingFaceError('Hugging Face response exceeds the byte bound'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new FuryHuggingFaceError('Hugging Face returned invalid JSON'); }
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function text(value: unknown, max=512): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
}
function quantFrom(name: string): string | undefined {
  const m = name.match(/(?:^|[-_.])((?:IQ|Q)\d(?:_[A-Z0-9]+|[A-Z0-9]+)?)(?=[-_.]|$)/iu);
  return m?.[1]?.toUpperCase();
}
function sizeOf(sibling: Record<string, unknown>): number | undefined {
  return numeric(sibling.size) ?? numeric((sibling.lfs as { size?: unknown } | undefined)?.size);
}

function variantsFrom(body: Record<string, unknown>, hardware: FuryHardwareProfile): FuryGgufVariant[] {
  const siblings = Array.isArray(body.siblings) ? body.siblings : [];
  const groups = new Map<string,{ files:string[]; sizes:number[]; missing:boolean; quantization?:string }>();
  for (const item of siblings.slice(0,2048)) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>; const filename = text(rec.rfilename,1024);
    if (!filename || !/\.gguf$/iu.test(filename) || /(^|\/)mmproj-/iu.test(filename)) continue;
    const shard = filename.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/iu);
    const key = shard ? shard[1]! + '.gguf' : filename;
    const g = groups.get(key) ?? { files:[], sizes:[], missing:false, quantization:quantFrom(key) };
    g.files.push(filename); const size=sizeOf(rec); if (size===undefined) g.missing=true; else g.sizes.push(size);
    groups.set(key,g);
  }
  return [...groups.entries()].map(([name,g]) => {
    const sizeBytes = g.missing || !g.sizes.length ? undefined : g.sizes.reduce((a,b)=>a+b,0);
    return Object.freeze({
      name, files:Object.freeze(g.files.sort()),
      ...(sizeBytes!==undefined?{sizeBytes}:{}),
      ...(g.quantization?{quantization:g.quantization}:{}),
      fit: classifyFuryModelFit({ sizeBytes }, hardware),
    });
  }).sort((a,b) => {
    const rank:Record<FuryModelFit,number>={FITS:0,MAY_BE_SLOW:1,UNKNOWN:2,DOES_NOT_FIT:3};
    return rank[a.fit]-rank[b.fit] || ((b.sizeBytes??0)-(a.sizeBytes??0));
  });
}

function bestVariant(variants: readonly FuryGgufVariant[]): FuryGgufVariant | undefined {
  return variants.find((v)=>v.fit==='FITS') ?? variants.find((v)=>v.fit==='MAY_BE_SLOW') ?? variants.find((v)=>v.fit==='UNKNOWN');
}

export async function inspectHuggingFaceGguf(
  ref: string,
  hardware: FuryHardwareProfile,
  options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {},
): Promise<FuryHuggingFaceModel> {
  const id = parseHuggingFaceModelRef(ref);
  const url = new URL(`/api/models/${id.split('/').map(encodeURIComponent).join('/')}?blobs=true`, HF_ORIGIN);
  const body = await boundedJson(url, options.fetch ?? fetch, options.timeoutMs ?? 8000) as Record<string, unknown>;
  const actual = text(body.id) ?? id;
  const tags = Array.isArray(body.tags) ? body.tags.filter((v):v is string=>typeof v==='string').slice(0,128) : [];
  const variants = variantsFrom(body, hardware);
  if (!variants.length) throw new FuryHuggingFaceError('no GGUF model weights were found in this repository');
  const card = body.cardData && typeof body.cardData==='object' ? body.cardData as Record<string,unknown> : {};
  const recommended = bestVariant(variants);
  return Object.freeze({
    format:FURY_HF_CATALOG_FORMAT,id:actual,url:`${HF_ORIGIN}/${actual}`,
    ...(numeric(body.downloads)!==undefined?{downloads:numeric(body.downloads)!}:{}),
    ...(numeric(body.likes)!==undefined?{likes:numeric(body.likes)!}:{}),
    ...(text(card.license,64)?{license:text(card.license,64)!}:{}),
    ...(text(body.lastModified,64)?{lastModified:text(body.lastModified,64)!}:{}),
    tags:Object.freeze(tags),variants:Object.freeze(variants),
    ...(recommended?{recommended}:{}),
    recommendationBasis:'hardware-fit-only',
  });
}

export async function recommendHuggingFaceGguf(
  hardware: FuryHardwareProfile,
  options: { readonly profile?: 'general'|'coding'|'reasoning'|'vision'; readonly fetch?: typeof fetch; readonly timeoutMs?: number; readonly limit?: number } = {},
): Promise<{ readonly format: typeof FURY_HF_CATALOG_FORMAT; readonly profile:string; readonly models: readonly FuryHuggingFaceRecommendation[]; readonly methodology:string }> {
  const profile=options.profile??'general'; const fetchFn=options.fetch??fetch; const limit=Math.min(Math.max(options.limit??6,1),10);
  const search = profile==='coding'?'coder':profile==='reasoning'?'reasoning':profile==='vision'?'vision':'';
  const u=new URL('/api/models',HF_ORIGIN); u.searchParams.set('filter','gguf'); u.searchParams.set('sort','downloads'); u.searchParams.set('direction','-1'); u.searchParams.set('limit','18');
  if(search) u.searchParams.set('search',search);
  const listed=await boundedJson(u,fetchFn,options.timeoutMs??8000);
  if(!Array.isArray(listed)) throw new FuryHuggingFaceError('unexpected Hugging Face model-list response');
  const ids=listed.map((x)=>x&&typeof x==='object'?text((x as Record<string,unknown>).id):undefined).filter((x):x is string=>!!x).slice(0,12);
  const inspected=(await Promise.all(ids.map((id)=>inspectHuggingFaceGguf(id,hardware,{fetch:fetchFn,timeoutMs:options.timeoutMs??8000}).catch(()=>undefined)))).filter((x):x is FuryHuggingFaceModel=>!!x);
  const fitScore:Record<FuryModelFit,number>={FITS:100,MAY_BE_SLOW:55,UNKNOWN:20,DOES_NOT_FIT:-100};
  const models=inspected.map((m):FuryHuggingFaceRecommendation=>{
    const variant=m.recommended; const pop=Math.min(25,Math.log10((m.downloads??0)+1)*5); const likes=Math.min(10,Math.log10((m.likes??0)+1)*4);
    const tags=m.tags.join(' ').toLowerCase(); const task=profile==='general'?8:(tags.includes(profile)||m.id.toLowerCase().includes(search)?15:0);
    const score=Math.round(((variant?fitScore[variant.fit]:-100)+pop+likes+task)*100)/100;
    return Object.freeze({...m,score,recommendationBasis:'hardware-fit-plus-hub-signals' as const});
  }).filter((m)=>m.recommended?.fit!=='DOES_NOT_FIT').sort((a,b)=>b.score-a.score).slice(0,limit);
  return Object.freeze({format:FURY_HF_CATALOG_FORMAT,profile,models:Object.freeze(models),methodology:'Public Hugging Face GGUF discovery ranked by hardware fit plus Hub popularity/task signals; this is not a quality benchmark.'});
}
