import { describe, expect, it } from 'vitest';

import type { FuryCapabilityGraph } from '../src/fury-capability-graph.js';
import type { FuryGraph } from '../src/fury-graph.js';
import { buildFuryWorkspaceGraph } from '../src/fury-workspace-graph.js';

const repositoryGraph: FuryGraph = Object.freeze({
  format:'furypipe-graph/v1',
  provider:'native-codegraph',
  root:'/tmp/project',
  nodes:Object.freeze([
    Object.freeze({id:'file:src/index.ts',label:'index.ts',kind:'file',file:'src/index.ts'}),
    Object.freeze({id:'symbol:index',label:'index',kind:'symbol',file:'src/index.ts'}),
  ]),
  edges:Object.freeze([]),
  stale:false,
  staleFiles:Object.freeze([]),
  outputs:Object.freeze({}),
});

const capabilityGraph: FuryCapabilityGraph = Object.freeze({
  format:'furypipe-capability-graph/v1',
  requestDigestSha256:'a'.repeat(64),
  selectionDigestSha256:'b'.repeat(64),
  nodes:Object.freeze([
    Object.freeze({id:'request:a',kind:'request',label:'Request',executionAuthority:false}),
    Object.freeze({id:'decision:model',kind:'decision',label:'model',family:'model',reason:'advisory',executionAuthority:false}),
  ]),
  edges:Object.freeze([]),
  unresolved:Object.freeze([]),
  authority:'visualization-only',
  executionAuthorized:false,
});

describe('Fury Workspace Graph',()=>{
  it('composes authoritative project/file/memory/decision/artifact references without owning them',()=>{
    const graph=buildFuryWorkspaceGraph({
      projectRoot:'/tmp/project',
      repositoryGraph,
      capabilityGraph,
      memories:[{
        memoryId:'mem-1',
        memoryClass:'Project',
        scope:'project',
        state:'active',
        confidence:1,
        source:'user-message',
      }],
      artifacts:[{
        artifactId:'artifact-1',
        label:'analysis.md',
        decisionFamily:'model',
      }],
    });
    expect(graph).toMatchObject({
      format:'furypipe-workspace-graph/v1',
      authority:'projection-only',
      executionAuthority:false,
      coverage:{repository:true,files:1,memory:1,decisions:1,artifacts:1},
    });
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({kind:'project',source:'project'}),
      expect.objectContaining({kind:'repository',source:'fury-graph'}),
      expect.objectContaining({kind:'file',source:'fury-graph',label:'src/index.ts'}),
      expect.objectContaining({kind:'memory',source:'memory-vnext'}),
      expect.objectContaining({kind:'decision',source:'capability-graph'}),
      expect.objectContaining({kind:'artifact',source:'artifact-store'}),
    ]));
    const artifact=graph.nodes.find((node)=>node.kind==='artifact')!;
    const decision=graph.nodes.find((node)=>node.kind==='decision')!;
    expect(graph.edges).toContainEqual(expect.objectContaining({
      from:decision.id,to:artifact.id,kind:'produced',
    }));
  });

  it('does not fabricate repository, memory or artifact nodes when stores are absent',()=>{
    const graph=buildFuryWorkspaceGraph({projectRoot:'/tmp/project'});
    expect(graph.coverage).toEqual({repository:false,files:0,memory:0,decisions:0,artifacts:0});
    expect(graph.nodes.map((node)=>node.kind)).toEqual(['project']);
  });

  it('bounds projected memory and artifacts',()=>{
    expect(()=>buildFuryWorkspaceGraph({
      projectRoot:'/tmp/project',
      memories:new Array(2001).fill({
        memoryId:'x',memoryClass:'Project',scope:'project',state:'active',confidence:1,source:'user-message',
      }),
    })).toThrow(/memory bound/u);
    expect(()=>buildFuryWorkspaceGraph({
      projectRoot:'/tmp/project',
      artifacts:new Array(2001).fill({artifactId:'x',label:'x'}),
    })).toThrow(/artifact bound/u);
  });
});
