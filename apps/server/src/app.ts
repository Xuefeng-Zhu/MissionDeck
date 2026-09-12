import express,{type Request,type Response,type NextFunction} from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createProposal,proposalOperationSchema,taskSchema,criterionSchema,validateProposal,type Criterion,type Mission } from '@mission/domain';
import { config,repoRoot } from './config.js';
import { type Database } from './database.js';
import { type AuthenticatedRequest,authMiddleware,equalSecret,issueSession,pairingCode } from './auth.js';
import { HttpError } from './errors.js';
import { MissionService } from './service.js';
import { Planner,SAFETY_PROMPT } from './model.js';
import { ProviderError } from './providers/index.js';

const line=z.string().trim().min(1).max(500);
const contractInput=z.object({goal:line,deadline:z.string().datetime({offset:true}),timezone:line,criteria:z.array(z.object({id:z.string().optional(),title:line,required:z.boolean(),verificationMethod:line}).passthrough()).min(1).max(30),outcome:line.optional(),constraints:z.array(line).optional(),forbiddenActions:z.array(line).optional(),approvedCapabilities:z.array(line).optional(),assumptions:z.array(line).optional(),questions:z.array(line).optional(),unresolvedQuestions:z.array(line).optional(),confirmed:z.boolean().optional(),humanOwner:z.string().optional()});
const scope=(req:Request)=>(req as AuthenticatedRequest).principal;
const param=(req:Request,name:string)=>z.string().max(160).regex(/^[\w.:-]+$/).parse(req.params[name]);
const reply=(res:Response,m:Mission,service:MissionService)=>res.json({mission:m,health:service.health(m)});

