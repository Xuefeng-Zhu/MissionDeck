import { afterEach, describe, expect, it, vi } from 'vitest';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import { resolveModelConfig } from './model-provider.js';
import { createStrandsModel, sanitizeNovaToolSpecs } from './strands-model.js';

const environment = {
  MODEL_MODE: 'live' as const,
  OPENROUTER_API_KEY: 'synthetic-openrouter-key', OPENROUTER_MODEL: 'openai/gpt-5.6-luna',
  OPENAI_API_KEY: 'synthetic-openai-key', OPENAI_MODEL: 'gpt-5-mini',
  AWS_REGION: 'us-west-2', BEDROCK_MODEL_ID: 'us.amazon.nova-2-lite-v1:0',
};

describe('Strands model factory', () => {
  afterEach(() => vi.restoreAllMocks());

  it('constructs the native Bedrock model for Nova 2 Lite without an API key', () => {
    const selected = resolveModelConfig({ ...environment, MODEL_PROVIDER: 'bedrock' });
    const model = createStrandsModel(selected, { maxTokens: 4096, stream: true });
    expect(model).toBeInstanceOf(BedrockModel);
    expect(model.getConfig()).toMatchObject({ modelId: 'us.amazon.nova-2-lite-v1:0', maxTokens: 4096, temperature: 0, stream: true, includeToolResultStatus: false });
  });

  it('strips unsupported top-level JSON Schema fields for every Nova tool request', () => {
    const [sanitized] = sanitizeNovaToolSpecs([{
      name: 'strict_tool',
      description: 'Synthetic strict tool.',
      inputSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'Strict tool',
        description: 'Synthetic schema.',
        type: 'object',
        properties: { sourceId: { type: 'string', minLength: 1 } },
        required: ['sourceId'],
        additionalProperties: false,
      },
    }])!;
    expect(sanitized.inputSchema).toEqual({
      type: 'object',
      properties: { sourceId: { type: 'string', minLength: 1 } },
      required: ['sourceId'],
    });
    expect(Object.keys(sanitized.inputSchema!)).toEqual(['type', 'properties', 'required']);
  });

  it('rejects unsupported top-level schema semantics instead of weakening them', () => {
    expect(() => sanitizeNovaToolSpecs([{
      name: 'composed_tool',
      description: 'Synthetic composed tool.',
      inputSchema: {
        type: 'object',
        oneOf: [{ type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }],
      },
    }])).toThrow(/unsupported top-level semantics: oneOf/);
  });

  it('routes Nova stream tool specs through the compatibility adapter', () => {
    const upstream = vi.spyOn(BedrockModel.prototype, 'stream').mockImplementation(async function* () {});
    const selected = resolveModelConfig({ ...environment, MODEL_PROVIDER: 'bedrock' });
    const model = createStrandsModel(selected, { maxTokens: 4096 });
    model.stream([], { toolSpecs: [{
      name: 'strict_tool',
      description: 'Synthetic strict tool.',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
    }] });
    expect(upstream).toHaveBeenCalledOnce();
    expect(upstream.mock.calls[0]?.[1]?.toolSpecs?.[0]?.inputSchema).toEqual({
      type: 'object', properties: { value: { type: 'string' } }, required: ['value'],
    });
  });

  it('retains the explicitly selected OpenAI-compatible adapter', () => {
    const selected = resolveModelConfig({ ...environment, MODEL_PROVIDER: 'openrouter' });
    const model = createStrandsModel(selected, { maxTokens: 2048 });
    expect(model).toBeInstanceOf(OpenAIModel);
    expect(model.getConfig()).toMatchObject({ modelId: 'openai/gpt-5.6-luna', maxTokens: 2048 });
  });
});
