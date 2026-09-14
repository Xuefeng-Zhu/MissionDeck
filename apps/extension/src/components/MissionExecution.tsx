import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {ADAPTIVE_SAMPLE_SOURCES,type AdaptiveSourceInput,type ExecutionArtifact,type ExecutionCapabilities,type ExecutionIdentity,type ExecutionOperationSummary,type ExecutionStart,type ExecutionTask,type MissionExecution as Execution} from '@mission/domain';
import {Badge,Button,Field,Notice} from '@mission/ui';
import {ArrowRight,Bot,Check,CheckCircle2,ExternalLink,FileText,GitBranch,Pause,Play,RefreshCw,Square,Target,User} from 'lucide-react';
import {api,ApiError,post} from '../api';
import {dateTime} from '../format';
import {AdaptiveLaunch,AdaptiveSourceEditor,sourcesValid} from './AdaptiveLaunch';
import {ExecutionGraph} from './ExecutionGraph';
import {LaunchPackCards,StrandsWorkflow} from './LaunchExperience';
import '../execution.css';

interface Props {
  missionId?: string;
  paired: boolean;
  publicDemo?: boolean;
  publicDemoMaxSourceRevisions?: number;
  onStarted: (missionId:string)=>Promise<unknown>;
  onNewMission: ()=>void;
  onPlanningSetup?: ()=>void;
  onCancel?: ()=>void;
}
const taskLabels:Record<ExecutionTask['status'],string>={queued:'Waiting for dependencies',running:'Drafting worker running',waiting_human:'Human review ready',saving:'Saving to workspace',completed:'Verified complete',blocked:'Blocked',failed:'Failed',outcome_unknown:'Outcome uncertain',cancelled:'Cancelled'};
const missionLabels:Record<Execution['status'],string>={planning:'Building your plan',running:'In progress',paused:'Paused',blocked:'Needs attention',needs_review:'Ready for final review',completed:'Completed',cancelled:'Cancelled'};
const genericSampleContext='Fictional demo sources — these are sample facts, not real business claims.\n\nProduct: Harbor, a shared workspace for small project teams.\nAudience: teams coordinating human and agent work.\nCore features: mission planning, named task ownership, human review, and a shared document library.\nPositioning: make it clear who is doing what and where the latest work lives.\nConstraints: no invented customer quotes, revenue, performance metrics, pricing, or launch dates.\nDeliverable: a concise launch brief with audience, positioning, features, and a launch checklist.\nReview: ask the human reviewer to confirm the positioning before writing the final brief.';
function stateTone(status:string):'neutral'|'blue'|'green'|'amber'|'red'{return status==='completed'?'green':['failed','outcome_unknown','blocked'].includes(status)?'red':['waiting_human','needs_review','paused'].includes(status)?'amber':['running','planning','saving'].includes(status)?'blue':'neutral';}
function safeLink(value:string|null):string|undefined{if(!value)return;try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:undefined;}catch{return;}}
function message(error:unknown){return error instanceof Error?error.message:'Unable to update this mission. Please retry.';}

