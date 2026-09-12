import type {ArtifactOperation} from '../../../packages/domain/src/artifacts.js';
import {ProviderError} from './providers/types.js';
export interface WorkspaceWrite {path:string;method:'POST'|'PATCH';body:Record<string,unknown>;readPath?:(id:string)=>string;category:'private_artifact'|'communication'|'invitation'}
/** Fixed, reviewed OpenAPI mappings; never accepts a caller supplied endpoint or executable action. */
export function mapWorkspaceWrite(op:ArtifactOperation):WorkspaceWrite {
 const target=op.targetId;
 if(op.app==='mail'&&op.action==='send')return {path:'/api/mail/send',method:'POST',body:{subject:op.title,body_text:op.content,to:op.audience,undo_send_seconds:0,include_signature:false},readPath:id=>`/api/mail/${id}`,category:'communication'};
 if(op.app==='mail'&&op.action==='create')return {path:'/api/mail/drafts',method:'POST',body:{subject:op.title,body_text:op.content,to:op.audience},readPath:id=>`/api/mail/${id}`,category:'private_artifact'};
 if(op.app==='chat'&&op.action==='send'&&target)return {path:`/api/channels/${target}/messages`,method:'POST',body:{content:op.content,...(op.threadId?{thread_id:op.threadId}:{})},readPath:id=>`/api/channels/${target}/messages/${id}`,category:'communication'};
 if(op.app==='calendar'&&target&&['invite','create','update'].includes(op.action))return {path:op.action==='update'?`/api/calendars/events/${target}`:`/api/calendars/${target}/events`,method:op.action==='update'?'PATCH':'POST',body:{title:op.title,description:op.content,start_at:op.startAt,end_at:op.endAt,attendees:op.audience},readPath:id=>`/api/calendars/events/${id}`,category:'invitation'};
 if(op.app==='slides'&&op.action==='create'&&!op.content)return {path:'/api/slides',method:'POST',body:{title:op.title,visibility:'restricted'},readPath:id=>`/api/slides/${id}/data`,category:'private_artifact'};
 if(op.app==='slides'&&op.action==='update'&&target&&op.slideIndex!==undefined)return {path:`/api/slides/${target}/slides/${op.slideIndex}`,method:'PATCH',body:{notes:op.content},readPath:()=>`/api/slides/${target}/data`,category:'private_artifact'};
 throw new ProviderError('failed','unsupported_write','No reviewed native mapping supports these fields. Slides supports explicit notes updates or empty presentation creation only.');
}
