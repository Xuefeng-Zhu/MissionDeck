import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import {ADAPTIVE_SAMPLE_SOURCES,type MissionExecution} from '@mission/domain';
import {openDatabase,type Database} from './database.js';
import {MissionService} from './service.js';
import {FixtureWorkProvider,MemoryFixtureRepository} from './providers/index.js';
import {createApp} from './app.js';
import {assertRuntimeConfig,config} from './config.js';
import {digest,issueDemoSession} from './auth.js';
import {consumePublicDemoModelCall} from './demo-budget.js';
import {ExecutionService} from './execution-service.js';
import {FixtureExecutionProvider} from './execution-provider.js';
import {UpgradeStore} from './upgrade-store.js';
import type {ExecutionRunner} from './execution-runner.js';
import {maintainHostedDemoData,purgeExpiredDemoData} from './demo-cleanup.js';

vi.hoisted(()=>{process.env.MODEL_MODE='fixture';process.env.PROVIDER_MODE='fixture';});

describe('hosted runtime configuration',()=>{
  it('rejects ephemeral databases and anonymous external workspace writes',()=>{
    expect(()=>assertRuntimeConfig({...config,DEPLOYMENT_MODE:'hosted',host:'0.0.0.0',DATABASE_MODE:'pglite'})).toThrow(/requires DATABASE_MODE=postgres/);
    expect(()=>assertRuntimeConfig({...config,DEPLOYMENT_MODE:'hosted',host:'0.0.0.0',DATABASE_MODE:'postgres',PUBLIC_DEMO_ENABLED:true,PROVIDER_MODE:'live'})).toThrow(/must use PROVIDER_MODE=fixture/);
  });
  it('keeps local mode on loopback',()=>{
    expect(()=>assertRuntimeConfig({...config,DEPLOYMENT_MODE:'local',host:'0.0.0.0'})).toThrow(/must bind to a loopback host/);
  });
});

