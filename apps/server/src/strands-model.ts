import {
  BedrockModel,
  type BaseModelConfig,
  type BedrockModelOptions,
  type CountTokensOptions,
  type JSONSchema,
  type Message,
  type Model,
  type ModelStreamEvent,
  type StreamOptions,
  type ToolSpec,
} from '@strands-agents/sdk';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import type { ResolvedModelConfig } from './model-provider.js';

export interface StrandsModelOptions {
  maxTokens: number;
  stream?: boolean;
  transport?: typeof globalThis.fetch;
  bedrockClientConfig?: BedrockModelOptions['clientConfig'];
}

export type StrandsModelFactory = (selected: ResolvedModelConfig, options: StrandsModelOptions) => Model<BaseModelConfig>;

const isNovaModel = (modelId: string) => /(?:^|\.)amazon\.nova(?:-|_)/.test(modelId);

/** Nova accepts only type, properties, and required at a tool schema's top level. */
export function sanitizeNovaToolSpecs(toolSpecs: ToolSpec[] | undefined): ToolSpec[] | undefined {
  return toolSpecs?.map(spec => {
    const schema = spec.inputSchema;
    if (!schema) return spec;
    if (schema.type !== 'object') throw new Error('Amazon Nova tool input schemas must be top-level objects.');
    const supported = new Set(['$schema', 'title', 'description', 'type', 'properties', 'required', 'additionalProperties']);
    const unsupported = Object.keys(schema).filter(key => !supported.has(key));
    if (unsupported.length) throw new Error(`Amazon Nova tool input schemas contain unsupported top-level semantics: ${unsupported.join(', ')}.`);
    if ('additionalProperties' in schema && schema.additionalProperties !== false) {
      throw new Error('Amazon Nova tool input schemas must declare named top-level properties.');
    }
    const inputSchema: JSONSchema = { type: 'object' };
    if (schema.properties) inputSchema.properties = schema.properties;
    if (schema.required) inputSchema.required = schema.required;
    return { ...spec, inputSchema };
  });
}

function withNovaToolSchemas<T extends { toolSpecs?: ToolSpec[] } | undefined>(options: T): T {
  if (!options?.toolSpecs) return options;
  return { ...options, toolSpecs: sanitizeNovaToolSpecs(options.toolSpecs) } as T;
}

/** Keep Strands' local Zod validation strict while sending Nova-compatible tool schemas. */
class NovaBedrockModel extends BedrockModel {
  override stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    return super.stream(messages, withNovaToolSchemas(options));
  }

  override countTokens(messages: Message[], options?: CountTokensOptions): Promise<number> {
    return super.countTokens(messages, withNovaToolSchemas(options));
  }
}

/** Construct the provider-native model used by every Strands invocation. */
export const createStrandsModel: StrandsModelFactory = (selected, options) => {
  if (selected.provider === 'bedrock') {
    if (!selected.region) throw new Error('Amazon Bedrock requires an AWS region.');
    const nova = isNovaModel(selected.model);
    const BedrockAdapter = nova ? NovaBedrockModel : BedrockModel;
    return new BedrockAdapter({
      region: selected.region,
      modelId: selected.model,
      maxTokens: options.maxTokens,
      temperature: nova ? 0 : 0.1,
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
