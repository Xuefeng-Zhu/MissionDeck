import {useEffect,useState} from 'react';
import type {AdaptiveSourceInput,AdaptiveState,Evidence,Mission,MissionExecution,SourceCitation} from '@mission/domain';
import {Badge,Button,Field,Notice} from '@mission/ui';
import {CheckCircle2,ExternalLink,FileText,GitBranch,Plus,RefreshCw,Trash2} from 'lucide-react';
import {dateTime} from '../format';
import {api} from '../api';
import '../adaptive.css';

export function sourceInputs(adaptive:AdaptiveState):AdaptiveSourceInput[]{
  return (adaptive.sourceHistory.find(item=>item.revision===adaptive.sourceRevision)?.sources??[])
    .map(({fingerprint:_fingerprint,documentId:_documentId,...source})=>source);
}

export function sourcesValid(sources:AdaptiveSourceInput[]):boolean{
  return sources.length>0&&sources.length<=5&&sources.every(source=>source.title.trim()&&source.content.trim())&&sources.reduce((total,source)=>total+source.content.length,0)<=20000;
}

export function AdaptiveSourceEditor({sources,onChange,disabled=false}:{sources:AdaptiveSourceInput[];onChange:(sources:AdaptiveSourceInput[])=>void;disabled?:boolean}){
  const characters=sources.reduce((total,source)=>total+source.content.length,0);
  const update=(id:string,patch:Partial<AdaptiveSourceInput>)=>onChange(sources.map(source=>source.id===id?{...source,...patch}:source));
  return <div className="adaptive-source-editor">
    <p className="small muted">Name each source and paste the material the agents should use. Links are retained as references; linked pages are not fetched.</p>
    {sources.map((source,index)=><fieldset className="adaptive-source-card" key={source.id} disabled={disabled}>
      <legend>Source {index+1}</legend>
      <Field label={`Source ${index+1} name`}><input value={source.title} onChange={event=>update(source.id,{title:event.target.value})} maxLength={200} required readOnly={source.provenance==='browser'}/></Field>
      <Field label={`Source ${index+1} material`} help={source.provenance==='browser'?'This reviewed excerpt keeps its original content and provenance. Remove it to replace it with a different source.':undefined}><textarea value={source.content} onChange={event=>update(source.id,{content:event.target.value})} rows={5} maxLength={20000} required readOnly={source.provenance==='browser'}/></Field>
      <div className="adaptive-source-footer"><span className="small muted">{source.provenance==='browser'?'Reviewed excerpt':'Pasted source'} · {source.content.length.toLocaleString()} characters</span><Button variant="ghost" type="button" disabled={disabled||sources.length===1} aria-label={`Remove source ${index+1}`} onClick={()=>onChange(sources.filter(item=>item.id!==source.id))}><Trash2 size={13}/>Remove</Button></div>
    </fieldset>)}
    <div className="adaptive-source-footer"><Button variant="secondary" type="button" disabled={disabled||sources.length>=5} onClick={()=>onChange([...sources,{id:crypto.randomUUID(),title:'',content:'',provenance:'pasted'}])}><Plus size={14}/>Add source</Button><span className={`small ${characters>20000?'adaptive-limit-error':'muted'}`} role="status">{sources.length}/5 sources · {characters.toLocaleString()}/20,000 characters</span></div>
    {characters>20000&&<Notice tone="red">Shorten the source material to 20,000 characters in total before continuing.</Notice>}
  </div>;
}

interface AdaptiveLaunchProps{
  execution:MissionExecution;
  busy:boolean;
  onDecision:(body:{requestId:string;expectedRevision:number;analysisVersion:string;optionId:string;constraints:string})=>Promise<void>;
  onSources:(body:{requestId:string;expectedRevision:number;sources:AdaptiveSourceInput[]})=>Promise<void>;
  onReopen:(body:{requestId:string;expectedRevision:number})=>Promise<void>;
}

