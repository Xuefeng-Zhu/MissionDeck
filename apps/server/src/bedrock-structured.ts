import { Agent, configureLogging } from '@strands-agents/sdk';
import type { z } from 'zod';
import type { ResolvedModelConfig } from './model-provider.js';
import { createStrandsModel, type StrandsModelFactory } from './strands-model.js';

// Provider exceptions can contain prompts or source text. Callers expose only their own safe errors.
configureLogging({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });

export interface BedrockStructuredRequest {
  schema: z.ZodType;
  name: string;
  systemPrompt: string;
  prompt: string;
  data: unknown;
  maxTokens: number;
  signal?: AbortSignal;
}

export type BedrockStructuredInvoker = (selected: ResolvedModelConfig, request: BedrockStructuredRequest) => Promise<unknown>;

/**
 * Bedrock Luna supports tools but not Bedrock's native structured-output format.
 * Strands represents the Zod schema as a final synthetic tool, validates its input,
 * and forces that tool on a second bounded turn if the model initially answers in prose.
 */
export function createBedrockStructuredInvoker(modelFactory: StrandsModelFactory = createStrandsModel): BedrockStructuredInvoker {
  return async (selected, request) => {
    if (selected.provider !== 'bedrock' || !selected.enabled) throw new Error('Amazon Bedrock is not enabled.');
    const timeout = AbortSignal.timeout(60_000);
    const cancelSignal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    const agent = new Agent({
      id: `missiondeck-${request.name}`,
      model: modelFactory(selected, { maxTokens: request.maxTokens, stream: false }),
      tools: [],
      printer: false,
      retryStrategy: null,
      contextManager: false,
      structuredOutputSchema: request.schema,
      systemPrompt: `${request.systemPrompt}\n${request.prompt}\nReturn the completed result only through the required final structured-output tool.`,
    });
    const result = await agent.invoke(JSON.stringify(request.data), {
      cancelSignal,
      // One initial attempt, one forced-tool attempt, and one bounded schema repair.
      limits: { turns: 3 },
    });
    if (result.stopReason === 'cancelled') throw new Error('Amazon Bedrock invocation was cancelled.');
    if (result.structuredOutput === undefined) throw new Error('Amazon Bedrock did not return the required structured result.');
    return request.schema.parse(result.structuredOutput);
  };
}

export const invokeBedrockStructured = createBedrockStructuredInvoker();
