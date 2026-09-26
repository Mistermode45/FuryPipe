import type { FuryContextCapsule, FuryContextEntry } from './fury-context-compiler.js';

export const FURY_CONTEXT_DIFF_FORMAT = 'furypipe-context-diff/v1' as const;

export interface FuryContextDiffChangedEntry {
  readonly source: string;
  readonly previousDigest: string;
  readonly currentDigest: string;
  readonly previousBytes: number;
  readonly currentBytes: number;
  readonly pinnedChanged: boolean;
}

export interface FuryContextDiff {
  readonly format: typeof FURY_CONTEXT_DIFF_FORMAT;
  readonly previousCapsuleDigest: string;
  readonly currentCapsuleDigest: string;
  readonly added: readonly FuryContextEntry[];
  readonly removed: readonly FuryContextEntry[];
  readonly changed: readonly FuryContextDiffChangedEntry[];
  readonly unchanged: number;
  readonly budget: {
    readonly previousUsedBytes: number;
    readonly currentUsedBytes: number;
    readonly deltaBytes: number;
    readonly previousBudgetBytes: number;
    readonly currentBudgetBytes: number;
  };
  readonly hardConstraintChanged: boolean;
  readonly authority: 'comparison-only';
  readonly executionAuthority: false;
}

const MAX_ENTRIES = 20_000;

function validateCapsule(value:FuryContextCapsule,label:string):void{
  if(!value||typeof value!=='object'||value.format!=='furypipe-context-capsule/v1') {
    throw new TypeError(`${label} must be a FuryContext capsule`);
  }
  if(!Array.isArray(value.entries)||value.entries.length>MAX_ENTRIES) {
    throw new RangeError(`${label} entries exceed bound`);
  }
  if(typeof value.capsuleDigest!=='string'||!/^[a-f0-9]{64}$/u.test(value.capsuleDigest)) {
    throw new TypeError(`${label} capsule digest is invalid`);
  }
}

function sourceMap(entries:readonly FuryContextEntry[],label:string):Map<string,FuryContextEntry>{
  const map=new Map<string,FuryContextEntry>();
  for(const entry of entries){
    if(!entry||typeof entry.source!=='string'||!entry.source||entry.source.includes('\0')) {
      throw new TypeError(`${label} contains invalid entry source`);
    }
    if(map.has(entry.source)) throw new Error(`${label} contains duplicate source: ${entry.source}`);
    map.set(entry.source,entry);
  }
  return map;
}

export function diffFuryContextCapsules(
  previous:FuryContextCapsule,
  current:FuryContextCapsule,
):FuryContextDiff{
  validateCapsule(previous,'previous');
  validateCapsule(current,'current');
  const before=sourceMap(previous.entries,'previous');
  const after=sourceMap(current.entries,'current');
  const added:FuryContextEntry[]=[];
  const removed:FuryContextEntry[]=[];
  const changed:FuryContextDiffChangedEntry[]=[];
  let unchanged=0;

  for(const [source,entry] of after){
    const old=before.get(source);
    if(!old){
      added.push(entry);
      continue;
    }
    if(old.digest===entry.digest&&old.bytes===entry.bytes&&old.pinned===entry.pinned){
      unchanged+=1;
      continue;
    }
    changed.push(Object.freeze({
      source,
      previousDigest:old.digest,
      currentDigest:entry.digest,
      previousBytes:old.bytes,
      currentBytes:entry.bytes,
      pinnedChanged:old.pinned!==entry.pinned,
    }));
  }
  for(const [source,entry] of before){
    if(!after.has(source)) removed.push(entry);
  }

  added.sort((a,b)=>a.source.localeCompare(b.source));
  removed.sort((a,b)=>a.source.localeCompare(b.source));
  changed.sort((a,b)=>a.source.localeCompare(b.source));
  const hardConstraintChanged=
    added.some((entry)=>entry.pinned)
    || removed.some((entry)=>entry.pinned)
    || changed.some((entry)=>entry.pinnedChanged||before.get(entry.source)?.pinned===true||after.get(entry.source)?.pinned===true);

  return Object.freeze({
    format:FURY_CONTEXT_DIFF_FORMAT,
    previousCapsuleDigest:previous.capsuleDigest,
    currentCapsuleDigest:current.capsuleDigest,
    added:Object.freeze(added),
    removed:Object.freeze(removed),
    changed:Object.freeze(changed),
    unchanged,
    budget:Object.freeze({
      previousUsedBytes:previous.usedBytes,
      currentUsedBytes:current.usedBytes,
      deltaBytes:current.usedBytes-previous.usedBytes,
      previousBudgetBytes:previous.budgetBytes,
      currentBudgetBytes:current.budgetBytes,
    }),
    hardConstraintChanged,
    authority:'comparison-only' as const,
    executionAuthority:false as const,
  });
}