export function AdaptiveLaunch({execution,busy,onDecision,onSources,onReopen}:AdaptiveLaunchProps){
  const adaptive=execution.adaptive;
  const [editing,setEditing]=useState(false);
  const [draftSources,setDraftSources]=useState<AdaptiveSourceInput[]>([]);
  const [editRevision,setEditRevision]=useState(0);
  const [selectedRevision,setSelectedRevision]=useState<number|null>(null);
  if(!adaptive)return null;
  const writing=execution.tasks.some(task=>['running','saving','outcome_unknown'].includes(task.status))||execution.operations.some(operation=>['running','outcome_unknown'].includes(operation.state));
  const closed=['completed','cancelled'].includes(execution.status);
  const current=adaptive.sourceHistory.find(item=>item.revision===adaptive.sourceRevision);
  const viewed=adaptive.sourceHistory.find(item=>item.revision===selectedRevision)??current;
  const analysis=adaptive.analysis?.sourceRevision===adaptive.sourceRevision?adaptive.analysis:undefined;
  const decision=adaptive.decision?.sourceRevision===adaptive.sourceRevision?adaptive.decision:undefined;
  const canDecide=Boolean(analysis&&!decision&&execution.status==='running'&&execution.tasks.some(task=>task.status==='waiting_human'))&&!writing;
  const staleEdit=editing&&editRevision!==adaptive.revision;
  return <div className="adaptive-launch">
    <section className="execution-overview adaptive-source-section" aria-label="Mission sources">
      <div className="section-heading row-between"><div><div className="execution-eyebrow"><GitBranch size={14}/>Adaptive launch review</div><h2>Sources and changes</h2></div><Badge tone="blue">Source revision {adaptive.sourceRevision}</Badge></div>
      <p className="small muted">The agents compare these sources, surface a launch decision, then prepare the agreed launch pack. Replacing sources preserves past work and triggers a fresh review of affected outputs.</p>
      {adaptive.sourceHistory.length>1&&<Field label="View source revision"><select value={viewed?.revision??adaptive.sourceRevision} onChange={event=>setSelectedRevision(Number(event.target.value))}>{[...adaptive.sourceHistory].reverse().map(revision=><option key={revision.revision} value={revision.revision}>Revision {revision.revision}{revision.revision===adaptive.sourceRevision?' · current':' · historical'}</option>)}</select></Field>}
      {viewed&&<><p className="small muted">{viewed.changeSummary} · {dateTime(viewed.createdAt)}</p><div className="adaptive-sources">{viewed.sources.map(source=>{
        const url=safeSourceLink(source.sourceUrl);
        return <details className="adaptive-source-detail" key={source.id} id={`source-${viewed.revision}-${source.id}`}><summary><FileText size={14}/><span>{source.title}</span><Badge tone={viewed.revision===adaptive.sourceRevision?'blue':'neutral'}>{viewed.revision===adaptive.sourceRevision?'Current':'Historical'}</Badge></summary><pre className="adaptive-source-content">{source.content}</pre><div className="adaptive-source-metadata"><span>{source.provenance==='browser'?'Reviewed excerpt':'Pasted source'}</span>{url&&<a href={url} target="_blank" rel="noreferrer">Source page <ExternalLink size={11}/></a>}{source.capturedAt&&<span>Captured {dateTime(source.capturedAt)}</span>}{source.documentId&&<span>Saved document: <code>{source.documentId}</code></span>}<span>Fingerprint: <code>{source.fingerprint}</code></span></div></details>;
      })}</div></>}
      {execution.status==='completed'&&<Notice tone="blue">This mission is complete. Reopen it before updating sources and authorizing another round of work.<div className="actions"><Button variant="secondary" busy={busy} disabled={writing} onClick={()=>void onReopen({requestId:crypto.randomUUID(),expectedRevision:adaptive.revision}).catch(()=>{})}><RefreshCw size={14}/>Reopen mission for changes</Button></div></Notice>}
      {!closed&&!editing&&<div className="adaptive-edit-action"><Button variant="secondary" disabled={busy||writing} onClick={()=>{setDraftSources(sourceInputs(adaptive));setEditRevision(adaptive.revision);setEditing(true);}}>Update sources</Button>{writing&&<p className="small muted">Sources can be changed after active work and provider writes are settled.</p>}</div>}
      {editing&&!closed&&<form className="adaptive-source-form" onSubmit={event=>{event.preventDefault();void onSources({requestId:crypto.randomUUID(),expectedRevision:editRevision,sources:draftSources}).then(()=>{setEditing(false);setSelectedRevision(null);}).catch(()=>{});}}>
        <h3>Prepare the next source revision</h3><AdaptiveSourceEditor sources={draftSources} onChange={setDraftSources} disabled={busy||writing}/>
        <AcceptedBrowserImport missionId={execution.missionId} sources={draftSources} onImport={source=>setDraftSources(items=>[...items,source])} disabled={busy||writing||draftSources.length>=5}/>
        <p className="small muted">Saving retains a new source revision in Ambiguous and authorizes updated analysis within the mission's remaining work limits. Existing outputs remain in history.</p>
        {staleEdit&&<Notice tone="amber">This mission changed while you were editing. Close this editor and reopen it to review the latest sources before saving.</Notice>}
        <div className="execution-actions"><Button type="submit" busy={busy} disabled={writing||staleEdit||!sourcesValid(draftSources)}>Save sources and replan</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>setEditing(false)}>Close editor</Button></div>
      </form>}
    </section>
    {analysis?<section className="execution-overview adaptive-analysis" aria-label="Launch analysis"><div className="section-heading row-between"><h2>{decision?'Your launch decision':'A launch decision needs your judgment'}</h2><Badge tone="blue">Based on revision {analysis.sourceRevision}</Badge></div><p>{analysis.value.summary}</p>
      <div className="adaptive-findings">{analysis.value.findings.map(finding=><article className="adaptive-finding" key={finding.id}><div className="adaptive-finding-heading"><h3>{finding.title}</h3><Badge tone={finding.kind==='conflict'?'amber':finding.kind==='risk'?'red':'blue'}>{finding.kind}</Badge></div><p>{finding.detail}</p><Citations citations={finding.citations} adaptive={adaptive}/></article>)}</div>
      {analysis.value.unresolvedRequirements.length>0&&<div className="adaptive-requirements"><h3>Still unresolved</h3><ul>{analysis.value.unresolvedRequirements.map((requirement,index)=><li key={index}>{requirement}</li>)}</ul></div>}
      {analysis.value.assumptions.length>0&&<details className="adaptive-assumptions"><summary>Assumptions to review ({analysis.value.assumptions.length})</summary><ul>{analysis.value.assumptions.map((assumption,index)=><li key={index}>{assumption}</li>)}</ul></details>}
      <DecisionForm key={analysis.version} adaptive={adaptive} enabled={canDecide} busy={busy} onDecision={onDecision}/>
    </section>:<section className="execution-overview" aria-label="Launch analysis"><h2>Comparing the current sources</h2><p className="small muted">The analysis and decision options for source revision {adaptive.sourceRevision} will appear here after their evidence is verified.</p></section>}
    {adaptive.pack?.sourceRevision===adaptive.sourceRevision&&<section className="execution-overview adaptive-pack" aria-label="Launch pack changes"><div className="section-heading"><CheckCircle2 size={19}/><h2>What changed in the launch pack</h2></div><p>{adaptive.pack.value.changeSummary}</p><Citations citations={adaptive.pack.value.citations} adaptive={adaptive}/>{adaptive.pack.value.unresolvedRisks.length>0&&<><h3>Risks retained in the final pack</h3><ul>{adaptive.pack.value.unresolvedRisks.map((risk,index)=><li key={index}>{risk}</li>)}</ul></>}<p className="small muted">Open the saved artifacts below to review the brief, checklist, and announcement draft.</p></section>}
    <AdaptiveActivityLog execution={execution}/>
  </div>;
}

