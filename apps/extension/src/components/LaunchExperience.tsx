import {useMemo,useState,type ReactNode} from 'react';
import type {AdaptiveSource,LaunchPack,MissionExecution} from '@mission/domain';
import {Badge,Button} from '@mission/ui';
import {Check,CheckCircle2,ClipboardCheck,Copy,Download,FileText,Megaphone,ShieldAlert,Sparkles} from 'lucide-react';
import {buildExecutionGraph,type ExecutionGraphNodeId,type ExecutionGraphStatus} from '../execution-graph';
import './launch-experience.css';

const stageLabels:Record<Extract<ExecutionGraphNodeId,'evidence'|'readiness'|'risk'|'synthesis'>,string>={
  evidence:'Evidence',readiness:'Readiness',risk:'Risk',synthesis:'Synthesis',
};
const stageOrder=(['evidence','readiness','risk','synthesis'] as const);
const completed=(status:ExecutionGraphStatus)=>status==='succeeded';
const active=(status:ExecutionGraphStatus)=>status==='running'||status==='saving';
const blocked=(status:ExecutionGraphStatus)=>['blocked','failed','cancelled','uncertain'].includes(status);

export function StrandsWorkflow({execution,stale=false}:{execution:MissionExecution;stale?:boolean}){
  const graph=buildExecutionGraph(execution);
  const nodes=new Map(graph.nodes.map(node=>[node.id,node]));
  const current=stageOrder.find(id=>active(nodes.get(id)!.status));
  const decision=nodes.get('decision')!;
  const summary=stale?'Updates interrupted. Showing the last confirmed state.':current?`${stageLabels[current]} is working.`:decision.status==='waiting'&&execution.adaptive?.analysis?'Your judgment is needed.':graph.verified?'Outcome verified.':'The run is saved and can continue while you are away.';
  return <section className="strands-workflow" aria-label="Strands workflow" aria-live="polite" data-stale={stale}>
    <div className="strands-workflow-heading"><div><span className="launch-kicker"><Sparkles size={13}/>Strands workflow</span><h2>Quiet work. One consequential interruption.</h2></div><Badge tone={stale?'amber':'blue'}>Source revision {graph.sourceRevision}</Badge></div>
    <ol className="strands-stage-list">{stageOrder.map((id,index)=>{
      const node=nodes.get(id)!;
      return <li key={id} data-state={node.status}><span className="strands-stage-index">{completed(node.status)?<Check size={13}/>:String(index+1).padStart(2,'0')}</span><span><strong>{stageLabels[id]}</strong><small>{completed(node.status)?'Verified':active(node.status)?'Working':blocked(node.status)?'Needs attention':'Waiting'}</small></span></li>;
    })}</ol>
    <p className="strands-workflow-status">{summary}</p>
  </section>;
}

export function launchPackMarkdown(pack:LaunchPack,sources:Pick<AdaptiveSource,'id'|'title'>[]){
  const evidence=pack.citations.map((citation,index)=>{
    const title=sources.find(source=>source.id===citation.sourceId)?.title.replace(/\s+/g,' ')||'Reviewed source';
    const excerpt=citation.excerpt.split('\n').map(line=>`> ${line}`).join('\n');
    return `### Evidence ${index+1}\n\nSource: ${title}\nSource ID: \`${citation.sourceId}\`\nSource revision: ${citation.sourceRevision}\n\n${excerpt}`;
  }).join('\n\n');
  return `# Launch brief\n\n${pack.brief}\n\n## Readiness checklist\n${pack.checklist.map(item=>`- [ ] ${item}`).join('\n')}\n\n## Announcement draft — not sent\n\n${pack.announcementDraft}\n\n## Risks retained\n${pack.unresolvedRisks.map(item=>`- ${item}`).join('\n')||'- None identified.'}\n\n## What changed\n\n${pack.changeSummary}\n\n## Source evidence\n\n${evidence}`;
}

function PackCard({title,icon,children,tone='paper'}:{title:string;icon:ReactNode;children:ReactNode;tone?:'paper'|'orange'|'green'}){
  return <article className="launch-pack-card" data-tone={tone}><div className="launch-pack-card-heading"><span>{icon}</span><h3>{title}</h3></div>{children}</article>;
}

export function LaunchPackCards({execution}:{execution:MissionExecution}){
  const adaptive=execution.adaptive;
  const savedPack=adaptive?.pack;
  const pack=adaptive&&savedPack?.sourceRevision===adaptive.sourceRevision?savedPack.value:undefined;
  const sourceRevision=adaptive?.sourceRevision??0;
  const sources=adaptive?.sourceHistory.find(revision=>revision.revision===sourceRevision)?.sources??[];
  const [copied,setCopied]=useState(false);
  const text=useMemo(()=>pack?launchPackMarkdown(pack,sources):'',[pack,sources]);
  if(!adaptive||!pack)return null;
  async function copy(){
    try{await navigator.clipboard.writeText(text);setCopied(true);window.setTimeout(()=>setCopied(false),1800);}catch{setCopied(false);}
  }
  function download(){
    const url=URL.createObjectURL(new Blob([text],{type:'text/markdown'}));
    const link=document.createElement('a');link.href=url;link.download=`missiondeck-launch-pack-v${sourceRevision}.md`;link.click();URL.revokeObjectURL(url);
  }
  return <section className="launch-pack" aria-label="Launch pack">
    <div className="launch-pack-hero"><div><span className="launch-kicker"><CheckCircle2 size={14}/>Decision-shaped result</span><h2>Your launch pack changed because you decided.</h2><p>{pack.changeSummary}</p></div><div className="launch-pack-actions"><Button variant="secondary" onClick={()=>void copy()}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'Copied':'Copy pack'}</Button><Button variant="secondary" onClick={download}><Download size={14}/>Download .md</Button></div></div>
    <div className="launch-pack-grid">
      <PackCard title="Launch brief" icon={<FileText size={17}/>}><p>{pack.brief}</p></PackCard>
      <PackCard title="Readiness checklist" icon={<ClipboardCheck size={17}/>} tone="green"><ul className="launch-checklist">{pack.checklist.map((item,index)=><li key={index}><span aria-hidden="true"/>{item}</li>)}</ul></PackCard>
      <PackCard title="Announcement draft" icon={<Megaphone size={17}/>} tone="orange"><p className="launch-announcement-label">Draft · not sent</p><p>{pack.announcementDraft}</p></PackCard>
      <PackCard title="Risks retained" icon={<ShieldAlert size={17}/>}><ul>{pack.unresolvedRisks.length?pack.unresolvedRisks.map((risk,index)=><li key={index}>{risk}</li>):<li>No unresolved risks were reported.</li>}</ul></PackCard>
    </div>
  </section>;
}
