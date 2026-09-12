import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ArtifactOperation, WorkspaceApp, WorkspaceArtifact } from '../../../packages/domain/src/artifacts.js';
import type { ArtifactAuthority, WorkspaceProvider } from './artifact-coordinator.js';
import { AmbiguousWorkProvider, type AmbiguousOptions } from './providers/ambiguous.js';
import { fingerprint, ProviderError } from './providers/types.js';
import {verifyWorkspaceDestination} from './workspace-destination.js';
import {mapWorkspaceWrite} from './workspace-mapping.js';
import { UpgradeStore } from './upgrade-store.js';

export const WORKSPACE_CAPABILITIES = [
 {app:'docs',status:'documented-but-untested',read:true,write:'Create restricted document; full replacement with explicit approval and fingerprint check',blocker:'Live credentials and test workspace required; no native conditional write.'},
 {app:'sheets',status:'documented-but-untested',read:true,write:'Fixture cell updates only',blocker:'OpenAPI cell update items are untyped; literal/formula encoding needs authoritative verification.'},
 {app:'slides',status:'documented-but-untested',read:true,write:'Native empty presentation create or explicit slide notes update; fixture rich presentation',blocker:'Rich editable element schema is untyped. Native rich authoring not implemented; narrow operations untested live.'},
 {app:'mail',status:'documented-but-untested',read:true,write:'Local email proposal or explicit native draft create with read-back',blocker:'Send adapter checks exact recipients and provider sent status with idempotency. Separate one-off sharing approval and verified live identity required; untested live.'},
 {app:'chat',status:'documented-but-untested',read:true,write:'Local chat proposal',blocker:'Requires complete private/DM roster, exact audience, no mentions. Separate one-off sharing approval and verified live identity required; live proof unavailable.'},
 {app:'calendar',status:'documented-but-untested',read:true,write:'Local meeting proposal',blocker:'Requires owned unpublished local calendar, user-only ACL, complete free/busy and conflicts. Separate one-off invitation/sharing approval and verified live identity required; live proof unavailable.'},
 {app:'tasks',status:'documented-but-untested',read:true,write:'Existing verified task adapter',blocker:'Live credential and authorized test workspace required.'},
 {app:'automations',status:'documented-but-untested',read:false,write:'See routine compiler',blocker:'Native node schemas and authorized runtime proof required.'},
 {app:'assistant',status:'blocked',read:false,write:'Disabled',blocker:'Instruction-only delegation cannot enforce approved execution scope.'},
] as const;
const id=z.string().uuid();
/** Live REST paths are closed, selected-object reads only; no arbitrary URL or mailbox listing. */
export class AmbiguousWorkspaceProvider implements WorkspaceProvider {
 readonly mode='live' as const;
 constructor(private options:AmbiguousOptions){}
 private async request(path:string,method='GET',body?:unknown,operationId?:string):Promise<unknown>{
  if(!/^\/api\/(documents(?:\/[0-9a-f-]{36})?|sheets\/[0-9a-f-]{36}|slides(?:\/[0-9a-f-]{36}\/(?:data|slides\/\d+))?|mail\/(?:[0-9a-f-]{36}|drafts|send)|calendars\/(?:events\/[0-9a-f-]{36}|[0-9a-f-]{36}(?:\/(?:events|permissions))?|(?:availability|conflicts)\?[a-zA-Z0-9_%=&.,:-]+)|channels\/[0-9a-f-]{36}(?:\/messages(?:\?limit=20|\/[0-9a-f-]{36})?)?)$/i.test(path)) throw new ProviderError('failed','unsupported_path','This workspace path is not reviewed.');
  if(!this.options.apiKey)throw new ProviderError('failed','missing_credentials','Live workspace access requires AMBIGUOUS_API_KEY.');
  const identity=await new AmbiguousWorkProvider(this.options).identity();
  if(!identity.verified)throw new ProviderError('failed','identity_unverified','Review the configured provider user and workspace before access.');
  let response:Response;
  try {response=await (this.options.fetch??fetch)(`https://app.ambiguous.ai${path}`,{method,redirect:'error',signal:AbortSignal.timeout(this.options.timeoutMs??12000),headers:{Authorization:`Bearer ${this.options.apiKey}`,'API-Version':'1','Content-Type':'application/json',...(path==='/api/mail/send'&&operationId?{'Idempotency-Key':operationId}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  catch{throw new ProviderError(method==='GET'?'failed':'outcome_unknown','request_unconfirmed','The provider did not confirm the operation. Inspect before retrying a write.');}
  if(!response.ok)throw new ProviderError(method!=='GET'&&response.status>=500?'outcome_unknown':'failed',`provider_http_${response.status}`,`Workspace request returned HTTP ${response.status}. Live mode remains selected.`);
  try{return await response.json();}catch{throw new ProviderError(method==='GET'?'failed':'outcome_unknown','invalid_response','Provider response could not be verified.');}
 }
 private record(app:WorkspaceApp,body:unknown):WorkspaceArtifact{
  const value=z.object({id:z.string().uuid(),title:z.string().optional(),subject:z.string().optional(),content:z.string().nullable().optional(),body_text:z.string().nullable().optional()}).passthrough().safeParse(body);
  if(!value.success)throw new ProviderError('failed','invalid_artifact','The provider returned an unrecognized artifact.');
  const v=value.data;const content=v.content??v.body_text??JSON.stringify(v.data??v);
  if(content.length>50000)throw new ProviderError('failed','content_limit','Select a narrower object or use its native editor; content exceeds the review limit.');
  return {id:v.id,app,title:v.title??v.subject??app,content,fingerprint:fingerprint(v),url:null,mode:'live',verifiedAt:new Date().toISOString(),state:'verified'};
 }
 async read(app:WorkspaceApp,objectId:string,authority:ArtifactAuthority){
  id.parse(objectId);if(!authority.allowedTargetIds.includes(objectId))throw new ProviderError('failed','target_scope','Select and authorize the object before reading it.');
  if(app==='tasks'){const identity=await new AmbiguousWorkProvider(this.options).identity();if(!identity.verified)throw new ProviderError('failed','identity_unverified','Review the provider identity before access.');const task=await new AmbiguousWorkProvider(this.options).readTask(objectId);return {id:task.id,app,title:task.title,content:task.description,fingerprint:task.fingerprint,url:task.url,mode:'live' as const,verifiedAt:task.observedAt,state:'verified' as const};}
  const path=app==='docs'?`/api/documents/${objectId}`:app==='sheets'?`/api/sheets/${objectId}`:app==='slides'?`/api/slides/${objectId}/data`:app==='mail'?`/api/mail/${objectId}`:app==='calendar'?`/api/calendars/events/${objectId}`:app==='chat'?`/api/channels/${objectId}/messages?limit=20`:null;
  if(!path)throw new ProviderError('failed','unsupported_read','This scoped workspace read is not implemented.');
  const body=await this.request(path);
  if(app==='chat')return this.record(app,{id:objectId,title:'Selected channel · latest 20 messages',content:JSON.stringify(body)});
  return this.record(app,body);
 }
 async readResult(op:ArtifactOperation,objectId:string,authority:ArtifactAuthority):Promise<WorkspaceArtifact>{
  if(op.app!=='chat')return this.read(op.app,objectId,authority);
  id.parse(objectId);id.parse(op.targetId);
  if(!authority.allowedTargetIds.includes(objectId)||!authority.allowedTargetIds.includes(op.targetId!))throw new ProviderError('failed','target_scope','Select the original channel and returned message before reconciliation.');
  return this.record('chat',await this.request(`/api/channels/${op.targetId}/messages/${objectId}`));
 }
 async execute(op:ArtifactOperation,authority:ArtifactAuthority,_operationId:string):Promise<WorkspaceArtifact>{
  if(op.action==='prepare')return {id:`proposal-${randomUUID()}`,app:op.app,title:op.title,content:op.content,fingerprint:fingerprint(op),url:null,mode:'live',state:'proposal',verifiedAt:null};
  if(op.app!=='docs'&&op.app!=='sheets'){
   const mapping=mapWorkspaceWrite(op);
   if(!authority.categories.includes(mapping.category))throw new ProviderError('failed','category_scope','This operation requires separate authorization.');
   if(op.audience.some(a=>!authority.allowedAudience.includes(a)))throw new ProviderError('failed','destination_scope','Destination audience has not been authorized.');
   if(op.app==='mail'&&op.action==='send'){z.array(z.email()).min(1).parse(op.audience);if(!_operationId)throw new ProviderError('failed','operation_key_required','A durable send operation key is required.');}
   if(op.app==='chat'||op.app==='calendar')await verifyWorkspaceDestination(op,this.options.expectedUserId??'',this.options.expectedWorkspaceId??'',path=>this.request(path));
   if(op.app==='slides'&&op.action==='update'){
    const raw=await this.request(`/api/slides/${op.targetId}/data`) as {visibility?:string;can_edit?:boolean};
    if(raw.visibility!=='restricted'||raw.can_edit!==true)throw new ProviderError('failed','audience_unverified','Only editable restricted decks are supported.');
    if(this.record('slides',raw).fingerprint!==op.expectedFingerprint)throw new ProviderError('conflict','target_changed','The presentation changed after review.');
   }
   const raw=await this.request(mapping.path,mapping.method,mapping.body,_operationId);
   let accepted:WorkspaceArtifact;
   try{accepted=this.record(op.app,raw);}catch{throw new ProviderError('outcome_unknown','invalid_write_response','Native write returned no verifiable artifact.');}
   try{
    const body=await this.request(mapping.readPath!(accepted.id));const observed=this.record(op.app,body);
    if(observed.fingerprint!==accepted.fingerprint)throw new Error('different');
    if(op.app==='mail'&&(observed.title!==op.title||observed.content!==op.content))throw new Error('draft differs');
    if(op.app==='mail'&&op.action==='send'){
     const sent=z.object({delivery_status:z.literal('sent'),sent_at:z.string(),to:z.array(z.union([z.string(),z.object({email:z.string()})]))}).parse(body);
     const recipients=sent.to.map(r=>typeof r==='string'?r:r.email);if(recipients.length!==op.audience.length||recipients.some(r=>!op.audience.includes(r)))throw new Error('recipients differ');
    }
    if(op.app==='chat'){
     const message=z.object({channel_id:z.string(),content:z.string(),thread_id:z.string().nullable()}).parse(body);
     if(message.channel_id!==op.targetId||message.content!==op.content||message.thread_id!==(op.threadId??null))throw new Error('message differs');
    }
    if(op.app==='calendar'){
     const event=z.object({title:z.string(),description:z.string().nullable(),start_at:z.string(),end_at:z.string(),attendees:z.array(z.object({id:z.string().nullable(),kind:z.literal('user')}))}).parse(body);
     if(event.title!==op.title||event.description!==op.content||Date.parse(event.start_at)!==Date.parse(op.startAt!)||Date.parse(event.end_at)!==Date.parse(op.endAt!)||event.attendees.some(a=>a.id!==this.options.expectedUserId&&!op.audience.includes(a.id??''))||op.audience.some(id=>!event.attendees.some(a=>a.id===id)))throw new Error('event differs');
    }
    if(op.app==='slides'){
     const deck=body as {title?:string;data?:{slides?:Array<{notes?:string}>}};
     if(op.action==='update'&&deck.data?.slides?.[op.slideIndex!]?.notes!==op.content)throw new Error('notes differ');
     if(op.action==='create'&&deck.title!==op.title)throw new Error('title differs');
    }
    return observed;
   }
   catch{throw new ProviderError('outcome_unknown','readback_unconfirmed','Native write was accepted but read-back is unconfirmed.',accepted.id);}
  }
  if(op.app!=='docs'||!['create','update'].includes(op.action))throw new ProviderError('failed','unsupported_write',WORKSPACE_CAPABILITIES.find(c=>c.app===op.app)?.blocker??'This write is not implemented.');
  if(op.action==='update'){
   if(!op.replacementApproved)throw new ProviderError('failed','replacement_review','Full document replacement requires explicit full-diff approval.');
   const raw=await this.request(`/api/documents/${op.targetId}`) as {visibility?:string;can_edit?:boolean};
   if(raw.visibility!=='restricted'||raw.can_edit!==true)throw new ProviderError('failed','audience_unverified','Only editable restricted documents can be replaced; review broader audiences separately.');
   const before=this.record('docs',raw);
   if(before.fingerprint!==op.expectedFingerprint)throw new ProviderError('conflict','target_changed','Document changed after review. Human edits were preserved.');
  }
  // Schema-confirmed restricted creation. Recheck this exact reviewed schema before each live write.
  const schemaResponse=await (this.options.fetch??fetch)('https://app.ambiguous.ai/api/openapi.json',{redirect:'error',signal:AbortSignal.timeout(12000)});
  const schema=await schemaResponse.json() as {paths?:Record<string,Record<string,unknown>>};
  if(!schemaResponse.ok||!schema.paths?.[op.action==='create'?'/api/documents':'/api/documents/{id}']?.[op.action==='create'?'post':'patch'])throw new ProviderError('failed','schema_changed','Reviewed document endpoint is unavailable.');
  const body=await this.request(op.action==='create'?'/api/documents':`/api/documents/${op.targetId}`,op.action==='create'?'POST':'PATCH',{title:op.title,content:op.content,...(op.action==='create'?{type:'doc',visibility:'restricted'}:{})});
  let accepted:WorkspaceArtifact;
  try {accepted=this.record('docs',body);}catch{throw new ProviderError('outcome_unknown','invalid_write_response','Write acknowledgment has no verifiable artifact. Inspect before retrying.');}
  try {
   const observed=await this.read('docs',accepted.id,{...authority,allowedTargetIds:[...authority.allowedTargetIds,accepted.id]});
   if(observed.fingerprint!==accepted.fingerprint||observed.title!==op.title||!matchesDocumentText(observed.content,op.content))throw new Error('Read-back differs or authoring conversion requires review');
   return observed;
  }catch{throw new ProviderError('outcome_unknown','readback_unconfirmed','The document write was accepted but read-back was not confirmed.',accepted.id);}
 }
}
export class FixtureWorkspaceProvider implements WorkspaceProvider {
 readonly mode='fixture' as const;
 constructor(private store:UpgradeStore,private now=()=>new Date().toISOString()){}
 async read(app:WorkspaceApp,id:string,authority:ArtifactAuthority){
  if(!authority.allowedTargetIds.includes(id))throw new ProviderError('failed','target_scope','The object was not selected.');
  const r=await this.store.get<WorkspaceArtifact>(id,'fixture_artifact',authority);
  if(r.data.app!==app)throw new ProviderError('failed','app_mismatch','Selected artifact belongs to another application.');return r.data;
 }
 async execute(op:ArtifactOperation,authority:ArtifactAuthority,_key:string):Promise<WorkspaceArtifact>{
  if(['send','invite'].includes(op.action))throw new ProviderError('failed','fixture_no_communications','Fixture proposals never send messages or invitations.');
  const artifact:WorkspaceArtifact={id:op.targetId??`fixture-${randomUUID()}`,app:op.app,title:op.title,content:op.cells?JSON.stringify(op.cells):op.content,fingerprint:'',url:null,mode:'fixture',verifiedAt:op.action==='prepare'?null:this.now(),state:op.action==='prepare'?'proposal':'verified'};
  artifact.fingerprint=fingerprint({app:artifact.app,title:artifact.title,content:artifact.content});
  await this.store.db.transaction(async q=>{
   let revision=1;
   if(op.targetId){const existing=await this.store.get<WorkspaceArtifact>(op.targetId,'fixture_artifact',authority,q);if(existing.data.fingerprint!==op.expectedFingerprint)throw new ProviderError('conflict','target_changed','The fixture target changed.');revision=existing.revision+1;
    if(op.app==='sheets'&&op.cells){
     const prior=z.array(z.object({row:z.number(),column:z.string(),value:z.string(),rowKey:z.string()}).strict()).safeParse(JSON.parse(existing.data.content));
     if(!prior.success)throw new ProviderError('conflict','fixture_sheet_format','Existing fixture sheet is not structured cell data; preserve it for explicit review.');
     const merged=prior.data.map(c=>({...c}));
     for(const cell of op.cells){const index=merged.findIndex(c=>c.rowKey===cell.rowKey&&c.column===cell.column);if(index>=0)merged[index]={...cell,row:merged[index]!.row};else{const existingRow=merged.find(c=>c.rowKey===cell.rowKey)?.row;merged.push({...cell,row:existingRow??Math.max(-1,...merged.map(c=>c.row))+1});}}
     artifact.content=JSON.stringify(merged);artifact.fingerprint=fingerprint({app:artifact.app,title:artifact.title,content:artifact.content});
    }
   }
   await this.store.save({id:artifact.id,kind:'fixture_artifact',missionId:authority.missionId,revision,data:artifact},authority,q);
  });
  const read=await this.read(op.app,artifact.id,{...authority,allowedTargetIds:[...authority.allowedTargetIds,artifact.id]});return read;
 }
}

/** Only plain text equivalence is claimed; unsupported Markdown transformations stay unconfirmed. */
export function matchesDocumentText(observed:string,requested:string):boolean {
 if(observed===requested)return true;
 let doc:unknown;try{doc=JSON.parse(observed);}catch{return false;}
 function texts(node:unknown):string[]{
  if(!node||typeof node!=='object')return [];
  const value=node as {type?:string;text?:unknown;content?:unknown[]};
  if(value.type==='text'&&typeof value.text==='string')return [value.text];
  return Array.isArray(value.content)?value.content.flatMap(texts):[];
 }
 return texts(doc).join(' ').replace(/\s+/g,' ').trim()===requested.replace(/\s+/g,' ').trim();
}
