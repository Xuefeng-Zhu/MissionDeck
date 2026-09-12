import {describe,it,expect,vi} from 'vitest';
import {mapWorkspaceWrite} from './workspace-mapping.js';
import {artifactOperationSchema} from '../../../packages/domain/src/artifacts.js';
import {AmbiguousWorkspaceProvider,matchesDocumentText} from './workspace-provider.js';
import type {ArtifactAuthority} from './artifact-coordinator.js';
const target='00000000-0000-4000-8000-000000000001';const user='00000000-0000-4000-8000-000000000002';const workspace='00000000-0000-4000-8000-000000000003';
const authority:ArtifactAuthority={ownerId:'local-user',workspaceId:'local-workspace',missionId:'mission',missionRevision:1,sourceHashes:{},allowedTargetIds:[target],allowedAudience:[],categories:['private_artifact']};
const operation=(data:Record<string,unknown>)=>artifactOperationSchema.parse({id:'operation',app:'mail',action:'create',title:'Review',content:'Literal review',sourceSnapshotIds:[],...data});
describe('reviewed native workspace mappings',()=>{
 it('maps mail draft to the documented plain-text draft schema',()=>{expect(mapWorkspaceWrite(operation({}))).toMatchObject({path:'/api/mail/drafts',body:{subject:'Review',body_text:'Literal review',to:[]}});});
 it('maps chat reply separately from posting and invitations',()=>{expect(mapWorkspaceWrite(operation({app:'chat',action:'send',targetId:target,audience:['team'],threadId:user}))).toMatchObject({path:`/api/channels/${target}/messages`,body:{thread_id:user},category:'communication'});});
 it('maps native calendar with explicit reviewable timing',()=>{expect(mapWorkspaceWrite(operation({app:'calendar',action:'invite',targetId:target,audience:['member'],startAt:'2026-09-14T10:00:00.000Z',endAt:'2026-09-14T11:00:00.000Z',timezone:'Etc/UTC'}))).toMatchObject({path:`/api/calendars/${target}/events`,category:'invitation'});});
 it('only maps explicitly selected slide notes, preserving element bodies',()=>{expect(mapWorkspaceWrite(operation({app:'slides',action:'update',targetId:target,expectedFingerprint:'reviewed',slideIndex:2}))).toMatchObject({path:`/api/slides/${target}/slides/2`,body:{notes:'Literal review'}});expect(()=>mapWorkspaceWrite(operation({app:'slides'}))).toThrow('No reviewed');});
 it('creates native draft and verifies returned object through read-back without sending',async()=>{
  const draft={id:target,subject:'Review',body_text:'Literal review',folder:'drafts'};
  const request=vi.fn(async(url:URL|RequestInfo,options?:RequestInit)=>new Response(JSON.stringify(String(url).endsWith('/api/users/me')?{id:user,workspace_id:workspace,display_name:'Test'}:draft),{status:options?.method==='POST'?201:200,headers:{'Content-Type':'application/json'}}));
  const provider=new AmbiguousWorkspaceProvider({apiKey:'synthetic',expectedUserId:user,expectedWorkspaceId:workspace,fetch:request});
  const result=await provider.execute(operation({}),authority,'operation-key');expect(result.state).toBe('verified');expect(result.mode).toBe('live');
  expect(request.mock.calls.filter(c=>c[1]?.method==='POST').map(c=>String(c[0]))).toEqual(['https://app.ambiguous.ai/api/mail/drafts']);expect(request.mock.calls.some(c=>String(c[0]).endsWith(`/api/mail/${target}`))).toBe(true);
 });
 it('keeps native chat execution blocked without separate authorization',async()=>{
  const request=vi.fn();const provider=new AmbiguousWorkspaceProvider({fetch:request});
  await expect(provider.execute(operation({app:'chat',action:'send',targetId:target,audience:['team']}),{...authority,allowedAudience:['team']},'key')).rejects.toMatchObject({code:'category_scope'});expect(request).not.toHaveBeenCalled();
 });
});

describe('native uncertain outcome recovery',()=>{
 it('retains the accepted provider ID when draft read-back fails',async()=>{
  const request=vi.fn(async(url:URL|RequestInfo,options?:RequestInit)=>{
   if(String(url).endsWith('/api/users/me'))return new Response(JSON.stringify({id:user,workspace_id:workspace,display_name:'Test'}));
   if(options?.method==='POST')return new Response(JSON.stringify({id:target,subject:'Review',body_text:'Literal review'}),{status:201});
   return new Response('{}',{status:503});
  });
  const provider=new AmbiguousWorkspaceProvider({apiKey:'synthetic',expectedUserId:user,expectedWorkspaceId:workspace,fetch:request});
  await expect(provider.execute(operation({}),authority,'key')).rejects.toMatchObject({state:'outcome_unknown',providerId:target});
 });
});

