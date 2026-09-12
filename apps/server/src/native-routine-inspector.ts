import {z} from 'zod';
import {AmbiguousWorkProvider} from './providers/ambiguous.js';
import {HttpError} from './errors.js';
import type {RoutineSpec} from '../../../packages/domain/src/routines.js';
/** Read-only native inspector. IDs must originate from a scoped stored routine, never a client URL. */
export async function inspectNativeRoutine(routine:RoutineSpec,options:{apiKey?:string;expectedUserId?:string;expectedWorkspaceId?:string;fetch?:typeof fetch},offset=0){
 if(routine.fixture||!routine.nativeWorkflowId)throw new HttpError(409,'No verified native workflow is attached to this routine. Native run inspection is blocked until authorized compilation and activation.');
 if(!options.apiKey)throw new HttpError(409,'Native run inspection requires configured Ambiguous credentials.');
 const id=z.string().uuid().parse(routine.nativeWorkflowId);
 const identity=await new AmbiguousWorkProvider(options).identity();if(!identity.verified)throw new HttpError(403,'Native workspace identity is not verified.');
 const response=await (options.fetch??fetch)(`https://app.ambiguous.ai/api/automations/${id}/runs?limit=50&offset=${z.number().int().min(0).max(10000).parse(offset)}`,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:`Bearer ${options.apiKey}`,'API-Version':'1'}});
 if(!response.ok)throw new HttpError(response.status===401||response.status===403?403:502,'Native run inspection failed; no fixture fallback was used.');
 const data=z.object({data:z.array(z.object({id:z.string().uuid(),automation_id:z.string().uuid(),workspace_id:z.string().uuid(),status:z.string().max(100),trigger_source:z.string().max(100),workflow_version_at_dispatch:z.number().int().positive(),started_at:z.string().max(100),finished_at:z.string().max(100).nullable()})).max(50),total:z.number().int().nonnegative(),has_more:z.boolean()}).parse(await response.json());
 if(data.data.some(r=>r.automation_id!==id||r.workspace_id!==options.expectedWorkspaceId))throw new HttpError(403,'Native run response does not match the reviewed workflow and workspace.');
 return {data:data.data.map(r=>({...r,normalizedStatus:normalizeNativeRunStatus(r.status)})),total:data.total,hasMore:data.has_more,nextOffset:data.has_more?offset+data.data.length:null,verification:'native_status_only',detail:'Native success does not independently verify every output artifact.'};
}

export function normalizeNativeRunStatus(status:string):string {
 return ({success:'accepted_unverified',filtered:'filtered',failed:'failed',suspended:'awaiting_input',cancelled:'cancelled',depth_exceeded:'failed',running:'running'} as Record<string,string>)[status]??'outcome_unknown';
}

export async function inspectNativeRun(routine:RoutineSpec,runId:string,options:{apiKey?:string;expectedUserId?:string;expectedWorkspaceId?:string;fetch?:typeof fetch}){
 if(routine.fixture||!routine.nativeWorkflowId||!options.apiKey)throw new HttpError(409,'Native run detail requires a verified native workflow and credentials.');
 const workflowId=z.string().uuid().parse(routine.nativeWorkflowId),id=z.string().uuid().parse(runId);
 const identity=await new AmbiguousWorkProvider(options).identity();if(!identity.verified)throw new HttpError(403,'Native workspace identity is not verified.');
 const response=await (options.fetch??fetch)(`https://app.ambiguous.ai/api/automations/runs/${id}`,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:`Bearer ${options.apiKey}`,'API-Version':'1'}});
 if(!response.ok)throw new HttpError(502,'Native run detail failed; no fixture fallback was used.');
 const run=z.object({id:z.string().uuid(),automation_id:z.string().uuid(),workspace_id:z.string().uuid(),status:z.string().max(100),trigger_source:z.string().max(100),workflow_version_at_dispatch:z.number().int().positive(),started_at:z.string().max(100),finished_at:z.string().max(100).nullable()}).parse(await response.json());
 if(run.id!==id||run.automation_id!==workflowId||run.workspace_id!==options.expectedWorkspaceId)throw new HttpError(403,'Run does not belong to the reviewed native workflow.');
 return {...run,normalizedStatus:normalizeNativeRunStatus(run.status),verification:'native_status_only'};
}
