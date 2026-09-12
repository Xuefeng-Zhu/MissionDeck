import OpenAI from 'openai';
import { config } from './config.js';

export type ModelEnvironment = Pick<typeof config,
  'MODEL_MODE' | 'MODEL_PROVIDER' | 'OPENROUTER_API_KEY' | 'OPENROUTER_MODEL' | 'OPENAI_API_KEY' | 'OPENAI_MODEL'>;

/** Server-only configuration. Never return this object to a client: it can contain the selected key. */
export interface ResolvedModelConfig {
  provider: 'openrouter' | 'openai';
  mode: 'fixture' | 'live';
  model: string;
  baseURL: string;
  apiKey?: string;
  label: 'OpenRouter' | 'OpenAI';
  apiKeyEnv: 'OPENROUTER_API_KEY' | 'OPENAI_API_KEY';
  enabled: boolean;
  setupRequired: string[];
}

/** Select exactly one explicitly configured provider. Other vendors' keys are never fallback credentials. */
export function resolveModelConfig(env: ModelEnvironment = config): ResolvedModelConfig {
  const openrouter = env.MODEL_PROVIDER === 'openrouter';
  const apiKey = (openrouter ? env.OPENROUTER_API_KEY : env.OPENAI_API_KEY)?.trim() || undefined;
  const apiKeyEnv = openrouter ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY';
  const label = openrouter ? 'OpenRouter' : 'OpenAI';
  const setupRequired: string[] = [];
  if (env.MODEL_MODE !== 'live') setupRequired.push('Set MODEL_MODE=live to enable model requests. Fixture mode is currently selected.');
  if (!apiKey) setupRequired.push(`Set ${apiKeyEnv} on the server for the selected ${label} provider.`);
  return {
    provider: env.MODEL_PROVIDER,
    mode: env.MODEL_MODE,
    model: openrouter ? env.OPENROUTER_MODEL : env.OPENAI_MODEL,
    // Explicit URLs also prevent the OpenAI SDK from reading OPENAI_BASE_URL as an implicit override.
    baseURL: openrouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1',
    apiKey,
    label,
    apiKeyEnv,
    enabled: env.MODEL_MODE === 'live' && !!apiKey,
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
  if (!selected.enabled || !selected.apiKey) return null;
  return new OpenAI({
    apiKey: selected.apiKey,
    baseURL: selected.baseURL,
    timeout: 45000,
    maxRetries: 0,
    ...(selected.provider === 'openrouter' ? { organization: null, project: null } : {}),
    ...(transport ? { fetch: transport } : {}),
  });
}
