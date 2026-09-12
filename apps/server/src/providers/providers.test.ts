import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AmbiguousWorkProvider, FileFixtureRepository, FixtureWorkProvider, MemoryFixtureRepository,
  workUpdateSchema,
} from './index.js';

const userId = '81114c52-7d02-4a6f-bcd8-c9a9c9787d1b';
const workspaceId = 'f436ebd9-2d38-4243-b4d9-ce512f81b619';
const taskId = '1f109052-5202-41f1-babe-413e2c2d0a2b';
const officialSubset = {
  info: { version: '1195179a5535748e4ffe53978d2fc5082ec09f1c' },
  paths: {
    '/api/tasks': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskCreateInput' } } } } } },
    '/api/tasks/{id}': {
      get: {}, patch: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskUpdateInput' } } } } },
    },
  },
  components: { schemas: {
    TaskCreateInput: { properties: { title: { type: 'string' }, description: { type: 'string' }, status: { $ref: '#/components/schemas/TaskStatus' } } },
    TaskUpdateInput: { properties: { title: { type: 'string' }, description: { type: 'string' }, status: { $ref: '#/components/schemas/TaskStatus' } } },
    TaskStatus: { enum: ['todo', 'in_progress', 'done', 'cancelled', 'blocked'] },
  } },
};
const clock = () => new Date('2026-09-12T16:00:00.000Z');

function vendor(options: { timeoutAfterWrite?: boolean; readBackFails?: boolean; wrongIdentity?: boolean } = {}) {
  let task = { id: taskId, title: 'Review plan', description: 'Retained detail', status: 'in_progress', updated_at: '2026-09-12T15:00:00Z', recurrence_rule: null as string | null, task_status_id: null as string | null };
  const requests: Array<{ url: string; method: string; body: any; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url, method, body, headers: new Headers(init?.headers) });
    if (url.endsWith('/api/openapi.json')) return Response.json(officialSubset);
    if (url.endsWith('/api/users/me')) return Response.json({
      id: userId, workspace_id: options.wrongIdentity ? taskId : workspaceId,
      display_name: 'Approved test identity', needs_workspace_setup: false,
    });
    if (method === 'POST' || method === 'PATCH') {
      task = { ...task, ...body, updated_at: '2026-09-12T16:00:00Z' };
      if (options.timeoutAfterWrite) throw new DOMException('socket closed', 'AbortError');
      return Response.json({ task }, { status: method === 'POST' ? 201 : 200 });
    }
    if (url.endsWith(`/api/tasks/${taskId}`)) {
      if (options.readBackFails && requests.some((r) => r.method === 'POST')) return Response.json({}, { status: 503 });
      return Response.json({ task });
    }
    return Response.json({}, { status: 404 });
  };
  const provider = new AmbiguousWorkProvider({
    apiKey: 'test-only-secret-not-a-real-key', expectedWorkspaceId: workspaceId,
    expectedUserId: userId, fetch: fetcher, now: clock,
  });
  return { provider, requests, edit: (patch: Partial<typeof task>) => { task = { ...task, ...patch }; } };
}

