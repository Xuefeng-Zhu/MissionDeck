import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_NOW, createDemoMission, prepareCapture } from '@mission/domain';
import { Planner } from './model.js';
import { createModelClient, modelStatus, resolveModelConfig, type ModelEnvironment } from './model-provider.js';

const environment=(overrides:Partial<ModelEnvironment>={}):ModelEnvironment=>({
  MODEL_MODE:'live',MODEL_PROVIDER:'openrouter',OPENROUTER_MODEL:'openai/gpt-5.6-luna',OPENAI_MODEL:'gpt-5-mini',
  OPENROUTER_API_KEY:'synthetic-openrouter-test-key',OPENAI_API_KEY:'synthetic-direct-openai-test-key',...overrides,
});
const assessment={missing:false,possibleDuplicateCriterionId:null,title:'',exactExcerpt:'',rationale:'Uncertain fixture evidence.',verificationMethod:'',taskTitle:'',taskDescription:'',dependencies:[],remainingMinutes:null};
const evidence=()=>prepareCapture({id:'model-transport-evidence',text:'Synthetic public requirements excerpt.',title:'Transport test fixture',capturedAt:DEMO_NOW,captureMethod:'manual',fixture:true});
const chatResponse=(content:unknown=assessment)=>({
  id:'chatcmpl-synthetic',object:'chat.completion',created:0,model:'openai/gpt-5.6-luna',
  choices:[{index:0,message:{role:'assistant',content:JSON.stringify(content),refusal:null},finish_reason:'stop',logprobs:null}],
  usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0},
});
const responsesResponse=()=>({
  id:'resp-synthetic',object:'response',created_at:0,status:'completed',model:'gpt-5-mini',
  output:[{id:'msg-synthetic',type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify(assessment),annotations:[]}]}],
});
function mockTransport(reply:()=>Response=()=>Response.json(chatResponse())) {
  const requests:Array<{url:string;headers:Headers;body:Record<string,unknown>}>=[];
  const transport=vi.fn<typeof globalThis.fetch>(async(input,init)=>{
    const request=new Request(input,init);
    requests.push({url:request.url,headers:request.headers,body:JSON.parse(await request.text()) as Record<string,unknown>});
    return reply();
  });
  return {transport,requests};
}
afterEach(()=>vi.unstubAllEnvs());

describe('explicit model provider configuration',()=>{
  it('selects Bedrock Luna with the AWS credential chain and exposes no credential fields',()=>{
    const resolved=resolveModelConfig(environment({MODEL_PROVIDER:'bedrock',AWS_REGION:'us-west-2',BEDROCK_MODEL_ID:'us.openai.gpt-5.6-luna'}));
    expect(resolved).toMatchObject({provider:'bedrock',model:'us.openai.gpt-5.6-luna',region:'us-west-2',label:'Amazon Bedrock',authKind:'aws',enabled:true});
    expect(resolved.apiKey).toBeUndefined();
    expect(resolved.apiKeyEnv).toBeUndefined();
    expect(resolved.baseURL).toBeUndefined();
    expect(createModelClient(resolved)).toBeNull();
    expect(modelStatus(resolved)).toEqual({modelProvider:'bedrock',modelName:'us.openai.gpt-5.6-luna',modelEnabled:true,setupRequired:[]});
    expect(JSON.stringify(modelStatus(resolved))).not.toMatch(/credential|access.?key|secret/i);
  });

  it('honors the standard AWS default-region variable before the Luna region default',()=>{
    const resolved=resolveModelConfig(environment({MODEL_PROVIDER:'bedrock',AWS_REGION:undefined,AWS_DEFAULT_REGION:'us-east-1'}));
    expect(resolved.region).toBe('us-east-1');
  });

  it('selects OpenRouter separately from the direct OpenAI key and exposes only safe status',()=>{
    const resolved=resolveModelConfig(environment());
    expect(resolved).toMatchObject({provider:'openrouter',model:'openai/gpt-5.6-luna',baseURL:'https://openrouter.ai/api/v1',label:'OpenRouter',apiKeyEnv:'OPENROUTER_API_KEY',enabled:true});
    expect(resolved.apiKey).toBe('synthetic-openrouter-test-key');
    expect(modelStatus(resolved)).toEqual({modelProvider:'openrouter',modelName:'openai/gpt-5.6-luna',modelEnabled:true,setupRequired:[]});
    expect(JSON.stringify(modelStatus(resolved))).not.toContain('synthetic-');
  });

  it('keeps fixture mode disabled even if both providers have credentials',()=>{
    const resolved=resolveModelConfig(environment({MODEL_MODE:'fixture'}));
    expect(resolved.enabled).toBe(false);
    expect(createModelClient(resolved)).toBeNull();
    expect(resolved.setupRequired.join(' ')).toContain('MODEL_MODE=live');
  });

  it('does not substitute a direct OpenAI key when the selected OpenRouter key is absent',async()=>{
    const resolved=resolveModelConfig(environment({OPENROUTER_API_KEY:undefined}));
    const {transport}=mockTransport();
    const planner=new Planner(resolved,transport);
    await expect(planner.assessEvidence(createDemoMission(),evidence(),DEMO_NOW)).rejects.toMatchObject({status:503,code:'model_unavailable'});
    expect(resolved.setupRequired.join(' ')).toContain('OPENROUTER_API_KEY');
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not substitute an OpenRouter key for explicitly selected direct OpenAI',()=>{
    const resolved=resolveModelConfig(environment({MODEL_PROVIDER:'openai',OPENAI_API_KEY:undefined}));
    expect(resolved.enabled).toBe(false);
    expect(resolved.apiKey).toBeUndefined();
    expect(resolved.setupRequired.join(' ')).toContain('OPENAI_API_KEY');
  });
});

