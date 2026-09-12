import {useState} from 'react';
import type {Mission} from '@mission/domain';
import {Button,Field,Notice} from '@mission/ui';
import {Flag,Plus,Trash2} from 'lucide-react';
import {dateTime,localInput,zonedInputToIso} from '../format';

export interface ContractInput {goal:string;deadline:string;timezone:string;criteria:{title:string;required:boolean;verificationMethod:string}[];constraints:string[];forbiddenActions:string[];approvedCapabilities:string[];assumptions:string[];questions:string[];confirmed:true}
const split=(value:string)=>value.split('\n').map(s=>s.trim()).filter(Boolean);
export function MissionContractCard({mission,onConfirm,busy=false,onCancel}: {mission?:Mission;onConfirm:(input:ContractInput)=>Promise<void>;busy?:boolean;onCancel?:()=>void}) {
  const [goal,setGoal]=useState(mission?.goal || '');
  const timezone=mission?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [deadline,setDeadline]=useState(localInput(mission?.deadline || new Date(Date.now()+86400000).toISOString(),timezone));
  const [criteria,setCriteria]=useState(mission?.criteria.map(c=>({title:c.title,required:c.required,verificationMethod:c.verificationMethod})) || [{title:'Working core experience',required:true,verificationMethod:'Owner reviews the working product against the goal'},{title:'Documented verification results',required:true,verificationMethod:'Owner reviews recorded checks and remaining limitations'},{title:'Polished presentation',required:false,verificationMethod:'Owner reviews visual polish'}]);
  const [constraints,setConstraints]=useState(mission?.contract.constraints.join('\n') || 'One human owner. Estimates assume continuous availability.');
  const [forbidden,setForbidden]=useState(mission?.contract.forbiddenActions.join('\n') || 'Do not publish, submit, or contact others without my approval.');
  const [assumptions,setAssumptions]=useState(mission?.contract.assumptions.join('\n') || 'Task effort is an initial suggestion and can be edited.');
  const [questions,setQuestions]=useState(mission?.contract.unresolvedQuestions.join('\n') || '');
  const [capabilities,setCapabilities]=useState(mission?.contract.approvedCapabilities.join('\n') || 'Propose plans and changes\nAnalyze accepted evidence\nCreate and update explicitly approved tasks');
  const [error,setError]=useState('');
  async function submit(event:React.FormEvent) {
    event.preventDefault();setError('');
    try {
      if(!criteria.some(c=>c.required && c.title.trim())) throw new Error('Add at least one required success criterion.');
      await onConfirm({goal,deadline:zonedInputToIso(deadline,timezone),timezone,criteria:criteria.filter(c=>c.title.trim()),constraints:split(constraints),forbiddenActions:split(forbidden),approvedCapabilities:split(capabilities),assumptions:split(assumptions),questions:split(questions),confirmed:true});
    } catch(e){setError(e instanceof Error?e.message:'Could not save contract.');}
  }
  return <section className="contract-card"><div className="section-heading"><Flag size={19}/><div><h2>{mission ? 'Review your mission contract' : 'What are you working toward?'}</h2><p>Define the outcome. You control what happens next.</p></div></div>
    <form onSubmit={submit}>
      <Field label="Outcome"><textarea required maxLength={500} rows={2} placeholder="Prepare our hackathon project for submission" value={goal} onChange={e=>setGoal(e.target.value)}/></Field>
      <Field label="Exact deadline" help={`Your displayed timezone: ${timezone}`}><input required type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)}/></Field>
      {deadline && <p className="confirmation-line">Confirm: {confirmedDeadline(deadline,timezone)}</p>}
      <h3>Success criteria</h3><p className="muted small">Required outcomes must be verified before this mission can finish.</p>
      <div className="criterion-fields">{criteria.map((criterion,index)=><div className="criterion-edit" key={index}>
        <div className="inline-fields"><input aria-label={`Criterion ${index+1}`} required value={criterion.title} onChange={e=>setCriteria(criteria.map((c,i)=>i===index?{...c,title:e.target.value}:c))}/><button className="icon-button" type="button" aria-label={`Remove criterion ${index+1}`} onClick={()=>setCriteria(criteria.filter((_,i)=>i!==index))}><Trash2 size={15}/></button></div>
        <input aria-label={`Verification method ${index+1}`} required value={criterion.verificationMethod} placeholder="How will you verify it?" onChange={e=>setCriteria(criteria.map((c,i)=>i===index?{...c,verificationMethod:e.target.value}:c))}/>
        <label className="check-label"><input type="checkbox" checked={criterion.required} onChange={e=>setCriteria(criteria.map((c,i)=>i===index?{...c,required:e.target.checked}:c))}/>Required outcome</label>
      </div>)}</div>
      <Button type="button" variant="ghost" onClick={()=>setCriteria([...criteria,{title:'',required:true,verificationMethod:''}])}><Plus size={15}/>Add criterion</Button>
      <details className="contract-details"><summary>Constraints, capabilities & assumptions</summary>
        <Field label="Constraints" help="One item per line"><textarea value={constraints} onChange={e=>setConstraints(e.target.value)}/></Field>
        <Field label="Forbidden actions"><textarea value={forbidden} onChange={e=>setForbidden(e.target.value)}/></Field>
        <Field label="Approved agent capabilities"><textarea value={capabilities} onChange={e=>setCapabilities(e.target.value)}/></Field>
        <Field label="Assumptions"><textarea value={assumptions} onChange={e=>setAssumptions(e.target.value)}/></Field>
        <Field label="Unresolved questions"><textarea value={questions} onChange={e=>setQuestions(e.target.value)}/></Field>
        <p className="small muted">Human owner: {mission?.contract.humanOwner || 'paired local user'}. Agents can propose work; every external change needs your approval.</p>
      </details>
      {error && <Notice tone="red">{error}</Notice>}
      <div className="actions">{onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}<Button busy={busy} type="submit">Confirm contract & generate plan</Button></div>
      <p className="small muted">This confirms your contract and prepares a plan for review. External tasks are created only after you approve the plan.</p>
    </form>
  </section>;
}
function confirmedDeadline(value:string,timezone:string){try{return dateTime(zonedInputToIso(value,timezone),timezone);}catch(e){return e instanceof Error?e.message:'Choose a valid deadline.';}}