function AcceptedBrowserImport({missionId,sources,onImport,disabled}:{missionId:string;sources:AdaptiveSourceInput[];onImport:(source:AdaptiveSourceInput)=>void;disabled:boolean}){
  const [open,setOpen]=useState(false);
  return <div className="adaptive-browser-import"><Button variant="secondary" type="button" disabled={disabled} onClick={()=>setOpen(value=>!value)}>{open?'Hide saved excerpts':'Import a saved browser excerpt'}</Button>{open&&<AcceptedBrowserChoices key={missionId} missionId={missionId} sources={sources} onImport={onImport} disabled={disabled}/>}</div>;
}

function AcceptedBrowserChoices({missionId,sources,onImport,disabled}:{missionId:string;sources:AdaptiveSourceInput[];onImport:(source:AdaptiveSourceInput)=>void;disabled:boolean}){
  const [evidence,setEvidence]=useState<Evidence[]|null>(null);
  const [error,setError]=useState('');
  const [selectedId,setSelectedId]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;setError('');setEvidence(null);
    void api<{mission:Mission}>(`/api/missions/${encodeURIComponent(missionId)}`).then(result=>{
      if(active)setEvidence(result.mission.evidence);
    }).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Unable to load saved browser excerpts.');});
    return()=>{active=false;};
  },[missionId,attempt]);
  const available=evidence?.filter(item=>!sources.some(source=>source.evidenceId===item.id))??[];
  const selected=available.find(item=>item.id===selectedId);
  const total=sources.reduce((count,source)=>count+source.content.length,0)+(selected?.excerpt.length??0);
  const exceedsLimit=Boolean(selected&&(selected.title.length>200||total>20000));
  const url=safeSourceLink(selected?.sourceUrl);
  return <div className="adaptive-browser-choices"><p className="small muted">Only excerpts already reviewed and saved to this mission are listed. Select one to preview its exact retained content before adding it.</p>
    {error?<Notice tone="red">{error} <Button type="button" variant="ghost" onClick={()=>setAttempt(value=>value+1)}>Retry</Button></Notice>:evidence===null?<p className="small muted" role="status">Loading saved browser excerpts…</p>:available.length===0?<p className="small muted">No additional saved excerpts are available. Capture a page or selection, or add a note, then review and accept it into this mission first.</p>:<>
      <Field label="Saved browser excerpt"><select value={selectedId} onChange={event=>setSelectedId(event.target.value)} disabled={disabled}><option value="">Select an accepted excerpt</option>{available.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
      {selected&&<div className="adaptive-browser-preview"><h3>{selected.title}</h3><pre className="adaptive-source-content">{selected.excerpt}</pre><div className="adaptive-source-metadata">{url&&<a href={url} target="_blank" rel="noreferrer">Source page <ExternalLink size={11}/></a>}<span>Captured {dateTime(selected.capturedAt)}</span><span>Accepted {dateTime(selected.acceptedAt)}</span><span>Evidence ID: <code>{selected.id}</code></span>{selected.fixture&&<span>Fixture excerpt</span>}</div>{exceedsLimit&&<Notice tone="amber">This excerpt exceeds the source name or combined material limit. Use a shorter reviewed capture, or remove another source.</Notice>}<Button type="button" variant="secondary" disabled={disabled||exceedsLimit} onClick={()=>{onImport({id:crypto.randomUUID(),title:selected.title,content:selected.excerpt,provenance:'browser',sourceUrl:selected.sourceUrl,capturedAt:selected.capturedAt,evidenceId:selected.id});setSelectedId('');}}><Plus size={14}/>Add reviewed excerpt</Button></div>}
    </>}
  </div>;
}