describe('mocked structured Planner transport',()=>{
  it('routes Bedrock planning through the bounded Strands structured-output adapter',async()=>{
    const selected=resolveModelConfig(environment({MODEL_PROVIDER:'bedrock',AWS_REGION:'us-west-2',BEDROCK_MODEL_ID:'us.openai.gpt-5.6-luna'}));
    const invoker=vi.fn(async(_selected,request)=>{
      expect(_selected).toBe(selected);
      expect(request).toMatchObject({name:'requirement_assessment',maxTokens:6000});
      expect(request.systemPrompt).toContain('planning assistant');
      expect(request.prompt).toContain('untrusted source material');
      return assessment;
    });
    await expect(new Planner(selected,undefined,invoker).assessEvidence(createDemoMission(),evidence(),DEMO_NOW)).resolves.toBeNull();
    expect(invoker).toHaveBeenCalledTimes(1);
  });

  it('fails closed when Bedrock does not return a valid structured result',async()=>{
    const selected=resolveModelConfig(environment({MODEL_PROVIDER:'bedrock'}));
    const invoker=vi.fn(async()=>{throw new Error('synthetic-private-bedrock-detail');});
    const failure=await new Planner(selected,undefined,invoker).assessEvidence(createDemoMission(),evidence(),DEMO_NOW).catch(error=>error);
    expect(failure).toMatchObject({status:502,code:'model_failed',message:expect.stringContaining('Amazon Bedrock')});
    expect(failure.message).not.toContain('synthetic-private-bedrock-detail');
    expect(invoker).toHaveBeenCalledTimes(1);
  });

  it('uses only OpenRouter chat-completions, the configured model, and its bearer key with strict JSON schema',async()=>{
    vi.stubEnv('OPENAI_BASE_URL','https://unexpected-endpoint.invalid/v1');
    vi.stubEnv('OPENAI_ORG_ID','synthetic-unrelated-openai-org');
    vi.stubEnv('OPENAI_PROJECT_ID','synthetic-unrelated-openai-project');
    const {transport,requests}=mockTransport();
    const selected=resolveModelConfig(environment({OPENROUTER_MODEL:'fixture/custom-model'}));
    const result=await new Planner(selected,transport).assessEvidence(createDemoMission(),evidence(),DEMO_NOW);
    expect(result).toBeNull();
    expect(requests).toHaveLength(1);
    const request=requests[0]!;
    expect(request.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(request.headers.get('authorization')).toBe('Bearer synthetic-openrouter-test-key');
    expect(request.headers.has('OpenAI-Organization')).toBe(false);
    expect(request.headers.has('OpenAI-Project')).toBe(false);
    expect(request.body).toMatchObject({model:'fixture/custom-model',store:false,max_completion_tokens:6000,provider:{require_parameters:true,allow_fallbacks:false},response_format:{type:'json_schema',json_schema:{name:'requirement_assessment',strict:true,schema:{type:'object',additionalProperties:false}}}});
    expect(request.body).not.toHaveProperty('models');
    expect(request.body).not.toHaveProperty('previous_response_id');
    expect(requests.some(item=>item.url.startsWith('https://api.openai.com/'))).toBe(false);
  });

  it('uses the same selected OpenRouter transport for plans while preserving the approval boundary',async()=>{
    const mission=createDemoMission();mission.contract.confirmed=true;
    const generated={rationale:'Synthetic structured plan response.',tasks:mission.criteria.filter(criterion=>criterion.required).map((criterion,index)=>({key:`task-${index}`,title:`Prepare ${criterion.title}`,description:'Synthetic planner transport fixture.',executor:'human',dependencies:[],criterionIds:[criterion.id],remainingMinutes:30,optional:false,completionEvidence:criterion.verificationMethod}))};
    const {transport,requests}=mockTransport(()=>Response.json(chatResponse(generated)));
    const proposal=await new Planner(resolveModelConfig(environment()),transport).plan(mission,DEMO_NOW);
    expect(proposal.state).toBe('pending');
    expect(proposal.operations).toHaveLength(3);
    expect(proposal.operations.every(operation=>operation.type==='add_task'&&operation.task.provider===null)).toBe(true);
    expect(mission.tasks).toEqual([]);
    expect(mission.approvals).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(requests[0]!.body).toMatchObject({response_format:{json_schema:{name:'mission_plan',strict:true}}});
  });

  it('retains the direct OpenAI Responses path only when explicitly selected',async()=>{
    const {transport,requests}=mockTransport(()=>Response.json(responsesResponse()));
    const selected=resolveModelConfig(environment({MODEL_PROVIDER:'openai'}));
    await expect(new Planner(selected,transport).assessEvidence(createDemoMission(),evidence(),DEMO_NOW)).resolves.toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://api.openai.com/v1/responses');
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer synthetic-direct-openai-test-key');
    expect(requests[0]!.body).toMatchObject({model:'gpt-5-mini',store:false,max_output_tokens:6000,text:{format:{type:'json_schema',strict:true}}});
    expect(requests[0]!.body).not.toHaveProperty('provider');
  });

  it('fails visibly on an OpenRouter error without retries or a direct/fixture fallback',async()=>{
    const {transport,requests}=mockTransport(()=>Response.json({error:{message:'Synthetic upstream failure',code:'unavailable'}},{status:503}));
    const planner=new Planner(resolveModelConfig(environment()),transport);
    await expect(planner.assessEvidence(createDemoMission(),evidence(),DEMO_NOW)).rejects.toMatchObject({status:502,code:'model_failed',message:expect.stringContaining('OpenRouter')});
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toContain('openrouter.ai');
  });

  it('rejects malformed structured output even when the provider claims success',async()=>{
    const {transport,requests}=mockTransport(()=>Response.json(chatResponse({...assessment,missing:'not-a-boolean'})));
    await expect(new Planner(resolveModelConfig(environment()),transport).assessEvidence(createDemoMission(),evidence(),DEMO_NOW)).rejects.toMatchObject({status:502,code:'model_failed'});
    expect(requests).toHaveLength(1);
  });

  it('handles a model refusal without generating a proposal or falling back',async()=>{
    const response=chatResponse();response.choices[0]!.message={role:'assistant',content:'',refusal:'Synthetic refusal'} as never;
    const {transport,requests}=mockTransport(()=>Response.json(response));
    await expect(new Planner(resolveModelConfig(environment()),transport).assessEvidence(createDemoMission(),evidence(),DEMO_NOW)).rejects.toMatchObject({status:422,code:'model_refusal'});
    expect(requests).toHaveLength(1);
  });
});
