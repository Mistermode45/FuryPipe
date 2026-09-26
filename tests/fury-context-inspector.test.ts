import { describe, expect, it } from 'vitest';

import { buildFuryContextInspector } from '../src/fury-context-inspector.js';

describe('FuryContext Inspector',()=>{
  it('reports loaded and unresolved context categories without fabricating unavailable data',()=>{
    const inspector=buildFuryContextInspector({
      budgetBytes:28*1024,
      usedBytes:4096,
      sources:[
        {category:'system',status:'loaded',count:1,bytes:2048,ids:['compiled-system'],reason:'Compiled FuryPrompt system instructions.'},
        {category:'skills',status:'loaded',count:2,bytes:1024,ids:['skill-a','skill-b'],reason:'Activated bounded skill instructions.'},
        {category:'mcp',status:'available-not-loaded',count:1,ids:['github'],reason:'MCP is advisory and not injected as executable context.'},
      ],
    });
    expect(inspector).toMatchObject({
      format:'furypipe-context-inspector/v1',
      redactionPolicy:'secret-values-never-exposed',
      authority:'inspection-only',
      executionAuthority:false,
      budget:{usedBytes:4096,availableBytes:28*1024-4096,estimatedUsedTokens:1024},
    });
    expect(inspector.sources).toContainEqual(expect.objectContaining({
      category:'memory',status:'unknown',bytes:null,estimatedTokens:null,
    }));
    expect(inspector.sources).toContainEqual(expect.objectContaining({
      category:'skills',status:'loaded',estimatedTokens:256,
    }));
  });

  it('fails closed on duplicate categories, invalid ids and impossible budgets',()=>{
    expect(()=>buildFuryContextInspector({
      budgetBytes:10,
      usedBytes:11,
      sources:[],
    })).toThrow(/exceeds budgetBytes/u);
    expect(()=>buildFuryContextInspector({
      budgetBytes:100,
      usedBytes:10,
      sources:[
        {category:'system',status:'loaded',reason:'a'},
        {category:'system',status:'loaded',reason:'b'},
      ],
    })).toThrow(/duplicate/u);
    expect(()=>buildFuryContextInspector({
      budgetBytes:100,
      usedBytes:10,
      sources:[{category:'files',status:'loaded',ids:['bad\u0000id'],reason:'files'}],
    })).toThrow(/id is invalid/u);
  });
});
