import type { BrowserActionRequest, BrowserActionResult, BrowserPage, BrowserRuntime, BrowserSession, BrowserWaitCondition } from '../browser-runtime.js';

export const STUDIO_BROWSER_CONTROLLER_FORMAT='furypipe-studio-browser-controller/v1' as const;
const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SCREENSHOT_LIMIT=4*1024*1024;
export class StudioBrowserControllerError extends Error{
  override readonly name='StudioBrowserControllerError';
  constructor(readonly status:number,message:string){super(message);}
}
export type StudioBrowserActionInput=
 | {action:'navigate';url:unknown}
 | {action:'click';selector:unknown}
 | {action:'fill'|'select';selector:unknown;value:unknown}
 | {action:'keyboard';key:unknown}
 | {action:'submit';formScope:unknown}
 | {action:'download';url?:unknown}
 | {action:'screenshot'|'extract_text'|'accessibility_snapshot'|'inspect_url'}
 | {action:'wait';condition:unknown};
function id(value:unknown,label:string):string{
  if(typeof value!=='string'||!SAFE_ID.test(value)) throw new StudioBrowserControllerError(400,label+' is invalid');
  return value;
}
function text(value:unknown,label:string,max=16384):string{
  if(typeof value!=='string'||!value.length||value.length>max||value.includes('\0')) throw new StudioBrowserControllerError(400,label+' is invalid');
  return value;
}
function request(session:BrowserSession,page:BrowserPage,input:StudioBrowserActionInput):BrowserActionRequest{
  switch(input.action){
    case'navigate':return{action:'navigate',session,page,url:text(input.url,'browser URL',8192)};
    case'click':return{action:'click',session,page,selector:text(input.selector,'browser selector',4096)};
    case'fill':return{action:'fill',session,page,selector:text(input.selector,'browser selector',4096),value:text(input.value,'browser value',1024*1024)};
    case'select':return{action:'select',session,page,selector:text(input.selector,'browser selector',4096),value:text(input.value,'browser value',1024*1024)};
    case'keyboard':return{action:'keyboard',session,page,key:text(input.key,'browser key',256)};
    case'submit':return{action:'submit',session,page,formScope:text(input.formScope,'browser form scope',4096)};
    case'download':return{action:'download',session,page,...(input.url===undefined?{}:{url:text(input.url,'download URL',8192)})};
    case'screenshot':case'extract_text':case'accessibility_snapshot':case'inspect_url':return{action:input.action,session,page};
    case'wait':{
      const allowed:readonly BrowserWaitCondition[]=['dom-content-loaded','load','network-idle','next-navigation'];
      if(typeof input.condition!=='string'||!(allowed as readonly string[]).includes(input.condition)) throw new StudioBrowserControllerError(400,'browser wait condition is invalid');
      return{action:'wait',session,page,condition:input.condition as BrowserWaitCondition};
    }
  }
}
export function createStudioBrowserController(runtime?:BrowserRuntime){
  const sessions=new Map<string,{session:BrowserSession;pages:Map<string,BrowserPage>}>();
  const required=()=>{if(!runtime)throw new StudioBrowserControllerError(409,'managed browser runtime is not configured');return runtime;};
  const record=(sessionId:unknown)=>{const key=id(sessionId,'browser session id'),value=sessions.get(key);if(!value)throw new StudioBrowserControllerError(404,'browser session not found');return value;};
  const page=(rec:{pages:Map<string,BrowserPage>},pageId:unknown)=>{const key=id(pageId,'browser page id'),value=rec.pages.get(key);if(!value)throw new StudioBrowserControllerError(404,'browser page not found');return value;};
  return Object.freeze({
    status(){
      const items=[...sessions.values()].map(rec=>Object.freeze({session:runtime?runtime.inspectSession(rec.session):rec.session,pages:Object.freeze([...rec.pages.values()].map(p=>runtime?runtime.inspectPage(rec.session,p):p))})).sort((a,b)=>a.session.sessionId.localeCompare(b.session.sessionId));
      return Object.freeze({format:STUDIO_BROWSER_CONTROLLER_FORMAT,available:runtime!==undefined,sessions:Object.freeze(items),requiresOperatorConfirmation:true as const,permitExposure:false as const,executionAuthority:false as const});
    },
    async createSession(principalId:unknown){
      const managed=required(),created=await managed.createSession(id(principalId,'browser principal id'));
      sessions.set(created.sessionId,{session:created,pages:new Map()});
      return managed.inspectSession(created);
    },
    async closeSession(sessionId:unknown){const managed=required(),rec=record(sessionId);await managed.closeSession(rec.session);sessions.delete(rec.session.sessionId);},
    async createPage(sessionId:unknown){
      const managed=required(),rec=record(sessionId),created=await managed.createPage(rec.session);
      rec.pages.set(created.pageId,created);rec.session=managed.inspectSession(rec.session);return managed.inspectPage(rec.session,created);
    },
    async closePage(sessionId:unknown,pageId:unknown){
      const managed=required(),rec=record(sessionId),p=page(rec,pageId);await managed.closePage(rec.session,p);rec.pages.delete(p.pageId);rec.session=managed.inspectSession(rec.session);
    },
    async action(sessionId:unknown,pageId:unknown,input:StudioBrowserActionInput){
      const managed=required(),rec=record(sessionId),p=page(rec,pageId),permit=await managed.authorize(request(rec.session,p,input));
      const result:BrowserActionResult=await managed.invoke(permit);
      rec.session=managed.inspectSession(rec.session);rec.pages.set(p.pageId,managed.inspectPage(rec.session,p));
      const artifact=result.artifact?Object.freeze({sha256:result.artifact.sha256,bytes:result.artifact.bytes.byteLength,...(result.artifact.bytes.byteLength<=SCREENSHOT_LIMIT?{dataUrl:'data:image/png;base64,'+Buffer.from(result.artifact.bytes).toString('base64')}:{})}):undefined;
      return Object.freeze({receipt:result.receipt,...(result.observation?{observation:result.observation}:{}),...(result.download?{download:result.download}:{}),...(artifact?{artifact}:{}),permitExposed:false as const,executionAuthority:false as const});
    },
  });
}
