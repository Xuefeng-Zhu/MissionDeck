import {useId,useState,type KeyboardEvent} from 'react';
import type {AdaptiveActivity,MissionExecution} from '@mission/domain';
import {Badge} from '@mission/ui';
import {Activity,ArrowDown,ArrowRight,Check,CheckCircle2,ChevronRight,Clock3,ExternalLink,FileCheck2,FileSearch,GitBranch,LoaderCircle,LockKeyhole,Search,ShieldAlert,UserRound,Workflow,XCircle,type LucideIcon} from 'lucide-react';
import {buildExecutionGraph,type ExecutionGraphNode,type ExecutionGraphStatus} from '../execution-graph';
import {dateTime} from '../format';
import '../execution-graph.css';

const labels:Record<ExecutionGraphStatus,string>={waiting:'Waiting',running:'Working',saving:'Saving',succeeded:'Complete',blocked:'Blocked',failed:'Failed',cancelled:'Cancelled',uncertain:'Outcome uncertain',unavailable:'Details unavailable'};
const icons:Record<ExecutionGraphNode['id'],LucideIcon>={evidence:FileSearch,readiness:CheckCircle2,risk:ShieldAlert,synthesis:GitBranch,decision:UserRound,launch_pack:FileCheck2,delivery:LockKeyhole};
const active=(node:ExecutionGraphNode)=>node.status==='running'||node.status==='saving';
const tone=(status:ExecutionGraphStatus)=>status==='succeeded'?'green':status==='failed'?'red':['blocked','uncertain','saving'].includes(status)?'amber':status==='running'?'blue':'neutral';

function focusSection(id:string){
  const element=document.getElementById(id);
  if(!element)return;
  element.focus({preventScroll:true});
  element.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}

