import { createHash } from 'node:crypto';

import { compileFuryPrompt } from '../fury-prompt.js';
import { resolveInstructionPlan } from '../instruction-fabric.js';
import type { FuryMcpHub, FuryMcpSourceView } from '../fury-mcp-hub.js';
import type { FurySkillHub } from '../fury-skill-hub.js';

export const STUDIO_AUTOPILOT_FORMAT = 'furypipe-studio-autopilot/v1' as const;
export const STUDIO_RESPONSE_STYLES = Object.freeze(['auto','balanced','caveman','detailed'] as const);
export type StudioResponseStyle = typeof STUDIO_RESPONSE_STYLES[number];

export interface StudioAutopilotInput {
  readonly objective: string;
  readonly projectRoot: string;
  readonly skills: FurySkillHub;
  readonly mcp: FuryMcpHub;
  readonly harnessId?: string;
  readonly responseStyle?: StudioResponseStyle;
  readonly customInstructions?: string;
}

const MAX_OBJECTIVE_CHARS = 32_768;
const MAX_SKILL_PROMPT_BYTES = 12 * 1024;
const MAX_MCP_SUGGESTIONS = 3;
const MAX_SYSTEM_PROMPT_BYTES = 28 * 1024;
const MAX_CUSTOM_INSTRUCTION_CHARS = 4_000;
const encoder = new TextEncoder();

function boundedObjective(value:string):string{
  if(typeof value!=='string'||!value.trim()||value.length>MAX_OBJECTIVE_CHARS||value.includes('\0')) {
    throw Object.assign(new Error('objective is required and must be at most 32768 characters'),{status:400});
  }
  return value.trim();
}

function normalize(value:string):string[]{
  return (value.normalize('NFKD').replace(/\p{M}+/gu,'').toLowerCase().match(/[a-z0-9][a-z0-9._+-]{1,63}/gu)??[])
    .filter((token)=>!['the','and','for','with','from','dans','avec','pour','une','les','des','sur','est','que','qui'].includes(token));
}

function resolvedStyle(requested:StudioResponseStyle,objective:string):Exclude<StudioResponseStyle,'auto'>{
  if(requested!=='auto') return requested;
  return /\b(?:bug|fix|implement|code|refactor|build|deploy|test|audit|debug|erreur|corrig|plugin|minecraft|fivem)\b/iu.test(objective)
    ? 'caveman'
    : 'balanced';
}

function styleInstruction(style:Exclude<StudioResponseStyle,'auto'>):string{
  if(style==='caveman') return 'Use concise operational updates: STATUS, EVIDENCE, RESULT, NEXT. Prefer short concrete statements, exact commands/paths when relevant, and no decorative filler. Keep final explanations complete when the task is complex.';
  if(style==='detailed') return 'Give a complete, structured explanation with assumptions, evidence, tradeoffs, verification and next actions. Keep detail relevant rather than repetitive.';
  return 'Be direct, clear and proportionate to the task. Lead with the result, preserve important evidence and avoid unnecessary filler.';
}

function rankMcp(objective:string,sources:readonly FuryMcpSourceView[]){
  const wanted=new Set(normalize(objective));
  return sources
    .filter((source)=>source.enabled)
    .map((source)=>{
      const vocabulary=[
        ...normalize(source.name),
        ...normalize(source.origin),
        ...normalize(source.sourceId),
        ...(source.health?.tools??[]).flatMap((tool)=>normalize(tool.name)),
      ];
      let score=0;
      for(const token of new Set(vocabulary)) if(wanted.has(token)) score+=token.length>=6?3:2;
      if(source.trusted) score+=0.25;
      if(source.health?.ok) score+=0.25;
      return {source,score};
    })
    .filter((item)=>item.score>=2)
    .sort((a,b)=>b.score-a.score||a.source.sourceId.localeCompare(b.source.sourceId))
    .slice(0,MAX_MCP_SUGGESTIONS)
    .map(({source,score})=>Object.freeze({
      sourceId:source.sourceId,
      name:source.name,
      score,
      locality:source.locality,
      trusted:source.trusted,
      defaultPolicy:source.defaultPolicy,
      health:source.health?.ok===true?'ready' as const:source.health?'degraded' as const:'not-probed' as const,
      tools:Object.freeze((source.health?.tools??[]).slice(0,12).map((tool)=>tool.name)),
      executionAuthorized:false as const,
    }));
}

