import { describe, expect, it } from 'vitest';
import { launchFuryAccountLogin } from '../src/fury-account-connect.js';
import type { FuryHarnessDiscovery } from '../src/fury-harness-hub.js';

const discovery:FuryHarnessDiscovery={
  format:'furypipe-harness-discovery/v1',platform:'win32',
  harnesses:[
    {id:'claude-code',displayName:'Claude Code',installed:true,executable:'C:\\Tools\\claude.exe',versionStatus:'ok',authentication:'not-probed',definition:{id:'claude-code',displayName:'Claude Code',executables:['claude'],versionArgs:['--version'],integrations:['structured-cli'],protocols:['mcp'],skillsDirectories:[],localModel:{mechanism:'none',note:'x'},capabilities:{streaming:true,resume:true,subagents:true},evidence:'BUILTIN'}},
    {id:'codex',displayName:'Codex CLI',installed:true,executable:'C:\\Tools\\codex.exe',versionStatus:'ok',authentication:'not-probed',definition:{id:'codex',displayName:'Codex CLI',executables:['codex'],versionArgs:['--version'],integrations:['structured-cli'],protocols:['mcp'],skillsDirectories:[],localModel:{mechanism:'none',note:'x'},capabilities:{streaming:true,resume:true,subagents:true},evidence:'BUILTIN'}},
  ],
};

describe('AI account login launcher',()=>{
  it('launches the fixed Claude auth command only after selecting the known provider',()=>{
    const calls:Array<{file:string;args:readonly string[]}>= [];
    const result=launchFuryAccountLogin('anthropic',discovery,{platform:'win32',env:{PATH:'C:\\Tools',SystemRoot:'C:\\Windows'},launcher:(file,args)=>calls.push({file,args})});
    expect(result.status).toBe('launched');
    expect(calls).toEqual([{file:'C:\\Tools\\claude.exe',args:['auth','login']}]);
  });
  it('launches Codex login for the OpenAI connection',()=>{
    const calls:string[][]=[];
    launchFuryAccountLogin('openai',discovery,{platform:'win32',launcher:(file,args)=>calls.push([file,...args])});
    expect(calls[0]).toEqual(['C:\\Tools\\codex.exe','login']);
  });
  it('does not claim login when the runtime is missing',()=>{
    const result=launchFuryAccountLogin('google',discovery,{platform:'win32',launcher:()=>{throw new Error('must not run');}});
    expect(result.status).toBe('runtime-missing');
  });
  it('does not launch on unsupported platforms',()=>{
    let called=false;
    const result=launchFuryAccountLogin('anthropic',discovery,{platform:'linux',launcher:()=>{called=true;}});
    expect(result.status).toBe('unsupported');
    expect(called).toBe(false);
  });
});
