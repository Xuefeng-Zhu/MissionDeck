import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type RequestHandler } from 'express';
import type { Server } from 'node:http';

describe('installed CopilotKit v2 with Express 5', () => {
  let server: Server | undefined;
  let base: string;
  let previousTelemetry: string | undefined;

  beforeAll(async () => {
    previousTelemetry = process.env.COPILOTKIT_TELEMETRY_DISABLED;
    process.env.COPILOTKIT_TELEMETRY_DISABLED = 'true';
    const { BuiltInAgent, CopilotRuntime, InMemoryAgentRunner } = await import('@copilotkit/runtime/v2');
    const { createCopilotExpressHandler } = await import('@copilotkit/runtime/v2/express');
    const runtime = new CopilotRuntime({
      agents: { default: new BuiltInAgent({
        model: 'openai:gpt-5-mini', prompt: 'Runtime discovery test only. No model request is made.',
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
  });

  it('rejects an unknown agent through the parsed-body Express bridge', async () => {
    const response = await fetch(`${base}/api/copilotkit/agent/does-not-exist/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: 'discovery-test-thread', runId: 'discovery-test-run', messages: [], state: {}, tools: [], context: [], forwardedProps: {} }),
    });
    expect(response.status).toBe(404);
  });
});
