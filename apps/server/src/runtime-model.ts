import { createOpenAI, type OpenAIProviderSettings } from '@ai-sdk/openai';
import { createAmazonBedrock, type AmazonBedrockProviderSettings } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { HttpError } from './errors.js';
import { type ResolvedModelConfig } from './model-provider.js';

/** Construct the actual transport; a model-name prefix cannot select an API URL. */
export function createRuntimeModel(
  selected: ResolvedModelConfig,
  fetch?: OpenAIProviderSettings['fetch'] | AmazonBedrockProviderSettings['fetch'],
  credentialProvider: NonNullable<AmazonBedrockProviderSettings['credentialProvider']> = fromNodeProviderChain(),
) {
  if (!selected.enabled) {
    throw new HttpError(503, selected.setupHint, 'model_unavailable');
  }
  if (selected.provider === 'bedrock') {
    if (!selected.region) throw new HttpError(503, selected.setupHint, 'model_unavailable');
    const provider = createAmazonBedrock({
      region: selected.region,
      credentialProvider,
      ...(fetch ? { fetch } : {}),
    });
    return provider(selected.model);
  }
  if (!selected.apiKey || !selected.baseURL) {
    throw new HttpError(503, selected.setupHint, 'model_unavailable');
  }
  const provider = createOpenAI({
    apiKey: selected.apiKey, baseURL: selected.baseURL, name: selected.provider,
    ...(fetch ? { fetch } : {}),
  });
  // OpenRouter's documented compatibility endpoint is Chat Completions. The
  // OpenAI SDK provider defaults to Responses, so choose the API explicitly.
  return selected.provider === 'openrouter' ? provider.chat(selected.model) : provider.responses(selected.model);
}
