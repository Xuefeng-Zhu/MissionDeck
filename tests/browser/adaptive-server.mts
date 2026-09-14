/** Controlled browser harness. No live model, Strands SDK, or Ambiguous calls.
 * The real coordinator, HTTP routes, PGlite, and fixture documents are exercised.
 * mode:'live' is solely the runner contract required to enable the adaptive UI.
 */
import {type AdaptiveAnalysis,type LaunchPack} from '@mission/domain';
import {createApp} from '../../apps/server/src/app.js';
import {config} from '../../apps/server/src/config.js';
import {openDatabase} from '../../apps/server/src/database.js';
import {ExecutionService} from '../../apps/server/src/execution-service.js';
import {FixtureExecutionProvider} from '../../apps/server/src/execution-provider.js';
import {ModelExecutionRunner,type ExecutionPlan,type ExecutionRunner,type ExecutionTaskInput} from '../../apps/server/src/execution-runner.js';
import {resolveModelConfig} from '../../apps/server/src/model-provider.js';
import {MissionService} from '../../apps/server/src/service.js';
import {FixtureWorkProvider,MemoryFixtureRepository} from '../../apps/server/src/providers/index.js';
import {UpgradeStore} from '../../apps/server/src/upgrade-store.js';
import {randomUUID} from 'node:crypto';

if(config.PROVIDER_MODE!=='fixture'||config.MODEL_MODE!=='fixture')throw new Error('Controlled adaptive browser tests require fixture workspace and planning modes.');
const plan:ExecutionPlan={summary:'Controlled browser verification: compare sources, record a human decision, and save a launch pack.',tasks:[
  {key:'analysis',title:'Analyze launch readiness',description:'Compare reviewed source snapshots and save cited launch options.',executor:'agent',dependencies:[],completionCriteria:['Save a source-backed decision brief.']},
  {key:'decision',title:'Resolve the launch conflict',description:'Choose a launch approach and record constraints for the current source revision.',executor:'human',dependencies:['analysis'],completionCriteria:['Save the owner decision against the current analysis.']},
  {key:'launch_pack',title:'Prepare the agreed launch pack',description:'Draft the brief, checklist, announcement, and unresolved risks from the decision.',executor:'agent',dependencies:['analysis','decision'],completionCriteria:['Save all four launch deliverables with source evidence.']},
]};

function analysisFor(input:ExecutionTaskInput):AdaptiveAnalysis{
  const a=input.adaptive!;
  const revised=a.sourceRevision>1;
  return {summary:revised?'The revised engineering source supports a broader launch; the owner must choose the new scope.':'The announced calendar integration conflicts with the engineering status. A human launch decision is required.',findings:[
    {id:'calendar-readiness',title:revised?'Calendar readiness changed':'Calendar promise conflicts with engineering readiness',detail:revised?'The latest source reports accepted integration work. Earlier launch choices are historical.':'A private beta can use manual date entry while calendar integration is completed.',kind:revised?'readiness':'conflict',citations:a.sources.slice(0,2).map(source=>({sourceId:source.id,sourceRevision:a.sourceRevision,excerpt:source.content.slice(0,120)}))},
    ...(a.sources.some(source=>source.provenance==='browser')?[{id:'owner-update',title:'The saved owner excerpt is included',detail:'This accepted mission excerpt was explicitly imported into the current source revision.',kind:'readiness' as const,citations:a.sources.filter(source=>source.provenance==='browser').map(source=>({sourceId:source.id,sourceRevision:a.sourceRevision,excerpt:source.content}))}]:[]),
  ],unresolvedRequirements:['The mission owner must select the launch scope.'],options:[
    {id:revised?'broader_rollout':'private_beta',label:revised?'Proceed with a broader rollout':'Run a private beta',description:revised?'Use the accepted calendar integration and a controlled customer rollout.':'Start with 20 customers and manual date entry.',consequences:[revised?'Confirm the final announcement with the launch owner.':'Disclose that calendar integration is not included.']},
    {id:'delay_launch',label:'Delay the launch',description:'Wait for another readiness review.',consequences:['Move the announced date and notify the launch owner.']},
  ],recommendedOptionId:revised?'broader_rollout':'private_beta',assumptions:['Controlled browser verification uses only fictional retained sources.']};
}

