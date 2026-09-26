export const FURY_CONTEXT_INSPECTOR_FORMAT = 'furypipe-context-inspector/v1' as const;

export type FuryContextInspectorStatus =
  | 'loaded'
  | 'available-not-loaded'
  | 'not-present'
  | 'unknown';

export type FuryContextInspectorCategory =
  | 'system'
  | 'project'
  | 'conversation'
  | 'skills'
  | 'memory'
  | 'files'
  | 'tools'
  | 'mcp';

export interface FuryContextInspectorSourceInput {
  readonly category: FuryContextInspectorCategory;
  readonly status: FuryContextInspectorStatus;
  readonly count?: number;
  readonly bytes?: number;
  readonly ids?: readonly string[];
  readonly reason: string;
}

export interface FuryContextInspectorInput {
  readonly budgetBytes: number;
  readonly usedBytes: number;
  readonly sources: readonly FuryContextInspectorSourceInput[];
}

export interface FuryContextInspectorSource {
  readonly category: FuryContextInspectorCategory;
  readonly status: FuryContextInspectorStatus;
  readonly count: number | null;
  readonly bytes: number | null;
  readonly estimatedTokens: number | null;
  readonly tokenEstimateBasis: 'bytes-divided-by-4' | 'unknown';
  readonly ids: readonly string[];
  readonly reason: string;
}

export interface FuryContextInspector {
  readonly format: typeof FURY_CONTEXT_INSPECTOR_FORMAT;
  readonly budget: {
    readonly usedBytes: number;
    readonly availableBytes: number;
    readonly budgetBytes: number;
    readonly estimatedUsedTokens: number;
    readonly tokenEstimateBasis: 'bytes-divided-by-4';
  };
  readonly sources: readonly FuryContextInspectorSource[];
  readonly redactionPolicy: 'secret-values-never-exposed';
  readonly authority: 'inspection-only';
  readonly executionAuthority: false;
}

const CATEGORIES = Object.freeze([
  'system','project','conversation','skills','memory','files','tools','mcp',
] as const);
const STATUS = new Set<FuryContextInspectorStatus>([
  'loaded','available-not-loaded','not-present','unknown',
]);
const MAX_SOURCES = 32;
const MAX_IDS = 256;
const MAX_ID_CHARS = 256;
const MAX_REASON_CHARS = 1024;
const MAX_BYTES = 64 * 1024 * 1024;

function boundedBytes(value:number,label:string):number{
  if(!Number.isSafeInteger(value)||value<0||value>MAX_BYTES) throw new RangeError(`${label} must be 0..64 MiB`);
  return value;
}

function safeIds(values:readonly string[]|undefined):readonly string[]{
  const input=values??[];
  if(!Array.isArray(input)||input.length>MAX_IDS) throw new RangeError('context inspector ids exceed bound');
  const output:string[]=[];
  const seen=new Set<string>();
  for(const value of input){
    if(typeof value!=='string'||value.length<1||value.length>MAX_ID_CHARS||/[\u0000-\u001f\u007f]/u.test(value)) {
      throw new TypeError('context inspector id is invalid');
    }
    if(!seen.has(value)){seen.add(value);output.push(value);}
  }
  return Object.freeze(output);
}

function estimateTokens(bytes:number):number{
  return Math.ceil(bytes/4);
}

export function buildFuryContextInspector(input:FuryContextInspectorInput):FuryContextInspector{
  if(!input||typeof input!=='object') throw new TypeError('context inspector input is required');
  const budgetBytes=boundedBytes(input.budgetBytes,'context inspector budgetBytes');
  const usedBytes=boundedBytes(input.usedBytes,'context inspector usedBytes');
  if(usedBytes>budgetBytes) throw new RangeError('context inspector usedBytes exceeds budgetBytes');
  if(!Array.isArray(input.sources)||input.sources.length>MAX_SOURCES) throw new RangeError('context inspector sources exceed bound');

  const seen=new Set<FuryContextInspectorCategory>();
  const sources:FuryContextInspectorSource[]=[];
  for(const source of input.sources){
    if(!source||typeof source!=='object'||!(CATEGORIES as readonly string[]).includes(source.category)||!STATUS.has(source.status)) {
      throw new TypeError('context inspector source is invalid');
    }
    if(seen.has(source.category)) throw new Error(`duplicate context inspector category: ${source.category}`);
    seen.add(source.category);
    if(typeof source.reason!=='string'||source.reason.length<1||source.reason.length>MAX_REASON_CHARS||/[\u0000\u007f]/u.test(source.reason)) {
      throw new TypeError('context inspector reason is invalid');
    }
    const count=source.count===undefined?null:source.count;
    if(count!==null&&(!Number.isSafeInteger(count)||count<0||count>1_000_000)) throw new RangeError('context inspector count is invalid');
    const bytes=source.bytes===undefined?null:boundedBytes(source.bytes,'context inspector source bytes');
    sources.push(Object.freeze({
      category:source.category,
      status:source.status,
      count,
      bytes,
      estimatedTokens:bytes===null?null:estimateTokens(bytes),
      tokenEstimateBasis:bytes===null?'unknown':'bytes-divided-by-4',
      ids:safeIds(source.ids),
      reason:source.reason,
    }));
  }

  for(const category of CATEGORIES){
    if(seen.has(category)) continue;
    sources.push(Object.freeze({
      category,
      status:'unknown',
      count:null,
      bytes:null,
      estimatedTokens:null,
      tokenEstimateBasis:'unknown',
      ids:Object.freeze([]),
      reason:'No authoritative source information was supplied for this category.',
    }));
  }

  return Object.freeze({
    format:FURY_CONTEXT_INSPECTOR_FORMAT,
    budget:Object.freeze({
      usedBytes,
      availableBytes:budgetBytes-usedBytes,
      budgetBytes,
      estimatedUsedTokens:estimateTokens(usedBytes),
      tokenEstimateBasis:'bytes-divided-by-4' as const,
    }),
    sources:Object.freeze(sources),
    redactionPolicy:'secret-values-never-exposed' as const,
    authority:'inspection-only' as const,
    executionAuthority:false as const,
  });
}
