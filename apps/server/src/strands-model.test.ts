import { describe, expect, it } from 'vitest';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import { resolveModelConfig } from './model-provider.js';
import { createStrandsModel } from './strands-model.js';

const environment = {
  MODEL_MODE: 'live' as const,
  OPENROUTER_API_KEY: 'synthetic-openrouter-key', OPENROUTER_MODEL: 'openai/gpt-5.6-luna',
  OPENAI_API_KEY: 'synthetic-openai-key', OPENAI_MODEL: 'gpt-5-mini',
  AWS_REGION: 'us-west-2', BEDROCK_MODEL_ID: 'us.openai.gpt-5.6-luna',
};

describe('Strands model factory', () => {
  it('constructs the native Bedrock model for Luna without an API key', () => {
    const selected = resolveModelConfig({ ...environment, MODEL_PROVIDER: 'bedrock' });
    const model = createStrandsModel(selected, { maxTokens: 4096, stream: true });
    expect(model).toBeInstanceOf(BedrockModel);
    expect(model.getConfig()).toMatchObject({ modelId: 'us.openai.gpt-5.6-luna', maxTokens: 4096, temperature: 0.1, stream: true, includeToolResultStatus: false });
  });

  it('retains the explicitly selected OpenAI-compatible adapter', () => {
    const selected = resolveModelConfig({ ...environment, MODEL_PROVIDER: 'openrouter' });
    const model = createStrandsModel(selected, { maxTokens: 2048 });
    expect(model).toBeInstanceOf(OpenAIModel);
    expect(model.getConfig()).toMatchObject({ modelId: 'openai/gpt-5.6-luna', maxTokens: 2048 });
  });
});
