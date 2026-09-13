import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MissionExecution } from '@mission/domain';
import { createApp } from './app.js';
import { openDatabase, type Database } from './database.js';
import { ExecutionService } from './execution-service.js';
import { FixtureExecutionProvider } from './execution-provider.js';
import { ModelExecutionRunner } from './execution-runner.js';
import { resolveModelConfig } from './model-provider.js';
import { MissionService } from './service.js';
import { FixtureWorkProvider, MemoryFixtureRepository } from './providers/index.js';
import { UpgradeStore } from './upgrade-store.js';

// Never consult live credentials or selected modes for this HTTP acceptance test.
vi.hoisted(() => { process.env.MODEL_MODE = 'fixture'; process.env.PROVIDER_MODE = 'fixture'; });

describe('paired execution HTTP routes', () => {
  let db: Database; let execution: ExecutionService; let server: Server; let base: string; let token: string; let store: UpgradeStore;
  const origin = 'http://127.0.0.1:5173';
  const pairingCode = 'synthetic-execution-router-pairing-code';
  const localScope = { ownerId: 'local-user', workspaceId: 'local-workspace' };
  const input = () => ({ requestId: randomUUID(), goal: 'Draft a launch brief, receive a human review, and produce a final brief.', context: 'MissionDeck is for project teams. Use only supplied context.', humanId: 'fixture-human', agentId: 'fixture-agent', maxTasks: 3, maxAgentRuns: 2 });
  const request = (path: string, body?: unknown, options: { token?: string; origin?: string; method?: string } = {}) => fetch(base + path, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { Origin: options.origin ?? origin, 'Content-Type': 'application/json', ...((options.token ?? token) ? { Authorization: `Bearer ${options.token ?? token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  beforeAll(async () => {
    db = await openDatabase({ memory: true }); store = new UpgradeStore(db);
    const model = new ModelExecutionRunner(resolveModelConfig({ MODEL_MODE: 'fixture', MODEL_PROVIDER: 'openrouter', OPENROUTER_MODEL: 'synthetic/model', OPENAI_MODEL: 'synthetic/model' }));
    execution = new ExecutionService(db, scope => new FixtureExecutionProvider(store, scope), model);
    vi.spyOn(execution, 'wake').mockImplementation(() => {});
    const legacy = new MissionService(db, new FixtureWorkProvider(new MemoryFixtureRepository()));
    const app = await createApp(legacy, { pairingCode, enableCopilot: false, executionService: execution });
    await new Promise<void>((resolve, reject) => { server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const paired = await request('/api/pair', { code: pairingCode }, { token: '' });
    expect(paired.status).toBe(200); token = (await paired.json()).token;
  });
  afterAll(async () => { await execution?.stop(); await new Promise<void>(resolve => server?.close(() => resolve())); await db?.close(); });

  it('requires a paired, origin-bound session for execution reads and mission start', async () => {
    expect((await request('/api/execution/capabilities', undefined, { token: '' })).status).toBe(401);
    expect((await request('/api/execution/missions', input(), { token: '' })).status).toBe(401);
    expect((await request('/api/execution/capabilities', undefined, { origin: 'http://localhost:5173' })).status).toBe(401);
    const capabilities = await request('/api/execution/capabilities');
    expect(capabilities.status).toBe(200);
    expect(await capabilities.json()).toMatchObject({ enabled: true, mode: 'fixture', modelMode: 'fixture', humans: [{ id: 'fixture-human' }], agents: [{ id: 'fixture-agent' }] });
    expect((await store.list('mission_execution', localScope))).toHaveLength(0);
  });

  it('delivers the entire paired HTTP start, human review, and verified-completion flow with workspace artifacts', async () => {
    const payload = input();
    const started = await request('/api/execution/missions', payload);
    expect(started.status, await started.clone().text()).toBe(201);
    const { execution: created } = await started.json() as { execution: MissionExecution };
    const repeated = await request('/api/execution/missions', payload);
    expect((await repeated.json()).execution.missionId).toBe(created.missionId);
    await execution.pump();
    const state = await request(`/api/missions/${created.missionId}/execution`);
    expect(state.status).toBe(200);
    const current = (await state.json()).execution as MissionExecution;
    expect(current.tasks.map(task => task.status)).toEqual(['completed', 'waiting_human', 'queued']);
    const human = current.tasks[1]!;
    const reviewPath = `/api/missions/${current.missionId}/execution/tasks/${human.id}/review`;
    expect((await request(reviewPath, { feedback: '   ' })).status).toBe(422);
    expect((await request(reviewPath, { feedback: 'Keep the final positioning focused on shared project ownership.' })).status).toBe(200);
    await execution.pump();
    const ready = (await (await request(`/api/missions/${current.missionId}/execution`)).json()).execution as MissionExecution;
    expect(ready.status).toBe('needs_review');
    expect(ready.artifacts).toHaveLength(5);
    const verified = await request(`/api/missions/${current.missionId}/execution/control`, { action: 'complete', attestation: 'I reviewed the saved final brief and it meets this synthetic mission outcome.' });
    expect(verified.status).toBe(200);
    const final = (await verified.json()).execution as MissionExecution;
    expect(final.status).toBe('completed'); expect(final.artifacts).toHaveLength(6);
    const provider = new FixtureExecutionProvider(store, localScope);
    const verification = final.artifacts.find(artifact => artifact.kind === 'verification')!;
    expect((await provider.readDocument(verification.id)).content).toContain('I reviewed the saved final brief');
    expect((await request(`/api/missions/${current.missionId}`)).status).toBe(200);
  });

  it('blocks legacy mutation routes for managed missions while retaining their read views', async () => {
    const started = await request('/api/execution/missions', input());
    expect(started.status, await started.clone().text()).toBe(201);
    const { execution: created } = await started.json() as { execution: MissionExecution };
    await execution.pump();
    const current = (await execution.get(created.missionId, localScope))!;
    const mutations = [
      [`/api/missions/${current.missionId}/plan`, {}],
      [`/api/missions/${current.missionId}/complete`, {}],
      [`/api/missions/${current.missionId}/tasks/${current.tasks[0]!.id}/block`, { reason: 'Attempted mutation through the legacy interface.' }],
    ] as const;
    for (const [path, body] of mutations) {
      const response = await request(path, body);
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain('managed by the execution worker');
    }
    expect((await request(`/api/missions/${current.missionId}`)).status).toBe(200);
    expect((await execution.get(created.missionId, localScope))!.tasks[0]!.status).toBe('completed');
  });

  it('rejects forged scope or unsupported start fields instead of silently accepting them', async () => {
    const response = await request('/api/execution/missions', { ...input(), ownerId: 'another-owner', capabilities: ['shell'] });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('validation_error');
  });
});
