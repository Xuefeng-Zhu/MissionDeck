import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import express from 'express';
import type {Server} from 'node:http';
import {openDatabase,type Database} from './database.js';
import {MissionService} from './service.js';
import {FixtureWorkProvider,MemoryFixtureRepository} from './providers/index.js';
import {createArtifactRouter} from './artifact-router.js';
import {FixtureWorkspaceProvider} from './workspace-provider.js';
import {artifactOperationSchema} from '../../../packages/domain/src/artifacts.js';
import {UpgradeStore} from './upgrade-store.js';
vi.hoisted(()=>{process.env.PROVIDER_MODE='fixture';});
const scope={ownerId:'local-user',workspaceId:'local-workspace'};
describe('durable artifact review routes',()=>{
 let db:Database,service:MissionService,server:Server,base:string,missionId:string;let now='2026-09-12T12:00:00.000Z';
 const request=(path:string,body?:unknown)=>fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 beforeAll(async()=>{
  db=await openDatabase({memory:true});service=new MissionService(db,new FixtureWorkProvider(new MemoryFixtureRepository()),()=>now);missionId=(await service.create(scope)).id;
  const app=express();app.use(express.json());app.use((req,_res,next)=>{Object.assign(req,{principal:scope});next();});app.use(createArtifactRouter(service));app.use((e:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status((e as {status?:number}).status??400).json({error:e instanceof Error?e.message:'error'});});
  await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',()=>resolve());});base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 });
 afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await db.close();});
 const create=async()=>{const r=await request(`/missions/${missionId}/artifact-plans`,{outcome:'Review',operations:[{id:'doc',app:'docs',action:'create',title:'Review',content:'Approved facts',sourceSnapshotIds:[]}]});const data=await r.json();expect(r.status,JSON.stringify(data)).toBe(201);return data;};
 it('requires the displayed digest and persists read-back without replaying',async()=>{
  const p=await create();const url=`/missions/${missionId}/artifact-plans/${p.id}/execute`;
  expect((await request(url,{approve:true})).status).toBe(400);
  const listed=await (await request(`/missions/${missionId}/artifact-plans`)).json();const review=listed.plans.find((x:{id:string})=>x.id===p.id).review;
  const r=await request(url,{approve:true,digest:review.digest});expect(r.status).toBe(200);expect((await r.json()).results[0].state).toBe('verified');
  expect((await request(url,{approve:true,digest:review.digest})).status).toBe(400);
  const saved=await (await request(`/missions/${missionId}/artifact-plans`)).json();expect(saved.artifacts.length).toBe(1);expect(saved.artifacts[0].data.mode).toBe('fixture');
 });
 it('expires review from plan creation rather than extending expiry at execution',async()=>{
  const p=await create();const listed=await (await request(`/missions/${missionId}/artifact-plans`)).json();const review=listed.plans.find((x:{id:string})=>x.id===p.id).review;
  now='2026-09-12T12:11:00.000Z';const response=await request(`/missions/${missionId}/artifact-plans/${p.id}/execute`,{approve:true,digest:review.digest});expect(response.status).toBe(400);expect((await response.json()).error).toContain('Review');
 });
 it('preserves unrelated tracker cells and stable row keys on fixture update',async()=>{
  const provider=new FixtureWorkspaceProvider(new UpgradeStore(db),()=>now);
  const authority={...scope,missionId,missionRevision:0,sourceHashes:{},allowedTargetIds:[] as string[],allowedAudience:[],categories:['private_artifact' as const]};
  const op=artifactOperationSchema.parse({id:'sheet',app:'sheets',action:'create',title:'Tracker',content:'',sourceSnapshotIds:[],cells:[{row:0,rowKey:'source-one',column:'claim',value:'=literal formula-like data'},{row:1,rowKey:'human-row',column:'claim',value:'Keep human edit'}]});
  const first=await provider.execute(op,authority,'first');
  const updated=await provider.execute({...op,action:'update',targetId:first.id,expectedFingerprint:first.fingerprint,cells:[{row:0,rowKey:'source-one',column:'claim',value:'Revised claim'}]},{...authority,allowedTargetIds:[first.id]},'second');
  expect(updated.id).toBe(first.id);expect(JSON.parse(updated.content)).toEqual([{row:0,rowKey:'source-one',column:'claim',value:'Revised claim'},{row:1,rowKey:'human-row',column:'claim',value:'Keep human edit'}]);
 });
 it('requires separate disclosure consent and refuses fixture sends',async()=>{
  const created=await request(`/missions/${missionId}/artifact-plans`,{outcome:'Send review',operations:[{id:'send',app:'mail',action:'send',title:'Review',content:'Exact outgoing text',sourceSnapshotIds:[],audience:['review@example.test']}]});expect(created.status).toBe(201);const plan=await created.json();
  const listed=await (await request(`/missions/${missionId}/artifact-plans`)).json();const review=listed.plans.find((x:{id:string})=>x.id===plan.id).review;
  const path=`/missions/${missionId}/artifact-plans/${plan.id}`;
  expect((await request(path+'/execute',{approve:true,digest:review.digest})).status).toBe(400);
  expect((await request(path+'/execute-consequential',{approve:true,digest:review.digest,category:'communication'})).status).toBe(400);
  const refused=await request(path+'/execute-consequential',{approve:true,digest:review.digest,category:'communication',acknowledgeSourceSharing:true});expect(refused.status).toBe(409);expect((await refused.json()).error).toContain('Fixture mode');
  expect((await new UpgradeStore(db).list('artifact_operation',scope,missionId)).filter(x=>x.id.startsWith(plan.id))).toHaveLength(0);
 });
 it('rejects unknown evidence and artifact writes on closed missions',async()=>{
  const missing=await request(`/missions/${missionId}/artifact-plans`,{outcome:'Review',operations:[{id:'doc',app:'docs',action:'create',title:'Review',content:'Facts',sourceSnapshotIds:['not-authorized']}]});expect(missing.status).toBe(400);
  const mission=await service.get(missionId,scope);mission.lifecycle='archived';await db.transaction(q=>db.save(mission,q));
  const closed=await request(`/missions/${missionId}/artifact-plans`,{outcome:'Review',operations:[{id:'doc',app:'docs',action:'create',title:'Review',content:'Facts',sourceSnapshotIds:[]}]});expect(closed.status).toBe(409);
 });
 it('reconciles interrupted durable attempts to outcome unknown without issuing writes',async()=>{
  const store=new UpgradeStore(db);await db.transaction(q=>store.save({id:'interrupted',kind:'artifact_operation',missionId,revision:1,data:{state:'running',runtimeId:'previous-process'}},scope,q));
  const listed=await (await request(`/missions/${missionId}/artifact-plans`)).json();expect(listed.operations.find((x:{id:string})=>x.id==='interrupted').data.state).toBe('outcome_unknown');
 });
});