type ControlledPhase='evidence'|'readiness'|'risk'|'synthesis'|'launch_pack';
type PhaseGate={id:string;stage:'analysis'|'launch_pack';held:Set<ControlledPhase>;entered:Set<ControlledPhase>;release:Map<ControlledPhase,()=>void>;claimed:boolean};
const phaseGates=new Map<string,PhaseGate>();
const phases:ControlledPhase[]=['evidence','readiness','risk','synthesis','launch_pack'];
function claimGate(stage:'analysis'|'launch_pack'){
  const gate=[...phaseGates.values()].find(candidate=>candidate.stage===stage&&!candidate.claimed);
  if(gate)gate.claimed=true;
  return gate;
}
async function waitForPhase(gate:PhaseGate|undefined,phase:ControlledPhase,signal?:AbortSignal){
  if(signal?.aborted)throw new Error('Controlled invocation cancelled.');
  gate?.entered.add(phase);
  if(!gate?.held.has(phase))return;
  await new Promise<void>((resolve,reject)=>{
    const finish=(error?:Error)=>{clearTimeout(timeout);signal?.removeEventListener('abort',abort);gate.release.delete(phase);error?reject(error):resolve();};
    const abort=()=>finish(new Error('Controlled invocation cancelled.'));
    const timeout=setTimeout(()=>finish(new Error('Controlled browser phase gate timed out.')),120_000);
    gate.release.set(phase,()=>finish());
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
  });
}

const controlled:ExecutionRunner={engine:'strands',mode:'live',modelProvider:'controlled-browser-test',modelName:'deterministic-runner-no-live-model',setupRequired:[],
  async plan(){return structuredClone(plan);},
  async run(input,signal){
    const a=input.adaptive!;
    const gate=claimGate(a.stage);
    const step=async(phase:ControlledPhase,readSources=false)=>{
      await a.activity({agent:phase,kind:'agent_start',summary:`Controlled ${phase} worker started.`});
      try{
        await a.consume('model');
        await a.activity({agent:phase,kind:'model_call',summary:`One controlled ${phase} model-call reservation; no live model call was made.`});
        if(readSources)for(const source of a.sources){
          const toolCallId=`${input.task.id}:${a.sourceRevision}:${phase}:${source.id}`;
          await a.consume('tool');
          await a.activity({agent:phase,kind:'tool_start',tool:'read_mission_source',toolCallId,sourceId:source.id,summary:`Reading the saved source: ${source.title}`});
          await a.readSource(source.id);
          await a.activity({agent:phase,kind:'tool_end',tool:'read_mission_source',toolCallId,sourceId:source.id,outcome:'succeeded',summary:`Read the saved source: ${source.title}`});
        }
        await waitForPhase(gate,phase,signal);
        await a.activity({agent:phase,kind:'agent_end',outcome:'succeeded',summary:`Controlled ${phase} result accepted; no live model call was made.`});
      }catch(error){
        await a.activity({agent:phase,kind:'agent_end',outcome:signal?.aborted?'cancelled':'failed',summary:`Controlled ${phase} invocation did not produce an accepted result.`});
        throw error;
      }
    };
    if(a.stage==='analysis'){
      await step('evidence',true);
      await Promise.all([step('readiness'),step('risk')]);
      await step('synthesis');
      const analysis=analysisFor(input);
      return {title:`Launch decision brief v${a.sourceRevision}`,content:JSON.stringify(analysis,null,2),summary:analysis.summary,adaptiveResult:{kind:'analysis',analysis}};
    }
    await step('launch_pack',true);
    const option=a.analysis!.options.find(item=>item.id===a.decision!.optionId)!;
    const pack:LaunchPack={brief:`Controlled browser verification. ${option.label}. ${a.decision!.constraints}`,checklist:['Confirm customer scope.','Approve the launch announcement.'],announcementDraft:`Unsent fictional Harbor announcement: ${option.description}`,unresolvedRisks:['Human owner must verify the launch facts before external publication.'],changeSummary:a.sourceRevision===1?'Initial pack incorporates the recorded private beta decision.':`Revised pack incorporates the updated engineering source, ${a.sources.some(source=>source.provenance==='browser')?'the imported owner excerpt, and ':''}the new human decision.`,citations:a.sources.map(source=>({sourceId:source.id,sourceRevision:a.sourceRevision,excerpt:source.content.slice(0,100)}))};
    return {title:`Reviewed launch pack v${a.sourceRevision}`,content:JSON.stringify(pack,null,2),summary:pack.changeSummary,adaptiveResult:{kind:'launch_pack',pack}};
  },
};

