import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {Server} from 'node:http';
import {openDatabase,type Database} from './database.js';
import {MissionService} from './service.js';
import {FixtureWorkProvider,MemoryFixtureRepository,ProviderError} from './providers/index.js';
import {createApp} from './app.js';

describe('paired local API boundaries',()=>{
  let db:Database;let service:MissionService;let server:Server;let base:string;let token:string;
  const origin='http://127.0.0.1:5173';const code='test-pairing-code-with-enough-entropy';
  const request=(path:string,body?:unknown,options:{method?:string;token?:string;origin?:string}={})=>fetch(base+path,{method:options.method??(body?'POST':'GET'),headers:{'Content-Type':'application/json',Origin:options.origin??origin,...((options.token??token)?{Authorization:`Bearer ${options.token??token}`}:{})},body:body?JSON.stringify(body):undefined});
  beforeAll(async()=>{db=await openDatabase({memory:true});service=new MissionService(db,new FixtureWorkProvider(new MemoryFixtureRepository()));const app=await createApp(service,{pairingCode:code,enableCopilot:false});await new Promise<void>((resolve,reject)=>{server=app.listen(0,'127.0.0.1',error=>error?reject(error):resolve());});base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;token=(await (await request('/api/pair',{code})).json()).token;});
  afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await db.close();});
  it('rejects anonymous API access and wrong pairing code',async()=>{
    const response=await fetch(base+'/api/missions',{headers:{Origin:origin}});expect(response.status).toBe(401);
    expect((await request('/api/pair',{code:'wrong'})).status).toBe(401);
  });
  it('rejects arbitrary origins and binds issued credentials to their origin',async()=>{
    expect((await request('/api/missions',undefined,{origin:'https://untrusted.example'})).status).toBe(403);
    expect((await request('/api/missions',undefined,{origin:'http://localhost:5173'})).status).toBe(401);
  });
  it('pairs an exact extension origin only with the pairing credential',async()=>{
    const extension='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect((await request('/api/config',undefined,{origin:extension})).status).toBe(200);
    expect((await request('/api/missions',undefined,{origin:extension})).status).toBe(403);
    const paired=await request('/api/pair',{code},{origin:extension});expect(paired.status).toBe(200);
    const extensionToken=(await paired.json()).token;expect((await request('/api/missions',undefined,{token:extensionToken,origin:extension})).status).toBe(200);
  });
  it('persists a confirmed mission, edits a proposal, and rejects the old approval',async()=>{
    const created=await request('/api/missions',{goal:'A working verified demo',deadline:new Date(Date.now()+86400000).toISOString(),timezone:'America/Los_Angeles',criteria:[{title:'Working build',required:true,verificationMethod:'Human checks test output'}],confirmed:true});expect(created.status).toBe(200);const m=(await created.json()).mission;
    const generated=await request(`/api/missions/${m.id}/plan`,{});expect(generated.status).toBe(200);const plan=await generated.json();
    const old=plan.proposal;const operations=structuredClone(old.operations);operations[0].task.remainingMinutes=120;
    const edited=await request(`/api/missions/${m.id}/proposals/${old.id}`,{operations},{method:'PATCH'});expect(edited.status).toBe(200);const updated=await edited.json();
    expect((await request(`/api/missions/${m.id}/proposals/${old.id}/approve`,{payloadHash:old.payloadHash})).status).toBe(409);
    const approved=await request(`/api/missions/${m.id}/proposals/${updated.proposal.id}/approve`,{payloadHash:updated.proposal.payloadHash});expect(approved.status).toBe(200);
    const state=(await approved.json()).mission;expect(state.tasks.every((t:{provider:{state:string}})=>t.provider.state==='synced')).toBe(true);
    expect((await request(`/api/missions/${m.id}/complete`,{})).status).toBe(422);
    expect((await request(`/api/missions/${m.id}/criteria/${state.criteria[0].id}/verify`,{attestation:'I reviewed the test fixture outputs for this automated API test.'})).status).toBe(200);
    expect((await request(`/api/missions/${m.id}/complete`,{})).status).toBe(200);
    expect((await request(`/api/missions/${m.id}`)).status).toBe(200);
  });
  it('rejects forged provider mappings and self-attestation in proposals',async()=>{
    const m=(await (await request('/api/missions/demo',{})).json()).mission;
    await request(`/api/missions/${m.id}/contract`,{goal:m.goal,deadline:m.deadline,timezone:m.timezone,criteria:m.criteria,confirmed:true});
    const {proposal}=await (await request(`/api/missions/${m.id}/plan`,{})).json();
    proposal.operations[0].task.provider={id:'forged',state:'synced'};
    const edit=await request(`/api/missions/${m.id}/proposals/${proposal.id}`,{operations:proposal.operations},{method:'PATCH'});
    const p=(await edit.json()).proposal;expect((await request(`/api/missions/${m.id}/proposals/${p.id}/approve`,{payloadHash:p.payloadHash})).status).toBe(422);
  });
  it('requires reopening before retrying previously approved failed provider work',async()=>{
    const prepared=await request('/api/integrations/smoke',{});
    expect(prepared.status).toBe(200);
    const {mission,proposal}=await prepared.json();
    const originalCreate=service.provider.createTask.bind(service.provider);
    service.provider.createTask=async()=>{throw new ProviderError('failed','fixture_rejected','The fixture rejected this create before writing.');};
    let failed;
    try {
      const approved=await request(`/api/missions/${mission.id}/proposals/${proposal.id}/approve`,{payloadHash:proposal.payloadHash});
      expect(approved.status).toBe(200);
      failed=(await approved.json()).mission;
    } finally {service.provider.createTask=originalCreate;}
    expect(failed.operations[0].state).toBe('failed');
    await request(`/api/missions/${mission.id}/criteria/${mission.criteria[0].id}/verify`,{attestation:'I independently reviewed and accept the fixture result.'});
    expect((await request(`/api/missions/${mission.id}/complete`,{})).status).toBe(200);
    const retry=await request(`/api/missions/${mission.id}/operations/${failed.operations[0].id}/retry`,{});
    expect(retry.status).toBe(409);
    expect((await retry.json()).code).toBe('mission_closed');
    const closed=(await (await request(`/api/missions/${mission.id}`)).json()).mission;
    expect(closed.operations[0]).toMatchObject({state:'failed',attempts:failed.operations[0].attempts});
    expect(closed.tasks[0].provider.state).toBe('failed');
    expect((await request(`/api/missions/${mission.id}/reopen`,{})).status).toBe(200);
    const reopened=await request(`/api/missions/${mission.id}/operations/${failed.operations[0].id}/retry`,{});
    expect(reopened.status).toBe(200);
    expect((await reopened.json()).mission.operations[0].state).toBe('synced');
  });
  it('does not expose secrets or enable research in public configuration',async()=>{
    const response=await request('/api/config');const text=await response.text();expect(text).not.toContain(code);expect(text).not.toContain(token);expect(JSON.parse(text).researchEnabled).toBe(false);
  });
  it('revokes a session server-side',async()=>{
    const paired=await request('/api/pair',{code});const temporary=(await paired.json()).token;
    expect((await request('/api/session/revoke',{}, {token:temporary})).status).toBe(200);
    expect((await request('/api/missions',undefined,{token:temporary})).status).toBe(401);
  });
});