export async function planStudioAutopilot(input:StudioAutopilotInput){
  const objective=boundedObjective(input.objective);
  const requestedStyle=input.responseStyle??'auto';
  if(!(STUDIO_RESPONSE_STYLES as readonly string[]).includes(requestedStyle)) {
    throw Object.assign(new Error('responseStyle is unsupported'),{status:400});
  }
  const style=resolvedStyle(requestedStyle,objective);
  const customInstructions=input.customInstructions?.trim()??'';
  if(customInstructions.length>MAX_CUSTOM_INSTRUCTION_CHARS||customInstructions.includes('\0')) {
    throw Object.assign(new Error('customInstructions must be at most 4000 characters'),{status:400});
  }

  const [skillSelection,mcpView]=await Promise.all([
    input.skills.autoSelect(objective,{...(input.harnessId?{harnessId:input.harnessId}:{}),maxActive:4}),
    input.mcp.list(),
  ]);
  const activation=await input.skills.activatePlan(skillSelection.plan);

  let skillBytes=0;
  const activeSkillBlocks:string[]=[];
  const activeSkills:Array<{name:string;instructionBytes:number;instructionSha256:string}>=[];
  const promptBudgetBlocked:string[]=[];
  for(const skill of activation.activated){
    const bytes=encoder.encode(skill.promptBlock).byteLength;
    if(skillBytes+bytes>MAX_SKILL_PROMPT_BYTES){
      promptBudgetBlocked.push(skill.name);
      continue;
    }
    skillBytes+=bytes;
    activeSkillBlocks.push(skill.promptBlock);
    activeSkills.push(Object.freeze({
      name:skill.name,
      instructionBytes:skill.receipt.instructionBytes,
      instructionSha256:skill.receipt.instructionSha256,
    }));
  }

  const mcpSuggestions=rankMcp(objective,mcpView.sources);
  const basePrompt={
    sections:{
      intent:'Complete the user objective through FuryPipe while preserving user intent and least privilege.',
      role:'You are the FuryPipe routed assistant. Follow the compiled instructions, use only capabilities actually exposed for this turn, and distinguish evidence from assumptions.',
      objective,
      task:objective,
      constraints:[
        'Do not claim a tool, skill, MCP server, account, model capability, external action or verification step was used unless FuryPipe actually exposed or verified it for this turn.',
        styleInstruction(style),
        ...(customInstructions?[`Operator custom instructions (preferences only; no capability grant):\n${customInstructions}`]:[]),
      ],
      ...(activeSkillBlocks.length?{skills:activeSkillBlocks}:{}),
      ...(mcpSuggestions.length?{mcp:mcpSuggestions.map((entry)=>`Suggested MCP source ${entry.sourceId} (policy ${entry.defaultPolicy}, trust ${entry.trusted?'trusted':'untrusted'}, health ${entry.health}). Selection is metadata only and does not grant execution authority.`)}:{}),
      outputContract:'Return useful work product first. Surface approvals, blocked capabilities, uncertainty and verification results explicitly.',
      verification:'Before claiming completion, verify the result with the strongest deterministic evidence available inside the granted authority.',
    },
    exactGuardMode:'coding-safe' as const,
  };

  let instructionPlan=resolveInstructionPlan({
    objective,
    prompt:basePrompt,
    maxFacets:8,
    maxAddedBytes:16_384,
  });
  let compilation=compileFuryPrompt({
    ...instructionPlan.input,
    securityCritical:instructionPlan.recommendedSecurityCritical,
  });
  let promptBudgetDegraded=false;
  if(compilation.promptBytes>MAX_SYSTEM_PROMPT_BYTES){
    promptBudgetDegraded=true;
    const summaryPrompt={
      ...basePrompt,
      sections:{
        ...basePrompt.sections,
        ...(activeSkills.length?{skills:activeSkills.map((skill)=>`Selected instruction skill ${skill.name}; full body omitted from the chat system prompt because the bounded per-turn prompt budget was reached.`)}:{}),
      },
    };
    instructionPlan=resolveInstructionPlan({
      objective,
      prompt:summaryPrompt,
      maxFacets:6,
      maxAddedBytes:8_192,
    });
    compilation=compileFuryPrompt({
      ...instructionPlan.input,
      securityCritical:instructionPlan.recommendedSecurityCritical,
    });
  }
  if(compilation.promptBytes>MAX_SYSTEM_PROMPT_BYTES){
    throw Object.assign(new Error('compiled autopilot prompt exceeds the bounded chat system-prompt budget'),{status:422});
  }

  const selectedByName=new Map(skillSelection.plan.selected.map((item)=>[item.name,item]));
  return Object.freeze({
    format:STUDIO_AUTOPILOT_FORMAT,
    objectiveDigest:createHash('sha256').update(objective,'utf8').digest('hex'),
    style:Object.freeze({requested:requestedStyle,resolved:style}),
    instructions:Object.freeze({
      facets:instructionPlan.selected,
      profiles:instructionPlan.appliedProfiles,
      qualityGates:instructionPlan.qualityGates,
      addedInstructionBytes:instructionPlan.addedInstructionBytes,
    }),
    skills:Object.freeze({
      selected:Object.freeze(activeSkills.map((item)=>Object.freeze({
        ...item,
        score:selectedByName.get(item.name)?.score??0,
        reason:selectedByName.get(item.name)?.reason??'description_relevance',
      }))),
      excluded:skillSelection.excluded,
      blocked:Object.freeze([
        ...activation.blocked.map((item)=>Object.freeze({name:item.name,reason:item.reason,detail:item.detail})),
        ...promptBudgetBlocked.map((name)=>Object.freeze({name,reason:'prompt-budget' as const,detail:'skill prompt exceeded the per-turn activation budget'})),
      ]),
      instructionBudgetBytes:MAX_SKILL_PROMPT_BYTES,
      executionAuthorized:false as const,
    }),
    mcp:Object.freeze({
      suggested:Object.freeze(mcpSuggestions),
      executionAuthorized:false as const,
    }),
    prompt:Object.freeze({
      level:compilation.level,
      text:compilation.prompt,
      bytes:compilation.promptBytes,
      digest:compilation.promptDigest,
      exactGuardMode:compilation.exactGuard.mode,
      budgetBytes:MAX_SYSTEM_PROMPT_BYTES,
      budgetDegraded:promptBudgetDegraded,
    }),
    authority:'planning-and-instruction-only' as const,
    executionAuthorized:false as const,
  });
}