export function MissionExecution({missionId,paired,publicDemo=false,publicDemoMaxSourceRevisions,onStarted,onNewMission,onPlanningSetup,onCancel}:Props){
  const [capabilities,setCapabilities]=useState<ExecutionCapabilities|null>(null);
  const [execution,setExecution]=useState<Execution|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [refreshFailed,setRefreshFailed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [cancelOpen,setCancelOpen]=useState(false);
  const [attestation,setAttestation]=useState('');
  const busyRef=useRef(false);
  const mutationVersion=useRef(0);
  const readSequence=useRef(0);
  const mounted=useRef(true);
  const terminal=execution?.status==='completed'||execution?.status==='cancelled';

  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const refresh=useCallback(async()=>{
    if(!paired){setLoading(false);return;}
    const version=mutationVersion.current;
    const read=++readSequence.current;
    try{
      const results=await Promise.allSettled([
        api<ExecutionCapabilities>('/api/execution/capabilities'),
        missionId?api<{execution:Execution|null}>(`/api/missions/${encodeURIComponent(missionId)}/execution`):Promise.resolve({execution:null}),
      ]);
      if(!mounted.current||version!==mutationVersion.current||read!==readSequence.current)return;
      const [capabilityResult,executionResult]=results;
      if(capabilityResult.status==='fulfilled')setCapabilities(capabilityResult.value);
      if(executionResult.status==='fulfilled'){setExecution(executionResult.value.execution);setRefreshFailed(false);}
      else setRefreshFailed(true);
      const failure=results.find(result=>result.status==='rejected');
      setError(failure?.status==='rejected'?message(failure.reason):'');
    }finally{if(mounted.current)setLoading(false);}
  },[missionId,paired]);

  useEffect(()=>{setLoading(true);setExecution(null);setError('');setRefreshFailed(false);setCancelOpen(false);setAttestation('');void refresh();},[refresh]);
  useEffect(()=>{
    if(!missionId||!paired||terminal)return;
    let active=true;
    let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      const version=mutationVersion.current;
      let read:number|undefined;
      try{
        if(!busyRef.current){
          read=++readSequence.current;
          const result=await api<{execution:Execution|null}>(`/api/missions/${encodeURIComponent(missionId)}/execution`);
          if(active&&version===mutationVersion.current&&read===readSequence.current){setExecution(result.execution);setRefreshFailed(false);setError('');}
        }
      }catch(e){if(active&&version===mutationVersion.current&&read===readSequence.current){setError(message(e));setRefreshFailed(true);}}
      if(active)timer=setTimeout(()=>void poll(),3000);
    };
    timer=setTimeout(()=>void poll(),3000);
    return()=>{active=false;clearTimeout(timer);};
  },[missionId,paired,terminal]);

  async function mutate(path:string,body:unknown){
    if(busyRef.current)return;
    busyRef.current=true;mutationVersion.current+=1;setBusy(true);setError('');
    try{
      const result=await post<{execution:Execution}>(path,body);
      if(mounted.current){setExecution(result.execution);setRefreshFailed(false);setCancelOpen(false);}
    }catch(e){if(mounted.current)setError(message(e));throw e;}
    finally{busyRef.current=false;if(mounted.current)setBusy(false);}
  }
  const control=(action:'pause'|'resume'|'cancel'|'complete')=>mutate(`/api/missions/${encodeURIComponent(missionId!)}/execution/control`,{action,...(action==='complete'?{attestation:attestation.trim()}:{})});
  const taskAction=(taskId:string,action:'review'|'reassign'|'retry',body:unknown)=>mutate(`/api/missions/${encodeURIComponent(missionId!)}/execution/tasks/${encodeURIComponent(taskId)}/${action}`,body);

  if(!missionId)return <ExecutionStartForm key={paired?'paired':'unpaired'} capabilities={capabilities} loading={loading} paired={paired} error={error} publicDemo={publicDemo} onRefresh={refresh} onStarted={onStarted} onCancel={onCancel} onPlanningSetup={onPlanningSetup}/>;
  if(loading)return <div className="execution-loading" role="status"><RefreshCw size={20} className="spin"/>Loading mission execution…</div>;
  if(!execution)return <section className="execution-empty" aria-label="Mission execution"><Target size={28}/><h2>This mission uses the planning workspace.</h2><p>Start an execution mission to assign work to a named human and agent, run ready tasks automatically, and retain the outputs in the configured workspace.</p>{error&&<Notice tone="red">{error}<div className="actions"><Button variant="secondary" onClick={()=>void refresh()}>Retry</Button></div></Notice>}<Button onClick={onNewMission}><Play size={15}/>Start a new execution mission</Button></section>;

  const completed=execution.tasks.filter(task=>task.status==='completed').length;
  const running=execution.tasks.filter(task=>['running','saving'].includes(task.status)).length;
  const humanReady=execution.tasks.filter(task=>task.status==='waiting_human').length;
  const stopped=!['planning','running'].includes(execution.status);
  const scope=execution.mode==='fixture'?'Fixture workspace':'Ambiguous';
  const currentArtifacts=execution.artifacts.filter(artifact=>!execution.adaptive||artifact.sourceRevision===undefined||artifact.sourceRevision===execution.adaptive.sourceRevision);
  const historicalArtifacts=execution.artifacts.filter(artifact=>execution.adaptive&&artifact.sourceRevision!==undefined&&artifact.sourceRevision!==execution.adaptive.sourceRevision);
  const deliverables=currentArtifacts.filter(artifact=>artifact.kind!=='brief');
  const briefs=currentArtifacts.filter(artifact=>artifact.kind==='brief');
  const outcomeReview=execution.status==='needs_review'&&<div className="execution-overview" id="execution-outcome-verification" tabIndex={-1}><div className="section-heading"><CheckCircle2 size={20}/><div><h2>Review the mission outcome</h2><p>Open the saved deliverables below and check them against your mission before marking it complete.</p></div></div><form onSubmit={event=>{event.preventDefault();void control('complete').catch(()=>{});}}><Field label="Outcome verification" help="Describe how the saved work meets your mission, including any limitations you accept."><textarea value={attestation} onChange={event=>setAttestation(event.target.value)} rows={3} minLength={10} maxLength={500} required disabled={busy}/></Field><Button type="submit" busy={busy} disabled={attestation.trim().length<10}><CheckCircle2 size={15}/>Verify and complete mission</Button></form></div>;
  const workSections=<>
    <div className="execution-section-title"><h3>The work</h3><span className="small muted">Dependencies release automatically</span></div>
    {execution.tasks.length?<ol className="execution-task-list">{execution.tasks.map((task,index)=><ExecutionTaskCard key={task.id} task={task} index={index} execution={execution} identities={[...(capabilities?.humans??[]),...(capabilities?.agents??[])]} stopped={stopped} busy={busy} publicDemo={publicDemo} onReview={feedback=>taskAction(task.id,'review',{feedback})} onReassign={assigneeId=>taskAction(task.id,'reassign',{assigneeId})} onRetry={()=>taskAction(task.id,'retry',{})}/>)}</ol>:<div className="execution-empty"><p>The mission plan is being prepared. Assignments and saved tasks will appear here.</p></div>}
    <div className="execution-section-title"><h3>Saved artifacts</h3><span className="small muted">{deliverables.length} verified in {scope}</span></div>
    <div className="execution-artifact-list" aria-label="Execution artifacts">{deliverables.length?deliverables.map(artifact=><Artifact key={artifact.id} artifact={artifact} taskTitle={execution.tasks.find(task=>task.id===artifact.taskId)?.title}/>):<p className="small muted" style={{paddingTop:14}}>Drafts, reviews, and final deliverables appear here after their saved contents have been verified.</p>}</div>
    {historicalArtifacts.length>0&&<details className="adaptive-history"><summary>Historical artifacts · {historicalArtifacts.length} from earlier source revisions</summary><p className="small muted">These verified records are retained for comparison. They do not establish completion of the current source revision.</p><div className="execution-artifact-list" aria-label="Historical execution artifacts">{historicalArtifacts.map(artifact=><Artifact key={artifact.id} artifact={artifact} taskTitle={execution.tasks.find(task=>task.id===artifact.taskId)?.title}/>)}</div></details>}
  </>;
  return <section className={`execution-panel ${execution.adaptive?'launch-experience':''}`} aria-label="Mission execution">
    <div className="execution-overview">
      <div className="section-heading row-between"><div><div className="execution-eyebrow"><Target size={14}/>Mission execution</div><h2>{missionLabels[execution.status]}</h2></div><div className="execution-actions">
        {!publicDemo&&(['paused','blocked'].includes(execution.status)?<Button busy={busy} disabled={execution.tasks.some(task=>['failed','blocked','outcome_unknown'].includes(task.status))||execution.operations.some(operation=>operation.state==='outcome_unknown')} onClick={()=>void control('resume').catch(()=>{})}><Play size={14}/>Resume mission</Button>:!['completed','cancelled','needs_review'].includes(execution.status)&&<Button variant="secondary" busy={busy} onClick={()=>void control('pause').catch(()=>{})}><Pause size={14}/>Pause mission</Button>)}
        {!['completed','cancelled'].includes(execution.status)&&<Button variant="ghost" disabled={busy} onClick={()=>setCancelOpen(true)}><Square size={13}/>Cancel mission</Button>}
        <Button variant="ghost" disabled={busy} onClick={()=>void refresh()} aria-label="Refresh execution"><RefreshCw size={15}/></Button>
      </div></div>
      <div className="execution-stats"><span><strong>{completed}/{execution.tasks.length}</strong> tasks verified</span><span><strong>{running}</strong> working</span><span><strong>{humanReady}</strong> waiting for a human</span><span><strong>{execution.budget.agentRuns}/{execution.budget.maxAgentRuns}</strong> agent runs used</span></div>
      <div className="execution-progress" role="progressbar" aria-label="Verified tasks" aria-valuemin={0} aria-valuemax={Math.max(execution.tasks.length,1)} aria-valuenow={completed}><span style={{width:`${execution.tasks.length?100*completed/execution.tasks.length:0}%`}}/></div>
      <p className="execution-status-text">{execution.summary||'Ready agent tasks start automatically after assignments and dependencies are verified.'}</p>
      <div className="adaptive-provenance" aria-label="Execution engine and model"><span>Engine: {execution.engine==='strands'?'Strands Agents':'Direct drafting'}</span>{execution.modelProvider&&<span>Provider: {execution.modelProvider}</span>}{execution.modelName&&<span>Model: {execution.modelName}</span>}</div>
      {execution.status==='paused'&&<Notice tone="amber">New work is paused. Any work already sent to a provider may still finish; saved results remain attached to this mission.</Notice>}
      {execution.status==='cancelled'&&<Notice>New work has been cancelled. Tasks and artifacts already saved remain in {scope}.</Notice>}
      {execution.status==='completed'&&execution.outcomeVerification&&<Notice tone="blue"><strong>Verified outcome:</strong> {execution.outcomeVerification.statement}</Notice>}
      {(execution.mode==='fixture'||execution.modelMode==='fixture')&&<Notice tone="amber">{execution.mode==='fixture'?'This is a fixture workspace. Tasks, people, and stored outputs are simulated. ':''}{execution.modelMode==='fixture'?'Agent outputs use a deterministic fixture, not a live model.':''}</Notice>}
      {execution.lastError&&<Notice tone="red">{execution.lastError}</Notice>}
      {error&&<Notice tone="red">The latest update failed: {error} <button className="text-button" onClick={()=>void refresh()}>Refresh</button></Notice>}
      {cancelOpen&&<Notice tone="amber"><div className="execution-cancel-confirm"><span>Cancel new work for this mission? Existing tasks and saved artifacts will remain.</span><div className="execution-actions"><Button variant="danger" busy={busy} onClick={()=>void control('cancel').catch(()=>{})}>Confirm cancellation</Button><Button variant="ghost" disabled={busy} onClick={()=>setCancelOpen(false)}>Keep working</Button></div></div></Notice>}
      <p className="execution-poll-status"><RefreshCw size={11}/>{terminal?'Saved mission history. Use refresh to check its latest state.':'Updates every 3 seconds · Work continues on the server when this panel closes.'}</p>
    </div>
    {execution.adaptive?<>
      <StrandsWorkflow execution={execution} stale={refreshFailed}/>
      <AdaptiveLaunch execution={execution} busy={busy} publicDemo={publicDemo} maxSourceRevisions={publicDemoMaxSourceRevisions} onDecision={body=>mutate(`/api/missions/${encodeURIComponent(missionId)}/execution/decision`,body)} onSources={body=>mutate(`/api/missions/${encodeURIComponent(missionId)}/execution/sources`,body)} onReopen={body=>mutate(`/api/missions/${encodeURIComponent(missionId)}/execution/reopen`,body)}/>
      <LaunchPackCards execution={execution}/>
      {outcomeReview}
      <details className="launch-technical" open><summary><span>How MissionDeck worked</span><small>Graph, tools, revisions, timings, budgets, and durable records</small></summary>
        <ExecutionGraph key={`${execution.missionId}:${execution.adaptive.sourceRevision}`} execution={execution} stale={refreshFailed}/>
        {briefs.length>0&&<div className="execution-artifact-list" aria-label="Saved mission brief">{briefs.map(artifact=><Artifact key={artifact.id} artifact={artifact}/>)}</div>}
        {workSections}
      </details>
    </>:<>{outcomeReview}{briefs.length>0&&<div className="execution-artifact-list" aria-label="Saved mission brief">{briefs.map(artifact=><Artifact key={artifact.id} artifact={artifact}/>)}</div>}{workSections}</>}
    {!publicDemo&&execution.operations.filter(operation=>operation.state==='outcome_unknown').map(operation=><ReconcileOperation key={operation.id} operation={operation} busy={busy} onReconcile={providerId=>mutate(`/api/missions/${encodeURIComponent(missionId)}/execution/reconcile`,{operationId:operation.id,...(providerId?{providerId}:{})})}/>)}
    <details className="schedule-details"><summary>Execution history</summary>{[...execution.events].reverse().map(event=><p key={event.id}><span className="small muted">{dateTime(event.at)}</span> · {event.message}</p>)}<p className="small muted">Mission ID: {execution.missionId}</p></details>
  </section>;
}

