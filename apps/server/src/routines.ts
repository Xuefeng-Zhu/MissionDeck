import { routineSpecSchema, routineApprovalHash, type RoutineSpec } from '../../../packages/domain/src/routines.js';

export interface RoutinePreview {specHash:string;productionWrites:0;nativePayload:null;blockers:string[];steps:{id:string;description:string;review:string}[];sourceMode:'fixture'|'saved_evidence';}
/** Deliberately no provider argument: local preview cannot invoke native test/run/create. */
export function previewRoutine(input:RoutineSpec):RoutinePreview{
 const spec=routineSpecSchema.parse(input);
 return {specHash:routineApprovalHash(spec),productionWrites:0,nativePayload:null,sourceMode:spec.fixture?'fixture':'saved_evidence',steps:spec.steps.map(s=>({id:s.id,description:`${s.action} ${s.app} → ${s.destination}`,review:s.review})),blockers:[
 'Native node catalog requires authorized access (GET /api/automations/node-types returned 401). Exact node parameter and connection schemas are not verified.',
 'Native per-run approval enforcement has not been verified. Consequential steps must remain separate reviewed proposals.',
 ...(spec.trigger==='manual'?[]:['This trigger and its timezone/event configuration require authorized native schema verification.']),
 ...(spec.browserDependency==='browser_assisted'?['Every run requires fresh explicitly shared browser context.']:[])]};
}
/** Fail closed until exact native node schemas and policy-enforcing boundaries are verified. */
export function compileAutomation(spec:RoutineSpec):never{throw new Error(previewRoutine(spec).blockers.join(' '));}
export function approveRoutineActivation(spec:RoutineSpec,approval:{ownerId:string;workspaceId:string;specHash:string;expiresAt:string;used:boolean},now:string):never{
 routineSpecSchema.parse(spec);
 if(!Number.isFinite(Date.parse(now)))throw new Error('Routine activation approval clock is invalid');
 if(approval.ownerId!==spec.ownerId||approval.workspaceId!==spec.workspaceId||approval.specHash!==routineApprovalHash(spec)||approval.used||!Number.isFinite(Date.parse(approval.expiresAt))||Date.parse(approval.expiresAt)<=Date.parse(now)||spec.lifecycle!=='awaiting_approval')throw new Error('Routine activation approval is invalid, stale, expired or replayed');
 return compileAutomation(spec);
}
export interface RoutineEvent {id:string;ownerId:string;workspaceId:string;authenticated:boolean;originRoutineId?:string;receivedAt:string}
/** Caller persists accepted event IDs atomically with its durable outbox. This never dispatches. */
export function checkRoutineEvent(spec:RoutineSpec,event:RoutineEvent,state:{seenEventIds:string[];lastRunAt?:string;running:number;browserAvailable:boolean;now:string}):{accepted:boolean;status:string}{
 routineSpecSchema.parse(spec);
 if(!Number.isFinite(Date.parse(state.now)))return {accepted:false,status:'invalid_clock'};
 if(!event.authenticated||event.ownerId!==spec.ownerId||event.workspaceId!==spec.workspaceId)return {accepted:false,status:'unauthorized'};
 if(spec.lifecycle!=='enabled')return {accepted:false,status:'routine_paused'};
 if(state.seenEventIds.includes(event.id)||event.originRoutineId===spec.id)return {accepted:false,status:'duplicate_or_self_trigger'};
 if(!Number.isFinite(Date.parse(event.receivedAt))||Math.abs(Date.parse(state.now)-Date.parse(event.receivedAt))>300000)return {accepted:false,status:'stale_event'};
 if(state.running>=spec.budget.concurrency||state.lastRunAt&&Date.parse(state.now)-Date.parse(state.lastRunAt)<spec.budget.cooldownSeconds*1000)return {accepted:false,status:'cooldown_or_concurrency'};
 if(spec.browserDependency==='browser_assisted'&&!state.browserAvailable)return {accepted:false,status:'waiting_for_browser_context'};
 return {accepted:true,status:'awaiting_input'};
}
