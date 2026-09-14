import { describe, expect, it } from 'vitest';
import { modelProviderLabel, modelSetupHint, planningStatus } from './model-status';

describe('model status copy', () => {
  it('labels Bedrock and describes role-based server authentication', () => {
    const config = { modelProvider: 'bedrock' as const, modelMode: 'live' as const, modelEnabled: false, modelName: 'us.amazon.nova-2-lite-v1:0' };
    expect(modelProviderLabel(config)).toBe('Amazon Bedrock');
    expect(planningStatus(config)).toBe('Amazon Bedrock setup required');
    expect(planningStatus({ ...config, modelEnabled: true })).toBe('Amazon Bedrock live mode configured');
    expect(modelSetupHint(config)).toContain('AWS credential chain or workload role');
    expect(modelSetupHint(config)).not.toContain('BEDROCK_API_KEY');
  });

  it('retains explicit OpenRouter and OpenAI setup copy', () => {
    expect(modelSetupHint({ modelProvider: 'openrouter' })).toContain('OPENROUTER_API_KEY');
    expect(modelSetupHint({ modelProvider: 'openai' })).toContain('OPENAI_API_KEY');
  });
});