function ExecutionStartForm({capabilities,loading,paired,error,publicDemo,onRefresh,onStarted,onCancel,onPlanningSetup}:{capabilities:ExecutionCapabilities|null;loading:boolean;paired:boolean;error:string;publicDemo:boolean;onRefresh:()=>Promise<void>;onStarted:Props['onStarted'];onCancel?:()=>void;onPlanningSetup?:()=>void}){
  const [goal,setGoal]=useState("Prepare Harbor's launch pack and resolve the calendar conflict.");
  const [context,setContext]=useState('');
  const [template,setTemplate]=useState<'generic'|'adaptive_launch'>('adaptive_launch');
  const [sources,setSources]=useState<AdaptiveSourceInput[]>(()=>ADAPTIVE_SAMPLE_SOURCES.map(source=>({...source})));
  const [humanId,setHumanId]=useState('');
  const [agentId,setAgentId]=useState('');
  const [maxTasks,setMaxTasks]=useState(3);
  const [maxAgentRuns,setMaxAgentRuns]=useState(8);
  const [busy,setBusy]=useState(false);
  const [startError,setStartError]=useState('');
  const [uncertain,setUncertain]=useState(false);
  const request=useRef<ExecutionStart|null>(null);
  const submitting=useRef(false);
  useEffect(()=>{if(capabilities?.humans.length===1)setHumanId(capabilities.humans[0]!.id);if(capabilities?.agents.length===1)setAgentId(capabilities.agents[0]!.id);},[capabilities]);
  const selectedHuman=capabilities?.humans.find(identity=>identity.id===humanId);
  const selectedAgent=capabilities?.agents.find(identity=>identity.id===agentId);
  async function start(event:FormEvent){
    event.preventDefault();if(submitting.current)return;
    submitting.current=true;setBusy(true);setStartError('');
    const payload=request.current&&uncertain?request.current:{requestId:crypto.randomUUID(),goal:goal.trim(),context:template==='adaptive_launch'?'':context.trim(),humanId,agentId,maxTasks,maxAgentRuns,...(template==='adaptive_launch'?{template:'adaptive_launch' as const,sources}:{})};
    request.current=payload;
    try{
      const result=await post<{execution:Execution}>('/api/execution/missions',payload);
      await onStarted(result.execution.missionId);
    }catch(e){setStartError(message(e));setUncertain(!(e instanceof ApiError)||e.status===0||e.status>=500);}
    finally{submitting.current=false;setBusy(false);}
  }
  const disabled=busy||uncertain;
  const adaptiveReady=template!=='adaptive_launch'||Boolean(capabilities?.adaptive?.enabled&&sourcesValid(sources));
  const executionEnabled=template==='adaptive_launch'?capabilities?.adaptive?.enabled:capabilities?.enabled;
  return <section className="execution-start launch-start" aria-label="Harbor launch review">
    <div className="launch-start-hero"><div><span className="launch-kicker"><Target size={14}/>Release-readiness agent</span><h2>Run the Harbor launch review</h2><p>Requirements promise calendar sync. Engineering says it is two weeks away. Customer feedback supports a smaller beta. MissionDeck reconciles the evidence, asks for the one launch tradeoff that needs you, then writes the pack around your decision.</p></div><div className="launch-proof"><span><strong>3</strong> reviewed sources</span><span><strong>4</strong> Strands specialists</span><span><strong>1</strong> human decision</span></div></div>
    {!paired&&<Notice tone="amber">Connect this browser session in Settings to load workspace members and start work.</Notice>}
    {loading&&paired&&<Notice><RefreshCw size={13} className="spin"/> Checking workspace identities and execution capabilities…</Notice>}
    {error&&<Notice tone="red">{error} <button className="text-button" onClick={()=>void onRefresh()}>Retry connection</button></Notice>}
    {template==='generic'&&capabilities&&!capabilities.enabled&&<Notice tone="amber"><strong>Execution needs setup.</strong>{capabilities.blockers.map((blocker,index)=><p key={index} style={{margin:'7px 0 0'}}>{blocker}</p>)}</Notice>}
    {template==='adaptive_launch'&&capabilities&&!capabilities.adaptive?.enabled&&<Notice tone="amber"><strong>Adaptive launch review needs setup.</strong>{capabilities.adaptive?.blockers.length?capabilities.adaptive.blockers.map((blocker,index)=><p key={index} style={{margin:'7px 0 0'}}>{blocker}</p>):<p>The connected server has not enabled the adaptive Strands workflow.</p>}</Notice>}
    {capabilities&&(capabilities.mode==='fixture'||template==='generic'&&capabilities.modelMode==='fixture')&&<Notice tone="amber">{capabilities.mode==='fixture'?'Fixture workspace: assignments and stored artifacts are simulated. ':''}{template==='generic'&&capabilities.modelMode==='fixture'?'Agent work uses deterministic fixture output.':''}</Notice>}
    <form onSubmit={event=>void start(event)}>
      {template==='adaptive_launch'?<div className="launch-start-layout"><div className="launch-source-workbench"><div className="launch-start-section-heading"><div><span>01 / Evidence in</span><h3>Review the source packet</h3></div><Button type="button" variant="ghost" disabled={disabled} onClick={()=>{setGoal("Prepare Harbor's launch pack and resolve the calendar conflict.");setSources(ADAPTIVE_SAMPLE_SOURCES.map(source=>({...source})));}}>Reset demo sources</Button></div><p className="small muted">These are clearly labeled fictional inputs. Edit any sentence before starting to see the agents work from your version.</p><AdaptiveSourceEditor sources={sources} onChange={setSources} disabled={disabled}/></div><aside className="launch-decision-preview" aria-label="Expected review flow"><span>02 / Judgment</span><h3>MissionDeck interrupts only when the evidence becomes a tradeoff.</h3><blockquote>Promise calendar sync, delay the launch, or stage a private beta with honest limits?</blockquote><ol><li><Check size={13}/>Evidence is cited to a source revision</li><li><Check size={13}/>Your constraints are saved in a Decision Receipt</li><li><Check size={13}/>The brief, checklist, and announcement change together</li></ol></aside></div>:<Field label="Source material and context" help={`Paste the facts, excerpts, and links you want retained in ${capabilities?.mode==='fixture'?'the fixture workspace':'Ambiguous'}. Agents draft from the material you provide; linked pages are not fetched automatically.`}><textarea className="execution-context" value={context} onChange={event=>setContext(event.target.value)} placeholder="Audience, product details, research excerpts, requirements, or an existing draft…" rows={6} maxLength={20000} disabled={disabled}/></Field>}
      <div className="launch-run-settings"><Field label="Review outcome" help="The outcome stays editable and is saved with the mission."><textarea className="execution-goal" value={goal} onChange={event=>setGoal(event.target.value)} required minLength={5} maxLength={500} disabled={disabled}/></Field><div className="two-fields"><Field label="Human reviewer" help={selectedHuman?`Workspace identity: ${selectedHuman.id}`:'Choose a person from the connected workspace.'}><select required value={humanId} onChange={event=>setHumanId(event.target.value)} disabled={disabled||!capabilities?.humans.length}><option value="">Select a human</option>{capabilities?.humans.map(identity=><option key={identity.id} value={identity.id}>{identity.name}</option>)}</select></Field><Field label="Working agent" help={selectedAgent?`Workspace identity: ${selectedAgent.id}`:'Choose a supported agent from the connected workspace.'}><select required value={agentId} onChange={event=>setAgentId(event.target.value)} disabled={disabled||!capabilities?.agents.length}><option value="">Select an agent</option>{capabilities?.agents.map(identity=><option key={identity.id} value={identity.id}>{identity.name}</option>)}</select></Field></div></div>
      <details><summary>Work limits · up to {maxTasks} tasks and {maxAgentRuns} agent runs</summary><div className="two-fields"><Field label="Maximum tasks"><input type="number" min={3} max={12} required value={maxTasks} onChange={event=>setMaxTasks(event.target.valueAsNumber)} disabled={disabled}/></Field><Field label="Maximum agent runs"><input type="number" min={2} max={20} required value={maxAgentRuns} onChange={event=>setMaxAgentRuns(event.target.valueAsNumber)} disabled={disabled}/></Field></div><p className="small">Retries count toward the run limit. These limits cap work, not the model provider's monetary charges.</p></details>
      {template==='adaptive_launch'?<p className="small muted">Supported work: compare supplied sources and prepare a launch pack using Strands Agents.{capabilities?.adaptive&&<> Provider: {capabilities.adaptive.modelProvider} · Model: {capabilities.adaptive.modelName}.</>}</p>:capabilities?.supportedWork&&<p className="small muted">Supported work: {capabilities.supportedWork}</p>}
      <p className="execution-authorization">Starting sends the source text above to this MissionDeck server and the configured {capabilities?.adaptive?.modelProvider||'model provider'} for analysis. It authorizes bounded Strands work and saves source revisions, analysis, your decision, and the resulting pack in {capabilities?.mode==='fixture'?'the clearly labeled fixture workspace':'your connected Ambiguous workspace'}. Source URLs are references only. The announcement remains a draft; nothing is published.</p>
      {startError&&<Notice tone="red">{startError}</Notice>}
      {uncertain&&<Notice tone="amber">The start response could not be confirmed. Retry this same request to recover its saved mission without creating duplicate work.</Notice>}
      <div className="execution-start-actions"><Button type="submit" busy={busy} disabled={!paired||loading||!executionEnabled||!selectedHuman||!selectedAgent||goal.trim().length<5||!adaptiveReady}>{uncertain?'Recover launch review':busy?'Starting the review…':template==='adaptive_launch'?'Start launch review':'Start custom mission'}<ArrowRight size={15}/></Button>{onCancel&&<Button type="button" variant="ghost" disabled={busy||uncertain} onClick={onCancel}>Cancel</Button>}</div>
      {!publicDemo&&<details className="launch-custom-beta"><summary>Custom mission · beta</summary><div className="adaptive-template-options" role="group" aria-label="Mission workflow"><label className="adaptive-template-option"><input type="radio" name="execution-template" value="adaptive_launch" checked={template==='adaptive_launch'} onChange={()=>{setTemplate('adaptive_launch');setMaxTasks(3);setMaxAgentRuns(8);setGoal("Prepare Harbor's launch pack and resolve the calendar conflict.");setSources(ADAPTIVE_SAMPLE_SOURCES.map(source=>({...source})));}} disabled={disabled}/><span><strong>Harbor launch review</strong><small>The polished Strands workflow shown above.</small></span></label><label className="adaptive-template-option"><input type="radio" name="execution-template" value="generic" checked={template==='generic'} onChange={()=>{setTemplate('generic');setMaxTasks(8);setMaxAgentRuns(4);setGoal('Prepare a launch brief from these demo sources, ask me to review the positioning, then create the final brief.');setContext(genericSampleContext);}} disabled={disabled}/><span><strong>Draft and review beta</strong><small>A general drafting flow retained for existing MissionDeck workspaces.</small></span></label></div>{onPlanningSetup&&<Button type="button" variant="ghost" disabled={busy||uncertain} onClick={onPlanningSetup}>Use planning-only workspace</Button>}</details>}
    </form>
  </section>;
}

