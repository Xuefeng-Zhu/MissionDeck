// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';

describe('Chrome session invalidation ordering',()=>{
  afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();});

  it('keeps a replacement token when old-token invalidation commits afterward',async()=>{
    const state:Record<string,unknown>={};let releaseInvalid!:()=>void;let invalidStarted!:()=>void;
    const started=new Promise<void>(resolve=>{invalidStarted=resolve;});const released=new Promise<void>(resolve=>{releaseInvalid=resolve;});
    const session={
      get:vi.fn(async(keys:string|string[])=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in state).map(key=>[key,state[key]]))),
      set:vi.fn(async(values:Record<string,unknown>)=>{if(Object.keys(values).some(key=>key.startsWith('mission-control.invalid-session:'))){invalidStarted();await released;}Object.assign(state,values);}),
      remove:vi.fn(async(keys:string|string[])=>{for(const key of Array.isArray(keys)?keys:[keys])delete state[key];}),
    };
    vi.stubGlobal('chrome',{runtime:{id:'abcdefghijklmnopabcdefghijklmnop'},storage:{session}});
    let answer!:(response:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{answer=resolve;})));
    const module=await import('./api');await module.writeSession('revoked-token');
    const invalid=vi.fn();window.addEventListener(module.SESSION_INVALID_EVENT,invalid);
    const pending=module.api('/api/missions');await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());
    answer(new Response(JSON.stringify({error:'The old session was revoked.'}),{status:401,headers:{'Content-Type':'application/json'}}));
    await started;await module.writeSession('replacement-token');releaseInvalid();
    await expect(pending).rejects.toMatchObject({status:401,sessionInvalidated:false,sessionSuperseded:true});
    expect(await module.readSession()).toBe('replacement-token');
    expect(state['mission-control.session']).toBe('replacement-token');expect(state['mission-control.invalid-session:revoked-token']).toBe(true);expect(invalid).not.toHaveBeenCalled();
    window.removeEventListener(module.SESSION_INVALID_EVENT,invalid);
  });
});