function DecisionForm({adaptive,enabled,busy,onDecision}:{adaptive:AdaptiveState;enabled:boolean;busy:boolean;onDecision:AdaptiveLaunchProps['onDecision']}){
  const [optionId,setOptionId]=useState('');
  const [constraints,setConstraints]=useState('');
  const analysis=adaptive.analysis!;
  const decision=adaptive.decision?.sourceRevision===adaptive.sourceRevision?adaptive.decision:undefined;
  return <form className="adaptive-decision-form" id="adaptive-launch-decision" tabIndex={-1} onSubmit={event=>{event.preventDefault();void onDecision({requestId:crypto.randomUUID(),expectedRevision:adaptive.revision,analysisVersion:analysis.version,optionId,constraints:constraints.trim()}).catch(()=>{});}}>
    <fieldset disabled={busy||!enabled}><legend>{decision?'Selected launch approach':'Choose how the launch should proceed'}</legend><div className="adaptive-options">{analysis.value.options.map(option=><label className="adaptive-option" data-selected={(decision?.optionId??optionId)===option.id} key={option.id}><input type="radio" name={`launch-option-${analysis.version}`} value={option.id} checked={(decision?.optionId??optionId)===option.id} onChange={()=>setOptionId(option.id)} required/><div><div className="adaptive-option-heading"><strong>{option.label}</strong>{option.id===analysis.value.recommendedOptionId&&<Badge tone="blue">Recommended</Badge>}{option.id===decision?.optionId&&<Badge tone="green">Selected</Badge>}</div><p>{option.description}</p><ul>{option.consequences.map((consequence,index)=><li key={index}>{consequence}</li>)}</ul></div></label>)}</div></fieldset>
    {decision?<Notice tone="blue"><strong>Decision saved {dateTime(decision.at)}.</strong>{decision.constraints&&<p>{decision.constraints}</p>}Dependent work uses this decision and its constraints.</Notice>:<><Field label="Additional constraints" help="Optional. Add corrections or limits the launch pack must respect."><textarea value={constraints} onChange={event=>setConstraints(event.target.value)} rows={3} maxLength={4000} disabled={busy||!enabled}/></Field><Button type="submit" busy={busy} disabled={!enabled||!optionId}><CheckCircle2 size={14}/>Save decision and continue</Button>{!enabled&&<p className="small muted">Decision submission is available when the mission is running and the human decision task is ready.</p>}</>}
  </form>;
}

