import { describe,expect,it } from 'vitest';
import type { BrowserActionPermit,BrowserActionRequest,BrowserActionResult,BrowserPage,BrowserRuntime,BrowserSession } from '../src/browser-runtime.js';
import { createStudioBrowserController } from '../src/studio/studio-browser-controller.js';
function fake():BrowserRuntime{
  let session:BrowserSession|undefined,page:BrowserPage|undefined,last:BrowserActionRequest|undefined;
  return{
    format:'furypipe-browser-runtime/v1',
    async createSession(){session=Object.freeze({format:'furypipe-browser-session/v1',sessionId:'session-1',principalIdSha256:'a'.repeat(64),createdAt:1,status:'active',pageCount:0,executionAuthority:false});return session;},
    async closeSession(){if(!session)throw new Error('missing');session=Object.freeze({...session,status:'closed'});},
    async createPage(s){page=Object.freeze({format:'furypipe-browser-page/v1',pageId:'page-1',sessionId:s.sessionId,status:'open',currentUrl:'',historyLength:0,executionAuthority:false});session=Object.freeze({...s,pageCount:1});return page;},
    async closePage(){if(!page)throw new Error('missing');page=Object.freeze({...page,status:'closed'});if(session)session=Object.freeze({...session,pageCount:0});},
    inspectSession(){if(!session)throw new Error('missing');return session;},inspectPage(){if(!page)throw new Error('missing');return page;},
    async authorize(r){last=r;return Object.freeze({format:'furypipe-browser-action-permit/v1',permitId:'permit-process-local',sessionIdSha256:'b'.repeat(64),principalIdSha256:'a'.repeat(64),pageIdSha256:'c'.repeat(64),action:r.action,targetSha256:'d'.repeat(64),policySha256:'e'.repeat(64),issuedAt:1,expiresAt:2,executionAuthority:false}) as BrowserActionPermit;},
    async invoke(permit){if(!last)throw new Error('missing');if(last.action==='navigate'&&page)page=Object.freeze({...page,currentUrl:last.url,historyLength:1});return Object.freeze({receipt:Object.freeze({format:'furypipe-browser-action-receipt/v1',receiptId:'receipt-1',permitIdSha256:'f'.repeat(64),sessionIdSha256:'b'.repeat(64),principalIdSha256:'a'.repeat(64),action:permit.action,targetSha256:permit.targetSha256,policySha256:permit.policySha256,startedAt:1,finishedAt:2,outcome:'succeeded',verificationStatus:'locally-verified',executionAuthority:false})}) as BrowserActionResult;}
  };
}
describe('Studio browser controller',()=>{
  it('is disabled unless BrowserRuntime is injected',async()=>{const c=createStudioBrowserController();expect(c.status()).toMatchObject({available:false,permitExposure:false});await expect(c.createSession('studio-user')).rejects.toThrow(/not configured/u);});
  it('keeps permits server-side',async()=>{const c=createStudioBrowserController(fake());const s=await c.createSession('studio-user'),p=await c.createPage(s.sessionId);const r=await c.action(s.sessionId,p.pageId,{action:'navigate',url:'https://example.com/'});expect(r).toMatchObject({permitExposed:false,receipt:{outcome:'succeeded'}});expect(JSON.stringify(r)).not.toContain('permit-process-local');expect(c.status().sessions[0]?.pages[0]?.currentUrl).toBe('https://example.com/');});
  it('rejects unsafe inputs',async()=>{const c=createStudioBrowserController(fake());const s=await c.createSession('studio-user'),p=await c.createPage(s.sessionId);await expect(c.action(s.sessionId,p.pageId,{action:'click',selector:''})).rejects.toThrow(/selector/u);});
});
