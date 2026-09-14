export interface ModelStatusConfig {
  modelProvider?:'bedrock'|'openrouter'|'openai';
  modelMode?:'fixture'|'live';
  modelEnabled?:boolean;
  modelName?:string;
}

export function modelProviderLabel(config:ModelStatusConfig|null):string {
  if(config?.modelProvider==='bedrock')return 'Amazon Bedrock';
  return config?.modelProvider==='openai'?'OpenAI':'OpenRouter';
}

export function planningStatus(config:ModelStatusConfig|null):string {
  if(!config)return 'Planning unavailable';
  if(config.modelMode!=='live'&&!config.modelEnabled)return 'Fixture planning';
  if(config.modelProvider==='bedrock'&&config.modelEnabled)return 'Amazon Bedrock live mode configured';
  return `${modelProviderLabel(config)} ${config.modelEnabled?'live planning':'setup required'}`;
}

export function modelSetupHint(config:ModelStatusConfig|null):string {
  if(config?.modelProvider==='bedrock')return 'To enable conversation, configure MODEL_MODE=live, MODEL_PROVIDER=bedrock, AWS_REGION (or AWS_DEFAULT_REGION), BEDROCK_MODEL_ID, and an AWS credential chain or workload role on the server.';
  const provider=config?.modelProvider==='openai'?'openai':'openrouter';
  const prefix=provider.toUpperCase();
  return `To enable conversation, configure MODEL_MODE=live, MODEL_PROVIDER=${provider}, ${prefix}_API_KEY, and ${prefix}_MODEL on the server.`;
}
