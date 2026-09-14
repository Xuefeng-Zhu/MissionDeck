import {useState} from 'react';
import type {Mission} from '@mission/domain';
import {Button,Field,Notice} from '@mission/ui';
import {FileText,X} from 'lucide-react';
import {CAPTURE_LIMIT,safeSourceUrl,type PendingCapture} from '../capture';
export function CapturePreview({capture,missions,missionId,onSend,onDiscard,busy}:{capture:PendingCapture;missions:Mission[];missionId:string|null;onSend:(missionId:string,capture:PendingCapture)=>Promise<void>;onDiscard:()=>void;busy:boolean}) {
  const [text,setText]=useState(capture.text);const [source,setSource]=useState(capture.sourceUrl);const [title,setTitle]=useState(capture.title);const [destination,setDestination]=useState(missionId || missions[0]?.id || '');const [error,setError]=useState('');
  return <section className="capture-preview"><div className="row-between"><div className="section-heading"><FileText size={19}/><div><h2>Review captured context</h2><p>Only the excerpt you send becomes mission evidence.</p></div></div><button className="icon-button" aria-label="Discard capture" onClick={onDiscard}><X size={18}/></button></div>
    <form onSubmit={async e=>{e.preventDefault();setError('');try{await onSend(destination,{...capture,text,sourceUrl:safeSourceUrl(source),title:title.trim()||'Personal note'});}catch(error){setError(error instanceof Error?error.message:'Capture could not be sent.');}}}>
      {capture.intent==='task' && <Notice tone="blue">After sending this evidence, review its suggested task or choose task details. Creating a provider task always requires a separate approval.</Notice>}
      {capture.truncated && <Notice tone="amber">The source was truncated at 20,000 characters. Keep the relevant excerpt.</Notice>}
      <Field label="Title"><input value={title} maxLength={500} onChange={e=>setTitle(e.target.value)}/></Field><Field label="Excerpt" help={`${text.length.toLocaleString()} / 20,000 characters · not sent to chat`}><textarea rows={7} value={text} maxLength={CAPTURE_LIMIT} required onChange={e=>setText(e.target.value)}/></Field>
      <Field label="Source URL" help="Query parameters and fragments are removed before sending."><input type="url" value={source} onChange={e=>setSource(e.target.value)} placeholder="Optional for a personal note"/></Field><Field label="Destination mission"><select required value={destination} onChange={e=>setDestination(e.target.value)}><option value="" disabled>Select a mission</option>{missions.map(m=><option key={m.id} value={m.id}>{m.goal}</option>)}</select></Field>
      {error && <Notice tone="red">{error}</Notice>}<div className="actions wrap"><Button busy={busy} disabled={!destination || !text.trim()} type="submit">Send to MissionDeck</Button><Button variant="secondary" type="button" onClick={onDiscard}>Discard</Button></div>
      {!missions.length && <Notice tone="amber">Create a mission first. This capture is kept temporarily and expires after 10 minutes.</Notice>}
    </form>
  </section>;
}
