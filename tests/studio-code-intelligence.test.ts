import { mkdtemp,mkdir,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe,expect,it } from 'vitest';
import { createStudioCodeIntelligence } from '../src/studio/studio-code-intelligence.js';
describe('Studio code intelligence',()=>{
  it('searches CodeGraph without execution authority',async()=>{
    const root=await mkdtemp(join(tmpdir(),'fury-code-intel-'));
    try{
      await mkdir(join(root,'src'),{recursive:true});await mkdir(join(root,'tests'),{recursive:true});
      await writeFile(join(root,'src','math.ts'),'export function add(a:number,b:number){return a+b}\nexport const answer=42\n');
      await writeFile(join(root,'tests','math.test.ts'),"import { add } from '../src/math.js';\nadd(1,2);\n");
      const intel=createStudioCodeIntelligence(root);
      expect(await intel.summary()).toMatchObject({files:2,executionAuthority:false});
      expect((await intel.search('add')).symbols.some(s=>s.name==='add')).toBe(true);
      const detail=await intel.symbol('add');expect(detail.matches[0]?.symbol.name).toBe('add');expect(detail.matches[0]?.references.length).toBeGreaterThan(0);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('bounds requests',async()=>{
    const root=await mkdtemp(join(tmpdir(),'fury-code-intel-bounds-'));
    try{await writeFile(join(root,'x.ts'),'export const x=1;\n');const intel=createStudioCodeIntelligence(root);await expect(intel.search('')).rejects.toThrow(/query/u);await expect(intel.search('x',101)).rejects.toThrow(/limit/u);}finally{await rm(root,{recursive:true,force:true});}
  });
});
