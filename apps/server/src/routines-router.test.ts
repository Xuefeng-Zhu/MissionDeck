import {beforeAll,afterAll,it,expect} from 'vitest';
import express from 'express';
import type {Server} from 'node:http';
import {openDatabase,type Database} from './database.js';
import {MissionService} from './service.js';
import {FixtureWorkProvider,MemoryFixtureRepository} from './providers/index.js';
import {createRoutinesRouter} from './routines-router.js';
import {UpgradeStore} from './upgrade-store.js';
import {makeRepeatable,type ExecutionMetadata} from '../../../packages/domain/src/routines.js';
const scope={ownerId:'owner',workspaceId:'workspace'};
let db:Database,service:MissionService,server:Server,base:string;
const request=(path:string,body?:unknown,method=body?'POST':'GET',workspace='workspace')=>fetch(base+path,{method,headers:{'content-type':'application/json','x-test-workspace':workspace},body:body?JSON.stringify(body):undefined});
beforeAll(async()=>{db=await openDatabase({memory:true});service=new MissionService(db,new FixtureWorkProvider(new MemoryFixtureRepository()));const app=express();app.use(express.json());app.use((req,_res,next)=>{Object.assign(req,{principal:{...scope,workspaceId:req.headers['x-test-workspace']}});next();});app.use(createRoutinesRouter(service));app.use((e:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status((e as {status?:number}).status??400).json({error:e instanceof Error?e.message:'error'});});await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',()=>resolve());});base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await db.close();});
it('persists scoped routine previews, rejects revision races and never enables native execution',async()=>{
 const run:ExecutionMetadata={id:'run',missionId:'mission',...scope,consented:true,verified:true,approved:true,fixture:true,family:'task_followup',steps:[{id:'step',action:'create',app:'tasks',sourceTypes:['page'],destination:'owner-list',audience:['owner'],sensitiveSources:[],review:'per_run',dependencies:[]}],corrections:[],failureCount:0,completedAt:'2026-09-12T12:00:00Z'};
 const routine=makeRepeatable(run,scope,'routine');const store=new UpgradeStore(db);await db.transaction(q=>store.save({id:'routine',kind:'routine',revision:1,data:routine},scope,q));
 expect((await (await request('/api/routines')).json()).routines).toHaveLength(1);
 expect((await (await request('/api/routines',undefined,'GET','other')).json()).routines).toHaveLength(0);
 const preview=await (await request('/api/routines/routine/preview',{})).json();expect(preview.preview.productionWrites).toBe(0);
 expect((await request('/api/routines/routine',{version:1,title:'Edited'},'PATCH')).status).toBe(200);
 expect((await request('/api/routines/routine',{version:1,title:'Stale'},'PATCH')).status).toBeGreaterThanOrEqual(400);
 expect((await request('/api/routines/routine/enable',{})).status).toBeGreaterThanOrEqual(400);
 expect((await store.get<typeof routine>('routine','routine',scope)).data.lifecycle).toBe('draft');
});
it('rejects client-supplied success and missing consent for incomplete missions',async()=>{
 const mission=await service.create(scope);
 expect((await request(`/api/missions/${mission.id}/routines`,{consent:true,verified:true})).status).toBeGreaterThanOrEqual(400);
 expect((await request(`/api/missions/${mission.id}/routines`,{consent:true})).status).toBeGreaterThanOrEqual(400);
});

it('loads only labeled comparable fixture runs and persists dismissal',async()=>{
 expect((await request('/api/routines/demo',{consent:true})).status).toBe(200);
 expect((await request('/api/routines/demo',{consent:true})).status).toBe(200);
 const state=await (await request('/api/routines')).json();expect(state.suggestions).toHaveLength(1);expect(state.suggestions[0].fixture).toBe(true);
 const created=await request('/api/routines/from-history',{runId:state.suggestions[0].supportingRuns[0]});expect(created.status).toBe(201);
 expect((await request('/api/routines/suggestions/dismiss',{patternKey:state.suggestions[0].patternKey,permanent:true})).status).toBe(200);
 expect((await (await request('/api/routines')).json()).suggestions).toHaveLength(0);
});
