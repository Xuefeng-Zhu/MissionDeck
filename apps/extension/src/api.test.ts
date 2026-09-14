// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {api,readSession,SESSION_INVALID_EVENT,writeSession} from './api';

describe('session response ordering',()=>{
  beforeEach(async()=>{sessionStorage.clear();await writeSession('revoked-token');});
  afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

  it('does not erase a replacement session when an old request returns 401 late',async()=>{
    let answer!:(response:Response)=>void;
    vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{answer=resolve;})));
    const invalid=vi.fn();window.addEventListener(SESSION_INVALID_EVENT,invalid);
    const pending=api('/api/missions');
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());
    await writeSession('replacement-token');
    answer(new Response(JSON.stringify({error:'The old session was revoked.'}),{status:401,headers:{'Content-Type':'application/json'}}));
    await expect(pending).rejects.toMatchObject({status:401,sessionInvalidated:false,sessionSuperseded:true});
    expect(await readSession()).toBe('replacement-token');expect(invalid).not.toHaveBeenCalled();
    window.removeEventListener(SESSION_INVALID_EVENT,invalid);
  });

  it('invalidates local UI when another view already cleared the requested session',async()=>{
    let answer!:(response:Response)=>void;
    vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{answer=resolve;})));
    const invalid=vi.fn();window.addEventListener(SESSION_INVALID_EVENT,invalid);
    const pending=api('/api/missions');await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());
    await writeSession(null);
    answer(new Response(JSON.stringify({error:'The shared session was revoked.'}),{status:401,headers:{'Content-Type':'application/json'}}));
    await expect(pending).rejects.toMatchObject({status:401,sessionInvalidated:true,sessionSuperseded:false});
    expect(await readSession()).toBeNull();expect(invalid).toHaveBeenCalledOnce();
    window.removeEventListener(SESSION_INVALID_EVENT,invalid);
  });
});