/** Current execution only. Selecting a step is local UI state and never starts work. */
export function ExecutionGraph({execution,stale=false}:{execution:MissionExecution;stale?:boolean}){
  const graph=buildExecutionGraph(execution);
  const [selection,setSelection]=useState<ExecutionGraphNode['id']|null>(null);
  const detailId=useId();
  if(!execution.adaptive)return null;
  const nodes=graph.nodes;
  const selected=nodes.find(node=>node.id===selection)??nodes.find(active)??nodes.find(node=>node.id==='decision'&&node.status==='waiting'&&execution.adaptive?.analysis)??nodes.find(node=>node.status==='failed'||node.status==='uncertain')??nodes[0]!;
  const byId=(id:ExecutionGraphNode['id'])=>nodes.find(node=>node.id===id)!;
  const activitySummary=nodes.filter(active).map(node=>node.label).join(' and ');
  const saved=byId('delivery').status==='succeeded';
  const budget=execution.adaptive.budget;

  function keyboard(event:KeyboardEvent<HTMLButtonElement>,id:ExecutionGraphNode['id']){
    const index=nodes.findIndex(node=>node.id===id);
    const next=event.key==='Home'?0:event.key==='End'?nodes.length-1:['ArrowRight','ArrowDown'].includes(event.key)?(index+1)%nodes.length:['ArrowLeft','ArrowUp'].includes(event.key)?(index+nodes.length-1)%nodes.length:-1;
    if(next<0)return;
    event.preventDefault();
    const node=nodes[next]!;
    setSelection(node.id);
    event.currentTarget.closest('[aria-label="Execution graph"]')?.querySelector<HTMLButtonElement>(`[data-graph-node="${node.id}"]`)?.focus();
  }
  function card(id:ExecutionGraphNode['id']){
    const node=byId(id);const Icon=icons[id];
    const StatusIcon=active(node)?LoaderCircle:node.status==='succeeded'?Check:node.status==='failed'?XCircle:Clock3;
    return <button type="button" className="graph-node" data-graph-node={id} data-state={node.status} aria-pressed={selected.id===id} aria-controls={detailId} onClick={()=>setSelection(id)} onKeyDown={event=>keyboard(event,id)}>
      <span className="graph-node-icon"><Icon size={17} aria-hidden="true"/></span>
      <span className="graph-node-copy"><strong>{node.label}</strong><span className="graph-node-status"><StatusIcon size={11} aria-hidden="true"/>{id==='decision'&&node.status==='saving'?'Saving decision':id==='delivery'&&node.status==='succeeded'?'Documents saved':labels[node.status]}</span></span>
    </button>;
  }
  return <section className="execution-overview execution-graph" aria-label="Execution graph" data-stale={stale}>
    <div className="graph-heading"><div><div className="execution-eyebrow"><Workflow size={14}/>Execution map</div><h2>Follow the work</h2></div><Badge tone="blue">Source revision {graph.sourceRevision}</Badge></div>
    <p className="graph-change">{graph.changeSummary}</p>
    <p className="graph-live-status" role="status"><span className="graph-live-dot"/>{stale?'Updates interrupted · showing last confirmed state':execution.status==='paused'?'New work paused · active work may still finish':execution.status==='cancelled'?'Execution cancelled':graph.verified?'Mission verified':activitySummary?`${activitySummary} working`:saved?'Documents saved · ready for your final review':byId('decision').status==='waiting'&&execution.adaptive.analysis?'Your launch decision is ready':'Select a step to inspect its recorded activity'}</p>

    <div className="graph-flow">
      <div className="graph-stage graph-stage-analysis" role="group" aria-label="Analyze stage">
        <div className="graph-stage-heading"><span>01</span><h3>Analyze</h3><span className="graph-stage-owner">Strands</span></div>
        <div className="graph-analysis-flow">
          <div className="graph-centered-node">{card('evidence')}</div>
          <BranchConnector/>
          <div className="graph-parallel" role="group" aria-label="Parallel specialists">{card('readiness')}{card('risk')}</div>
          <div className="graph-join-label">Both analyses required</div>
          <BranchConnector join/>
          <div className="graph-centered-node">{card('synthesis')}</div>
        </div>
      </div>
      <StageConnector/>
      <div className="graph-stage graph-stage-human" role="group" aria-label="Human decision stage">
        <div className="graph-stage-heading"><span>02</span><h3>Human decision</h3></div>
        <div className="graph-human-body">{card('decision')}<p>Your choice releases the launch pack.</p><span className="graph-assignee"><UserRound size={12}/>{execution.human.name}</span></div>
      </div>
      <StageConnector/>
      <div className="graph-stage graph-stage-produce" role="group" aria-label="Produce launch pack stage">
        <div className="graph-stage-heading"><span>03</span><h3>Produce launch pack</h3></div>
        <div className="graph-produce-body">{card('launch_pack')}<ArrowDown className="graph-delivery-arrow" size={18} aria-hidden="true"/>{card('delivery')}<p>Saved content and access are checked.</p></div>
      </div>
    </div>

    <div className="graph-inspector" id={detailId} aria-label="Selected execution step" role="region">
      <div className="graph-inspector-heading"><h3>{selected.label}</h3><Badge tone={tone(selected.status)}>{labels[selected.status]}</Badge></div>
      <p className="graph-node-summary">{selected.summary}</p>
      <NodeTiming node={selected}/>
      {selected.id==='decision'&&execution.adaptive.analysis&&<button type="button" className="graph-section-link" onClick={()=>focusSection('adaptive-launch-decision')}>{execution.adaptive.decision?'View saved decision':'Review launch decision'}<ArrowRight size={13}/></button>}
      <NodeDetails node={selected} execution={execution}/>
    </div>

    <div className="graph-footer"><div className="graph-budgets" aria-label="Graph work limits"><span><Activity size={12}/><strong>{budget.modelCalls}/{budget.maxModelCalls}</strong> model calls</span><span><strong>{budget.toolCalls}/{budget.maxToolCalls}</strong> tool calls</span></div><div className="graph-outcome" aria-label="Graph outcome" data-verified={graph.verified}><CheckCircle2 size={15}/>{graph.verified?'Mission verified':saved?'Awaiting outcome verification':'Outcome not yet verified'}{saved&&!graph.verified&&execution.status==='needs_review'&&<button type="button" className="graph-section-link" onClick={()=>focusSection('execution-outcome-verification')}>Review outcome<ChevronRight size={13}/></button>}</div></div>
  </section>;
}