describe('Ambiguous adapter with explicit simulated HTTP transport', () => {
  it('fails visibly when live credentials are absent and never switches to fixture', async () => {
    let calls = 0;
    const provider = new AmbiguousWorkProvider({ fetch: async () => { calls++; return Response.json(officialSubset); } });
    await expect(provider.readTask(taskId)).rejects.toMatchObject({ state: 'failed', code: 'missing_credentials' });
    expect(calls).toBe(0);
    await expect(provider.createTask({ title: 'Must not be created' }, { operationId: 'missing_key_operation' })).rejects.toMatchObject({ state: 'failed', code: 'missing_credentials' });
    expect(calls).toBe(1); // Public schema discovery only; no credentialed request.
    expect(provider.mode).toBe('live');
  });

  it('discovers official operations, verifies identity, and reads a returned ID back', async () => {
    const { provider, requests } = vendor();
    const capabilities = await provider.discover();
    expect(capabilities.writesEnabled).toBe(true);
    expect(capabilities.nativeIdempotency).toBe(false);
    expect(capabilities.conditionalUpdates).toBe(false);
    const record = await provider.createTask({ title: 'Approved task', description: 'Only approved context' }, { operationId: 'operation_create_01' });
    expect(record.id).toBe(taskId);
    expect(record.url).toBeNull();
    expect(requests.at(-1)?.url).toBe(`https://app.ambiguous.ai/api/tasks/${taskId}`);
    const write = requests.find((r) => r.method === 'POST')!;
    expect(write.body).toEqual({ title: 'Approved task', description: 'Only approved context', status: 'todo' });
    expect(write.headers.has('Idempotency-Key')).toBe(false);
    expect(requests[0].headers.has('Authorization')).toBe(false);
  });

  it('refuses writes when connected identity differs', async () => {
    const { provider, requests } = vendor({ wrongIdentity: true });
    await expect(provider.createTask({ title: 'Never written' }, { operationId: 'operation_identity' })).rejects.toMatchObject({ code: 'write_identity_unverified' });
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('keeps timeout-after-write outcome unknown without retry or fixture fallback', async () => {
    const { provider, requests } = vendor({ timeoutAfterWrite: true });
    await expect(provider.createTask({ title: 'Possible task' }, { operationId: 'operation_timeout' })).rejects.toMatchObject({ state: 'outcome_unknown', code: 'request_unconfirmed' });
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    expect(provider.mode).toBe('live');
  });

  it('retains a returned provider ID when read-back fails for later reconciliation', async () => {
    const { provider } = vendor({ readBackFails: true });
    await expect(provider.createTask({ title: 'Recover by reading ID' }, { operationId: 'operation_readback' })).rejects.toMatchObject({ state: 'outcome_unknown', providerId: taskId, code: 'readback_unconfirmed' });
  });

  it('reads before a patch and preserves direct human edits on fingerprint conflicts', async () => {
    const { provider, requests, edit } = vendor();
    const original = await provider.readTask(taskId);
    edit({ description: 'A human revised this in Ambiguous' });
    await expect(provider.updateTask(taskId, { title: 'Old proposal' }, {
      operationId: 'operation_conflict', expectedFingerprint: original.fingerprint,
    })).rejects.toMatchObject({ state: 'conflict', code: 'external_edit' });
    expect(requests.some((r) => r.method === 'PATCH')).toBe(false);
  });

  it('patches only approved fields, then reads back the exact ID', async () => {
    const { provider, requests } = vendor();
    const original = await provider.readTask(taskId);
    const result = await provider.updateTask(taskId, { title: 'Reviewed title' }, {
      operationId: 'operation_update01', expectedFingerprint: original.fingerprint,
    });
    expect(result.description).toBe('Retained detail');
    expect(result.status).toBe('in_progress');
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({ title: 'Reviewed title' });
    expect(requests.at(-1)?.method).toBe('GET');
  });

  it('does not implicitly authorize recurrence side effects', async () => {
    const { provider, requests, edit } = vendor();
    edit({ recurrence_rule: 'FREQ=DAILY' });
    const record = await provider.readTask(taskId);
    await expect(provider.updateTask(taskId, { status: 'done' }, {
      operationId: 'operation_recurrence', expectedFingerprint: record.fingerprint,
    })).rejects.toMatchObject({ code: 'external_workflow' });
    expect(requests.some((r) => r.method === 'PATCH')).toBe(false);
  });

  it('preserves over-limit human content as a conflict rather than truncating it', async () => {
    const { provider, edit } = vendor();
    edit({ description: 'x'.repeat(4_001) });
    await expect(provider.readTask(taskId)).rejects.toMatchObject({ state: 'conflict', code: 'external_content_limit', providerId: taskId });
  });

  it('validates IDs and rejects unsupported fields', async () => {
    const { provider, requests } = vendor();
    await expect(provider.readTask('../../users/me')).rejects.toThrow();
    expect(() => workUpdateSchema.parse({ assignee_id: userId })).toThrow();
    expect(requests).toHaveLength(0);
  });

  it('redacts HTTP error bodies and reports Retry-After without automatic retry', async () => {
    let requests = 0;
    const provider = new AmbiguousWorkProvider({ apiKey: 'test-only-server-secret', fetch: async () => {
      requests++;
      return Response.json({ error: 'sensitive remote diagnostic test-only-server-secret' }, { status: 429, headers: { 'Retry-After': '30' } });
    } });
    try {
      await provider.readTask(taskId);
      throw new Error('Expected rate limit');
    } catch (error) {
      expect(error).toMatchObject({ code: 'provider_http_429', state: 'failed', retryAfterSeconds: 30 });
      expect(String(error)).not.toContain('test-only-server-secret');
      expect(String(error)).not.toContain('sensitive remote diagnostic');
    }
    expect(requests).toBe(1);
  });
});

describe('explicit fixture provider', () => {
  const folders: string[] = [];
  afterEach(async () => { await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

  it('persists task records and operation deduplication across provider reopens', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mission-provider-test-'));
    folders.push(directory);
    const filename = join(directory, 'provider.json');
    const provider = new FixtureWorkProvider(new FileFixtureRepository(filename), clock);
    const first = await provider.createTask({ title: 'Persistent fixture' }, { operationId: 'persistent_operation01' });
    const reopened = new FixtureWorkProvider(new FileFixtureRepository(filename), clock);
    const replay = await reopened.createTask({ title: 'Persistent fixture' }, { operationId: 'persistent_operation01' });
    expect(replay.id).toBe(first.id);
    expect((await reopened.readTask(first.id)).title).toBe('Persistent fixture');
    expect(replay.mode).toBe('fixture');
  });

  it('rejects idempotency-key reuse with altered payloads', async () => {
    const provider = new FixtureWorkProvider(new MemoryFixtureRepository(), clock);
    await provider.createTask({ title: 'First' }, { operationId: 'one_operation01' });
    await expect(provider.createTask({ title: 'Changed' }, { operationId: 'one_operation01' })).rejects.toMatchObject({ state: 'conflict' });
  });

  it('enforces conditional fixture updates and preserves unrelated fields', async () => {
    const provider = new FixtureWorkProvider(new MemoryFixtureRepository(), clock);
    const original = await provider.createTask({ title: 'Before', status: 'in_progress', description: 'Keep' }, { operationId: 'fixture_create01' });
    const changed = await provider.updateTask(original.id, { title: 'After' }, { operationId: 'fixture_update01', expectedFingerprint: original.fingerprint });
    expect(changed).toMatchObject({ title: 'After', status: 'in_progress', description: 'Keep' });
    await expect(provider.updateTask(original.id, { status: 'done' }, { operationId: 'fixture_update02', expectedFingerprint: original.fingerprint })).rejects.toMatchObject({ state: 'conflict' });
  });
});
