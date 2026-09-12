import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { artifactPlanSchema, workspaceAppSchema, type ArtifactPlan, type WorkspaceArtifact } from '../../../packages/domain/src/artifacts.js';
import type { MissionService } from './service.js';
import type { AuthenticatedRequest } from './auth.js';
import { UpgradeStore } from './upgrade-store.js';
import { config } from './config.js';
import { ArtifactCoordinator, artifactApprovalDigest, type ArtifactApproval, type ArtifactAuthority, type WorkspaceProvider } from './artifact-coordinator.js';
import { AmbiguousWorkspaceProvider, FixtureWorkspaceProvider, WORKSPACE_CAPABILITIES, matchesDocumentText } from './workspace-provider.js';
import {ProviderError} from './providers/types.js';
import { HttpError } from './errors.js';

export function createArtifactRouter(service:MissionService){
 const runtimeId=randomUUID();const router=Router();const store=new UpgradeStore(service.db);
 const provider:WorkspaceProvider=config.PROVIDER_MODE==='fixture'?new FixtureWorkspaceProvider(store,service.now):new AmbiguousWorkspaceProvider({apiKey:config.AMBIGUOUS_API_KEY,expectedUserId:config.AMBIGUOUS_EXPECTED_USER_ID,expectedWorkspaceId:config.AMBIGUOUS_EXPECTED_WORKSPACE_ID});
 const scope=(req:unknown)=>(req as AuthenticatedRequest).principal;
 router.get('/workspace/capabilities',(_req,res)=>res.json({mode:provider.mode,consequentialReady:provider.mode==='live'&&Boolean(config.AMBIGUOUS_API_KEY&&config.AMBIGUOUS_EXPECTED_USER_ID&&config.AMBIGUOUS_EXPECTED_WORKSPACE_ID),capabilities:WORKSPACE_CAPABILITIES}));
 router.post('/missions/:missionId/workspace/read',async(req,res)=>{
  const principal=scope(req);const m=await service.get(String(req.params.missionId),principal);
  const input=z.object({app:workspaceAppSchema,id:z.string().min(1).max(200)}).strict().parse(req.body);
  const authority:ArtifactAuthority={...principal,missionId:m.id,missionRevision:m.revision,sourceHashes:{},allowedTargetIds:[input.id],allowedAudience:[],categories:[]};
  res.json(await provider.read(input.app,input.id,authority));
 });
 router.get('/missions/:missionId/artifact-plans',async(req,res)=>{
  await service.get(String(req.params.missionId),scope(req));
  const principal=scope(req);const missionId=String(req.params.missionId);
  const plans=await store.list<ArtifactPlan>('artifact_plan',principal,missionId);
  const operations=await store.list<{state:string;runtimeId?:string;artifact?:WorkspaceArtifact}>('artifact_operation',principal,missionId);
  for(const operation of operations)if(operation.data.state==='running'&&operation.data.runtimeId!==runtimeId){
   operation.data.state='outcome_unknown';operation.revision++;
   await service.db.transaction(q=>store.save(operation,principal,q));
  }
  const artifacts=operations.filter(o=>o.data.artifact).map(o=>({id:o.data.artifact!.id,data:o.data.artifact!})).filter((a,index,all)=>all.findIndex(x=>x.id===a.id)===index);
  res.json({plans:plans.map(p=>({...p,review:{digest:artifactApprovalDigest(p.data,{...principal,missionRevision:p.data.missionRevision}),expiresAt:new Date(Date.parse(p.data.createdAt)+600000).toISOString()}})),artifacts,operations});
 });
 router.post('/missions/:missionId/artifact-plans',async(req,res)=>{
  const principal=scope(req);const m=await service.get(String(req.params.missionId),principal);
  if(['completed','archived'].includes(m.lifecycle))throw new HttpError(409,'Reopen this mission before proposing artifacts.');
  const input=z.object({outcome:z.string().min(1).max(5000),operations:artifactPlanSchema.shape.operations}).strict().parse(req.body);
  const plan=artifactPlanSchema.parse({...input,id:randomUUID(),missionId:m.id,missionRevision:m.revision,createdAt:service.now(),sourceSnapshots:m.evidence.filter(e=>input.operations.some(o=>o.sourceSnapshotIds.includes(e.id))).map(e=>({snapshotId:e.id,contentHash:e.contentHash,audience:[...new Set(input.operations.filter(o=>o.sourceSnapshotIds.includes(e.id)).flatMap(o=>o.audience))]}))});
  await service.db.transaction(q=>store.save({id:plan.id,kind:'artifact_plan',missionId:m.id,revision:1,data:plan},principal,q));res.status(201).json(plan);
 });
 const execute=async(req:Request,res:Response,consequential=false)=>{
  const reviewSchema=z.object({approve:z.literal(true),digest:z.string().regex(/^[a-f0-9]{64}$/)});
  const review=consequential?reviewSchema.extend({category:z.enum(['communication','invitation']),acknowledgeSourceSharing:z.literal(true)}).strict().parse(req.body):reviewSchema.strict().parse(req.body);
  const principal=scope(req);const m=await service.get(String(req.params.missionId),principal);
  if(['completed','archived'].includes(m.lifecycle))throw new HttpError(409,'Reopen this mission before executing artifacts.');
  const saved=await store.get<ArtifactPlan>(String(req.params.planId),'artifact_plan',principal);
  if(saved.missionId!==m.id)throw new HttpError(404,'Plan not found in this mission.');
  const plan=artifactPlanSchema.parse(saved.data);
  const category='category' in review?z.enum(['communication','invitation']).parse(review.category):'private_artifact';
  if(consequential){
   if(provider.mode!=='live')throw new HttpError(409,'Fixture mode never sends messages or invitations.');
   if(!config.AMBIGUOUS_API_KEY||!config.AMBIGUOUS_EXPECTED_USER_ID||!config.AMBIGUOUS_EXPECTED_WORKSPACE_ID)throw new HttpError(409,'Configure and verify the intended live workspace identity before consequential execution.');
   if(plan.operations.some(op=>!op.audience.length||(category==='communication'?!(['mail','chat'].includes(op.app)&&op.action==='send'):!(op.app==='calendar'&&['invite','create','update'].includes(op.action)))))throw new HttpError(400,'Review communications and invitations as separate, single-category plans with exact audiences.');
  }
  const authority:ArtifactAuthority={...principal,missionId:m.id,missionRevision:m.revision,sourceHashes:Object.fromEntries(m.evidence.map(e=>[e.id,e.contentHash])),allowedTargetIds:plan.operations.flatMap(o=>o.targetId?[o.targetId]:[]),allowedAudience:consequential?[...new Set(plan.operations.flatMap(o=>o.audience))]:[],categories:[category]};
  const approval:ArtifactApproval={id:`artifact-approval-${plan.id}`,digest:review.digest,ownerId:principal.ownerId,workspaceId:principal.workspaceId,expiresAt:new Date(Date.parse(plan.createdAt)+10*60_000).toISOString(),consumedAt:null};
  const coordinator=new ArtifactCoordinator(provider,{
   beforeOperation:async()=>{
    const current=await service.get(m.id,principal);
    if(current.revision!==plan.missionRevision||['completed','archived'].includes(current.lifecycle)||Date.parse(approval.expiresAt)<=Date.parse(service.now()))throw new ProviderError('conflict','authorization_changed','Mission or authorization changed. Review the remaining work again.');
    if(principal.tokenHash){const session=await service.db.query('SELECT token_hash FROM sessions WHERE token_hash=$1 AND owner_id=$2 AND workspace_id=$3 AND expires_at>now()',[principal.tokenHash,principal.ownerId,principal.workspaceId]);if(!session.rows.length)throw new ProviderError('failed','session_revoked','Session expired or was revoked before this operation.');}
   },
   consumeApproval:async()=>service.db.transaction(async q=>{
    const existing=await q('SELECT id FROM upgrade_records WHERE id=$1',[approval.id]);if(existing.rows.length)return false;
    // Recheck mission and exact stored plan while holding the transaction gate.
    const current=await service.get(m.id,principal,q);if(['completed','archived'].includes(current.lifecycle)||current.revision!==plan.missionRevision)throw new HttpError(409,'Mission changed. Review a new artifact plan.');
    await store.save({id:approval.id,kind:'artifact_approval',missionId:m.id,revision:1,data:{...approval,consumedAt:service.now(),category,acknowledgeSourceSharing:consequential}},principal,q);return true;
   }),
   record:async(id,value)=>service.db.transaction(async q=>{
    const r=await q<{revision:number}>('SELECT revision FROM upgrade_records WHERE id=$1 AND owner_id=$2 AND workspace_id=$3',[id,principal.ownerId,principal.workspaceId]);
    await store.save({id,kind:'artifact_operation',missionId:m.id,revision:(r.rows[0]?.revision??0)+1,data:{...value,runtimeId,planId:plan.id}},principal,q);
   }),
  },()=>new Date(service.now()));
  res.json({results:await coordinator.execute(plan,approval,authority)});
 };
 router.post('/missions/:missionId/artifact-plans/:planId/execute',(req,res)=>execute(req,res));
 router.post('/missions/:missionId/artifact-plans/:planId/execute-consequential',(req,res)=>execute(req,res,true));
 router.post('/missions/:missionId/artifact-operations/:operationId/reconcile',async(req,res)=>{
  z.object({}).strict().parse(req.body);
  const principal=scope(req);const mission=await service.get(String(req.params.missionId),principal);
  type Outcome={state:string;providerId?:string;planId?:string;artifact?:WorkspaceArtifact;code?:string};
  const record=await store.get<Outcome>(String(req.params.operationId),'artifact_operation',principal);
  if(record.missionId!==mission.id||record.data.state!=='outcome_unknown'||!record.data.providerId||!record.data.planId)throw new HttpError(409,'This operation has no selected provider ID to reconcile. Inspect the native workspace; do not retry blindly.');
  const saved=await store.get<ArtifactPlan>(record.data.planId,'artifact_plan',principal);
  const operation=saved.data.operations.find(o=>`${saved.id}_${o.id}`===record.id);
  if(!operation)throw new HttpError(409,'Original operation is unavailable.');
  const authority:ArtifactAuthority={...principal,missionId:mission.id,missionRevision:mission.revision,sourceHashes:{},allowedTargetIds:[record.data.providerId,...(operation.targetId?[operation.targetId]:[])],allowedAudience:[],categories:[]};
  const observed=provider.readResult?await provider.readResult(operation,record.data.providerId,authority):await provider.read(operation.app,record.data.providerId,authority);
  // Use the same supported plain-text equivalence as document write confirmation.
  const matches=!['send','invite'].includes(operation.action)&&observed.title===operation.title&&(operation.app==='docs'?matchesDocumentText(observed.content,operation.content):observed.content===operation.content)&&!operation.cells;
  record.data={...record.data,state:matches?'verified':'outcome_unknown',artifact:{...observed,state:matches?'verified':'accepted'},code:matches?'readback_verified':'payload_requires_review'};record.revision++;
  await service.db.transaction(q=>store.save(record,principal,q));res.json(record.data);
 });
 return router;
}
