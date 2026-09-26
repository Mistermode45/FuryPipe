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
      const routedSkills={...skills,autoSelect:async()=>{throw new Error('LEGACY_SKILL_SELECTOR_MUST_NOT_RUN');}} as typeof skills;
      const mcp=createFuryMcpHub({projectRoot:project,homeDir:home,stateDir:join(root,'mcp-state')});
      const plan=await planStudioAutopilot({objective:'Implement and review the GitHub API integration with tests',projectRoot:project,skills:routedSkills,mcp,effort:'xhigh',responseStyle:'auto'});
      expect(plan.instructions.profiles).toContain('karpathy-coding-discipline');
      expect(plan.instructions.facets.map((x)=>x.id)).toContain('production-engineering');
      expect(plan.skills.selected.map((x)=>x.name)).toContain('api-review');
      expect(plan.capabilities.selected).toContainEqual(expect.objectContaining({
        kind:'skill',
        id:'api-review',
        executionAuthorized:false,
      }));
      expect(plan.capabilities).toMatchObject({
        authority:'selection-only',
        executionAuthorized:false,
      });
      expect(plan.mcp.suggested.map((x)=>x.name)).toContain('github');
      expect(plan.mcp.executionAuthorized).toBe(false);
      expect(plan.capabilities.blocked).toContainEqual(expect.objectContaining({
        kind:'mcp-server',
        reason:'trust-unverified',
      }));
      expect(plan.blueprint.mcp.advisory).toContainEqual(expect.objectContaining({
        source:'github',
        needsApproval:true,
      }));
      expect(plan.blueprint.capabilities.executionAuthority).toBe(false);
      expect(plan.prompt.text).toContain('Check API behavior and tests before claiming done.');
      expect(plan.prompt.bytes).toBeLessThanOrEqual(plan.prompt.budgetBytes);
      expect(plan.plan.skills.map((x)=>x.name)).toContain('api-review');
      expect(plan.plan.effort).toMatchObject({requested:'xhigh',effective:'xhigh'});
      expect(plan.routing.effort).toMatchObject({requested:'xhigh',effective:'xhigh'});
      expect(plan.routing.profile.id).toBe('coding');
      expect(plan.routing.communicationStyle).toBe('CAVEMAN');
      expect(plan.routing.executionAuthorized).toBe(false);
      expect(plan.mcp.suggested[0]).toMatchObject({ name: 'github', executionAuthorized: false });
      expect(plan.style.resolved).toBe('caveman');
      expect(plan.executionAuthorized).toBe(false);
    }finally{rmSync(root,{recursive:true,force:true});}
  });

  it('resolves an explicitly selected safe harness as an agent capability without granting execution',async()=>{
    const root=mkdtempSync(join(tmpdir(),'furypipe-autopilot-agent-'));
    try{
      const project=join(root,'project'); const home=join(root,'home');
      mkdirSync(project,{recursive:true}); mkdirSync(home,{recursive:true});
      const skills=createFurySkillHub({projectRoot:project,homeDir:home,stateDir:join(root,'skill-state')});
      const mcp=createFuryMcpHub({projectRoot:project,homeDir:home,stateDir:join(root,'mcp-state')});
      const plan=await planStudioAutopilot({
        objective:'Use FuryPipe Native to review this repository',
        projectRoot:project,
        skills,
        mcp,
        harnessId:'furypipe-native',
        harnesses:{
          format:'furypipe-harness-discovery/v1',
          platform:'linux',
          harnesses:[{
            id:'furypipe-native',
            displayName:'FuryPipe Native',
            installed:true,
            versionStatus:'builtin',
            authentication:'not-probed',
            definition:{
              id:'furypipe-native',
              displayName:'FuryPipe Native',
              executables:[],
              versionArgs:[],
              integrations:['native'],
              protocols:['mcp','acp','a2a'],
              skillsDirectories:['.furypipe/skills'],
              localModel:{mechanism:'native',note:'native'},
              capabilities:{streaming:true,resume:true,subagents:true},
              evidence:'BUILTIN',
            },
          }],
        },
      });
      expect(plan.capabilities.selected).toContainEqual(expect.objectContaining({
        kind:'agent',
        id:'furypipe-native',
        executionAuthorized:false,
      }));
      expect(plan.blueprint.unresolved).not.toContain('agent');
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
      const plan=await planStudioAutopilot({
        objective:'Research current evidence and compare sources',
        projectRoot:project,
        skills,
        mcp,
        customInstructions:'Prefer primary sources and state uncertainty explicitly.',
      });
      expect(plan.instructions.facets.map((x)=>x.id)).toContain('research-evidence');
      expect(plan.routing.profile.id).toBe('research');
      expect(plan.routing.communicationStyle).toBe('STANDARD');
      expect(plan.style.resolved).toBe('balanced');
      expect(plan.prompt.text).toContain('Prefer primary sources and state uncertainty explicitly.');
      await expect(planStudioAutopilot({objective:'x',projectRoot:project,skills,mcp,responseStyle:'invalid' as never})).rejects.toThrow(/unsupported/u);
      await expect(planStudioAutopilot({objective:'x',projectRoot:project,skills,mcp,customInstructions:'x'.repeat(4_001)})).rejects.toThrow(/4000/u);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});