const db=await openDatabase({memory:true});
const store=new UpgradeStore(db);
const generic=new ModelExecutionRunner(resolveModelConfig({MODEL_MODE:'fixture',MODEL_PROVIDER:'openrouter',OPENROUTER_MODEL:'controlled/generic',OPENAI_MODEL:'controlled/generic'}));
const execution=new ExecutionService(db,scope=>new FixtureExecutionProvider(store,scope),generic,undefined,controlled);
const service=new MissionService(db,new FixtureWorkProvider(new MemoryFixtureRepository()));
const app=await createApp(service,{pairingCode:'adaptive-browser-fixture-code',enableCopilot:false,executionService:execution});
app.get('/__adaptive_test__',(_req,res)=>res.json({workspace:'fixture',runner:'controlled-browser-test',liveModelCalls:false,liveAmbiguousCalls:false}));
// These controls exist only in this isolated fixture server. Tests hold actual
// coordinator invocations so browser polling can observe both parallel branches.
app.post('/__adaptive_test__/gates',(req,res)=>{
  const requested=req.body?.phases;
  if(!Array.isArray(requested)||!requested.length||requested.some(phase=>!phases.includes(phase))||!['analysis','launch_pack'].includes(req.body?.stage))return res.status(400).json({error:'A controlled stage and recognized phases are required.'});
  const gate:PhaseGate={id:randomUUID(),stage:req.body.stage,held:new Set(requested),entered:new Set(),release:new Map(),claimed:false};
  phaseGates.set(gate.id,gate);
  return res.json({id:gate.id});
});
app.get('/__adaptive_test__/gates/:id',(req,res)=>{
  const gate=phaseGates.get(req.params.id);if(!gate)return res.status(404).json({error:'Unknown controlled gate.'});
  return res.json({id:gate.id,claimed:gate.claimed,entered:[...gate.entered],held:[...gate.held]});
});
app.post('/__adaptive_test__/gates/:id/release',(req,res)=>{
  const gate=phaseGates.get(req.params.id);if(!gate)return res.status(404).json({error:'Unknown controlled gate.'});
  const releasing=req.body?.phase==='all'?[...gate.held]:[req.body?.phase];
  if(releasing.some(phase=>!phases.includes(phase)))return res.status(400).json({error:'A recognized controlled phase is required.'});
  for(const phase of releasing){gate.held.delete(phase);gate.release.get(phase)?.();}
  return res.json({released:releasing});
});
await execution.listen();
const server=await new Promise<ReturnType<typeof app.listen>>((resolve,reject)=>{
  const pending=app.listen(config.PORT,'127.0.0.1',error=>error?reject(error):resolve(pending));
});
console.log(`Controlled adaptive browser harness listening on ${config.PORT}; no live model or Ambiguous calls.`);
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void execution.stop().finally(()=>server.close(()=>{void db.close().then(()=>process.exit(0));}));});
