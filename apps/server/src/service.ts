import { randomUUID } from 'node:crypto';
import {
  type Mission, type Task, type Proposal, type ProposalOperation, type Evidence,
  applyProposalOperations, validatePlan, validateProposal, proposalHash, createProposal,
  createDemoMission, createDemoPlanProposal, assessMissionHealth, canCompleteMission,
  analyzeEvidence, proposeRecovery, prepareCapture, findDuplicateEvidence, taskPatchSchema,
} from '@mission/domain';
import { Database, type Query, type Scope } from './database.js';
import { ProviderError, type WorkProvider, type WorkRecord, type WorkCreate, type WorkUpdate } from './providers/index.js';
import { HttpError } from './errors.js';

export type Effect = { operationId:string;taskId:string;kind:'create'|'update';fields:WorkCreate|WorkUpdate;providerId?:string;expectedFingerprint?:string;identityKey?:string };
const statusToProvider = (status:Task['status']) => status==='reported_complete'?'done':status;
const statusFromProvider = (record:WorkRecord):Task['status'] => record.status==='done'?'reported_complete':record.status==='cancelled'?'blocked':record.status;
export class MissionService {
  private draining: Promise<void>|null=null;
  constructor(public db:Database, public provider:WorkProvider,public now:()=>string=()=>new Date().toISOString()) {}
  health(m:Mission) {return assessMissionHealth(m,{now:this.now()});}
  async get(id:string,scope:Scope,q?:Query) { const m=await this.db.get(id,scope,q);if(!m)throw new HttpError(404,'Mission not found.','not_found');return m; }
  event(m:Mission,scope:Scope,type:string,summary:string,ids:string[]=[]) {m.events.push({id:randomUUID(),actorId:scope.ownerId,type,summary,relevantIds:ids,timestamp:this.now()});}
  touch(m:Mission) {m.revision++;m.updatedAt=this.now();m.health=this.health(m).health;}
  async mutate(id:string,scope:Scope,fn:(m:Mission,q:Query)=>Promise<void>|void) {
    return this.db.transaction(async q=>{const m=await this.get(id,scope,q);if(m.lifecycle==='completed'||m.lifecycle==='archived')throw new HttpError(409,'Reopen this mission before changing its completed record.','mission_closed');await fn(m,q);this.touch(m);await this.db.save(m,q);return m;});
  }
  async create(scope:Scope,overrides?:Partial<Mission>) {
    const mission=createDemoMission(this.now(),{...overrides,id:randomUUID(),ownerId:scope.ownerId,workspaceId:scope.workspaceId});
    mission.contract.humanOwner=scope.ownerId;
    this.event(mission,scope,'mission.created','Created an editable mission contract. No external tasks exist.');
    await this.db.transaction(q=>this.db.save(mission,q));return mission;
  }
  async saveProposal(id:string,scope:Scope,proposal:Proposal) {
    return this.db.transaction(async q=>{const m=await this.get(id,scope,q);if(m.lifecycle==='completed'||m.lifecycle==='archived')throw new HttpError(409,'Reopen the mission before proposing new work.');if(m.revision!==proposal.baseRevision)throw new HttpError(409,'Mission changed while preparing this proposal. Generate it again.','stale_proposal');
      for(const previous of m.proposals) if(previous.kind===proposal.kind&&previous.state==='pending')previous.state='stale';
      m.proposals.push(proposal);m.updatedAt=this.now();this.event(m,scope,'proposal.created',proposal.title,[proposal.id]);await this.db.save(m,q);return m;
    });
  }
  async plan(id:string,scope:Scope) {
    const m=await this.get(id,scope);if(!m.contract.confirmed)throw new HttpError(422,'Confirm the exact contract and deadline first.');
    if(m.tasks.length)throw new HttpError(409,'This mission already has a plan. Propose task changes instead.');
    const proposal=createDemoPlanProposal(m,this.now()); const mission=await this.saveProposal(id,scope,proposal);return {mission,proposal};
  }
  private assertPermissions(m:Mission,ops:ProposalOperation[],scope:Scope) {
    if(m.ownerId!==scope.ownerId || m.workspaceId!==scope.workspaceId) throw new HttpError(403,'You cannot approve this mission.');
    const mayWriteTasks=m.contract.approvedCapabilities.some(c=>['Create and update tasks after explicit approval','Create and update explicitly approved tasks'].includes(c));
    for(const op of ops) {
      if((op.type==='add_task'||op.type==='update_task'&&Object.keys(op.patch).some(k=>['title','description','status'].includes(k)))&&!mayWriteTasks)throw new HttpError(403,'The confirmed contract does not grant task creation/update capability. Keep the explicit task-write capability in the contract before planning.','capability_denied');
      if(op.type==='add_task') {
        if(!op.task.id.startsWith(m.id+'-'))throw new HttpError(422,'New task IDs must belong to this mission.');
        if(op.task.provider!==null)throw new HttpError(422,'New task mappings are assigned only after provider read-back.');
        if(op.task.ownerId && op.task.ownerId!==scope.ownerId)throw new HttpError(422,'An unknown human owner cannot be assigned.');
        if(op.task.executor==='agent'&&!m.contract.approvedCapabilities.length)throw new HttpError(422,'The contract grants no agent capabilities.');
      }
      if(op.type==='update_task' && op.patch.ownerId && op.patch.ownerId!==scope.ownerId)throw new HttpError(422,'Cannot invent another available human.');
      if(op.type==='add_criterion' && (!op.criterion.id.startsWith(m.id+'-')||op.criterion.verificationState!=='needs_verification'||op.criterion.attestation))throw new HttpError(422,'New criteria must be scoped and cannot verify their own results.');
      if(op.type==='add_criterion'&&m.criteria.some(c=>c.title.trim().toLowerCase()===op.criterion.title.trim().toLowerCase()))throw new HttpError(409,'This criterion already exists. Merge the evidence into the existing requirement instead of creating duplicate work.','duplicate_requirement');
      if(op.type==='update_criterion') {
        if(op.patch.verificationState||op.patch.attestation||op.patch.evidenceIds)throw new HttpError(422,'Use the human verification endpoint to verify a criterion.');
        if(m.criteria.find(c=>c.id===op.criterionId)?.required && op.patch.required===false)throw new HttpError(422,'Required criteria cannot be silently downgraded.');
      }
      if(op.type==='update_contract' && (op.patch.humanOwner&&op.patch.humanOwner!==scope.ownerId || op.patch.approvedCapabilities || op.patch.forbiddenActions || op.patch.confirmed!==undefined))throw new HttpError(422,'This proposal cannot expand its permissions or reconfirm its own contract.');
    }
  }
  async approve(id:string,pid:string,payloadHash:string,scope:Scope) {
    // Capability discovery is read-only and happens outside the transaction.
    const initial=await this.get(id,scope);const before=initial.proposals.find(p=>p.id===pid);
    if(!before)throw new HttpError(404,'Proposal not found.');
    const needsProvider=before.operations.some(op=>op.type==='add_task'||op.type==='update_task'&&Object.keys(op.patch).some(k=>['title','description','status'].includes(k)));
    if(needsProvider){const capabilities=await this.provider.discover();if(!capabilities.writesEnabled)throw new HttpError(503,capabilities.setupRequired.join(' '),'integration_unavailable');}
    let identityKey:string|undefined;
    if(needsProvider&&this.provider.mode==='live'){const identity=await this.provider.identity();if(!identity.verified)throw new HttpError(403,'Verify the intended provider identity before writing.');identityKey=`${identity.workspaceId}:${identity.id}`;}
    if(this.provider.mode==='live'&&before.operations.filter(op=>op.type==='add_task').length>1){
      const ledger=await this.db.query<{create_verified:boolean;update_verified:boolean}>('SELECT create_verified,update_verified FROM integration_verifications WHERE identity_key=$1',[identityKey]);
      if(!ledger.rows[0]?.create_verified||!ledger.rows[0]?.update_verified)throw new HttpError(409,'First prepare and approve one integration smoke task in Settings, verify its read-back, then approve a supported title update. Bulk creation unlocks after both reads succeed in this identity and workspace.','smoke_required');
    }
    const mission=await this.db.transaction(async q=>{
      let m=await this.get(id,scope,q);const p=m.proposals.find(p=>p.id===pid);if(!p)throw new HttpError(404,'Proposal not found.');
      if(m.lifecycle==='completed'||m.lifecycle==='archived')throw new HttpError(409,'Reopen this mission before approving more work.');
      if(p.state==='approved')throw new HttpError(409,'This proposal was already approved. No new operations were queued.','already_approved');
      if(payloadHash!==p.payloadHash||proposalHash(p)!==p.payloadHash)throw new HttpError(409,'The displayed proposal payload changed. Review it again.','payload_mismatch');
      const validity=validateProposal(m,p,this.now());
      if(!validity.valid)throw new HttpError(409,'Proposal is stale, expired, or violates plan constraints. Refresh and review a new diff.','stale_proposal',validity);
      this.assertPermissions(m,p.operations,scope);
      const oldTasks=new Map(m.tasks.map(t=>[t.id,structuredClone(t)]));
      m=applyProposalOperations(m,p.operations);
      const validation=validatePlan(m);if(!validation.valid)throw new HttpError(422,'The proposed plan is invalid.','invalid_plan',validation.issues);
      m.proposals.find(item=>item.id===pid)!.state='approved';
      m.approvals.push({id:randomUUID(),actorId:scope.ownerId,proposalId:pid,payloadHash,timestamp:this.now()});
      const effects:Effect[]=[];
      for(const op of p.operations) {
        if(op.type!=='add_task'&&op.type!=='update_task')continue;
        const taskId=op.type==='add_task'?op.task.id:op.taskId;
        const target=m.tasks.find(t=>t.id===taskId)!;const old=oldTasks.get(taskId);
        if(effects.some(effect=>effect.taskId===taskId))continue;
        let fields:WorkCreate|WorkUpdate;
        if(op.type==='add_task') fields={title:target.title,description:target.description,status:statusToProvider(target.status)};
        else {
          fields={};if(old?.title!==target.title)fields.title=target.title;
          if(old?.description!==target.description)fields.description=target.description;
          const statusRequested=p.operations.some(item=>item.type==='update_task'&&item.taskId===taskId&&item.patch.status!==undefined);
          const observedStatus=old?.provider?.observedStatus??(old?statusToProvider(old.status):undefined);
          if(statusRequested&&observedStatus!==statusToProvider(target.status))fields.status=statusToProvider(target.status);
          // Local scheduling changes have no invented Ambiguous counterpart.
          if(!Object.keys(fields).length)continue;
          if(!old?.provider?.id || !old.provider.fingerprint || old.provider.state!=='synced')throw new HttpError(409,'Sync this task and resolve pending work before proposing another provider update.','sync_required');
          // Provider-owned fields stay observed until successful read-back.
          target.title=old.title;target.description=old.description;target.status=old.status;
        }
        if('title' in fields&&fields.title&&fields.title.length>255)throw new HttpError(422,'Ambiguous task titles must be at most 255 characters.');
        const operationId=randomUUID();effects.push({operationId,taskId,kind:op.type==='add_task'?'create':'update',fields,...(identityKey?{identityKey}:{}),...(old?.provider?{providerId:old.provider.id,expectedFingerprint:old.provider.fingerprint}:{})});
        target.provider={...(old?.provider??{id:''}),state:'pending'};
        // A pending record has no provider ID. Use an explicit local operation reference until read-back.
        if(!target.provider.id)target.provider.id=`pending:${operationId}`;
        m.operations.push({id:operationId,idempotencyKey:operationId,proposalId:pid,taskId,kind:op.type==='add_task'?'create':'update',state:'pending',attempts:[],result:null,reconciliation:'not_needed',createdAt:this.now(),updatedAt:this.now()});
      }
      m.lifecycle='active';this.touch(m);this.event(m,scope,'proposal.approved',`Approved “${p.title}”; ${effects.length} supported provider operation(s) queued.`,[pid]);
      await this.db.save(m,q);
      for(const effect of effects)await q('INSERT INTO outbox(id,mission_id,owner_id,workspace_id,payload,state) VALUES($1,$2,$3,$4,$5,$6)',[effect.operationId,id,scope.ownerId,scope.workspaceId,JSON.stringify(effect),'pending']);
      return m;
    });
    await this.drain();return await this.get(mission.id,scope);
  }
  async drain() {if(this.draining)return this.draining;this.draining=this.drainLoop().finally(()=>{this.draining=null;});return this.draining;}
  private async drainLoop() {
    for(let count=0;count<100;count++) {
      const row=await this.db.transaction(async q=>{
        const r=await q<{id:string;mission_id:string;owner_id:string;workspace_id:string;payload:Effect}>("SELECT * FROM outbox WHERE state='pending' ORDER BY created_at,id LIMIT 1");const row=r.rows[0];if(!row)return null;
        await q("UPDATE outbox SET state='running',claimed_at=now() WHERE id=$1",[row.id]);return row;
      });if(!row)return;
      let result:WorkRecord|undefined;let failure:ProviderError|undefined;
      try {const e=row.payload;
        if(e.identityKey){const identity=await this.provider.identity();if(this.provider.mode!=='live'||!identity.verified||e.identityKey!==`${identity.workspaceId}:${identity.id}`)throw new ProviderError('failed','identity_changed','The configured provider identity changed after approval. Restore the original test workspace before retrying.');}
        else if(this.provider.mode!=='fixture')throw new ProviderError('failed','mode_changed','A fixture-approved operation cannot execute against a live provider.');
        result=e.kind==='create'?await this.provider.createTask(e.fields as WorkCreate,{operationId:e.operationId}):await this.provider.updateTask(e.providerId!,e.fields as WorkUpdate,{operationId:e.operationId,expectedFingerprint:e.expectedFingerprint!});
        // Required read-back even for adapters that already read internally.
        result=await this.provider.readTask(result.id);
      } catch(error) {failure=result?new ProviderError('outcome_unknown','readback_failed','The write returned an ID but read-back could not be verified. Sync to reconcile before retrying.',result.id):error instanceof ProviderError?error:new ProviderError('outcome_unknown','unexpected_provider_error','Provider operation could not be verified. Inspect the provider before retrying.');}
      await this.db.transaction(async q=>{
        const scope={ownerId:row.owner_id,workspaceId:row.workspace_id};const m=await this.get(row.mission_id,scope,q);const op=m.operations.find(o=>o.id===row.id)!;const task=m.tasks.find(t=>t.id===op.taskId)!;
        op.updatedAt=this.now();op.attempts.push({timestamp:this.now(),outcome:failure?failure.message:'Provider read-back verified.'});op.state=failure?.state??'synced';op.result=failure?failure.message:result!.id;op.reconciliation=failure?.state==='outcome_unknown'?'required':'not_needed';
        if(failure)task.provider={...(task.provider??{id:`pending:${op.id}`}),...(failure.providerId?{id:failure.providerId}:{}),state:failure.state,error:failure.message};
        else this.applyReadback(task,result!);
        this.touch(m);this.event(m,scope,failure?'provider.failure':'provider.synced',failure?failure.message:`Read back ${this.provider.mode==='fixture'?'fixture':'Ambiguous'} task ${result!.id}.`,[task.id,op.id]);
        await this.db.save(m,q);await q('UPDATE outbox SET state=$2 WHERE id=$1',[row.id,failure?.state??'done']);
        if(!failure&&row.payload.identityKey){const field=row.payload.kind==='create'?'create_verified':'update_verified';await q(`INSERT INTO integration_verifications(identity_key,${field}) VALUES($1,true) ON CONFLICT(identity_key) DO UPDATE SET ${field}=true,updated_at=now()`,[row.payload.identityKey]);}
      });
    }
  }
  applyReadback(task:Task,record:WorkRecord) {
    const locallyBlocked=task.status==='blocked'&&!!task.blocker;
    task.title=record.title;task.description=record.description;task.status=statusFromProvider(record);
    // A title/description read-back cannot resolve a separately recorded local
    // blocker. Keep the observed provider status in its own mapping field.
    if(locallyBlocked&&record.status!=='done')task.status='blocked';
    if(record.status==='cancelled')task.blocker='The external task was cancelled; required work needs a recovery decision.';
    task.provider={id:record.id,state:'synced',fingerprint:record.fingerprint,observedStatus:record.status,lastSyncedAt:record.observedAt,...(record.url?{url:record.url}:{})};
  }
  async recoverInterruptedOperations() {
    const rows=await this.db.query<{id:string;mission_id:string;owner_id:string;workspace_id:string}>("SELECT id,mission_id,owner_id,workspace_id FROM outbox WHERE state='running'");
    for(const row of rows.rows)await this.db.transaction(async q=>{
      const scope={ownerId:row.owner_id,workspaceId:row.workspace_id};const m=await this.get(row.mission_id,scope,q);const op=m.operations.find(o=>o.id===row.id)!;op.state='outcome_unknown';op.reconciliation='required';op.result='Server stopped during an external operation. Inspect/reconcile before retrying.';
      const task=m.tasks.find(t=>t.id===op.taskId)!;if(task.provider){task.provider.state='outcome_unknown';task.provider.error=op.result;}
      this.touch(m);this.event(m,scope,'provider.interrupted',op.result,[op.id]);await this.db.save(m,q);await q("UPDATE outbox SET state='outcome_unknown' WHERE id=$1",[row.id]);
    });
  }
  async sync(id:string,scope:Scope) {
    const snapshot=await this.get(id,scope);
    for(const original of snapshot.tasks.filter(t=>t.provider&&!t.provider.id.startsWith('pending:')&&t.provider.state!=='pending')) {
      let read:WorkRecord|undefined;let error:unknown;
      try{read=await this.provider.readTask(original.provider!.id);}catch(e){error=e;}
      await this.mutate(id,scope,async(m,q)=>{
        const task=m.tasks.find(t=>t.id===original.id)!;
        if(task.provider?.state==='pending'||task.provider?.fingerprint!==original.provider?.fingerprint)return;
        if(error){task.provider!.state=error instanceof ProviderError?error.state:'failed';task.provider!.error='Could not read the provider task. Sync again to retry this read.';this.event(m,scope,'sync.failed',task.provider!.error,[task.id]);return;}
        this.applyReadback(task,read!);
        for(const op of m.operations.filter(o=>o.taskId===task.id&&o.state==='outcome_unknown')) {
          const out=await q<{payload:Effect}>('SELECT payload FROM outbox WHERE id=$1',[op.id]);const effect=out.rows[0]?.payload;
          const matches=effect&&Object.entries(effect.fields).every(([key,value])=>read![key as keyof WorkRecord]===value);
          if(matches){op.state='synced';op.reconciliation='reconciled';op.result=read!.id;await q("UPDATE outbox SET state='done' WHERE id=$1",[op.id]);}
          else {task.provider!.state='outcome_unknown';task.provider!.error='The provider record exists but does not match the approved operation. Inspect before resolving.';}
        }
        this.event(m,scope,'sync.read','Retrieved current provider fields. Criterion verification remains a separate human decision.',[task.id]);
      });
    }
    return this.get(id,scope);
  }
  async editTask(id:string,tid:string,raw:unknown,scope:Scope) {
    const m=await this.get(id,scope);const task=m.tasks.find(t=>t.id===tid);if(!task)throw new HttpError(404,'Task not found.');
    const patch=taskPatchSchema.parse(raw);const proposal=createProposal(m,{kind:'recovery',title:`Update ${task.title}`,operations:[{type:'update_task',taskId:tid,patch}],rationale:'User requested this exact task change. Dependencies, criterion coverage and provider fingerprints will be checked at approval.'},this.now());
    const mission=await this.saveProposal(id,scope,proposal);return {mission,proposal};
  }
  async capture(id:string,raw:{text?:string;excerpt?:string;sourceUrl?:string|null;title:string;capturedAt:string;captureMethod:Evidence['captureMethod'];fixture?:boolean;truncated?:boolean},scope:Scope,fixtureAnalysis=true) {
    return this.db.transaction(async q=>{
      const m=await this.get(id,scope,q);const evidence=prepareCapture({id:randomUUID(),text:raw.text??raw.excerpt??'',title:raw.title,sourceUrl:raw.sourceUrl,capturedAt:raw.capturedAt,captureMethod:raw.captureMethod,fixture:raw.fixture},this.now());evidence.truncated ||= !!raw.truncated;
      if(m.lifecycle==='completed'||m.lifecycle==='archived')throw new HttpError(409,'Reopen this mission before accepting new evidence.');
      const duplicates=findDuplicateEvidence(m.evidence,evidence);if(duplicates.exact)return {mission:m,duplicate:true,summary:'This exact excerpt was already accepted. No task was created.'};
      const analysis=fixtureAnalysis?analyzeEvidence(m,evidence,this.now()):{summary:'Accepted excerpt saved for model impact analysis.',proposal:undefined};
      m.evidence.push(evidence);this.touch(m);
      let proposal=analysis.proposal;
      if(proposal){proposal={...proposal,baseRevision:m.revision};proposal.payloadHash=proposalHash(proposal);m.proposals.push(proposal);}
      this.event(m,scope,'evidence.accepted',analysis.summary,[evidence.id,...(proposal?[proposal.id]:[])]);await this.db.save(m,q);
      return {mission:m,proposal,evidence,duplicate:false,summary:analysis.summary,possibleDuplicateEvidenceIds:duplicates.possible.map(e=>e.id)};
    });
  }
  async recovery(id:string,scope:Scope) {
    return this.db.transaction(async q=>{const m=await this.get(id,scope,q);if(m.lifecycle==='completed'||m.lifecycle==='archived')throw new HttpError(409,'Reopen this mission before proposing recovery work.','mission_closed');const proposals=proposeRecovery(m,this.now());for(const old of m.proposals)if(old.kind==='recovery'&&old.state==='pending')old.state='stale';m.proposals.push(...proposals);this.event(m,scope,'recovery.proposed',`${proposals.length} recovery option(s) prepared. Unresolved blockers remain explicit.`);await this.db.save(m,q);return {mission:m,proposals};});
  }
  async verify(id:string,cid:string,statement:string,scope:Scope) {
    return this.mutate(id,scope,m=>{const c=m.criteria.find(c=>c.id===cid);if(!c)throw new HttpError(404,'Criterion not found.');c.verificationState='verified';c.attestation={actorId:scope.ownerId,timestamp:this.now(),statement};this.event(m,scope,'criterion.attested',`Human attestation for “${c.title}”: ${statement}`,[cid]);});
  }
  async complete(id:string,scope:Scope) {return this.mutate(id,scope,m=>{const review=canCompleteMission(m);if(!review.allowed)throw new HttpError(422,'Every required criterion needs verification or your explicit attestation.','needs_verification',review);m.lifecycle='completed';this.event(m,scope,'mission.completed','All required criteria were verified or explicitly attested by the mission owner.');});}
}
