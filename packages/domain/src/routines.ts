import { z } from 'zod';
import { hashPayload } from './capture.js';

const id = z.string().min(1).max(200);
export const routineStepSchema = z.object({
  id, action: z.enum(['read','create','update','prepare_communication','send','invite']),
  app: z.enum(['docs','sheets','slides','tasks','mail','chat','calendar']),
  sourceTypes: z.array(id).max(10), destination: id, audience: z.array(id).max(50),
  sensitiveSources: z.array(id).max(50), review: z.literal('per_run'), dependencies: z.array(id).max(20),
}).strict();
export const routineSpecSchema = z.object({
  id, ownerId:id, workspaceId:id, version:z.number().int().positive(), title:z.string().min(1).max(200), purpose:z.string().max(2000),
  supportingRuns:z.array(id).max(100), trigger:z.enum(['manual','workspace_event','schedule']), timezone:id.refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Use an IANA timezone'),
  filters:z.array(z.string().max(500)).max(20), requiredInputs:z.array(id).max(20), parameterBindings:z.record(id,z.string().max(500)),
  allowedSources:z.array(id).max(100), steps:z.array(routineStepSchema).min(1).max(20),
  budget:z.object({maxOperations:z.number().int().min(1).max(100), concurrency:z.literal(1), cooldownSeconds:z.number().int().min(60).max(86400)}).strict(),
  exceptionPolicy:z.literal('pause_and_review'), browserDependency:z.enum(['browser_assisted','workspace_event_driven','unattended_source_driven']),
  lifecycle:z.enum(['draft','previewed','awaiting_approval','enabled','paused','archived']),
  nativeWorkflowId:id.optional(), nativeVersion:z.number().int().positive().optional(), fixture:z.boolean(),
}).strict().superRefine((spec,ctx)=>{
 const seen=new Set<string>();
 for(const step of spec.steps){
  if(seen.has(step.id)||step.dependencies.some(dep=>!seen.has(dep)))ctx.addIssue({code:'custom',message:'Steps need unique IDs and preceding dependencies',path:['steps']});
  seen.add(step.id);
 }
 if(spec.budget.maxOperations<spec.steps.length)ctx.addIssue({code:'custom',message:'Operation budget is smaller than the plan',path:['budget']});
});
export type RoutineSpec=z.infer<typeof routineSpecSchema>;
export type RoutineStep=z.infer<typeof routineStepSchema>;
export const executionMetadataSchema=z.object({
 id,missionId:id,ownerId:id,workspaceId:id,consented:z.boolean(),verified:z.boolean(),approved:z.boolean(),fixture:z.boolean(),
 family:z.enum(['launch_review','research_summary','task_followup']), steps:z.array(routineStepSchema).min(1).max(20),
 corrections:z.array(z.string().max(300)).max(20), failureCount:z.number().int().nonnegative(), completedAt:z.iso.datetime(),
}).strict();
export type ExecutionMetadata=z.infer<typeof executionMetadataSchema>;
export interface RoutineSuggestion {patternKey:string; supportingRuns:string[]; missionIds:string[]; family:ExecutionMetadata['family']; fixture:boolean; reason:string; differences:string[]}
export function routinePattern(run:ExecutionMetadata):string {
 // Resource IDs are parameters only for non-sensitive sources. Destinations and audiences remain exact.
 return hashPayload({owner:run.ownerId,workspace:run.workspaceId,family:run.family,fixture:run.fixture,steps:run.steps.map((s,index)=>({...s,id:index,dependencies:s.dependencies.map(d=>run.steps.findIndex(x=>x.id===d)),sourceTypes:[...s.sourceTypes].sort(), audience:[...s.audience].sort(),sensitiveSources:[...s.sensitiveSources].sort()}))});
}
export function discoverRoutines(raw:ExecutionMetadata[],scope:{ownerId:string;workspaceId:string},dismissed:string[]=[],threshold=3):RoutineSuggestion[]{
 const groups=new Map<string,ExecutionMetadata[]>();
 for(const value of raw){const run=executionMetadataSchema.parse(value);if(run.ownerId!==scope.ownerId||run.workspaceId!==scope.workspaceId||!run.consented||!run.verified||!run.approved||run.failureCount||run.corrections.length)continue;
 const key=routinePattern(run);if(dismissed.includes(key))continue;const group=groups.get(key)??[];if(!group.some(r=>r.missionId===run.missionId))group.push(run);groups.set(key,group);}
 return [...groups].filter(([,runs])=>runs.length>=Math.max(2,threshold)).map(([patternKey,runs])=>({patternKey,supportingRuns:runs.map(r=>r.id),missionIds:runs.map(r=>r.missionId),family:runs[0].family,fixture:runs.every(r=>r.fixture),reason:`${runs.length} separately approved, verified missions share these steps. This is a product heuristic, not statistical confidence.`,differences:['Mission identifiers and completion dates differ; destinations, audience and sensitive sources match.']}));
}
export function makeRepeatable(run:ExecutionMetadata,scope:{ownerId:string;workspaceId:string},routineId:string):RoutineSpec{
 executionMetadataSchema.parse(run);
 if(!run.consented||!run.approved||!run.verified||run.failureCount||run.ownerId!==scope.ownerId||run.workspaceId!==scope.workspaceId)throw new Error('Only consented, approved, verified work in this workspace can become a routine');
 return routineSpecSchema.parse({id:routineId,ownerId:scope.ownerId,workspaceId:scope.workspaceId,version:1,title:run.family.replaceAll('_',' '),purpose:'Review and repeat the selected successful workflow',supportingRuns:[run.id],trigger:'manual',timezone:'UTC',filters:[],requiredInputs:['current_sources'],parameterBindings:{current_sources:'User selects fresh evidence for every run'},allowedSources:[...new Set(run.steps.flatMap(s=>s.sensitiveSources))],steps:run.steps,budget:{maxOperations:run.steps.length,concurrency:1,cooldownSeconds:300},exceptionPolicy:'pause_and_review',browserDependency:'browser_assisted',lifecycle:'draft',fixture:run.fixture});
}
export function routineApprovalHash(spec:RoutineSpec):string{return hashPayload(routineSpecSchema.parse(spec));}
export function reviseRoutine(spec:RoutineSpec,patch:Partial<RoutineSpec>):RoutineSpec{
 return routineSpecSchema.parse({...spec,...patch,id:spec.id,ownerId:spec.ownerId,workspaceId:spec.workspaceId,version:spec.version+1,lifecycle:'draft',nativeWorkflowId:undefined,nativeVersion:undefined});
}
export interface RoutineRun {id:string;routineId:string;version:number;nativeRunId?:string;status:'queued'|'running'|'awaiting_input'|'succeeded'|'partial'|'failed'|'outcome_unknown';detail:string;artifactIds:string[];fixture:boolean}
