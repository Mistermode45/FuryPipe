import { describe, expect, it } from 'vitest';
import { probeFuryAccountStatuses } from '../src/fury-account-status.js';
import type { FuryHarnessDiscovery } from '../src/fury-harness-hub.js';

const discovery: FuryHarnessDiscovery = {
  format:'furypipe-harness-discovery/v1',
  platform:'win32',
  harnesses:[
    {id:'claude-code',displayName:'Claude Code',installed:true,executable:'C:\\Tools\\claude.exe',versionStatus:'ok',authentication:'not-probed',definition:{id:'claude-code',displayName:'Claude Code',executables:['claude'],versionArgs:['--version'],integrations:['structured-cli'],protocols:['mcp'],skillsDirectories:[],localModel:{mechanism:'none',note:'x'},capabilities:{streaming:true,resume:true,subagents:true},evidence:'BUILTIN'}},
    {id:'codex',displayName:'Codex CLI',installed:true,executable:'C:\\Tools\\codex.exe',versionStatus:'ok',authentication:'not-probed',definition:{id:'codex',displayName:'Codex CLI',executables:['codex'],versionArgs:['--version'],integrations:['structured-cli'],protocols:['mcp'],skillsDirectories:[],localModel:{mechanism:'none',note:'x'},capabilities:{streaming:true,resume:true,subagents:true},evidence:'BUILTIN'}},
  ],
};

describe('official account status probes',()=>{
  it('detects Claude subscription auth and ChatGPT-backed Codex auth',async()=>{
    const status=await probeFuryAccountStatuses(discovery,{
      platform:'win32',
      runner:async(_file,args)=>args[0]==='auth'
        ? {exitCode:0,stdout:'{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max","accessToken":"never-return"}',stderr:''}
        : {exitCode:0,stdout:'',stderr:'Logged in using ChatGPT'},
    });
    expect(status.anthropic).toMatchObject({state:'authenticated',method:'claude.ai',subscription:'max'});
    expect(status.openai).toMatchObject({state:'authenticated',method:'ChatGPT'});
    expect(JSON.stringify(status)).not.toContain('never-return');
  });

  it('detects logged-out CLI state without reading credential storage',async()=>{
    const status=await probeFuryAccountStatuses(discovery,{
      platform:'win32',
      runner:async(_file,args)=>args[0]==='auth'
        ? {exitCode:1,stdout:'{"loggedIn":false}',stderr:''}
        : {exitCode:1,stdout:'',stderr:'Not logged in'},
    });
    expect(status.anthropic.state).toBe('not-authenticated');
    expect(status.openai.state).toBe('not-authenticated');
    expect(status.google.state).toBe('not-probed');
  });
});
