import {it,expect,vi} from 'vitest';
import {inspectNativeRoutine,inspectNativeRun,normalizeNativeRunStatus} from './native-routine-inspector.js';
import {makeRepeatable,type ExecutionMetadata} from '../../../packages/domain/src/routines.js';
const run:ExecutionMetadata={id:'r',missionId:'m',ownerId:'o',workspaceId:'w',consented:true,approved:true,verified:true,fixture:true,family:'launch_review',steps:[{id:'s',app:'docs',action:'create',destination:'private',sourceTypes:[],sensitiveSources:[],audience:[],dependencies:[],review:'per_run'}],corrections:[],failureCount:0,completedAt:'2026-09-12T12:00:00Z'};
it('does not fetch native history for fixture or unattached local routines',async()=>{const fetch=vi.fn();await expect(inspectNativeRoutine(makeRepeatable(run,{ownerId:'o',workspaceId:'w'},'routine'),{fetch})).rejects.toThrow('No verified native workflow');expect(fetch).not.toHaveBeenCalled();});

it('reads documented scoped pagination and rejects provider workspace mismatch',async()=>{
 const user='11111111-1111-4111-8111-111111111111',workspace='22222222-2222-4222-8222-222222222222',workflow='33333333-3333-4333-8333-333333333333';
 const routine={...makeRepeatable(run,{ownerId:'o',workspaceId:'w'},'routine'),fixture:false,nativeWorkflowId:workflow};
 let returnedWorkspace=workspace;
 const fetch=vi.fn(async(input:RequestInfo|URL)=>new Response(JSON.stringify(String(input).endsWith('/api/users/me')?{id:user,workspace_id:workspace,display_name:'Test'}:{data:[{id:'44444444-4444-4444-8444-444444444444',automation_id:workflow,workspace_id:returnedWorkspace,status:'new_unknown_status',trigger_source:'manual',workflow_version_at_dispatch:1,started_at:'2026-09-12T00:00:00Z',finished_at:null,trigger_payload:{secret:'excluded'}}],total:1,has_more:false}),{status:200}));
 const options={apiKey:'test',expectedUserId:user,expectedWorkspaceId:workspace,fetch:fetch as typeof globalThis.fetch};
 const result=await inspectNativeRoutine(routine,options);expect(result.data[0].normalizedStatus).toBe('outcome_unknown');expect(result.data[0]).not.toHaveProperty('trigger_payload');expect(String(fetch.mock.calls[1][0])).toContain('limit=50&offset=0');
 returnedWorkspace=user;await expect(inspectNativeRoutine(routine,options)).rejects.toThrow('does not match');expect(normalizeNativeRunStatus('success')).toBe('accepted_unverified');
});

it('scopes native run detail to the stored workflow and suppresses raw payloads',async()=>{
 const user='11111111-1111-4111-8111-111111111111',workspace='22222222-2222-4222-8222-222222222222',workflow='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444';
 const routine={...makeRepeatable(run,{ownerId:'o',workspaceId:'w'},'routine'),fixture:false,nativeWorkflowId:workflow};
 let returnedWorkflow=workflow;
 const fetch=vi.fn(async(input:RequestInfo|URL)=>new Response(JSON.stringify(String(input).endsWith('/api/users/me')?{id:user,workspace_id:workspace,display_name:'Test'}:{id,automation_id:returnedWorkflow,workspace_id:workspace,status:'success',trigger_source:'manual',workflow_version_at_dispatch:1,started_at:'2026-09-12T00:00:00Z',finished_at:null,trigger_payload:{secret:'excluded'}}),{status:200}));
 const options={apiKey:'test',expectedUserId:user,expectedWorkspaceId:workspace,fetch:fetch as typeof globalThis.fetch};
 const result=await inspectNativeRun(routine,id,options);expect(result.normalizedStatus).toBe('accepted_unverified');expect(result).not.toHaveProperty('trigger_payload');
 returnedWorkflow=user;await expect(inspectNativeRun(routine,id,options)).rejects.toThrow('does not belong');
});