export async function createApp(service:MissionService,options?:{pairingCode?:string;enableCopilot?:boolean}) {
  const app=express();const db=service.db;const code=options?.pairingCode??await pairingCode();const planner=new Planner();
  const pairedOrigins=new Set(config.origins);const origins=await db.query<{origin:string}>('SELECT DISTINCT origin FROM sessions WHERE expires_at>now()');origins.rows.forEach(r=>pairedOrigins.add(r.origin));
  const attempts=new Map<string,{count:number;reset:number}>();
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    const hostname=(req.headers.host??'').split(':')[0];
    if(!['127.0.0.1','localhost','['].includes(hostname)) {res.status(403).json({error:'This local server accepts only loopback hosts.'});return;}
    const origin=req.headers.origin;
    const pairingPath=req.path==='/api/pair'||req.path==='/api/config';
    const allowed=origin&&(pairedOrigins.has(origin)||(pairingPath&&/^chrome-extension:\/\/[a-p]{32}$/.test(origin)));
    if(origin&&!allowed){res.status(403).json({error:'This origin is not paired with Mission Control.'});return;}
    if(allowed){res.setHeader('Access-Control-Allow-Origin',origin!);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');}
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method==='OPTIONS'){res.sendStatus(204);return;}next();
  });
  app.use(express.json({limit:'256kb'}));
  app.get('/health',(_req,res)=>res.json({status:'ok',service:'mission-control'}));
  const missing=[...(config.PROVIDER_MODE==='live'&&!config.AMBIGUOUS_API_KEY?['Set AMBIGUOUS_API_KEY on the server.']:[]),...(config.PROVIDER_MODE==='live'&&(!config.AMBIGUOUS_EXPECTED_USER_ID||!config.AMBIGUOUS_EXPECTED_WORKSPACE_ID)?['Set AMBIGUOUS_EXPECTED_USER_ID and AMBIGUOUS_EXPECTED_WORKSPACE_ID after inspecting the connected identity.']:[]),...(config.MODEL_MODE==='live'&&!config.OPENAI_API_KEY?['Set OPENAI_API_KEY on the server.']:[])];
  app.get('/api/config',(_req,res)=>res.json({providerMode:config.PROVIDER_MODE,modelMode:config.MODEL_MODE,mode:config.PROVIDER_MODE,databaseMode:config.DATABASE_MODE,modelEnabled:config.MODEL_MODE==='live'&&!!config.OPENAI_API_KEY,liveReady:false,missing,setupRequired:missing,identity:null,researchEnabled:false,demoNow:null,fixtureNotice:'Fixture provider records and deterministic planning suggestions are local simulation. No sponsor calls are made in fixture mode.'}));
  app.get('/privacy',(_req,res)=>res.type('text/plain').sendFile(resolve(repoRoot,'docs/privacy.md')));
  app.post('/api/pair',async(req,res)=>{
    const origin=req.headers.origin??'local-cli';const key=req.socket.remoteAddress??'local';const current=attempts.get(key);const bucket=current&&current.reset>Date.now()?current:{count:0,reset:Date.now()+60_000};attempts.set(key,bucket);
    if(++bucket.count>10)throw new HttpError(429,'Too many pairing attempts. Wait one minute.');
    const body=z.object({code:z.string().min(1).max(512)}).strict().parse(req.body);
    if(!equalSecret(body.code.trim(),code))throw new HttpError(401,'Pairing code is incorrect.','unauthorized');
    const token=await issueSession(db,origin);pairedOrigins.add(origin);res.json({token,expiresIn:86400});
  });
  app.use('/api',authMiddleware(db));
  app.post('/api/session/revoke',async(req,res)=>{await db.query('DELETE FROM sessions WHERE token_hash=$1',[scope(req).tokenHash]);res.json({revoked:true});});
  app.get('/api/integrations/check',async(_req,res)=>{const capabilities=await service.provider.discover();let identity=null;try{identity=await service.provider.identity();}catch{}res.json({capabilities,identity,liveReady:service.provider.mode==='live'&&capabilities.writesEnabled,setupRequired:capabilities.setupRequired});});
  app.post('/api/integrations/smoke',async(req,res)=>{
    const m=await service.create(scope(req));
    m.goal='Verify the Ambiguous test-workspace connection';m.contract.outcome='Read back one explicitly approved task, then approve and verify a supported title update.';m.contract.confirmed=true;m.contract.assumptions=['This is a disposable integration smoke task in the user-controlled test workspace.'];
    m.criteria=[criterionSchema.parse({id:`${m.id}-smoke`,title:'Task creation, read-back and supported update verified',required:true,verificationMethod:'Inspect returned provider ID after create/read and a title update/read.',verificationState:'needs_verification',evidenceIds:[]})];
    const task=taskSchema.parse({id:`${m.id}-smoke-task`,title:'Mission Control integration smoke test',description:'User-approved integration test task. Do not perform external submission or communication.',status:'todo',executor:'human',ownerId:m.ownerId,dependencies:[],criterionIds:[m.criteria[0]!.id],remainingMinutes:5,optional:false,deferred:false,completionEvidence:'Successful create, ID-based read-back, then a supported title update and another read-back.',provider:null});
    const proposal=createProposal(m,{id:randomUUID(),kind:'plan',title:'Approve one integration test task',operations:[{type:'add_task',task}],rationale:'First verify one task in the connected test workspace. After successful read-back, propose a title edit from task details and approve it. Bulk task creation remains gated until this create/read/update path succeeds.'},service.now());
    m.proposals.push(proposal);await db.transaction(q=>db.save(m,q));res.json({mission:m,proposal});
  });
  app.get('/api/missions',async(req,res)=>res.json({missions:await db.list(scope(req))}));
  app.post('/api/missions/demo',async(req,res)=>reply(res,await service.create(scope(req)),service));
  const applyContract=(m:Mission,body:z.infer<typeof contractInput>)=>{
    try {new Intl.DateTimeFormat('en-US',{timeZone:body.timezone}).format(new Date(body.deadline));}catch{throw new HttpError(422,'Use a valid IANA timezone and exact deadline.');}
    m.goal=body.goal;m.deadline=body.deadline;m.timezone=body.timezone;
    m.contract={...m.contract,confirmed:body.confirmed??true,outcome:body.outcome??body.goal,humanOwner:m.ownerId,constraints:body.constraints??m.contract.constraints,forbiddenActions:body.forbiddenActions??m.contract.forbiddenActions,approvedCapabilities:body.approvedCapabilities??m.contract.approvedCapabilities,assumptions:body.assumptions??m.contract.assumptions,unresolvedQuestions:body.unresolvedQuestions??body.questions??m.contract.unresolvedQuestions};
    m.criteria=body.criteria.map(c=>criterionSchema.parse({id:c.id&&m.criteria.some(existing=>existing.id===c.id)?c.id:`${m.id}-${randomUUID()}`,title:c.title,required:c.required,verificationMethod:c.verificationMethod,verificationState:'needs_verification',evidenceIds:[]}));
    if(!m.criteria.some(c=>c.required))throw new HttpError(422,'At least one required criterion is needed.');
  };
  app.post('/api/missions',async(req,res)=>{const body=contractInput.parse(req.body);const m=await service.create(scope(req));const mission=await service.mutate(m.id,scope(req),m=>{applyContract(m,body);service.event(m,scope(req),'contract.confirmed','Owner confirmed the editable contract and exact deadline.');});reply(res,mission,service);});
  app.get('/api/missions/:id',async(req,res)=>reply(res,await service.get(param(req,'id'),scope(req)),service));
  app.post('/api/missions/:id/contract',async(req,res)=>{const body=contractInput.parse(req.body);reply(res,await service.mutate(param(req,'id'),scope(req),m=>{if(m.tasks.length)throw new HttpError(409,'An active contract must change through a reviewed proposal.');applyContract(m,body);service.event(m,scope(req),'contract.confirmed','Owner confirmed the exact deadline, criteria and constraints.');}),service);});
  app.post('/api/missions/:id/plan',async(req,res)=>{const id=param(req,'id');if(config.MODEL_MODE==='fixture'){res.json(await service.plan(id,scope(req)));return;}const m=await service.get(id,scope(req));if(!m.contract.confirmed||m.tasks.length)throw new HttpError(409,'Confirm a new contract before generating its first plan.');const proposal=await planner.plan(m,service.now());res.json({mission:await service.saveProposal(id,scope(req),proposal),proposal});});
  app.post('/api/missions/:id/proposals/:pid/approve',async(req,res)=>{const body=z.object({payloadHash:z.string().length(64)}).strict().parse(req.body);reply(res,await service.approve(param(req,'id'),param(req,'pid'),body.payloadHash,scope(req)),service);});
  app.post('/api/missions/:id/proposals/:pid/reject',async(req,res)=>reply(res,await service.mutate(param(req,'id'),scope(req),m=>{const p=m.proposals.find(p=>p.id===param(req,'pid'));if(!p)throw new HttpError(404,'Proposal not found.');if(p.state!=='pending')throw new HttpError(409,'Only a pending proposal can be rejected.');p.state='rejected';service.event(m,scope(req),'proposal.rejected',`Rejected “${p.title}”.`,[p.id]);}),service));
  app.patch('/api/missions/:id/proposals/:pid',async(req,res)=>{
    const body=z.object({operations:z.array(proposalOperationSchema).min(1).max(100)}).strict().parse(req.body);const id=param(req,'id');const m=await service.get(id,scope(req));const old=m.proposals.find(p=>p.id===param(req,'pid'));if(!old||old.state!=='pending')throw new HttpError(409,'Edit a pending proposal.');
    const proposal=createProposal(m,{id:randomUUID(),kind:old.kind,title:old.title,operations:body.operations,rationale:old.rationale,evidenceIds:old.evidenceIds,scheduleNote:'Edited proposal. Review the complete diff; health is recomputed from the edited candidate.'},service.now());res.json({mission:await service.saveProposal(id,scope(req),proposal),proposal});
  });
  app.post('/api/missions/:id/proposals/:pid/refresh',async(req,res)=>{
    const id=param(req,'id');const m=await service.get(id,scope(req));const old=m.proposals.find(p=>p.id===param(req,'pid'));if(!old||old.state==='approved'||old.state==='rejected')throw new HttpError(409,'Only unapproved, unrejected proposals can be refreshed.');
    const proposal=createProposal(m,{id:randomUUID(),kind:old.kind,title:old.title,operations:old.operations,rationale:old.rationale,evidenceIds:old.evidenceIds,scheduleNote:'Refreshed against the current mission revision. Review the complete diff and updated scheduling assumptions.'},service.now());
    const validation=validateProposal(m,proposal,service.now());if(!validation.valid)throw new HttpError(409,'These operations no longer fit the current plan. Edit the proposal or generate a new recovery option.','refresh_conflict',validation.reasons);
    res.json({mission:await service.saveProposal(id,scope(req),proposal),proposal});
  });
  app.post('/api/missions/:id/evidence',async(req,res)=>{
    const body=z.object({text:z.string().max(20000).optional(),excerpt:z.string().max(20000).optional(),title:z.string().min(1).max(500),sourceUrl:z.string().max(2000).nullable().optional(),capturedAt:z.string().datetime({offset:true}),captureMethod:z.enum(['selection','page','manual']),fixture:z.boolean().optional(),truncated:z.boolean().optional(),id:z.string().optional(),contentHash:z.string().optional(),acceptedAt:z.string().optional(),retention:z.string().optional()}).strict().parse(req.body);
    const id=param(req,'id');const result=await service.capture(id,body,scope(req),config.MODEL_MODE==='fixture');
    if(config.MODEL_MODE==='live'&&!result.duplicate&&result.evidence&&!result.possibleDuplicateEvidenceIds?.length){const proposal=await planner.assessEvidence(result.mission,result.evidence,service.now());if(proposal){result.mission=await service.saveProposal(id,scope(req),proposal);result.proposal=proposal;}}
    res.json(result);
  });
  app.post('/api/missions/:id/tasks/:tid/propose',async(req,res)=>res.json(await service.editTask(param(req,'id'),param(req,'tid'),req.body,scope(req))));
  app.post('/api/missions/:id/tasks/propose',async(req,res)=>{
    const m=await service.get(param(req,'id'),scope(req));const body=taskSchema.omit({id:true,provider:true,status:true,deferred:true,ownerId:true,blocker:true,suggested:true}).parse(req.body);
    const task=taskSchema.parse({...body,id:`${m.id}-${randomUUID()}`,ownerId:m.ownerId,status:'todo',deferred:false,provider:null,suggested:true});
    const proposal=createProposal(m,{id:randomUUID(),kind:'plan',title:`Add ${task.title}`,operations:[{type:'add_task',task}],rationale:'User-proposed task. Required coverage, effort, dependencies and provider capabilities will be checked before creation.'},service.now());res.json({mission:await service.saveProposal(m.id,scope(req),proposal),proposal});
  });
  app.post('/api/missions/:id/tasks/:tid/block',async(req,res)=>{
    const {reason}=z.object({reason:z.string().trim().min(3).max(2000)}).strict().parse(req.body);
    reply(res,await service.mutate(param(req,'id'),scope(req),m=>{const t=m.tasks.find(t=>t.id===param(req,'tid'));if(!t)throw new HttpError(404,'Task not found.');t.blocker=reason;t.status='blocked';service.event(m,scope(req),'task.blocked',`User reported a local blocker: ${reason}. External status was not changed.`,[t.id]);}),service);
  });
  app.post('/api/missions/:id/tasks/:tid/resolve',async(req,res)=>{
    const body=z.object({resolution:z.string().trim().min(3).max(2000),remainingMinutes:z.number().int().min(0).max(525600).nullable()}).strict().parse(req.body);
    reply(res,await service.mutate(param(req,'id'),scope(req),m=>{const t=m.tasks.find(t=>t.id===param(req,'tid'));if(!t||!t.blocker)throw new HttpError(409,'This task has no recorded blocker.');delete t.blocker;t.status='todo';t.remainingMinutes=body.remainingMinutes;service.event(m,scope(req),'task.blocker_resolved',`Human reported resolution: ${body.resolution}. External status has not been changed.`,[t.id]);}),service);
  });
  app.post('/api/missions/:id/recovery',async(req,res)=>res.json(await service.recovery(param(req,'id'),scope(req))));
  app.post('/api/missions/:id/sync',async(req,res)=>reply(res,await service.sync(param(req,'id'),scope(req)),service));
  app.post('/api/missions/:id/criteria/:cid/verify',async(req,res)=>{const {attestation}=z.object({attestation:z.string().trim().min(8).max(500)}).strict().parse(req.body);reply(res,await service.verify(param(req,'id'),param(req,'cid'),attestation,scope(req)),service);});
  app.post('/api/missions/:id/complete',async(req,res)=>reply(res,await service.complete(param(req,'id'),scope(req)),service));
  app.post('/api/missions/:id/reopen',async(req,res)=>{const m=await db.transaction(async q=>{const m=await service.get(param(req,'id'),scope(req),q);if(m.lifecycle!=='completed')throw new HttpError(409,'Only a completed mission can be reopened.');m.lifecycle='active';service.touch(m);service.event(m,scope(req),'mission.reopened','Owner explicitly reopened the mission for further work.');await db.save(m,q);return m;});reply(res,m,service);});
  app.post('/api/missions/:id/operations/:oid/retry',async(req,res)=>{
    const id=param(req,'id');await db.transaction(async q=>{const m=await service.get(id,scope(req),q);if(m.lifecycle==='completed'||m.lifecycle==='archived')throw new HttpError(409,'Reopen this mission before retrying provider work.','mission_closed');const op=m.operations.find(o=>o.id===param(req,'oid'));if(!op||op.state!=='failed')throw new HttpError(409,'Only a definite failed operation can be retried. Unknown outcomes need inspection and reconciliation.');if(op.attempts.length>=3)throw new HttpError(409,'This operation reached its retry limit. Inspect the failure before creating a fresh proposal.');
      const approved=m.proposals.find(p=>p.id===op.proposalId);if(!approved||approved.state!=='approved'||!m.approvals.some(a=>a.proposalId===approved.id&&a.payloadHash===approved.payloadHash))throw new HttpError(403,'This operation has no exact recorded approval.');
      op.state='pending';const task=m.tasks.find(t=>t.id===op.taskId)!;if(task.provider)task.provider.state='pending';service.touch(m);service.event(m,scope(req),'operation.retry','Owner retried a definite failed operation with its original approval and idempotency key.',[op.id]);await db.save(m,q);await q("UPDATE outbox SET state='pending' WHERE id=$1 AND state='failed'",[op.id]);
    });await service.drain();reply(res,await service.get(id,scope(req)),service);
  });
  app.delete('/api/missions/:id',async(req,res)=>{const id=param(req,'id');await service.get(id,scope(req));await db.transaction(async q=>{const pending=await q("SELECT id FROM outbox WHERE mission_id=$1 AND state IN ('pending','running')",[id]);if(pending.rows.length)throw new HttpError(409,'Wait for pending operations before deleting this mission.');await q('DELETE FROM missions WHERE id=$1 AND owner_id=$2 AND workspace_id=$3',[id,scope(req).ownerId,scope(req).workspaceId]);});res.json({deleted:true,externalTasksDeleted:false});});
  // Fixture pages are explicit test material; never inject a page bridge into arbitrary websites.
  app.use('/fixtures',express.static(resolve(repoRoot,'fixtures'),{index:'requirements.html'}));
  if(options?.enableCopilot!==false&&config.MODEL_MODE==='live'&&config.OPENAI_API_KEY){
    const {CopilotRuntime,BuiltInAgent,InMemoryAgentRunner}=await import('@copilotkit/runtime/v2');const {createCopilotExpressHandler}=await import('@copilotkit/runtime/v2/express');
    const runtime=new CopilotRuntime({agents:{default:new BuiltInAgent({model:`openai:${config.OPENAI_MODEL}`,prompt:SAFETY_PROMPT,maxSteps:1,maxOutputTokens:1800,maxRetries:0,providerOptions:{openai:{store:false}}})},runner:new InMemoryAgentRunner({maxThreads:20,maxRunsPerThread:20,maxBytes:16*1024*1024,onConcurrentRun:'throw'}),openGenerativeUI:false});
    const copilotRouter=createCopilotExpressHandler({runtime,basePath:'/api/copilotkit',cors:false,activateChannels:false});
    // Runtime 1.70.3 exports Express 4 Router types; its Node request/response
    // middleware is compatible with our Express 5 host. Keep this adaptation at the mount.
    app.use(copilotRouter as unknown as express.RequestHandler);
  }else app.use('/api/copilotkit',(_req,res)=>res.status(503).json({error:'CopilotKit live conversation requires MODEL_MODE=live and a server-side OPENAI_API_KEY. The fixture workflow is available through explicit review controls.'}));
  app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
    if(res.headersSent)return;
    if(error instanceof z.ZodError){res.status(422).json({error:'Some fields are invalid.',code:'validation_error',details:error.issues.map(i=>({path:i.path,message:i.message}))});return;}
    if(error instanceof HttpError){res.status(error.status).json({error:error.message,code:error.code,details:error.details});return;}
    if(error instanceof ProviderError){res.status(error.state==='conflict'?409:503).json({error:error.message,code:error.code,state:error.state});return;}
    // Never log provider request bodies, captures, session credentials, or exception objects.
    console.error('Request failed:',error instanceof Error?error.name:'UnknownError');
    res.status(500).json({error:'The request could not be completed. Saved state is preserved; refresh before retrying.',code:'internal_error'});
  });
  return app;
}