function Citations({citations,adaptive}:{citations:SourceCitation[];adaptive:AdaptiveState}){
  if(!citations.length)return null;
  return <details className="adaptive-citations"><summary>Source evidence ({citations.length})</summary>{citations.map((citation,index)=>{
    const source=adaptive.sourceHistory.find(revision=>revision.revision===citation.sourceRevision)?.sources.find(item=>item.id===citation.sourceId);
    return <blockquote key={`${citation.sourceId}-${index}`}><p>{citation.excerpt}</p><footer>{source?.title??citation.sourceId} · source revision {citation.sourceRevision}</footer></blockquote>;
  })}</details>;
}

function AdaptiveActivityLog({execution}:{execution:MissionExecution}){
  const adaptive=execution.adaptive!;
  const activity=execution.activity??[];
  return <details className="execution-overview adaptive-activity"><summary><span>Agent activity and work limits</span><span className="small muted">{adaptive.budget.modelCalls}/{adaptive.budget.maxModelCalls} model calls · {adaptive.budget.toolCalls}/{adaptive.budget.maxToolCalls} tool calls</span></summary><p className="small muted">Parallel agents report their actions here. These summaries record execution activity; saved evidence establishes whether the work is complete.</p>{activity.length?<ol>{[...activity].reverse().map(event=><li key={event.id}><div className="adaptive-activity-heading"><strong>{event.agent}</strong><span className="small muted">{dateTime(event.at)} · revision {event.sourceRevision}</span></div><p>{event.summary}</p>{event.tool&&<span className="small muted">Tool: {event.tool}{event.sourceId?` · source ${event.sourceId}`:''}</span>}</li>)}</ol>:<p className="small muted">Activity will appear when the agents start.</p>}</details>;
}

function safeSourceLink(value:string|null|undefined):string|undefined{
  if(!value)return undefined;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}
}
