import { describe, expect, it } from 'vitest';
import { inspectHuggingFaceGguf, parseHuggingFaceModelRef, recommendHuggingFaceGguf } from '../src/fury-huggingface-models.js';
import type { FuryHardwareProfile } from '../src/fury-local-fabric.js';

const hw:FuryHardwareProfile={platform:'win32',arch:'x64',cpuModel:'test',cpuCount:16,totalMemoryBytes:32*1024**3,freeMemoryBytes:16*1024**3,unifiedMemory:false,gpus:[{name:'RTX',memoryBytes:8*1024**3}]};
const response=(body:unknown)=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});

describe('Hugging Face GGUF catalog',()=>{
  it('normalizes only public Hugging Face model references',()=>{
    expect(parseHuggingFaceModelRef('BoldingBuilds/GLM-5.3-Flash-Uncensored-GGUF')).toBe('BoldingBuilds/GLM-5.3-Flash-Uncensored-GGUF');
    expect(parseHuggingFaceModelRef('https://huggingface.co/BoldingBuilds/GLM-5.3-Flash-Uncensored-GGUF/tree/main')).toBe('BoldingBuilds/GLM-5.3-Flash-Uncensored-GGUF');
    expect(()=>parseHuggingFaceModelRef('https://evil.example/a/b')).toThrow(/huggingface/u);
    expect(()=>parseHuggingFaceModelRef('../x')).toThrow();
  });

  it('groups sharded GGUFs and computes fit without downloading weights',async()=>{
    const fetchMock=async()=>response({id:'BoldingBuilds/GLM-GGUF',downloads:42,likes:3,tags:['gguf','conversational'],cardData:{license:'mit'},siblings:[
      {rfilename:'GLM-IQ1S-00001-of-00002.gguf',size:3*1024**3},
      {rfilename:'GLM-IQ1S-00002-of-00002.gguf',size:3*1024**3},
      {rfilename:'GLM-Q8_0.gguf',size:10*1024**3},
      {rfilename:'mmproj-GLM-F16.gguf',size:1024**3},
    ]});
    const got=await inspectHuggingFaceGguf('BoldingBuilds/GLM-GGUF',hw,{fetch:fetchMock as typeof fetch});
    expect(got.variants).toHaveLength(2);
    expect(got.variants[0]).toMatchObject({name:'GLM-IQ1S.gguf',sizeBytes:6*1024**3,fit:'MAY_BE_SLOW'});
    expect(got.variants.some((v)=>v.name.startsWith('mmproj'))).toBe(false);
    expect(got.license).toBe('mit');
  });

  it('recommends only candidates that are not known to exceed the machine',async()=>{
    const fetchMock=async(input:RequestInfo|URL)=>{
      const u=new URL(String(input));
      if(u.pathname==='/api/models') return response([{id:'org/small'},{id:'org/huge'}]);
      if(u.pathname.endsWith('/org/small')) return response({id:'org/small',downloads:10000,likes:100,tags:['gguf','coding'],siblings:[{rfilename:'small-Q4_K_M.gguf',size:4*1024**3}]});
      return response({id:'org/huge',downloads:999999,likes:999,tags:['gguf'],siblings:[{rfilename:'huge-Q4_K_M.gguf',size:80*1024**3}]});
    };
    const got=await recommendHuggingFaceGguf(hw,{profile:'coding',fetch:fetchMock as typeof fetch});
    expect(got.models.map((m)=>m.id)).toEqual(['org/small']);
    expect(got.methodology).toMatch(/not a quality benchmark/u);
  });
});
