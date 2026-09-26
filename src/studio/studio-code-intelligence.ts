import { createCodeGraphIndexer, type CodeGraphIndex, type CodeGraphSymbol } from '../codegraph.js';

export const STUDIO_CODE_INTELLIGENCE_FORMAT = 'furypipe-studio-code-intelligence/v1' as const;

export class StudioCodeIntelligenceError extends Error {
  override readonly name = 'StudioCodeIntelligenceError';
  constructor(readonly status: number, message: string) { super(message); }
}
function query(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new StudioCodeIntelligenceError(400, label + ' must be text');
  const out=value.trim();
  if(!out||out.length>256||/[\u0000-\u001f\u007f]/u.test(out)) throw new StudioCodeIntelligenceError(400,label+' is invalid');
  return out;
}
function limit(value: unknown, fallback:number, max:number):number {
  if(value===undefined) return fallback;
  if(!Number.isInteger(value)||Number(value)<1||Number(value)>max) throw new StudioCodeIntelligenceError(400,'limit must be between 1 and '+max);
  return Number(value);
}
function rank(value:string,needle:string):number{
  const a=value.toLowerCase(),b=needle.toLowerCase();
  return a===b?0:a.startsWith(b)?1:a.includes(b)?2:99;
}
export function createStudioCodeIntelligence(projectRoot:string){
  const indexer=createCodeGraphIndexer(projectRoot,{maxFiles:8192,maxFileBytes:2*1024*1024,maxSymbols:65536,maxReferences:200000});
  let current:CodeGraphIndex|undefined;
  let pending:Promise<CodeGraphIndex>|undefined;
  const load=async(refresh=false)=>{
    if(refresh||(!current&&!pending)) pending=indexer.build(current);
    if(pending){try{current=await pending;}finally{pending=undefined;}}
    if(!current) throw new StudioCodeIntelligenceError(503,'CodeGraph is unavailable');
    return current;
  };
  return Object.freeze({
    async summary(refresh=false){
      const g=await load(refresh);
      return Object.freeze({format:STUDIO_CODE_INTELLIGENCE_FORMAT,repositoryId:g.repositoryId,builtAt:g.builtAt,mode:g.mode,reusedFiles:g.reusedFiles,files:g.files.length,symbols:g.symbols.length,references:g.references.length,imports:g.imports.length,tests:g.tests.length,packages:g.packages.length,executionAuthority:false as const});
    },
    async search(queryValue:unknown,limitValue?:unknown,refresh=false){
      const q=query(queryValue,'code search query'),n=limit(limitValue,30,100),g=await load(refresh);
      const files=g.files.map(file=>({file,score:rank(file.path,q)})).filter(x=>x.score<99).sort((a,b)=>a.score-b.score||a.file.path.localeCompare(b.file.path)).slice(0,n).map(x=>({path:x.file.path,language:x.file.language,bytes:x.file.bytes,sha256:x.file.sha256}));
      const symbols=g.symbols.map(symbol=>({symbol,score:Math.min(rank(symbol.name,q),rank(symbol.filePath,q))})).filter(x=>x.score<99).sort((a,b)=>a.score-b.score||a.symbol.name.localeCompare(b.symbol.name)||a.symbol.filePath.localeCompare(b.symbol.filePath)).slice(0,n).map(x=>x.symbol);
      return Object.freeze({format:STUDIO_CODE_INTELLIGENCE_FORMAT,repositoryId:g.repositoryId,builtAt:g.builtAt,query:q,files:Object.freeze(files),symbols:Object.freeze(symbols),executionAuthority:false as const});
    },
    async symbol(identifierValue:unknown,limitValue?:unknown,refresh=false){
      const identifier=query(identifierValue,'symbol identifier'),n=limit(limitValue,20,50),g=await load(refresh);
      const matches=g.symbols.filter((s:CodeGraphSymbol)=>s.symbolId===identifier||s.name.toLowerCase()===identifier.toLowerCase()).slice(0,n).map(symbol=>Object.freeze({
        symbol,
        references:Object.freeze(g.references.filter(r=>r.symbolId===symbol.symbolId).slice(0,500)),
        imports:Object.freeze(g.imports.filter(i=>i.filePath===symbol.filePath).slice(0,200)),
        tests:Object.freeze(g.tests.filter(t=>t.targetFile===symbol.filePath||t.symbolName===symbol.name).slice(0,200)),
      }));
      return Object.freeze({format:STUDIO_CODE_INTELLIGENCE_FORMAT,repositoryId:g.repositoryId,builtAt:g.builtAt,matches:Object.freeze(matches),executionAuthority:false as const});
    },
  });
}
