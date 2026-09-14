import { describe, expect, it } from 'vitest';
import { Model, type BaseModelConfig, type Message, type ModelStreamEvent, type StreamOptions } from '@strands-agents/sdk';
import { z } from 'zod';
import { createBedrockStructuredInvoker } from './bedrock-structured.js';
import { resolveModelConfig } from './model-provider.js';

type Script = { kind: 'text'; text: string } | { kind: 'tool'; value: unknown };

class ScriptedModel extends Model<BaseModelConfig> {
  readonly calls: Array<{ messages: Message[]; options?: StreamOptions }> = [];
  constructor(private config: BaseModelConfig, private readonly scripts: Script[]) { super(); }
  updateConfig(next: BaseModelConfig) { this.config = { ...this.config, ...next }; }
  getConfig() { return this.config; }
  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    this.calls.push({ messages, options });
    const script = this.scripts[this.calls.length - 1];
    if (!script) throw new Error('Unexpected extra model turn.');
    yield { type: 'modelMessageStartEvent', role: 'assistant' };
    if (script.kind === 'text') {
      yield { type: 'modelContentBlockStartEvent' };
      yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: script.text } };
      yield { type: 'modelContentBlockStopEvent' };
      yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' };
    } else {
      yield { type: 'modelContentBlockStartEvent', start: { type: 'toolUseStart', name: 'strands_structured_output', toolUseId: `tool-${this.calls.length}` } };
      yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'toolUseInputDelta', input: JSON.stringify(script.value) } };
      yield { type: 'modelContentBlockStopEvent' };
      yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' };
    }
    yield { type: 'modelMetadataEvent', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}

const selected = () => resolveModelConfig({
  MODEL_MODE: 'live', MODEL_PROVIDER: 'bedrock', AWS_REGION: 'us-west-2', BEDROCK_MODEL_ID: 'us.amazon.nova-2-lite-v1:0',
  OPENROUTER_API_KEY: undefined, OPENROUTER_MODEL: 'openai/gpt-5.6-luna', OPENAI_API_KEY: undefined, OPENAI_MODEL: 'gpt-5-mini',
});

describe('Bedrock structured output adapter', () => {
  it('forces the Strands output tool and permits one bounded schema repair', async () => {
    const model = new ScriptedModel({ modelId: 'us.amazon.nova-2-lite-v1:0' }, [
      { kind: 'text', text: 'I should use the result tool.' },
      { kind: 'tool', value: { answer: 42 } },
      { kind: 'tool', value: { answer: 'validated' } },
    ]);
    const invoke = createBedrockStructuredInvoker(() => model);
    const schema = z.object({ answer: z.string() }).strict();
    await expect(invoke(selected(), { schema, name: 'test_result', systemPrompt: 'System boundary.', prompt: 'Return an answer.', data: { input: 'safe' }, maxTokens: 128 })).resolves.toEqual({ answer: 'validated' });
    expect(model.calls).toHaveLength(3);
    expect(model.calls[0]!.options?.toolSpecs?.map(tool => tool.name)).toContain('strands_structured_output');
    expect(model.calls[0]!.options?.toolChoice).toBeUndefined();
    expect(model.calls[1]!.options?.toolChoice).toEqual({ tool: { name: 'strands_structured_output' } });
    expect(model.calls[2]!.options?.toolChoice).toEqual({ tool: { name: 'strands_structured_output' } });
  });

  it('rejects a result that never reaches a valid structured tool payload', async () => {
    const model = new ScriptedModel({ modelId: 'us.amazon.nova-2-lite-v1:0' }, [
      { kind: 'tool', value: { answer: 1 } },
      { kind: 'tool', value: { answer: 2 } },
      { kind: 'tool', value: { answer: 3 } },
    ]);
    const invoke = createBedrockStructuredInvoker(() => model);
    await expect(invoke(selected(), { schema: z.object({ answer: z.string() }), name: 'test_result', systemPrompt: 'System.', prompt: 'Prompt.', data: {}, maxTokens: 128 })).rejects.toThrow('required structured result');
    expect(model.calls).toHaveLength(3);
  });
});