describe('semantic read-back',()=>{
 it('verifies plain ProseMirror text but refuses unverified Markdown conversion',()=>{const doc=JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Approved facts'}]}]});expect(matchesDocumentText(doc,'Approved facts')).toBe(true);expect(matchesDocumentText(doc,'# Approved facts')).toBe(false);expect(matchesDocumentText(doc,'Different facts')).toBe(false);});
 it('refuses identical acknowledgment and read-back when draft payload is wrong',async()=>{
  const request=vi.fn(async(url:URL|RequestInfo)=>new Response(JSON.stringify(String(url).endsWith('/api/users/me')?{id:user,workspace_id:workspace,display_name:'Test'}:{id:target,subject:'Wrong draft',body_text:'Unintended content'})));
  const provider=new AmbiguousWorkspaceProvider({apiKey:'synthetic',expectedUserId:user,expectedWorkspaceId:workspace,fetch:request});
  await expect(provider.execute(operation({}),authority,'key')).rejects.toMatchObject({state:'outcome_unknown',providerId:target});
 });
});

describe('native mail send contract (synthetic only)',()=>{
 it('uses durable documented idempotency header and checks recipient/delivery read-back',async()=>{
  const recipient='review@example.test';
  const request=vi.fn(async(url:URL|RequestInfo)=>new Response(JSON.stringify(String(url).endsWith('/api/users/me')?{id:user,workspace_id:workspace,display_name:'Test'}:{id:target,subject:'Review',body_text:'Literal review',delivery_status:'sent',sent_at:'2026-09-12T12:00:00Z',to:[{email:recipient}]})));
  const provider=new AmbiguousWorkspaceProvider({apiKey:'synthetic',expectedUserId:user,expectedWorkspaceId:workspace,fetch:request});
  await expect(provider.execute(operation({action:'send',audience:[recipient]}),{...authority,allowedAudience:[recipient],categories:['communication']},'durable-operation-key')).resolves.toMatchObject({state:'verified'});
  const call=request.mock.calls.find(c=>String(c[0]).endsWith('/api/mail/send'));
  expect(call).toBeDefined();
  const headers=(request.mock.calls as unknown as Array<[unknown,RequestInit]>).find(c=>String(c[0]).endsWith('/api/mail/send'))![1].headers as Record<string,string>;
  expect(headers['Idempotency-Key']).toBe('durable-operation-key');
 });
});

describe('native chat and calendar contract (synthetic only)',()=>{
 it('posts to a verified private roster and verifies the exact thread/content',async()=>{
  const peer='00000000-0000-4000-8000-000000000004';
  const request=vi.fn(async(url:URL|RequestInfo)=>{
   const path=new URL(String(url)).pathname;
   const body=path==='/api/users/me'?{id:user,workspace_id:workspace,display_name:'Test'}:path===`/api/channels/${target}`?{id:target,type:'private',archived_at:null,member_count:2,members:[{user_id:user},{user_id:peer}]}:{id:peer,channel_id:target,thread_id:null,content:'Literal review'};
   return new Response(JSON.stringify(body));
  });
  const provider=new AmbiguousWorkspaceProvider({apiKey:'synthetic',expectedUserId:user,expectedWorkspaceId:workspace,fetch:request});
  await expect(provider.execute(operation({app:'chat',action:'send',targetId:target,audience:[peer]}),{...authority,allowedAudience:[peer],categories:['communication']},'durable-chat-key')).resolves.toMatchObject({state:'verified'});
 });
 it('creates an invitation only after owned-calendar ACL and availability preflight',async()=>{
  const peer='00000000-0000-4000-8000-000000000004';const start='2026-09-14T10:00:00.000Z',end='2026-09-14T11:00:00.000Z';
  const request=vi.fn(async(url:URL|RequestInfo)=>{
   const path=new URL(String(url)).pathname;let body:unknown;
   if(path==='/api/users/me')body={id:user,workspace_id:workspace,display_name:'Test'};
   else if(path===`/api/calendars/${target}`)body={id:target,owner_id:user,workspace_id:workspace,publish_token:null,source:'local',timezone:'Etc/UTC'};
   else if(path.endsWith('/permissions'))body={permissions:[{type:'user',id:user}],pending_shares:[]};
   else if(path.endsWith('/availability'))body={availability:{[user]:[],[peer]:[]}};
   else if(path.endsWith('/conflicts'))body={conflicts:{[user]:[],[peer]:[]}};
   else body={id:peer,title:'Review',description:'Literal review',start_at:start,end_at:end,attendees:[{id:peer,kind:'user'}]};
   return new Response(JSON.stringify(body));
  });
  const provider=new AmbiguousWorkspaceProvider({apiKey:'synthetic',expectedUserId:user,expectedWorkspaceId:workspace,fetch:request});
  await expect(provider.execute(operation({app:'calendar',action:'invite',targetId:target,audience:[peer],startAt:start,endAt:end,timezone:'Etc/UTC'}),{...authority,allowedAudience:[peer],categories:['invitation']},'durable-event-key')).resolves.toMatchObject({state:'verified'});
 });
});