function ExecutionTaskCard({task,index,execution,identities,stopped,busy,publicDemo,onReview,onReassign,onRetry}:{task:ExecutionTask;index:number;execution:Execution;identities:ExecutionIdentity[];stopped:boolean;busy:boolean;publicDemo:boolean;onReview:(feedback:string)=>Promise<void>;onReassign:(id:string)=>Promise<void>;onRetry:()=>Promise<void>}){
  const [feedback,setFeedback]=useState('');
  const [assigneeId,setAssigneeId]=useState(task.assignee.id);
  useEffect(()=>{setAssigneeId(task.assignee.id);},[task.assignee.id]);
  const options=execution.adaptive?identities.filter(identity=>identity.kind===(index===1?'human':'agent')):identities;
  const selectedAssignee=options.find(identity=>identity.id===assigneeId);
  const closed=['cancelled','completed'].includes(execution.status);
  const canReassign=!publicDemo&&!closed&&!task.pendingOutput&&['queued','waiting_human','blocked','failed'].includes(task.status)&&options.length>1;
  const link=safeLink(task.providerUrl);
  const dependencies=task.dependsOn.map(id=>execution.tasks.find(dependency=>dependency.id===id)?.title??id);
  const taskArtifacts=execution.artifacts.filter(artifact=>task.artifacts.includes(artifact.id)&&(!execution.adaptive||artifact.sourceRevision===undefined||artifact.sourceRevision===execution.adaptive.sourceRevision));
  const workspace=execution.mode==='fixture'?'the fixture workspace':'Ambiguous';
  return <li className="execution-task" data-state={task.status}>
    <span className="execution-task-number">{task.status==='completed'?<Check size={15}/>:index+1}</span>
    <div className="execution-task-body"><div className="execution-task-heading"><h3>{task.title}</h3><Badge tone={stateTone(task.status)}>{task.status==='queued'&&!task.dependsOn.length?'Queued':execution.adaptive&&task.status==='running'?'Strands agents working':execution.adaptive&&task.status==='waiting_human'?'Launch decision ready':taskLabels[task.status]}</Badge></div>
      <div className="execution-task-meta"><span>{task.assignee.kind==='agent'?<Bot size={13}/>:<User size={13}/>} {task.assignee.name}</span><span>{task.providerId&&!task.assignmentPending?<><CheckCircle2 size={12}/>Assignment saved</>:'Assignment pending verification'}</span>{link&&<a href={link} target="_blank" rel="noreferrer">Open task <ExternalLink size={11}/></a>}</div>
      <p className="execution-task-description">{task.description}</p>
      {dependencies.length>0&&<p className="small muted"><GitBranch size={12}/> Depends on: {dependencies.join(' · ')}</p>}
      {task.lastError&&<Notice tone={task.status==='outcome_unknown'?'amber':'red'}>{task.lastError}</Notice>}
      {task.status==='outcome_unknown'&&<p className="small muted">The provider outcome must be reconciled before another attempt. Refresh to check verified progress.</p>}
      {taskArtifacts.length>0&&<div className="execution-artifact-list">{taskArtifacts.map(artifact=><Artifact key={artifact.id} artifact={artifact}/>)}</div>}
      {task.status==='waiting_human'&&execution.adaptive&&<p className="small muted">Review the cited findings and choose a launch approach in the decision panel above.</p>}
      {task.status==='waiting_human'&&!stopped&&!execution.adaptive&&<form className="execution-review" onSubmit={event=>{event.preventDefault();void onReview(feedback.trim()).then(()=>setFeedback('')).catch(()=>{});}}><Field label={`Review feedback for ${task.title}`} help={`Record your decision and any corrections. Your review will be saved in ${workspace} and supplied to dependent tasks.`}><textarea value={feedback} onChange={event=>setFeedback(event.target.value)} rows={3} minLength={3} maxLength={10000} required disabled={busy} placeholder="I reviewed the draft. Keep… Change…"/></Field><Button type="submit" busy={busy} disabled={feedback.trim().length<3}><CheckCircle2 size={14}/>Save review and continue</Button><p style={{marginTop:9}}>You can also complete this review task in {workspace} with its review result.</p></form>}
      {!publicDemo&&!closed&&!task.pendingOutput&&['failed','blocked'].includes(task.status)&&task.assignee.kind==='agent'&&<Button variant="secondary" busy={busy} onClick={()=>void onRetry().catch(()=>{})}><RefreshCw size={13}/>Retry task</Button>}
      <details><summary>Completion criteria and provider details</summary><ul className="execution-task-criteria">{task.completionCriteria.map((criterion,criterionIndex)=><li key={criterionIndex}>{criterion}</li>)}</ul><p>Assignee ID: <code>{task.assignee.id}</code></p><p>{execution.mode==='fixture'?'Fixture task ID':'Ambiguous task ID'}: <code>{task.providerId??'Not yet saved'}</code></p><p>Run ID: <code>{task.runId??'No agent run started'}</code></p>{task.runStartedAt&&<p>Started {dateTime(task.runStartedAt)}</p>}{task.runFinishedAt&&<p>Finished {dateTime(task.runFinishedAt)}</p>}
      {canReassign&&<form className="execution-assignment" onSubmit={event=>{event.preventDefault();void onReassign(assigneeId).catch(()=>{});}}><Field label={`Reassign ${task.title}`}><select value={assigneeId} onChange={event=>setAssigneeId(event.target.value)} disabled={busy}>{options.map(identity=><option key={identity.id} value={identity.id}>{identity.name} · {identity.kind}</option>)}</select></Field><Button type="submit" variant="secondary" busy={busy} disabled={assigneeId===task.assignee.id||!selectedAssignee}>Save assignment</Button>{assigneeId!==task.assignee.id&&selectedAssignee&&<p className="small muted">Saving authorizes {selectedAssignee.name} to work on this task and shares saved mission artifacts with them. Existing participants retain access.</p>}</form>}</details>
    </div>
  </li>;
}