describe('hosted web boundaries',()=>{
  let db:Database;let service:MissionService;let executionService:ExecutionService;let server:Server;let base:string;let origin:string;let demoToken:string;let secondDemoToken:string;
  const request=(path:string,body?:unknown,token?:string,requestOrigin=origin)=>fetch(base+path,{method:body?'POST':'GET',headers:{Origin:requestOrigin,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
  beforeAll(async()=>{
    db=await openDatabase({memory:true});
    service=new MissionService(db,new FixtureWorkProvider(new MemoryFixtureRepository()));
    const idleRunner=(mode:'fixture'|'live',engine:'direct'|'strands'):ExecutionRunner=>({mode,engine,setupRequired:[],...(engine==='strands'?{modelProvider:'controlled',modelName:'controlled'}:{}),plan:async()=>{throw new Error('The hosting boundary test does not run the worker.');},run:async()=>{throw new Error('The hosting boundary test does not run the worker.');}});
    const store=new UpgradeStore(db);executionService=new ExecutionService(db,scope=>new FixtureExecutionProvider(store,scope),idleRunner('fixture','direct'),undefined,idleRunner('live','strands'));
    vi.spyOn(executionService,'wake').mockImplementation(()=>{});
    const app=await createApp(service,{enableCopilot:false,serveWeb:false,executionService,runtime:{deploymentMode:'hosted',publicDemoEnabled:true,publicDemoMaxMissions:1,publicDemoMaxConcurrent:1,publicDemoSessionLimit:2}});
    await new Promise<void>((resolve,reject)=>{server=app.listen(0,'127.0.0.1',error=>error?reject(error):resolve());});
    base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;origin=base;
  });
  afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await db.close();});

  it('issues isolated same-origin demo sessions and rejects foreign origins',async()=>{
    const health=await fetch(base+'/health');expect(await health.json()).toMatchObject({status:'ok',database:'ready'});expect(health.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const privacy=await fetch(base+'/privacy');expect(privacy.status).toBe(200);expect(await privacy.text()).toContain('Hosted public-demo mode');
    const first=await request('/api/demo/session',{});expect(first.status).toBe(201);const firstToken=(await first.json()).token;demoToken=firstToken;
    const second=await request('/api/demo/session',{});expect(second.status).toBe(201);secondDemoToken=(await second.json()).token;
    expect((await request('/api/missions',undefined,firstToken)).status).toBe(200);
    expect((await request('/api/missions',undefined,firstToken,'https://untrusted.example')).status).toBe(403);
    const principals=await db.query<{owner_id:string;workspace_id:string}>('SELECT owner_id,workspace_id FROM sessions ORDER BY owner_id');
    expect(new Set(principals.rows.map(row=>row.owner_id)).size).toBe(2);
    expect(new Set(principals.rows.map(row=>row.workspace_id)).size).toBe(2);
    expect(principals.rows.every(row=>row.owner_id.startsWith('demo-user:')&&row.workspace_id.startsWith('demo-workspace:'))).toBe(true);
    expect(secondDemoToken).not.toBe(firstToken);
  });

  it('coalesces concurrent exact mission-start retries for an isolated demo scope',async()=>{
    const token=await issueDemoSession(db,origin);
    const input={requestId:randomUUID(),template:'adaptive_launch' as const,goal:'Review the fictional Harbor launch sources.',context:'',humanId:'fixture-human',agentId:'fixture-agent',maxTasks:3,maxAgentRuns:8,sources:structuredClone(ADAPTIVE_SAMPLE_SOURCES)};
    const responses=await Promise.all([request('/api/execution/missions',input,token),request('/api/execution/missions',input,token)]);
    expect(responses.map(response=>response.status)).toEqual([201,201]);
    const ids=await Promise.all(responses.map(async response=>(await response.json()).mission.id));expect(new Set(ids).size).toBe(1);
    expect((await request('/api/session/revoke',{},token)).status).toBe(200);
  });

  it('limits session issuance and mission starts for public demo principals',async()=>{
    expect((await request('/api/demo/session',{})).status).toBe(429);
    expect((await request('/api/missions/demo',{},demoToken)).status).toBe(403);
    expect((await request('/api/execution/missions',{requestId:'generic-demo'},demoToken)).status).toBe(403);
    expect((await request('/api/missions/not-a-mission/evidence',{content:'blocked'},demoToken)).status).toBe(403);
    expect((await request('/api/missions/not-a-mission/execution/control',{action:'pause'},demoToken)).status).toBe(403);
    const starts=Array.from({length:3},()=>({requestId:randomUUID(),template:'adaptive_launch' as const,goal:'Review the fictional Harbor launch sources.',context:'',humanId:'fixture-human',agentId:'fixture-agent',maxTasks:3,maxAgentRuns:8,sources:structuredClone(ADAPTIVE_SAMPLE_SOURCES)}));
    const startResults=await Promise.all(starts.map(async input=>({input,response:await request('/api/execution/missions',input,demoToken)})));
    expect(startResults.map(item=>item.response.status).sort()).toEqual([201,429,429]);
    const winner=startResults.find(item=>item.response.status===201)!;const replayInput=winner.input;const startedBody=await winner.response.json();
    const replayed=await request('/api/execution/missions',replayInput,demoToken);expect(replayed.status).toBe(201);expect((await replayed.json()).mission.id).toBe(startedBody.mission.id);
    const changedReplay=await request('/api/execution/missions',{...replayInput,goal:'A changed goal must not reuse the original request.'},demoToken);expect(changedReplay.status).toBe(409);
    const principal=(await db.query<{owner_id:string;workspace_id:string}>('SELECT owner_id,workspace_id FROM sessions WHERE token_hash=$1',[digest(demoToken)])).rows[0]!;
    const firstScope={ownerId:principal.owner_id,workspaceId:principal.workspace_id};
    const secondStart={...replayInput,requestId:randomUUID()};
    const atCapacity=await request('/api/execution/missions',secondStart,secondDemoToken);expect(atCapacity.status).toBe(503);expect((await atCapacity.json()).code).toBe('demo_capacity');
    const saved=(await db.query<{data:MissionExecution}>('SELECT data FROM upgrade_records WHERE id=$1',[`execution:${startedBody.mission.id}`])).rows[0]!.data;
    saved.status='running';saved.tasks=[{id:'human-review',title:'Choose the launch path',description:'Waiting for the mission owner.',completionCriteria:['Record one decision.'],assignee:saved.human,status:'waiting_human',dependsOn:[],version:1,providerId:'fixture-human-review',providerUrl:null,providerFingerprint:null,providerDescription:null,runId:null,runStartedAt:null,runFinishedAt:null,artifacts:[],lastError:null}];
    await db.query('UPDATE upgrade_records SET data=$2 WHERE id=$1',[`execution:${startedBody.mission.id}`,JSON.stringify(saved)]);
    const afterWorkSettles=await request('/api/execution/missions',secondStart,secondDemoToken);expect(afterWorkSettles.status).toBe(201);const secondBody=await afterWorkSettles.json();
    const sourceBody={requestId:randomUUID(),expectedRevision:saved.adaptive!.revision,sources:structuredClone(ADAPTIVE_SAMPLE_SOURCES).map((source,index)=>index?source:{...source,content:source.content+' First reviewed update.'})};
    const reentryAtCapacity=await request(`/api/missions/${startedBody.mission.id}/execution/sources`,sourceBody,demoToken);expect(reentryAtCapacity.status).toBe(503);expect((await reentryAtCapacity.json()).code).toBe('demo_capacity');
    const secondSaved=(await db.query<{data:MissionExecution}>('SELECT data FROM upgrade_records WHERE id=$1',[`execution:${secondBody.mission.id}`])).rows[0]!.data;
    secondSaved.status='running';secondSaved.tasks=[{id:'second-human-review',title:'Choose the launch path',description:'Waiting for the second mission owner.',completionCriteria:['Record one decision.'],assignee:secondSaved.human,status:'waiting_human',dependsOn:[],version:1,providerId:'fixture-second-human-review',providerUrl:null,providerFingerprint:null,providerDescription:null,runId:null,runStartedAt:null,runFinishedAt:null,artifacts:[],lastError:null}];
    await db.query('UPDATE upgrade_records SET data=$2 WHERE id=$1',[`execution:${secondBody.mission.id}`,JSON.stringify(secondSaved)]);
    const chainedSourceBody={...sourceBody,requestId:randomUUID(),expectedRevision:2,sources:sourceBody.sources.map((source,index)=>index?source:{...source,content:source.content+' Second reviewed update.'})};
    const chained=await Promise.allSettled([executionService.updateSources(startedBody.mission.id,firstScope,sourceBody),executionService.updateSources(startedBody.mission.id,firstScope,chainedSourceBody)]);
    expect(chained[0]?.status).toBe('fulfilled');expect(chained[1]?.status).toBe('rejected');if(chained[1]?.status==='rejected')expect(chained[1].reason).toMatchObject({status:429,code:'demo_quota'});
    const sourceReplay=await request(`/api/missions/${startedBody.mission.id}/execution/sources`,sourceBody,demoToken);expect(sourceReplay.status).toBe(200);
    const changedSourceReplay=await request(`/api/missions/${startedBody.mission.id}/execution/sources`,{...sourceBody,sources:sourceBody.sources.map((source,index)=>index?source:{...source,content:source.content+' Changed.'})},demoToken);expect(changedSourceReplay.status).toBe(409);
    const sourceLimit=await request(`/api/missions/${startedBody.mission.id}/execution/sources`,{...sourceBody,requestId:randomUUID(),expectedRevision:2},demoToken);
    expect(sourceLimit.status).toBe(429);expect((await sourceLimit.json()).code).toBe('demo_quota');
    const deleted=await fetch(`${base}/api/missions/${startedBody.mission.id}`,{method:'DELETE',headers:{Origin:origin,Authorization:`Bearer ${demoToken}`}});expect(deleted.status).toBe(403);
    expect(await db.get(startedBody.mission.id,firstScope)).not.toBeNull();
    expect((await db.query('SELECT period_start FROM public_demo_model_usage')).rows).toHaveLength(0);
    expect(await db.transaction(q=>consumePublicDemoModelCall(q,2))).toBe(1);
    expect(await db.transaction(q=>consumePublicDemoModelCall(q,2))).toBe(2);
    await expect(db.transaction(q=>consumePublicDemoModelCall(q,2))).rejects.toMatchObject({status:429,code:'demo_budget'});
    expect((await db.query<{model_calls:number}>('SELECT model_calls FROM public_demo_model_usage')).rows[0]?.model_calls).toBe(2);
    const limited=await request('/api/execution/missions',{...replayInput,requestId:randomUUID()},demoToken);
    expect(limited.status).toBe(429);
    expect((await limited.json()).code).toBe('demo_quota');
    const store=new UpgradeStore(db);await db.transaction(q=>store.save({id:'demo-orphan-record',kind:'demo_test',revision:1,data:{retained:false}},firstScope,q));
    expect((await request('/api/session/revoke',{},demoToken)).status).toBe(200);
    expect((await request('/api/missions',undefined,demoToken)).status).toBe(401);
    await expect(new FixtureExecutionProvider(store,firstScope).createDocument({title:'Late demo write',content:'Must not survive reset.'},'after-revoke-write')).rejects.toMatchObject({status:401});
    expect((await db.query('SELECT id FROM missions WHERE owner_id=$1',[principal.owner_id])).rows).toHaveLength(0);
    expect((await db.query('SELECT id FROM upgrade_records WHERE owner_id=$1 AND workspace_id=$2',[principal.owner_id,principal.workspace_id])).rows).toHaveLength(0);
  });

  it('does not resume anonymous work after its demo session expires',async()=>{
    const principal=(await db.query<{owner_id:string;workspace_id:string}>('SELECT owner_id,workspace_id FROM sessions WHERE token_hash=$1',[digest(secondDemoToken)])).rows[0]!;
    await db.transaction(q=>new UpgradeStore(db).save({id:'expired-demo-orphan',kind:'demo_test',revision:1,data:{retained:false}},{ownerId:principal.owner_id,workspaceId:principal.workspace_id},q));
    await db.query("UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",[digest(secondDemoToken)]);
    const tick=vi.spyOn(executionService,'tick');
    await executionService.pump();
    expect(tick).not.toHaveBeenCalled();
  });

  it('purges mission and standalone records after the anonymous scope expires',async()=>{
    const principal=(await db.query<{owner_id:string;workspace_id:string}>('SELECT owner_id,workspace_id FROM sessions WHERE token_hash=$1',[digest(secondDemoToken)])).rows[0]!;
    await db.transaction(purgeExpiredDemoData);
    expect((await db.query('SELECT token_hash FROM sessions WHERE owner_id=$1 AND workspace_id=$2',[principal.owner_id,principal.workspace_id])).rows).toHaveLength(0);
    expect((await db.query('SELECT id FROM missions WHERE owner_id=$1 AND workspace_id=$2',[principal.owner_id,principal.workspace_id])).rows).toHaveLength(0);
    expect((await db.query('SELECT id FROM upgrade_records WHERE owner_id=$1 AND workspace_id=$2',[principal.owner_id,principal.workspace_id])).rows).toHaveLength(0);
  });

  it('purges runnable anonymous work before recovery when public demo mode is disabled',async()=>{
    const token=await issueDemoSession(db,origin);const principal=(await db.query<{owner_id:string;workspace_id:string}>('SELECT owner_id,workspace_id FROM sessions WHERE token_hash=$1',[digest(token)])).rows[0]!;
    const demoScope={ownerId:principal.owner_id,workspaceId:principal.workspace_id};
    const input={requestId:randomUUID(),template:'adaptive_launch' as const,goal:'Review the fictional Harbor launch sources.',context:'',humanId:'fixture-human',agentId:'fixture-agent',maxTasks:3,maxAgentRuns:8,sources:structuredClone(ADAPTIVE_SAMPLE_SOURCES)};
    const started=await executionService.start(input,demoScope);const tick=vi.spyOn(executionService,'tick');tick.mockClear();
    await db.transaction(q=>maintainHostedDemoData(q,false));
    await executionService.pump();
    expect(tick).not.toHaveBeenCalled();
    expect((await db.query('SELECT token_hash FROM sessions WHERE token_hash=$1',[digest(token)])).rows).toHaveLength(0);
    expect(await db.get(started.mission.id,demoScope)).toBeNull();
    expect((await db.query('SELECT id FROM upgrade_records WHERE owner_id=$1 AND workspace_id=$2',[demoScope.ownerId,demoScope.workspaceId])).rows).toHaveLength(0);
  });

  it('pages past fifty idle human waits to schedule newer worker-demanding work',async()=>{
    await db.transaction(async q=>{
      for(let index=0;index<50;index++){
        const id=`idle-human-${String(index).padStart(2,'0')}`;const data={status:'running',tasks:[{status:'waiting_human',dependsOn:[]}]};
        await q("INSERT INTO missions(id,owner_id,workspace_id,revision,data,updated_at) VALUES($1,'scheduler-owner','scheduler-workspace',0,'{}','2020-01-01T00:00:00Z')",[id]);
        await q("INSERT INTO upgrade_records(id,kind,owner_id,workspace_id,mission_id,revision,data,updated_at) VALUES($1,'mission_execution','scheduler-owner','scheduler-workspace',$2,1,$3,'2020-01-01T00:00:00Z')",[`execution:${id}`,id,JSON.stringify(data)]);
      }
    });
    const scheduled=await executionService.start({requestId:randomUUID(),template:'adaptive_launch',goal:'Schedule this newer launch review.',context:'',humanId:'fixture-human',agentId:'fixture-agent',maxTasks:3,maxAgentRuns:8,sources:structuredClone(ADAPTIVE_SAMPLE_SOURCES)},{ownerId:'scheduler-owner',workspaceId:'scheduler-workspace'});
    const tick=vi.spyOn(executionService,'tick').mockImplementation(async()=>{});tick.mockClear();await executionService.pump();
    expect(tick).toHaveBeenCalledWith(scheduled.mission.id,{ownerId:'scheduler-owner',workspaceId:'scheduler-workspace'});
    expect(tick.mock.calls.findIndex(call=>call[0]===scheduled.mission.id)).toBe(0);
  });

  it('retains shared capacity for an in-flight lease that crosses demo-session expiry',async()=>{
    const firstToken=await issueDemoSession(db,origin);const secondToken=await issueDemoSession(db,origin);
    const firstInput={requestId:randomUUID(),template:'adaptive_launch' as const,goal:'Run the first near-expiry review.',context:'',humanId:'fixture-human',agentId:'fixture-agent',maxTasks:3,maxAgentRuns:8,sources:structuredClone(ADAPTIVE_SAMPLE_SOURCES)};
    const first=await request('/api/execution/missions',firstInput,firstToken);expect(first.status).toBe(201);const firstBody=await first.json();
    await db.query("INSERT INTO mission_execution_leases(mission_id,holder,expires_at) VALUES($1,'near-expiry-test',now()+interval '2 minutes')",[firstBody.mission.id]);
    await db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[digest(firstToken)]);
    const abort=vi.spyOn(executionService,'abortExpiredDemoRuns');await executionService.abortExpiredDemoRuns();expect(abort).toHaveBeenCalledOnce();
    await db.transaction(purgeExpiredDemoData);
    expect((await db.query('SELECT id FROM missions WHERE id=$1',[firstBody.mission.id])).rows).toHaveLength(1);
    expect((await db.query('SELECT mission_id FROM mission_execution_leases WHERE mission_id=$1',[firstBody.mission.id])).rows).toHaveLength(1);
    const secondInput={...firstInput,requestId:randomUUID(),goal:'Run the second near-expiry review.'};
    const blocked=await request('/api/execution/missions',secondInput,secondToken);expect(blocked.status).toBe(503);expect((await blocked.json()).code).toBe('demo_capacity');
    await db.query('DELETE FROM mission_execution_leases WHERE mission_id=$1',[firstBody.mission.id]);await db.transaction(purgeExpiredDemoData);
    expect((await request('/api/execution/missions',secondInput,secondToken)).status).toBe(201);
    expect((await request('/api/session/revoke',{},secondToken)).status).toBe(200);
  });

  it('keeps private hosted pairing outside anonymous demo quotas and expiry cleanup',async()=>{
    const transitionToken=await issueDemoSession(db,origin);
    const transitionPrincipal=(await db.query<{owner_id:string;workspace_id:string}>('SELECT owner_id,workspace_id FROM sessions WHERE token_hash=$1',[digest(transitionToken)])).rows[0]!;
    const transitionScope={ownerId:transitionPrincipal.owner_id,workspaceId:transitionPrincipal.workspace_id};
    const transitionMission=await service.create(transitionScope);
    await db.transaction(q=>new UpgradeStore(db).save({id:'transition-demo-orphan',kind:'demo_test',revision:1,data:{retained:false}},transitionScope,q));
    const privateApp=await createApp(service,{pairingCode:'private-hosted-pairing-code',enableCopilot:false,serveWeb:false,executionService,runtime:{deploymentMode:'hosted',publicDemoEnabled:false,publicDemoMaxMissions:1,publicDemoMaxConcurrent:1,publicDemoMaxSourceRevisions:2}});
    const privateServer=await new Promise<Server>((resolve,reject)=>{const candidate=privateApp.listen(0,'127.0.0.1',error=>error?reject(error):resolve(candidate));});
    try{
      const privateOrigin=`http://127.0.0.1:${(privateServer.address() as {port:number}).port}`;
      const transitioned=await fetch(privateOrigin+'/api/missions',{headers:{Origin:origin,Authorization:`Bearer ${transitionToken}`}});expect(transitioned.status).toBe(401);
      expect((await db.query('SELECT token_hash FROM sessions WHERE token_hash=$1',[digest(transitionToken)])).rows).toHaveLength(0);
      expect(await db.get(transitionMission.id,transitionScope)).toBeNull();
      expect((await db.query('SELECT id FROM upgrade_records WHERE owner_id=$1 AND workspace_id=$2',[transitionScope.ownerId,transitionScope.workspaceId])).rows).toHaveLength(0);
      const paired=await fetch(privateOrigin+'/api/pair',{method:'POST',headers:{Origin:privateOrigin,'Content-Type':'application/json'},body:JSON.stringify({code:'private-hosted-pairing-code'})});
      expect(paired.status).toBe(200);const body=await paired.json();expect(body.expiresIn).toBe(86400);
      const principal=(await db.query<{owner_id:string;workspace_id:string}>('SELECT owner_id,workspace_id FROM sessions WHERE token_hash=$1',[digest(body.token)])).rows[0]!;
      expect(principal.owner_id).toBe('local-user');expect(principal.workspace_id).toBe('local-workspace');
      const mission=await service.create({ownerId:principal.owner_id,workspaceId:principal.workspace_id});
      await db.query("UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",[digest(body.token)]);
      await db.transaction(q=>maintainHostedDemoData(q,false));
      expect((await db.query('SELECT token_hash FROM sessions WHERE token_hash=$1',[digest(body.token)])).rows).toHaveLength(0);
      expect(await db.get(mission.id,{ownerId:principal.owner_id,workspaceId:principal.workspace_id})).not.toBeNull();
    }finally{await new Promise<void>(resolve=>privateServer.close(()=>resolve()));}
  });
});
