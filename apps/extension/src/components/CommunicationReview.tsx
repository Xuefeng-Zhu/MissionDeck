import {useState} from 'react';
import type {ArtifactPlan,Mission} from '@mission/domain';
import {Button} from '@mission/ui';
import {post} from '../api';
export function CommunicationComposer({mission,onSaved}:{mission:Mission;onSaved:()=>Promise<void>}){
 const [app,setApp]=useState('mail'),[audience,setAudience]=useState(''),[target,setTarget]=useState(''),[title,setTitle]=useState('Launch review'),[content,setContent]=useState(''),[start,setStart]=useState('2026-09-14T15:00:00.000Z'),[end,setEnd]=useState('2026-09-14T15:30:00.000Z'),[timezone,setTimezone]=useState('Etc/UTC');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <details><summary>Prepare a separate communication or invitation</summary><p>Nothing is sent during preparation. The next review names the exact audience and excerpts you authorize sharing.</p>
 <label>Application<select value={app} onChange={e=>setApp(e.target.value)}><option value="mail">Mail send</option><option value="chat">Private Chat post</option><option value="calendar">Calendar invitation</option></select></label>
 <label>{app==='mail'?'Recipient email addresses':'Recipient user IDs'}<input value={audience} onChange={e=>setAudience(e.target.value)} placeholder="Comma-separated exact recipients"/></label>
 {app!=='mail'&&<label>{app==='chat'?'Private channel ID':'Owned calendar ID'}<input value={target} onChange={e=>setTarget(e.target.value)}/></label>}
 <label>Subject or event title<input value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <label>Exact outgoing content<textarea rows={4} value={content} onChange={e=>setContent(e.target.value)}/></label>
 {app==='calendar'&&<><label>Start ISO timestamp<input value={start} onChange={e=>setStart(e.target.value)}/></label><label>End ISO timestamp<input value={end} onChange={e=>setEnd(e.target.value)}/></label><label>Calendar timezone<input value={timezone} onChange={e=>setTimezone(e.target.value)}/></label></>}
 <p>Saved evidence sources: {mission.evidence.map(e=>e.title).join(', ')||'None; only the text you enter will be shared.'}</p>
 <Button disabled={busy||!audience.trim()||!content.trim()||(app!=='mail'&&!target.trim())} onClick={()=>void(async()=>{setBusy(true);setError('');try{await post(`/api/missions/${mission.id}/artifact-plans`,{outcome:`Review ${app==='calendar'?'an invitation':'a communication'} and explicit source sharing`,operations:[{id:'communication',app,action:app==='calendar'?'invite':'send',title,content,sourceSnapshotIds:mission.evidence.map(e=>e.id),audience:audience.split(',').map(x=>x.trim()).filter(Boolean),...(app!=='mail'?{targetId:target}:{}),...(app==='calendar'?{startAt:start,endAt:end,timezone}:{})}]});await onSaved();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}})()}>Save for separate review</Button>{error&&<p role="alert">{error}</p>}
 </details>;
}
export function CommunicationReview({plan,mission,ready,busy,onApprove}:{plan:ArtifactPlan;mission:Mission;ready:boolean;busy:boolean;onApprove:(category:'communication'|'invitation')=>Promise<void>}){
 const [ack,setAck]=useState(false);const invitation=plan.operations.every(op=>op.app==='calendar');
 return <section aria-label="Communication sharing review"><p><strong>{invitation?'Invitation':'Communication'} authorization is separate from private artifact approval.</strong></p>
 {plan.operations.map(op=><p key={op.id}>Destination: {op.targetId??'Native Mail'}<br/>Exact recipients: {op.audience.join(', ')}</p>)}
 <details><summary>Inspect saved source excerpts covered by this disclosure</summary>{plan.sourceSnapshots.map(s=><article key={s.snapshotId}><p>{s.snapshotId} · {s.contentHash}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{mission.evidence.find(e=>e.id===s.snapshotId)?.excerpt??'Source unavailable — execution will be refused.'}</pre></article>)}</details>
 <label><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>I authorize sharing this exact outgoing content and the reviewed saved excerpts with these recipients for this one action. {invitation?'Attendees may receive invitations and notifications.':'Recipients may receive notifications.'}</label>
 <Button disabled={!ack||!ready||busy||plan.missionRevision!==mission.revision} onClick={()=>void onApprove(invitation?'invitation':'communication')}>{invitation?'Approve this invitation':'Approve this send'}</Button>
 {!ready&&<p role="status">Sending is unavailable in fixture mode or without a configured live workspace identity. Preparation remains available.</p>}
 </section>;
}
