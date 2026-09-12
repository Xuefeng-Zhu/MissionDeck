import { artifactPlanSchema, type ArtifactPlan, type ArtifactOperation, type WorkspaceArtifact } from '../../../packages/domain/src/artifacts.js';
import { fingerprint, ProviderError } from './providers/types.js';
export interface ArtifactAuthority {
 ownerId:string; workspaceId:string; missionId:string; missionRevision:number;
 sourceHashes:Record<string,string>; allowedTargetIds:string[]; allowedAudience:string[];
 categories:Array<'private_artifact'|'communication'|'invitation'>;
}
export interface ArtifactApproval { id:string; digest:string; ownerId:string; workspaceId:string; expiresAt:string; consumedAt:string|null }
export interface WorkspaceProvider {
 readonly mode:'fixture'|'live';
 readResult?(operation:ArtifactOperation,id:string,authority:ArtifactAuthority):Promise<WorkspaceArtifact>;
 read(app:ArtifactOperation['app'],id:string,authority:ArtifactAuthority):Promise<WorkspaceArtifact>;
 execute(operation:ArtifactOperation,authority:ArtifactAuthority,operationId:string):Promise<WorkspaceArtifact>;
}
export function artifactApprovalDigest(plan:ArtifactPlan,authority:Pick<ArtifactAuthority,'ownerId'|'workspaceId'|'missionRevision'>):string {
 return fingerprint({plan,ownerId:authority.ownerId,workspaceId:authority.workspaceId,missionRevision:authority.missionRevision});
}
export class PolicyGuard {
 static check(plan:ArtifactPlan,approval:ArtifactApproval,authority:ArtifactAuthority,now:Date):void {
  artifactPlanSchema.parse(plan);
  if(plan.missionId!==authority.missionId || plan.missionRevision!==authority.missionRevision || approval.ownerId!==authority.ownerId || approval.workspaceId!==authority.workspaceId) throw new ProviderError('failed','scope_mismatch','The plan does not belong to the authenticated mission revision.');
  if(approval.consumedAt || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt)<=now.getTime() || approval.digest!==artifactApprovalDigest(plan,authority)) throw new ProviderError('failed','stale_approval','Review the exact current plan again.');
  for(const source of plan.sourceSnapshots) if(authority.sourceHashes[source.snapshotId]!==source.contentHash) throw new ProviderError('conflict','stale_source','A source changed or was revoked. Review a new plan.');
  for(const op of plan.operations){
   if(op.targetId && !authority.allowedTargetIds.includes(op.targetId)) throw new ProviderError('failed','target_scope','The target is outside the selected scope.');
   const category=(op.app==='calendar'&&op.action!=='prepare')||op.action==='invite'?'invitation':op.action==='send'?'communication':'private_artifact';
   if(!authority.categories.includes(category)) throw new ProviderError('failed','category_scope','This action needs separate authorization.');
   if(op.audience.some(a=>!authority.allowedAudience.includes(a))) throw new ProviderError('failed','destination_scope','The destination audience is not authorized.');
   for(const sourceId of op.sourceSnapshotIds){
    const source=plan.sourceSnapshots.find(s=>s.snapshotId===sourceId)!;
    if(op.audience.some(a=>!source.audience.includes(a))) throw new ProviderError('failed','source_audience','The source is not authorized for this audience.');
   }
  }
 }
}
export interface ArtifactLedger {
 beforeOperation?(operation:ArtifactOperation):Promise<void>;
 /** Must atomically reject already consumed approvals before recording any attempt. */
 consumeApproval(approvalId:string):Promise<boolean>;
 record(operationId:string,value:{state:string;artifact?:WorkspaceArtifact;code?:string;providerId?:string}):Promise<void>;
}
export class ArtifactCoordinator {
 constructor(private provider:WorkspaceProvider,private ledger:ArtifactLedger,private now=()=>new Date()){}
 async execute(plan:ArtifactPlan,approval:ArtifactApproval,authority:ArtifactAuthority){
  PolicyGuard.check(plan,approval,authority,this.now());
  if(!await this.ledger.consumeApproval(approval.id)) throw new ProviderError('failed','approval_replayed','This approval was already used.');
  const results:Array<{operationId:string;state:string;artifact?:WorkspaceArtifact;code?:string;providerId?:string}>=[];
  for(const op of plan.operations){
   const key=`${plan.id}_${op.id}`;
   if(op.dependsOn.some(id=>!results.find(r=>r.operationId===id && r.state==='verified'))){
    const result={operationId:op.id,state:'failed',code:'dependency_unverified'};await this.ledger.record(key,result);results.push(result);continue;
   }
   await this.ledger.record(key,{state:'running'});
   try {
    await this.ledger.beforeOperation?.(op);
    if(op.action==='update'){
     const current=await this.provider.read(op.app,op.targetId!,authority);
     if(current.fingerprint!==op.expectedFingerprint || (op.beforeContent!==undefined && current.content!==op.beforeContent)) throw new ProviderError('conflict','target_changed','Human edits changed the target. Review a fresh diff.');
    }
    const artifact=await this.provider.execute(op,authority,key);
    const result={operationId:op.id,state:artifact.state,artifact}; await this.ledger.record(key,result);results.push(result);
   }catch(error){
    const result={operationId:op.id,state:error instanceof ProviderError?error.state:'outcome_unknown',code:error instanceof ProviderError?error.code:'execution_unconfirmed',...(error instanceof ProviderError&&error.providerId?{providerId:error.providerId}:{})};
    await this.ledger.record(key,result);results.push(result);
   }
  }
  return results;
 }
}
