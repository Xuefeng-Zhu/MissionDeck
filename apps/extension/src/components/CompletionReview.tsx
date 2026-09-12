import {useState} from 'react';
import type {Mission} from '@mission/domain';
import {Badge,Button,Field,Notice} from '@mission/ui';
import {CheckCircle2} from 'lucide-react';
import {readable,tone} from '../format';
export function CompletionReview({mission,onVerify,onComplete,busy}:{mission:Mission;onVerify:(id:string,attestation:string)=>Promise<void>;onComplete:()=>Promise<void>;busy:boolean}) {
  const [statements,setStatements]=useState<Record<string,string>>({});const [error,setError]=useState('');
  const complete=mission.criteria.filter(c=>c.required).every(c=>c.verificationState==='verified');
  async function run(fn:()=>Promise<void>){setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Verification failed.');}}
  return <section className="completion-review"><div className="section-heading"><CheckCircle2 size={20}/><div><h2>Verify the outcome</h2><p>Completed tasks need evidence. Your attestation is recorded.</p></div></div>
    {mission.criteria.map(c=><div className="verification-row" key={c.id}><div className="row-between"><strong>{c.title}</strong><Badge tone={tone(c.verificationState)}>{readable(c.verificationState)}</Badge></div><p className="small muted">{c.required?'Required':'Optional'} · {c.verificationMethod}</p>
      {c.evidenceIds.map(id=>mission.evidence.find(e=>e.id===id)).filter(Boolean).map(e=><blockquote key={e!.id}>{e!.excerpt}</blockquote>)}
      {c.attestation?<p className="small">Attested by {c.attestation.actorId}: {c.attestation.statement}</p>:<><Field label={`Attestation for ${c.title}`}><textarea rows={2} placeholder="Describe what you checked and why this outcome is met." maxLength={500} value={statements[c.id]||''} onChange={e=>setStatements({...statements,[c.id]:e.target.value})}/></Field><Button variant="secondary" disabled={!statements[c.id]?.trim()} busy={busy} onClick={()=>void run(()=>onVerify(c.id,statements[c.id]!))}>Attest & verify criterion</Button></>}
    </div>)}
    {error && <Notice tone="red">{error}</Notice>}<Button disabled={!complete || mission.lifecycle==='completed'} busy={busy} onClick={()=>void run(onComplete)}>{mission.lifecycle==='completed'?'Mission completed':'Complete verified mission'}</Button>
    {!complete && <p className="small muted">Every required criterion must be verified before completion.</p>}
  </section>;
}
