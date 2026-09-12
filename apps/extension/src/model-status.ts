export interface ModelStatusConfig {
  modelProvider?:'openrouter'|'openai';
  modelMode?:'fixture'|'live';
  modelEnabled?:boolean;
  modelName?:string;
}

export function modelProviderLabel(config:ModelStatusConfig|null):string {
  return config?.modelProvider==='openai'?'OpenAI':'OpenRouter';
}

export function planningStatus(config:ModelStatusConfig|null):string {
  if(!config)return 'Planning unavailable';
  if(config.modelMode!=='live'&&!config.modelEnabled)return 'Fixture planning';
  return `${modelProviderLabel(config)} ${config.modelEnabled?'live planning':'setup required'}`;
}

export function modelSetupHint(config:ModelStatusConfig|null):string {
  const provider=config?.modelProvider==='openai'?'openai':'openrouter';
  const prefix=provider.toUpperCase();
  return `To enable conversation, configure MODEL_MODE=live, MODEL_PROVIDER=${provider}, ${prefix}_API_KEY, and ${prefix}_MODEL on the server.`;
}
