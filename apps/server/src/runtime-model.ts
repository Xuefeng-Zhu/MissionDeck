import { createOpenAI, type OpenAIProviderSettings } from '@ai-sdk/openai';
import { HttpError } from './errors.js';
import { type ResolvedModelConfig } from './model-provider.js';

/** Construct the actual transport; a model-name prefix cannot select an API URL. */
export function createRuntimeModel(selected: ResolvedModelConfig, fetch?: OpenAIProviderSettings['fetch']) {
  if (!selected.enabled || !selected.apiKey) {
    throw new HttpError(503, `Set MODEL_MODE=live and ${selected.apiKeyEnv} on the server to enable ${selected.label}.`, 'model_unavailable');
  }
  const provider = createOpenAI({
    apiKey: selected.apiKey, baseURL: selected.baseURL, name: selected.provider,
    ...(fetch ? { fetch } : {}),
  });
  // OpenRouter's documented compatibility endpoint is Chat Completions. The
  // OpenAI SDK provider defaults to Responses, so choose the API explicitly.
  return selected.provider === 'openrouter' ? provider.chat(selected.model) : provider.responses(selected.model);
}
