import { describe, expect, it } from 'vitest';

import type { FuryContextCapsule, FuryContextEntry } from '../src/fury-context-compiler.js';
import { diffFuryContextCapsules } from '../src/fury-context-diff.js';

function entry(source:string,digest:string,bytes:number,pinned=false):FuryContextEntry{
  return Object.freeze({
    source,
    kind:pinned?'constraint':'note',
    reason:'fixture',
    digest,
    bytes,
    scope:'task',
    pinned,
    content:source,
  });
}

function capsule(digest:string,entries:readonly FuryContextEntry[],usedBytes:number,budgetBytes=4096):FuryContextCapsule{
  return Object.freeze({
    format:'furypipe-context-capsule/v1',
    irDigest:'ir',
    taskId:'task',
    budgetBytes,
    usedBytes,
    candidateBytes:usedBytes,
    entries,
    omitted:Object.freeze([]),
    capsuleDigest:digest,
  });
}

describe('FuryContext Diff',()=>{
  it('reports added, removed, changed and unchanged sources deterministically',()=>{
    const previous=capsule('a'.repeat(64),[
      entry('ir:must[0]','1'.repeat(64),10,true),
      entry('file:a','2'.repeat(64),20),
      entry('file:removed','3'.repeat(64),30),
    ],60);
    const current=capsule('b'.repeat(64),[
      entry('ir:must[0]','1'.repeat(64),10,true),
      entry('file:a','4'.repeat(64),25),
      entry('file:added','5'.repeat(64),40),
    ],75);

    const diff=diffFuryContextCapsules(previous,current);
    expect(diff).toMatchObject({
      format:'furypipe-context-diff/v1',
      previousCapsuleDigest:'a'.repeat(64),
      currentCapsuleDigest:'b'.repeat(64),
      unchanged:1,
      hardConstraintChanged:false,
      budget:{previousUsedBytes:60,currentUsedBytes:75,deltaBytes:15},
      authority:'comparison-only',
      executionAuthority:false,
    });
    expect(diff.added.map((item)=>item.source)).toEqual(['file:added']);
    expect(diff.removed.map((item)=>item.source)).toEqual(['file:removed']);
    expect(diff.changed).toEqual([
      expect.objectContaining({source:'file:a',previousBytes:20,currentBytes:25}),
    ]);
  });

  it('flags hard-constraint changes and rejects malformed capsules',()=>{
    const previous=capsule('c'.repeat(64),[entry('ir:must[0]','1'.repeat(64),10,true)],10);
    const current=capsule('d'.repeat(64),[entry('ir:must[0]','2'.repeat(64),12,true)],12);
    expect(diffFuryContextCapsules(previous,current).hardConstraintChanged).toBe(true);
    expect(()=>diffFuryContextCapsules({...previous,capsuleDigest:'bad'} as FuryContextCapsule,current)).toThrow(/digest/u);
  });
});
