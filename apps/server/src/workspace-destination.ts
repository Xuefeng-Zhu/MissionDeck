import {z} from 'zod';
import type {ArtifactOperation} from '../../../packages/domain/src/artifacts.js';
import {ProviderError} from './providers/types.js';
const uuid=z.string().uuid();
const deny=(message:string):never=>{throw new ProviderError('failed','destination_unverified',message);};
/** Fail closed for public channels, incomplete rosters, groups, invitations and unknown availability. */
export async function verifyWorkspaceDestination(op:ArtifactOperation,userId:string,workspaceId:string,read:(path:string)=>Promise<unknown>):Promise<void>{
 if(!op.targetId)return deny('Select an exact destination.');uuid.parse(op.targetId);
 if(op.app==='chat'){
  if(op.content.includes('@'))return deny('Mentions need separate review; this narrow adapter does not emit mentions.');
  const channel=z.object({id:uuid,type:z.enum(['public','private','dm']),archived_at:z.null(),member_count:z.number().int(),members:z.array(z.object({user_id:uuid}))}).safeParse(await read(`/api/channels/${op.targetId}`));
  if(!channel.success||channel.data.id!==op.targetId||channel.data.type==='public')return deny('A complete private channel or DM roster is required.');
  const members=[...new Set(channel.data.members.map(m=>m.user_id))];
  if(members.length!==channel.data.member_count||!members.includes(userId))return deny('Channel roster is incomplete or excludes the connected actor.');
  if(members.some(id=>id!==userId&&!op.audience.includes(id))||op.audience.some(id=>!members.includes(id)))return deny('Current channel membership differs from the approved audience.');
  if(op.threadId){const message=z.object({id:uuid,channel_id:uuid}).safeParse(await read(`/api/channels/${op.targetId}/messages/${op.threadId}`));if(!message.success||message.data.channel_id!==op.targetId||message.data.id!==op.threadId)return deny('The selected reply thread is not verified in this channel.');}
  return;
 }
 if(op.app==='calendar'){
  for(const member of op.audience)uuid.parse(member);
  let calendarId=op.targetId;
  if(op.action==='update'){
   const event=z.object({calendar_id:uuid,event_type:z.literal('default')}).safeParse(await read(`/api/calendars/events/${op.targetId}`));
   if(!event.success)return deny('Only ordinary calendar events can be updated by this adapter.');calendarId=event.data.calendar_id;
  }
  const calendar=z.object({id:uuid,workspace_id:uuid,owner_id:uuid,publish_token:z.null(),source:z.literal('local'),timezone:z.string()}).safeParse(await read(`/api/calendars/${calendarId}`));
  if(!calendar.success||calendar.data.workspace_id!==workspaceId||calendar.data.owner_id!==userId||calendar.data.timezone!==op.timezone)return deny('Use an owned, unpublished local calendar in the approved timezone.');
  const permissions=z.object({permissions:z.array(z.object({type:z.literal('user'),id:uuid})),pending_shares:z.array(z.unknown()).length(0)}).safeParse(await read(`/api/calendars/${calendarId}/permissions`));
  if(!permissions.success||permissions.data.permissions.some(p=>p.id!==userId&&!op.audience.includes(p.id)))return deny('Calendar groups, pending invitations, or broader viewers require a broader reviewed audience.');
  const members=[...new Set([userId,...op.audience])];const query=new URLSearchParams({user_ids:members.join(','),start:op.startAt!,end:op.endAt!});
  // Conflict check excludes the event being updated; availability still supplies access coverage.
  const availability=z.object({availability:z.record(z.string(),z.array(z.object({start:z.string(),end:z.string(),title:z.string()})))}).safeParse(await read(`/api/calendars/availability?${query}`));
  if(!availability.success||members.some(id=>!Object.hasOwn(availability.data.availability,id)))return deny('Missing availability is not evidence of free time.');
  if(op.action==='update')query.set('exclude_event_id',op.targetId);
  const conflicts=z.object({conflicts:z.record(z.string(),z.array(z.object({event_id:uuid,start_at:z.string(),end_at:z.string(),title:z.string()})))}).safeParse(await read(`/api/calendars/conflicts?${query}`));
  if(!conflicts.success||members.some(id=>!Object.hasOwn(conflicts.data.conflicts,id)||conflicts.data.conflicts[id]!.length>0))return deny('Availability is incomplete or an attendee has a conflicting event.');
 }
}
