import OpenAI from 'openai';
import { config } from './config.js';

export type ModelEnvironment = Pick<typeof config,
  'MODEL_MODE' | 'MODEL_PROVIDER' | 'OPENROUTER_API_KEY' | 'OPENROUTER_MODEL' | 'OPENAI_API_KEY' | 'OPENAI_MODEL'> &
  Partial<Pick<typeof config, 'AWS_REGION' | 'AWS_DEFAULT_REGION' | 'BEDROCK_MODEL_ID'>>;

/** Server-only configuration. Never return this object to a client: it can contain the selected key. */
export interface ResolvedModelConfig {
  provider: 'bedrock' | 'openrouter' | 'openai';
  mode: 'fixture' | 'live';
  model: string;
  baseURL?: string;
  apiKey?: string;
  region?: string;
  label: 'Amazon Bedrock' | 'OpenRouter' | 'OpenAI';
  apiKeyEnv?: 'OPENROUTER_API_KEY' | 'OPENAI_API_KEY';
  authKind: 'aws' | 'api-key';
  setupHint: string;
  enabled: boolean;
  setupRequired: string[];
}

/** Select exactly one explicitly configured provider. Other vendors' keys are never fallback credentials. */
export function resolveModelConfig(env: ModelEnvironment = config): ResolvedModelConfig {
  const provider = env.MODEL_PROVIDER;
  const bedrock = provider === 'bedrock';
  const openrouter = provider === 'openrouter';
  const apiKey = bedrock ? undefined : (openrouter ? env.OPENROUTER_API_KEY : env.OPENAI_API_KEY)?.trim() || undefined;
  const apiKeyEnv = bedrock ? undefined : openrouter ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY';
  const label = bedrock ? 'Amazon Bedrock' : openrouter ? 'OpenRouter' : 'OpenAI';
  const region = bedrock ? (env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim() || 'us-west-2') : undefined;
  const model = bedrock ? (env.BEDROCK_MODEL_ID?.trim() || 'us.amazon.nova-2-lite-v1:0') : openrouter ? env.OPENROUTER_MODEL : env.OPENAI_MODEL;
  const setupRequired: string[] = [];
  if (env.MODEL_MODE !== 'live') setupRequired.push('Set MODEL_MODE=live to enable model requests. Fixture mode is currently selected.');
  if (!bedrock && !apiKey) setupRequired.push(`Set ${apiKeyEnv} on the server for the selected ${label} provider.`);
  if (bedrock && !region) setupRequired.push('Set AWS_REGION on the server for Amazon Bedrock.');
  const setupHint = bedrock
    ? 'Configure MODEL_MODE=live, MODEL_PROVIDER=bedrock, AWS_REGION (or AWS_DEFAULT_REGION), BEDROCK_MODEL_ID, and an AWS credential chain or workload role with Bedrock invoke access.'
    : `Configure MODEL_MODE=live, MODEL_PROVIDER=${provider}, ${apiKeyEnv}, and ${openrouter ? 'OPENROUTER_MODEL' : 'OPENAI_MODEL'} on the server.`;
  return {
    provider,
    mode: env.MODEL_MODE,
    model,
    // Explicit URLs also prevent the OpenAI SDK from reading OPENAI_BASE_URL as an implicit override.
    ...(bedrock ? { region } : { baseURL: openrouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1' }),
    apiKey,
    label,
    apiKeyEnv,
    authKind: bedrock ? 'aws' : 'api-key',
    setupHint,
    enabled: env.MODEL_MODE === 'live' && (bedrock ? !!region && !!model : !!apiKey),
    setupRequired,
  };
}

/** Safe API/UI subset: no credential values or SDK configuration. */
export function modelStatus(selected: ResolvedModelConfig = resolveModelConfig()) {
  return {
    modelProvider: selected.provider,
    modelName: selected.model,
    modelEnabled: selected.enabled,
    setupRequired: [...selected.setupRequired],
  };
}

/** The optional transport exists for isolated tests; callers cannot override the selected endpoint. */
export function createModelClient(selected: ResolvedModelConfig = resolveModelConfig(), transport?: typeof globalThis.fetch): OpenAI | null {
  if (selected.provider === 'bedrock' || !selected.enabled || !selected.apiKey || !selected.baseURL) return null;
  return new OpenAI({
    apiKey: selected.apiKey,
    baseURL: selected.baseURL,
    timeout: 45000,
    maxRetries: 0,
    ...(selected.provider === 'openrouter' ? { organization: null, project: null } : {}),
    ...(transport ? { fetch: transport } : {}),
  });
}
