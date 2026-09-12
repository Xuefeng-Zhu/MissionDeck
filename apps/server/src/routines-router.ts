import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {discoverRoutines,makeRepeatable,reviseRoutine,routineSpecSchema,type RoutineSpec,type ExecutionMetadata} from '../../../packages/domain/src/routines.js';
import {previewRoutine,compileAutomation} from './routines.js';
import {UpgradeStore} from './upgrade-store.js';
import type {MissionService} from './service.js';
import type {AuthenticatedRequest} from './auth.js';
import {HttpError} from './errors.js';
import {config} from './config.js';
import {inspectNativeRoutine,inspectNativeRun} from './native-routine-inspector.js';
import {artifactPlanSchema,type ArtifactPlan,type WorkspaceArtifact} from '../../../packages/domain/src/artifacts.js';
import type {ArtifactApproval} from './artifact-coordinator.js';

export function createRoutinesRouter(service:MissionService){
 const router=Router(),store=new UpgradeStore(service.db);
 const scope=(req:unknown)=>(req as AuthenticatedRequest).principal;
 router.get('/api/routines',async(req,res)=>{
  const s=scope(req);const records=await store.list<RoutineSpec>('routine',s);
  const history=(await store.list<ExecutionMetadata>('routine_history',s)).map(r=>r.data);
  const dismissals=(await store.list<{patternKey:string}>('routine_dismissal',s)).map(r=>r.data.patternKey);
  res.json({routines:records.map(r=>r.data),suggestions:discoverRoutines(history,s,dismissals),runs:[],nativeStatus:'blocked_by_authorization'});
 });
 router.post('/api/routines/demo',async(req,res)=>{
  z.object({consent:z.literal(true)}).strict().parse(req.body);const s=scope(req);
  if(service.provider.mode!=='fixture')throw new HttpError(409,'Comparable demo history requires explicitly selected fixture provider mode.');
  const existing=await store.list<ExecutionMetadata>('routine_history',s);
  await service.db.transaction(async q=>{for(let n=1;n<=3;n++){
   const id=`fixture-launch-${s.ownerId}-${s.workspaceId}-${n}`;if(existing.some(r=>r.id===id))continue;
   const run:ExecutionMetadata={id,missionId:`fixture-launch-mission-${n}`,ownerId:s.ownerId,workspaceId:s.workspaceId,consented:true,verified:true,approved:true,fixture:true,family:'launch_review',steps:[{id:'tracker',action:'update',app:'sheets',sourceTypes:['page','table'],destination:'fixture-launch-tracker',audience:[s.ownerId],sensitiveSources:[],review:'per_run',dependencies:[]},{id:'slides',action:'update',app:'slides',sourceTypes:['page','table'],destination:'fixture-launch-slides',audience:[s.ownerId],sensitiveSources:[],review:'per_run',dependencies:['tracker']}],corrections:[],failureCount:0,completedAt:`2026-09-0${n}T12:00:00Z`};
   await store.save({id,kind:'routine_history',revision:1,data:run},s,q);
   if(n===1){const routine=makeRepeatable(run,s,`fixture-routine-${s.ownerId}-${s.workspaceId}`);await store.save({id:routine.id,kind:'routine',revision:1,data:routine},s,q);}
  }});res.json({fixture:true,detail:'Three synthetic comparable runs loaded. No native execution occurred.'});
 });
 router.post('/api/missions/:id/routines',async(req,res)=>{
  const body=z.object({consent:z.literal(true)}).strict().parse(req.body),s=scope(req);
  const mission=await service.get(String(req.params.id),s);
  const verified=mission.operations.filter(o=>o.state==='synced'&&o.reconciliation!=='required'&&o.kind!=='research'&&mission.approvals.some(a=>a.proposalId===o.proposalId&&a.actorId===s.ownerId));
  const plans=await store.list<ArtifactPlan>('artifact_plan',s,mission.id);
  const results=await store.list<{state:string;artifact?:WorkspaceArtifact}>('artifact_operation',s,mission.id);
  const approvals=await store.list<ArtifactApproval>('artifact_approval',s,mission.id);
  const successfulPlan=plans.map(p=>artifactPlanSchema.parse(p.data)).find(p=>p.operations.length<=20&&p.operations.every(o=>!['assistant','automations'].includes(o.app)&&results.some(r=>r.id===`${p.id}_${o.id}`&&r.data.state==='verified'&&r.data.artifact?.verifiedAt))&&approvals.some(a=>a.id===`artifact-approval-${p.id}`&&a.data.consumedAt&&a.data.ownerId===s.ownerId&&a.data.workspaceId===s.workspaceId));
  if(!successfulPlan&&(mission.lifecycle!=='completed'||!verified.length||mission.operations.some(o=>o.state!=='synced')))throw new HttpError(409,'Make repeatable requires a completed mission or an approved artifact plan with every output verified and no unresolved outcomes.');
  const fixture=service.provider.mode==='fixture';
  const run:ExecutionMetadata={id:`mission-history-${mission.id}`,missionId:mission.id,ownerId:s.ownerId,workspaceId:s.workspaceId,consented:body.consent,verified:true,approved:true,fixture,family:'task_followup',steps:verified.slice(0,20).map((o,index)=>({id:`step-${index}`,action:o.kind==='update'?'update':'create',app:'tasks',sourceTypes:['mission_evidence'],destination:'mission-owner-task-list',audience:[s.ownerId],sensitiveSources:mission.evidence.filter(e=>!e.fixture).map(e=>e.id).slice(0,50),review:'per_run',dependencies:[]})),corrections:[],failureCount:0,completedAt:mission.updatedAt};
  if(successfulPlan){
   run.family='launch_review';run.id=`artifact-history-${successfulPlan.id}`;
   run.fixture=successfulPlan.operations.every(o=>results.find(r=>r.id===`${successfulPlan.id}_${o.id}`)?.data.artifact?.mode==='fixture');
   run.steps=successfulPlan.operations.map(o=>({id:o.id,action:o.action==='prepare'?'prepare_communication':o.action,app:o.app as ExecutionMetadata['steps'][number]['app'],sourceTypes:['saved_evidence'],destination:o.targetId??`${o.app}:private-new-artifact`,audience:o.audience,sensitiveSources:o.sourceSnapshotIds.filter(id=>!mission.evidence.find(e=>e.id===id)?.fixture),review:'per_run',dependencies:o.dependsOn}));
  }
  const routine=makeRepeatable(run,s,randomUUID());routine.timezone=mission.timezone;
  const histories=await store.list<ExecutionMetadata>('routine_history',s,mission.id);
  await service.db.transaction(async q=>{
   if(!histories.some(h=>h.id===run.id))await store.save({id:run.id,kind:'routine_history',missionId:mission.id,revision:1,data:run},s,q);
   await store.save({id:routine.id,kind:'routine',missionId:mission.id,revision:1,data:routine},s,q);
  });res.status(201).json({routine});
 });
 router.post('/api/routines/from-history',async(req,res)=>{
  const body=z.object({runId:z.string().min(1).max(200)}).strict().parse(req.body),s=scope(req);
  const history=await store.get<ExecutionMetadata>(body.runId,'routine_history',s);
  const routine=makeRepeatable(history.data,s,randomUUID());
  await service.db.transaction(q=>store.save({id:routine.id,kind:'routine',missionId:history.missionId,revision:1,data:routine},s,q));res.status(201).json({routine});
 });
 router.patch('/api/routines/:id',async(req,res)=>{
  const body=routineSpecSchema.pick({version:true,title:true,purpose:true,trigger:true,timezone:true,filters:true,requiredInputs:true,parameterBindings:true,allowedSources:true,steps:true,budget:true,exceptionPolicy:true,browserDependency:true}).partial().required({version:true}).strict().parse(req.body),s=scope(req);
  const result=await service.db.transaction(async q=>{const record=await store.get<RoutineSpec>(String(req.params.id),'routine',s,q);if(record.data.version!==body.version)throw new HttpError(409,'Routine version changed; refresh review.');const {version,...patch}=body;const next=reviseRoutine(record.data,patch);await store.save({...record,revision:record.revision+1,data:next},s,q);return next;});res.json({routine:result});
 });
 router.post('/api/routines/:id/preview',async(req,res)=>{
  const s=scope(req);const result=await service.db.transaction(async q=>{const record=await store.get<RoutineSpec>(String(req.params.id),'routine',s,q);const next={...record.data,lifecycle:'previewed' as const};const preview=previewRoutine(next);await store.save({...record,revision:record.revision+1,data:next},s,q);return {routine:next,preview};});res.json(result);
 });
 router.post('/api/routines/:id/pause',async(req,res)=>{
  const s=scope(req);await service.db.transaction(async q=>{const record=await store.get<RoutineSpec>(String(req.params.id),'routine',s,q);if(record.data.nativeWorkflowId)throw new HttpError(409,'Native disable requires authorized provider access. In-flight cancellation is separate.');await store.save({...record,revision:record.revision+1,data:{...record.data,lifecycle:'paused'}},s,q);});res.json({paused:true,detail:'Local proposal paused. No native workflow was activated.'});
 });
 router.get('/api/routines/:id/runs/:runId',async(req,res)=>{const record=await store.get<RoutineSpec>(String(req.params.id),'routine',scope(req));res.json(await inspectNativeRun(record.data,String(req.params.runId),{apiKey:config.AMBIGUOUS_API_KEY,expectedUserId:config.AMBIGUOUS_EXPECTED_USER_ID,expectedWorkspaceId:config.AMBIGUOUS_EXPECTED_WORKSPACE_ID}));});
 router.get('/api/routines/:id/runs',async(req,res)=>{const record=await store.get<RoutineSpec>(String(req.params.id),'routine',scope(req));res.json(await inspectNativeRoutine(record.data,{apiKey:config.AMBIGUOUS_API_KEY,expectedUserId:config.AMBIGUOUS_EXPECTED_USER_ID,expectedWorkspaceId:config.AMBIGUOUS_EXPECTED_WORKSPACE_ID},Number(req.query.offset??0)));});
 router.post('/api/routines/:id/enable',async(req,res)=>{const record=await store.get<RoutineSpec>(String(req.params.id),'routine',scope(req));try{compileAutomation(record.data);}catch(e){throw new HttpError(409,e instanceof Error?e.message:'Native compilation unavailable');}res.json({});});
 router.post('/api/routines/suggestions/dismiss',async(req,res)=>{
  const body=z.object({patternKey:z.string().regex(/^[a-f0-9]{64}$/),permanent:z.boolean()}).strict().parse(req.body),s=scope(req);
  const id=`dismiss-${s.ownerId}-${s.workspaceId}-${body.patternKey}`;
  const existing=(await store.list<{patternKey:string}>('routine_dismissal',s)).find(r=>r.id===id);
  if(!existing)await service.db.transaction(q=>store.save({id,kind:'routine_dismissal',revision:1,data:body},s,q));res.json({dismissed:true});
 });
 return router;
}
