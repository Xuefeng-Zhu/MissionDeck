import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type RequestHandler } from 'express';
import type { Server } from 'node:http';
import { createRuntimeModel } from './runtime-model.js';
import { resolveModelConfig, type ModelEnvironment } from './model-provider.js';

const modelEnvironment: ModelEnvironment = {
  MODEL_MODE: 'live', MODEL_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: 'synthetic-openrouter-test-credential', OPENROUTER_MODEL: 'openai/gpt-5.6-luna',
  OPENAI_API_KEY: undefined, OPENAI_MODEL: 'gpt-5-mini',
};

describe('installed CopilotKit v2 with Express 5', () => {
  let server: Server | undefined;
  let base: string;
  let previousTelemetry: string | undefined;
  const modelRequests: Request[] = [];

  beforeAll(async () => {
    previousTelemetry = process.env.COPILOTKIT_TELEMETRY_DISABLED;
    process.env.COPILOTKIT_TELEMETRY_DISABLED = 'true';
    const { BuiltInAgent, CopilotRuntime, InMemoryAgentRunner } = await import('@copilotkit/runtime/v2');
    const { createCopilotExpressHandler } = await import('@copilotkit/runtime/v2/express');
    const model = createRuntimeModel(resolveModelConfig(modelEnvironment), async (input, init) => {
      modelRequests.push(new Request(input, init));
      const chunks = [
        { id: 'fixture-chat', object: 'chat.completion.chunk', created: 1, model: modelEnvironment.OPENROUTER_MODEL, choices: [{ index: 0, delta: { role: 'assistant', content: 'Synthetic routed response.' }, finish_reason: null }] },
        { id: 'fixture-chat', object: 'chat.completion.chunk', created: 1, model: modelEnvironment.OPENROUTER_MODEL, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      ];
      return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const runtime = new CopilotRuntime({
      agents: { default: new BuiltInAgent({
        model, prompt: 'Isolated runtime transport test. Only synthetic data is available.',
        maxSteps: 1, maxOutputTokens: 1800, maxRetries: 0,
        providerOptions: { openai: { store: false } },
      }) },
      runner: new InMemoryAgentRunner({ maxThreads: 20, maxRunsPerThread: 20, maxBytes: 16 * 1024 * 1024, onConcurrentRun: 'throw' }),
      openGenerativeUI: false,
    });
    const app = express();
    app.use(express.json({ limit: '256kb' }));
    // The installed adapter's declarations target Express 4; its implementation
    // uses the Node request/response bridge supported by Express 5. Keep this
    // explicit boundary assertion covered by real route discovery below.
    const handler = createCopilotExpressHandler({ runtime, basePath: '/api/copilotkit', cors: false, activateChannels: false });
    app.use(handler as unknown as RequestHandler);
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve());
    });
    base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (previousTelemetry === undefined) delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
    else process.env.COPILOTKIT_TELEMETRY_DISABLED = previousTelemetry;
  });

  it('serves the actual v2 agent discovery route without requesting a model', async () => {
    const response = await fetch(`${base}/api/copilotkit/info`);
    expect(response.status).toBe(200);
    const info = await response.json();
    expect(info.agents).toHaveProperty('default');
    expect(JSON.stringify(info)).not.toContain('OPENAI_API_KEY');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(info.openGenerativeUIEnabled).toBe(false);
    expect(info.a2uiEnabled).toBe(false);
    expect(modelRequests).toHaveLength(0);
  });

  it('rejects an unknown agent through the parsed-body Express bridge', async () => {
    const response = await fetch(`${base}/api/copilotkit/agent/does-not-exist/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: 'discovery-test-thread', runId: 'discovery-test-run', messages: [], state: {}, tools: [], context: [], forwardedProps: {} }),
    });
    expect(response.status).toBe(404);
  });

  it('streams through the real runtime to the mocked OpenRouter transport', async () => {
    const response = await fetch(`${base}/api/copilotkit/agent/default/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: 'routing-test-thread', runId: 'routing-test-run', messages: [{ id: 'routing-message', role: 'user', content: 'Route this synthetic test.' }], state: {}, tools: [], context: [], forwardedProps: {} }),
    });
    expect(response.status).toBe(200);
    const events = await response.text();
    expect(events).toContain('Synthetic routed response.');
    expect(events).toContain('RUN_FINISHED');
    expect(events).not.toContain('RUN_ERROR');
    expect(modelRequests).toHaveLength(1);
    const request = modelRequests[0]!;
    expect(request.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(request.headers.get('Authorization')).toBe(`Bearer ${modelEnvironment.OPENROUTER_API_KEY}`);
    expect(request.headers.get('OpenAI-Organization')).toBeNull();
    expect(request.headers.get('OpenAI-Project')).toBeNull();
    const body = await request.json();
    expect(body).toMatchObject({ model: 'openai/gpt-5.6-luna', stream: true, store: false });
    expect(body.messages.some((message: { content: string }) => message.content.includes('Route this synthetic test.'))).toBe(true);
  });
});

describe('runtime model selection', () => {
  it('keeps explicit direct OpenAI on the Responses endpoint', async () => {
    const selected = resolveModelConfig({ ...modelEnvironment, MODEL_PROVIDER: 'openai', OPENAI_API_KEY: 'synthetic-openai-test-credential' });
    const requests: Request[] = [];
    const model = createRuntimeModel(selected, async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json({ error: { message: 'Synthetic provider rejection.', type: 'invalid_request_error' } }, { status: 400 });
    });
    await expect(model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic routing test.' }] }], providerOptions: { openai: { store: false } } })).rejects.toThrow();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://api.openai.com/v1/responses');
    expect(requests[0]!.headers.get('Authorization')).toBe('Bearer synthetic-openai-test-credential');
    expect(await requests[0]!.json()).toMatchObject({ model: 'gpt-5-mini', store: false });
  });

  it('does not borrow an OpenAI key when the selected OpenRouter key is missing', () => {
    const selected = resolveModelConfig({ ...modelEnvironment, OPENROUTER_API_KEY: undefined, OPENAI_API_KEY: 'synthetic-unselected-credential' });
    expect(() => createRuntimeModel(selected)).toThrow('OPENROUTER_API_KEY');
  });

  it('does not construct a live runtime model in fixture mode', () => {
    const selected = resolveModelConfig({ ...modelEnvironment, MODEL_MODE: 'fixture' });
    expect(() => createRuntimeModel(selected)).toThrow('MODEL_MODE=live');
  });
});