function Artifact({artifact,taskTitle}:{artifact:ExecutionArtifact;taskTitle?:string}){
  const link=safeLink(artifact.url);
  return <details className="execution-artifact"><summary><span className="execution-artifact-title"><FileText size={15}/>{artifact.title}</span><Badge tone={artifact.mode==='fixture'?'amber':'green'}>{artifact.mode==='fixture'?'Fixture saved':'Verified in Ambiguous'}</Badge></summary><div className="execution-artifact-meta">{artifact.sourceRevision!==undefined&&<span>Source revision: {artifact.sourceRevision}</span>}{taskTitle&&<span>Task: {taskTitle}</span>}<span>Document ID: <code>{artifact.id}</code></span><span>Verified {dateTime(artifact.verifiedAt)}</span>{link&&<a href={link} target="_blank" rel="noreferrer">{artifact.mode==='fixture'?'Open fixture record':'Open in Ambiguous'} <ExternalLink size={11}/></a>}</div><pre className="execution-artifact-content">{artifact.content}</pre></details>;
}

function ReconcileOperation({operation,busy,onReconcile}:{operation:ExecutionOperationSummary;busy:boolean;onReconcile:(providerId?:string)=>Promise<void>}){
  const [providerId,setProviderId]=useState(operation.providerId??'');
  return <Notice tone="amber"><form onSubmit={event=>{event.preventDefault();void onReconcile(providerId.trim()||undefined).catch(()=>{});}}><h3>Confirm an uncertain provider result</h3><p>{operation.error||'A provider write did not return a confirmed result. Inspect the existing record before continuing.'}</p><p className="small">Operation: <code>{operation.id}</code> · {operation.kind}</p><Field label={`Existing workspace record ID for ${operation.id}`} help="If a task or document was created, enter its actual provider ID. This checks existing work and does not create another copy."><input value={providerId} onChange={event=>setProviderId(event.target.value)} disabled={busy} placeholder="Provider record ID" maxLength={200}/></Field><Button type="submit" variant="secondary" busy={busy}><RefreshCw size={13}/>Reconcile saved record</Button></form></Notice>;
}
