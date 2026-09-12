import {describe,it,expect,vi} from 'vitest';
import {artifactOperationSchema} from '../../../packages/domain/src/artifacts.js';
import type {ArtifactAuthority} from './artifact-coordinator.js';
import {AmbiguousWorkspaceProvider,matchesDocumentText} from './workspace-provider.js';
import {fingerprint} from './providers/types.js';

const target='00000000-0000-4000-8000-000000000001';
const user='00000000-0000-4000-8000-000000000002';
const workspace='00000000-0000-4000-8000-000000000003';
const other='00000000-0000-4000-8000-000000000004';
const authority:ArtifactAuthority={ownerId:'local-user',workspaceId:'local-workspace',missionId:'mission',missionRevision:1,sourceHashes:{},allowedTargetIds:[target],allowedAudience:[],categories:['private_artifact']};
const prose=(text:string)=>JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
const document={id:target,type:'doc',title:'Review',content:prose('Approved facts'),visibility:'restricted',updated_at:'2026-09-12T12:00:00Z'};
const operation=(patch:Record<string,unknown>={})=>artifactOperationSchema.parse({id:'document',app:'docs',action:'create',title:'Review',content:'Approved facts',sourceSnapshotIds:[],...patch});
function setup(options:{read?:()=>unknown;write?:unknown;readStatus?:number}={}){
 const request=vi.fn(async(url:URL|RequestInfo,init?:RequestInit)=>{
  const path=new URL(String(url)).pathname;
  if(path==='/api/users/me')return Response.json({id:user,workspace_id:workspace,display_name:'Synthetic test identity'});
  if(path==='/api/openapi.json')return Response.json({paths:{'/api/documents':{post:{}},'/api/documents/{id}':{patch:{}}}});
  if(init?.method==='POST'||init?.method==='PATCH')return Response.json(options.write??{...document,import_warnings:[],entities:{}},{status:init.method==='POST'?201:200});
  return Response.json(options.read?.()??{...document,can_edit:true,can_comment:true,comments:[]},{status:options.readStatus??200});
 });
 const provider=new AmbiguousWorkspaceProvider({apiKey:'synthetic-only',expectedUserId:user,expectedWorkspaceId:workspace,fetch:request});
 return {provider,request,writes:()=>request.mock.calls.filter(([,init])=>['POST','PATCH'].includes(init?.method??''))};
}

describe('native document confirmation with distinct response metadata',()=>{
 it('verifies create against the GET fields and retains its fingerprint',async()=>{
  const observed={...document,can_comment:true,comments:[],entities:{[target]:{id:target,title:'Read expansion'}}};
  const {provider,writes}=setup({read:()=>observed});
  const result=await provider.execute(operation(),authority,'create-once');
  expect(result).toMatchObject({id:target,state:'verified',mode:'live',content:document.content,fingerprint:fingerprint(observed)});
  expect(writes()).toHaveLength(1);
  expect(JSON.parse(String(writes()[0]![1]!.body))).toMatchObject({type:'doc',visibility:'restricted',content:'Approved facts'});
 });
 it('verifies a reviewed replacement despite PATCH/GET metadata differences',async()=>{
  const before={...document,content:prose('Original facts'),can_edit:true,comments:[]};let reads=0;
  const observed={...document,can_edit:true,comments:[]};
  const {provider,writes}=setup({read:()=>++reads===1?before:observed});
  const result=await provider.execute(operation({action:'update',targetId:target,expectedFingerprint:fingerprint(before),beforeContent:before.content,replacementApproved:true}),authority,'update-once');
  expect(result).toMatchObject({id:target,state:'verified',fingerprint:fingerprint(observed)});
  expect(writes()).toHaveLength(1);expect(writes()[0]![1]!.method).toBe('PATCH');
 });
 it('reconciles serialized document text through reads only',async()=>{
  const {provider,writes}=setup();
  await expect(provider.readResult(operation(),target,authority)).resolves.toMatchObject({id:target,state:'verified'});
  expect(writes()).toHaveLength(0);
 });
 it.each([
  ['wrong ID',{id:other}],['wrong type',{type:'sheet'}],['broader audience',{visibility:'workspace'}],
  ['missing visibility',{visibility:undefined}],['wrong title',{title:'Other title'}],
  ['changed text',{content:prose('Changed facts')}],['null content',{content:null}],
 ])('leaves %s unconfirmed with the original ID',async(_name,patch)=>{
  const {provider,writes}=setup({read:()=>({...document,...patch})});
  await expect(provider.execute(operation(),authority,'once')).rejects.toMatchObject({state:'outcome_unknown',code:'readback_unconfirmed',providerId:target});
  expect(writes()).toHaveLength(1);
  await expect(provider.readResult(operation(),target,authority)).rejects.toMatchObject({state:'outcome_unknown',providerId:target});
  expect(writes()).toHaveLength(1);
 });
 it('preserves conflict detection before any PATCH',async()=>{
  const before={...document,can_edit:true,comments:[]};
  const {provider,writes}=setup({read:()=>({...before,content:prose('A human edited this')})});
  await expect(provider.execute(operation({action:'update',targetId:target,expectedFingerprint:fingerprint(before),replacementApproved:true}),authority,'update')).rejects.toMatchObject({state:'conflict',code:'target_changed'});
  expect(writes()).toHaveLength(0);
 });
 it.each([{can_edit:false},{visibility:'workspace'},{type:'sheet'}])('preserves update permission checks for %j',async(patch)=>{
  const before={...document,can_edit:true,...patch};const {provider,writes}=setup({read:()=>before});
  await expect(provider.execute(operation({action:'update',targetId:target,expectedFingerprint:fingerprint(before),replacementApproved:true}),authority,'update')).rejects.toMatchObject({code:'audience_unverified'});
  expect(writes()).toHaveLength(0);
 });
 it('does not follow an unrelated update acknowledgment ID',async()=>{
  const before={...document,can_edit:true};const {provider,request,writes}=setup({read:()=>before,write:{...document,id:other}});
  await expect(provider.execute(operation({action:'update',targetId:target,expectedFingerprint:fingerprint(before),replacementApproved:true}),authority,'update')).rejects.toMatchObject({state:'outcome_unknown',providerId:target});
  expect(writes()).toHaveLength(1);expect(request.mock.calls.some(([url])=>String(url).endsWith(other))).toBe(false);
 });
 it('retains the accepted ID after a failed read without retrying the create',async()=>{
  const {provider,writes}=setup({readStatus:503});
  await expect(provider.execute(operation(),authority,'once')).rejects.toMatchObject({state:'outcome_unknown',providerId:target});expect(writes()).toHaveLength(1);
 });
 it('refuses unselected reconciliation before issuing requests',async()=>{
  const {provider,request}=setup();
  await expect(provider.readResult(operation(),target,{...authority,allowedTargetIds:[]})).rejects.toMatchObject({code:'target_scope'});expect(request).not.toHaveBeenCalled();
 });
 it('does not interpret arbitrary JSON or unsupported Markdown as equivalent text',()=>{
  for(const value of ['{}','null','{"content":[]}','{"type":"other","content":[]}'])expect(matchesDocumentText(value,'')).toBe(false);
  expect(matchesDocumentText(prose('Approved facts'),'# Approved facts')).toBe(false);
 });
});