function StageConnector(){return <div className="graph-stage-connector" aria-hidden="true"><ArrowRight size={18}/></div>;}
function BranchConnector({join=false}:{join?:boolean}){
  return <svg className="graph-branch-connector" viewBox="0 0 200 22" preserveAspectRatio="none" aria-hidden="true"><path d={join?'M50 0 V8 H100 V22 M150 0 V8 H100':'M100 0 V8 H50 V22 M100 8 H150 V22'}/></svg>;
}

function NodeTiming({node}:{node:ExecutionGraphNode}){
  if(node.id==='decision'||node.id==='delivery')return null;
  const start=node.startedAt?Date.parse(node.startedAt):NaN;
  const end=node.finishedAt?Date.parse(node.finishedAt):NaN;
  const elapsed=Number.isFinite(start)&&Number.isFinite(end)&&end>=start?(end-start)/1000:null;
  return <div className="graph-timing"><Clock3 size={12}/>{node.startedAt?<span>Started {dateTime(node.startedAt)}</span>:<span>Start time unavailable</span>}{node.finishedAt&&<span>Finished {dateTime(node.finishedAt)}</span>}{elapsed!==null&&<span>{elapsed<10?elapsed.toFixed(1):Math.round(elapsed)}s observed</span>}</div>;
}

function safeLink(value:string|null){try{const url=new URL(value??'');return ['http:','https:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}}

/** Collapse correlated tool details into one visible invocation; retain the full log below. */
function visibleActivity(events:AdaptiveActivity[]){
  const rows:AdaptiveActivity[]=[];
  const calls=new Map<string,number>();
  for(const event of events){
    if(event.toolCallId){
      const index=calls.get(event.toolCallId);
      if(index!==undefined){if(event.kind==='tool_end'&&(!event.sourceId||rows[index]?.kind==='tool_start'))rows[index]=event;continue;}
      calls.set(event.toolCallId,rows.length);
    }
    rows.push(event);
  }
  return rows.slice(-6).reverse();
}

function NodeDetails({node,execution}:{node:ExecutionGraphNode;execution:MissionExecution}){
  const events=visibleActivity(node.events);
  const sources=execution.adaptive?.sourceHistory.find(revision=>revision.revision===execution.adaptive?.sourceRevision)?.sources.filter(source=>node.sourceIds.includes(source.id))??[];
  return <>
    {events.length>0&&<ol className="graph-activity" aria-label="Step activity">{events.map(event=><li key={event.id} data-outcome={event.outcome}><span className="graph-event-dot"/><div><p>{event.summary}</p>{event.tool&&<span>{event.tool}{event.outcome?` · ${event.outcome}`:event.kind==='tool_start'?' · started':' · outcome not recorded'}</span>}</div><time dateTime={event.at}>{new Date(event.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time></li>)}</ol>}
    {sources.length>0&&<details className="graph-related"><summary><Search size={13}/>Source references · {sources.length}</summary>{sources.map(source=><details className="graph-source" key={source.id}><summary>{source.title}</summary><p className="small muted">Source revision {execution.adaptive?.sourceRevision} · {source.provenance==='browser'?'Reviewed excerpt':'Pasted source'}</p><pre>{source.content}</pre></details>)}</details>}
    {node.artifacts.length>0&&<details className="graph-related"><summary><FileCheck2 size={13}/>Saved artifacts · {node.artifacts.length}</summary>{node.artifacts.map(artifact=><details className="graph-source" key={artifact.id}><summary>{artifact.title}</summary><p className="small muted">{artifact.mode==='fixture'?'Fixture saved':'Verified in Ambiguous'} · {dateTime(artifact.verifiedAt)}</p>{safeLink(artifact.url)&&<a href={safeLink(artifact.url)} target="_blank" rel="noreferrer">Open in Ambiguous <ExternalLink size={12}/></a>}<pre>{artifact.content}</pre></details>)}</details>}
  </>;
}
