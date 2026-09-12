import {describe,it,expect,vi} from 'vitest';
import {verifyWorkspaceDestination} from './workspace-destination.js';
import {artifactOperationSchema} from '../../../packages/domain/src/artifacts.js';
const actor='00000000-0000-4000-8000-000000000001',peer='00000000-0000-4000-8000-000000000002',target='00000000-0000-4000-8000-000000000003';
const chat=artifactOperationSchema.parse({id:'op',app:'chat',action:'send',title:'Review',content:'Approved facts',targetId:target,audience:[peer],sourceSnapshotIds:[]});
const calendar=artifactOperationSchema.parse({...chat,app:'calendar',action:'invite',startAt:'2026-09-14T10:00:00.000Z',endAt:'2026-09-14T11:00:00.000Z',timezone:'Etc/UTC'});
describe('documented destination preflights',()=>{
 it('accepts only complete private channel roster matching exact audience',async()=>{
  const read=vi.fn().mockResolvedValue({id:target,type:'private',archived_at:null,member_count:2,members:[{user_id:actor},{user_id:peer}]});
  await expect(verifyWorkspaceDestination(chat,actor,target,read)).resolves.toBeUndefined();
  read.mockResolvedValue({id:target,type:'public',archived_at:null,member_count:2,members:[{user_id:actor},{user_id:peer}]});
  await expect(verifyWorkspaceDestination(chat,actor,target,read)).rejects.toMatchObject({code:'destination_unverified'});
 });
 it('rejects roster expansion and unexpected mentions',async()=>{
  await expect(verifyWorkspaceDestination(chat,actor,target,async()=>({id:target,type:'private',archived_at:null,member_count:3,members:[{user_id:actor},{user_id:peer}]}))).rejects.toThrow('incomplete');
  const read=vi.fn();await expect(verifyWorkspaceDestination({...chat,content:'@everyone'},actor,target,read)).rejects.toThrow('Mentions');expect(read).not.toHaveBeenCalled();
 });
 const calendarRead=(missing=false)=>async(path:string)=>{
  if(path.includes('/permissions'))return {permissions:[{type:'user',id:actor}],pending_shares:[]};
  if(path.includes('/availability?'))return {availability:missing?{[actor]:[]}:{[actor]:[],[peer]:[]}};
  if(path.includes('/conflicts?'))return {conflicts:{[actor]:[],[peer]:[]}};
  return {id:target,owner_id:actor,workspace_id:target,publish_token:null,source:'local',timezone:'Etc/UTC'};
 };
 it('requires complete availability and conflicts for each explicit attendee',async()=>{
  await expect(verifyWorkspaceDestination(calendar,actor,target,calendarRead())).resolves.toBeUndefined();
  await expect(verifyWorkspaceDestination(calendar,actor,target,calendarRead(true))).rejects.toThrow('Missing availability');
 });
 it('does not treat a broader calendar viewer set as attendee-only data',async()=>{
  const read=calendarRead();await expect(verifyWorkspaceDestination(calendar,actor,target,path=>path.includes('/permissions')?Promise.resolve({permissions:[{type:'team',id:target}],pending_shares:[]}):read(path))).rejects.toThrow('Calendar groups');
 });
});
