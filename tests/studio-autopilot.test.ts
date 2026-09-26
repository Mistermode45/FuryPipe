import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createFuryMcpHub } from '../src/fury-mcp-hub.js';
import { createFurySkillHub } from '../src/fury-skill-hub.js';
import { planStudioAutopilot } from '../src/studio/studio-autopilot.js';

describe('Studio Fury Autopilot',()=>{
  it('compiles production instructions, activates trusted matching skills and only suggests MCP metadata',async()=>{
    const root=mkdtempSync(join(tmpdir(),'furypipe-autopilot-'));
    try{
      const project=join(root,'project'); const home=join(root,'home');
      mkdirSync(join(home,'.claude','skills','api-review'),{recursive:true});
      writeFileSync(join(home,'.claude','skills','api-review','SKILL.md'),'---\nname: api-review\ndescription: Review API implementation and verify tests.\n---\nCheck API behavior and tests before claiming done.\n');
      mkdirSync(join(project,'.furypipe'),{recursive:true});
      writeFileSync(join(project,'.furypipe','mcp.json'),JSON.stringify({mcpServers:{github:{command:'npx',args:['server-github']}}}));
      const skills=createFurySkillHub({projectRoot:project,homeDir:home,stateDir:join(root,'skill-state')});
      const mcp=createFuryMcpHub({projectRoot:project,homeDir:home,stateDir:join(root,'mcp-state')});
      const plan=await planStudioAutopilot({objective:'Implement and review the GitHub API integration with tests',projectRoot:project,skills,mcp,responseStyle:'auto'});
      expect(plan.instructions.profiles).toContain('karpathy-coding-discipline');
      expect(plan.instructions.facets.map((x)=>x.id)).toContain('production-engineering');
      expect(plan.skills.selected.map((x)=>x.name)).toContain('api-review');
      expect(plan.mcp.suggested.map((x)=>x.name)).toContain('github');
      expect(plan.mcp.executionAuthorized).toBe(false);
      expect(plan.prompt.text).toContain('Check API behavior and tests before claiming done.');
      expect(plan.prompt.bytes).toBeLessThanOrEqual(plan.prompt.budgetBytes);
      expect(plan.style.resolved).toBe('caveman');
      expect(plan.executionAuthorized).toBe(false);
    }finally{rmSync(root,{recursive:true,force:true});}
  });

  it('keeps research responses balanced by default and validates style',async()=>{
    const root=mkdtempSync(join(tmpdir(),'furypipe-autopilot-empty-'));
    try{
      const project=join(root,'project'); const home=join(root,'home');
      mkdirSync(project,{recursive:true}); mkdirSync(home,{recursive:true});
      const skills=createFurySkillHub({projectRoot:project,homeDir:home,stateDir:join(root,'skill-state')});
      const mcp=createFuryMcpHub({projectRoot:project,homeDir:home,stateDir:join(root,'mcp-state')});
      const plan=await planStudioAutopilot({objective:'Research current evidence and compare sources',projectRoot:project,skills,mcp});
      expect(plan.instructions.facets.map((x)=>x.id)).toContain('research-evidence');
      expect(plan.style.resolved).toBe('balanced');
      await expect(planStudioAutopilot({objective:'x',projectRoot:project,skills,mcp,responseStyle:'invalid' as never})).rejects.toThrow(/unsupported/u);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});
