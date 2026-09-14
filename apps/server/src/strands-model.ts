import { BedrockModel, type BaseModelConfig, type BedrockModelOptions, type Model } from '@strands-agents/sdk';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import type { ResolvedModelConfig } from './model-provider.js';

export interface StrandsModelOptions {
  maxTokens: number;
  stream?: boolean;
  transport?: typeof globalThis.fetch;
  bedrockClientConfig?: BedrockModelOptions['clientConfig'];
}

export type StrandsModelFactory = (selected: ResolvedModelConfig, options: StrandsModelOptions) => Model<BaseModelConfig>;

/** Construct the provider-native model used by every Strands invocation. */
export const createStrandsModel: StrandsModelFactory = (selected, options) => {
  if (selected.provider === 'bedrock') {
    if (!selected.region) throw new Error('Amazon Bedrock requires an AWS region.');
    return new BedrockModel({
      region: selected.region,
      modelId: selected.model,
      maxTokens: options.maxTokens,
      temperature: 0.1,
      stream: options.stream ?? true,
      includeToolResultStatus: false,
      // The application owns retry and request budgets; do not multiply calls in the SDK.
      clientConfig: { maxAttempts: 1, ...options.bedrockClientConfig },
    });
  }
  if (!selected.apiKey || !selected.baseURL) throw new Error(`${selected.label} credentials are unavailable.`);
  return new OpenAIModel({
    api: 'chat',
    apiKey: selected.apiKey,
    modelId: selected.model,
    maxTokens: options.maxTokens,
    clientConfig: {
      baseURL: selected.baseURL,
      maxRetries: 0,
      timeout: 45_000,
      organization: null,
      project: null,
      ...(options.transport ? { fetch: options.transport } : {}),
    },
    // SDK 1.17's chat adapter does not preserve interleaved parallel tool blocks.
    params: {
      store: false,
      parallel_tool_calls: false,
      ...(selected.provider === 'openrouter' ? { provider: { allow_fallbacks: false } } : {}),
    },
  });
};
