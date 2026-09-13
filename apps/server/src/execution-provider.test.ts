import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AmbiguousExecutionProvider, FixtureExecutionProvider } from './execution-provider.js';
import { openDatabase, type Database } from './database.js';
import { UpgradeStore } from './upgrade-store.js';

const user = '00000000-0000-4000-8000-000000000001';
const agent = '00000000-0000-4000-8000-000000000002';
const workspace = '00000000-0000-4000-8000-000000000003';
const taskId = '00000000-0000-4000-8000-000000000004';
const documentId = '00000000-0000-4000-8000-000000000005';
const other = '00000000-0000-4000-8000-000000000006';
const relationId = '00000000-0000-4000-8000-000000000007';
const fields = (names: string[]) => ({ requestBody: { content: { 'application/json': { schema: { properties: Object.fromEntries(names.map(n => [n, {}])) } } } } });
// Contract fields checked against the public OpenAPI on 2026-09-12. No live writes in tests.
const spec = { paths: {
  '/api/users': { get: {} },
  '/api/tasks': { post: fields(['title', 'description', 'status', 'assignee_id', 'parent_task_id']) },
  '/api/tasks/{id}': { get: {}, patch: fields(['description', 'status', 'assignee_id']) },
  '/api/tasks/{id}/relations': { get: {}, post: fields(['target_task_id', 'type']) },
  '/api/documents': { post: fields(['title', 'type', 'content', 'visibility']) },
  '/api/documents/{id}': { get: {} },
  '/api/documents/{id}/permissions': { get: {}, post: fields(['user_id', 'role']) },
} };
function live(options: { afterWrite?: (kind: string, state: ReturnType<typeof stateFactory>) => void } = {}) {
  const state = stateFactory();
  const request = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    const path = new URL(String(url)).pathname; const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === '/api/users/me') return Response.json({ id: state.identityId, workspace_id: workspace, display_name: 'Owner' });
    if (path === '/api/openapi.json') return Response.json(spec);
    if (path === '/api/users') return Response.json({ data: [{ id: user, display_name: 'Owner', type: 'human' }, { id: agent, display_name: 'Agent', type: 'agent' }], total: 2, has_more: state.incompleteRoster });
    if (path === '/api/tasks' && method === 'POST') {
      state.task = { ...state.task, ...body }; options.afterWrite?.('task', state); return Response.json({ task: state.task }, { status: 201 });
    }
    if (path === `/api/tasks/${taskId}`) {
      if (method === 'PATCH') { state.task = { ...state.task, ...body }; options.afterWrite?.('task', state); }
      return Response.json({ task: state.task });
    }
    if (path === `/api/tasks/${taskId}/relations`) {
      if (method === 'POST') { state.relations.push({ id: relationId, source_task_id: taskId, target_task_id: body.target_task_id, type: body.type }); options.afterWrite?.('dependency', state); }
      return Response.json({ data: state.relations, has_more: false, total: state.relations.length });
    }
    if (path === '/api/documents' && method === 'POST') {
      state.document = { ...state.document, ...body }; options.afterWrite?.('document', state); return Response.json({ ...state.document, import_warnings: [] }, { status: 201 });
    }
    if (path === `/api/documents/${documentId}`) return Response.json(state.document);
    if (path === `/api/documents/${documentId}/permissions`) {
      if (method === 'POST') { state.permissions.push({ type: 'user', user_id: body.user_id, role: body.role }); options.afterWrite?.('sharing', state); }
      return Response.json({ data: state.permissions, total: state.permissions.length, has_more: false, pending: [] });
    }
    throw new Error(`Unreviewed request: ${method} ${path}`);
  });
  const provider = new AmbiguousExecutionProvider({ apiKey: 'test-only', expectedUserId: user, expectedWorkspaceId: workspace, fetch: request });
  return { provider, request, state, writes: () => request.mock.calls.filter(([, init]) => ['POST', 'PATCH'].includes(init?.method ?? '')) };
}
function stateFactory() {
  return {
    identityId: user, incompleteRoster: false,
    task: { id: taskId, title: 'Write brief', description: 'Draft a brief', status: 'todo', assignee_id: agent, parent_task_id: null, updated_at: '2026-09-12T10:00:00Z', recurrence_rule: null as string | null, task_status_id: null as string | null },
    document: { id: documentId, type: 'doc', title: 'Draft', content: '', visibility: 'restricted', owner_id: user },
    permissions: [] as Array<{ type: string; user_id: string; role: string }>,
    relations: [] as Array<{ id: string; source_task_id: string; target_task_id: string; type: string }>,
  };
}
const task = { title: 'Write brief', description: 'Draft a brief', status: 'todo' as const, assigneeId: agent };

describe('Ambiguous mission execution adapter', () => {
  it('discovers the actual human and agent identities without enabling native dispatch', async () => {
    const { provider, writes } = live();
    expect(await provider.discover()).toEqual({ mode: 'live', enabled: true, blockers: [], humans: [{ id: user, name: 'Owner', kind: 'human' }], agents: [{ id: agent, name: 'Agent', kind: 'agent' }] });
    expect(writes()).toHaveLength(0);
  });
  it('creates an actually assigned task and verifies the assignee in read-back', async () => {
    const { provider, writes } = live();
    expect(await provider.createTask(task, 'create-task-1')).toMatchObject({ id: taskId, assigneeId: agent, status: 'todo', parentTaskId: null, mode: 'live', url: `https://app.ambiguous.ai/tasks?task=${taskId}` });
    expect(JSON.parse(String(writes()[0]![1]!.body))).toEqual({ title: task.title, description: task.description, status: 'todo', assignee_id: agent });
  });
  it('retains the task ID when its native assignment does not match', async () => {
    const { provider, writes } = live({ afterWrite: (kind, state) => { if (kind === 'task') state.task.assignee_id = user; } });
    await expect(provider.createTask(task, 'create-task-1')).rejects.toMatchObject({ state: 'outcome_unknown', providerId: taskId });
    expect(writes()).toHaveLength(1);
  });
  it('retains a returned native task ID even when the write response has incomplete fields', async () => {
    const { provider, writes } = live({ afterWrite: (kind, state) => { if (kind === 'task') state.task.updated_at = undefined as unknown as string; } });
    await expect(provider.createTask(task, 'create-task-1')).rejects.toMatchObject({ state: 'outcome_unknown', code: 'invalid_task', providerId: taskId });
    expect(writes()).toHaveLength(1);
  });
  it('rejects unknown assignees before creating anything', async () => {
    const { provider, writes } = live();
    await expect(provider.createTask({ ...task, assigneeId: other }, 'create-task-1')).rejects.toMatchObject({ code: 'assignee_scope' });
    expect(writes()).toHaveLength(0);
  });
  it('rechecks identity after discovery and blocks writes if the identity changes', async () => {
    const { provider, state, writes } = live(); await provider.discover(); state.identityId = other;
    await expect(provider.createTask(task, 'create-task-1')).rejects.toMatchObject({ code: 'identity_unverified' }); expect(writes()).toHaveLength(0);
  });
  it('fails closed when the workspace roster is truncated', async () => {
    const { provider, state, writes } = live(); state.incompleteRoster = true;
    expect(await provider.discover()).toMatchObject({ enabled: false, humans: [], agents: [] });
    await expect(provider.createTask(task, 'create-task-1')).rejects.toMatchObject({ code: 'incomplete_assignees' }); expect(writes()).toHaveLength(0);
  });
  it('preserves human task edits and recurring status workflows', async () => {
    const { provider, state, writes } = live(); const before = await provider.readTask(taskId); state.task.description = 'Human edit';
    await expect(provider.updateTask(taskId, { status: 'done' }, before.fingerprint, 'complete-task')).rejects.toMatchObject({ code: 'external_edit' });
    state.task.recurrence_rule = 'FREQ=DAILY'; const recurring = await provider.readTask(taskId);
    await expect(provider.updateTask(taskId, { status: 'done' }, recurring.fingerprint, 'complete-task')).rejects.toMatchObject({ code: 'external_workflow' }); expect(writes()).toHaveLength(0);
  });
  it('writes actual blocked_by relations once and verifies the saved edge', async () => {
    const { provider, writes } = live();
    expect(await provider.addDependency(taskId, other, 'dependency-1')).toEqual({ id: relationId, taskId, dependencyId: other });
    expect(await provider.addDependency(taskId, other, 'dependency-2')).toEqual({ id: relationId, taskId, dependencyId: other });
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(String(writes()[0]![1]!.body))).toEqual({ target_task_id: other, type: 'blocked_by' });
  });
  it('reconciles only the exact saved blocked_by edge using reads alone', async () => {
    const { provider, state, writes } = live();
    expect(await provider.readDependency(taskId, other)).toBeNull();
    state.relations.push({ id: relationId, source_task_id: taskId, target_task_id: other, type: 'blocking' });
    expect(await provider.readDependency(taskId, other)).toBeNull();
    state.relations[0]!.type = 'blocked_by';
    expect(await provider.readDependency(taskId, other)).toEqual({ id: relationId, taskId, dependencyId: other });
    expect(writes()).toHaveLength(0);
  });
  it('keeps dependency writes unconfirmed when read-back lacks the edge', async () => {
    const { provider, writes } = live({ afterWrite: (kind, state) => { if (kind === 'dependency') state.relations = []; } });
    await expect(provider.addDependency(taskId, other, 'dependency-1')).rejects.toMatchObject({ state: 'outcome_unknown', providerId: taskId }); expect(writes()).toHaveLength(1);
  });
  it('stores all draft text in a native restricted document and grants only selected workspace users access', async () => {
    const { provider, state, writes } = live();
    const content = '# Draft\n\nLiteral <tag>, **bold**, and line\nbreak.';
    const created = await provider.createDocument({ title: 'Mission draft', content }, 'document-1');
    expect(created).toMatchObject({ id: documentId, content, audienceIds: [user], mode: 'live', url: `https://app.ambiguous.ai/docs/${documentId}` });
    const shared = await provider.shareDocument(created.id, [user, agent], 'sharing-1');
    expect(shared.audienceIds).toEqual([user, agent].sort());
    expect(state.permissions).toEqual([{ type: 'user', user_id: agent, role: 'editor' }]);
    expect(writes().map(([url]) => new URL(String(url)).pathname)).toEqual(['/api/documents', `/api/documents/${documentId}/permissions`]);
    await provider.shareDocument(created.id, [user, agent], 'sharing-2'); expect(writes()).toHaveLength(2);
  });
  it('never shares an artifact with an unknown recipient', async () => {
    const { provider, writes } = live(); await provider.createDocument({ title: 'Draft', content: 'Draft text' }, 'document-1');
    await expect(provider.shareDocument(documentId, [other], 'sharing-1')).rejects.toMatchObject({ code: 'assignee_scope' }); expect(writes()).toHaveLength(1);
  });
  it('refuses non-UUID native IDs before building object routes', async () => {
    const { provider, request } = live();
    for (const id of ['../other', 'javascript:alert(1)', 'fixture-local-task']) {
      await expect(provider.readTask(id)).rejects.toThrow();
      await expect(provider.readDocument(id)).rejects.toThrow();
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('retains document IDs when import or audience read-back differs', async () => {
    const { provider, writes } = live({ afterWrite: (kind, state) => { if (kind === 'document') state.document.visibility = 'workspace'; } });
    await expect(provider.createDocument({ title: 'Draft', content: 'Draft text' }, 'document-1')).rejects.toMatchObject({ state: 'outcome_unknown', providerId: documentId }); expect(writes()).toHaveLength(1);
  });
  it('refuses additional existing document recipients without changing their permissions', async () => {
    const { provider, state, writes } = live(); await provider.createDocument({ title: 'Draft', content: 'Draft text' }, 'document-1');
    state.permissions.push({ type: 'user', user_id: other, role: 'editor' });
    await expect(provider.shareDocument(documentId, [agent], 'sharing-1')).rejects.toMatchObject({ code: 'audience_changed' }); expect(writes()).toHaveLength(1);
  });
  it('reports partial sharing without recreating the saved document', async () => {
    const { provider, writes } = live({ afterWrite: (kind, state) => { if (kind === 'sharing') state.permissions = []; } });
    await provider.createDocument({ title: 'Draft', content: 'Draft text' }, 'document-1');
    await expect(provider.shareDocument(documentId, [agent], 'sharing-1')).rejects.toMatchObject({ state: 'outcome_unknown', code: 'sharing_unconfirmed', providerId: documentId }); expect(writes()).toHaveLength(2);
  });
});

describe('persistent fixture mission workspace', () => {
  let db: Database | undefined; let path: string | undefined;
  afterEach(async () => { await db?.close(); db = undefined; if (path) await rm(path, { recursive: true, force: true }); path = undefined; });
  const scope = { ownerId: 'owner', workspaceId: 'workspace' };
  it('survives a database restart with assignments, dependency edges, artifacts and operation deduplication', async () => {
    path = await mkdtemp(join(tmpdir(), 'missiondeck-execution-fixture-')); db = await openDatabase({ path });
    let provider = new FixtureExecutionProvider(new UpgradeStore(db), scope);
    const first = await provider.createTask({ ...task, assigneeId: 'fixture-agent' }, 'first-task');
    const second = await provider.createTask({ ...task, title: 'Review', assigneeId: 'fixture-human' }, 'second-task');
    const dependency = await provider.addDependency(second.id, first.id, 'dependency-1');
    const doc = await provider.createDocument({ title: 'Brief', content: 'Saved draft' }, 'first-doc');
    await provider.shareDocument(doc.id, ['fixture-human', 'fixture-agent'], 'share-doc');
    await db.close(); db = await openDatabase({ path }); provider = new FixtureExecutionProvider(new UpgradeStore(db), scope);
    expect(await provider.readTask(first.id)).toMatchObject({ assigneeId: 'fixture-agent', mode: 'fixture', url: null });
    expect(await provider.readDocument(doc.id)).toMatchObject({ content: 'Saved draft', audienceIds: ['fixture-agent', 'fixture-human'], mode: 'fixture', url: null });
    expect(await provider.createTask({ ...task, assigneeId: 'fixture-agent' }, 'first-task')).toEqual(first);
    expect(await provider.addDependency(second.id, first.id, 'dependency-1')).toEqual(dependency);
    expect(await provider.readDependency(second.id, first.id)).toEqual(dependency);
    expect(await provider.readDependency(first.id, second.id)).toBeNull();
    await expect(provider.createTask({ ...task, title: 'Different', assigneeId: 'fixture-agent' }, 'first-task')).rejects.toMatchObject({ code: 'idempotency_conflict' });
  }, 20_000);
  it('rejects cross-workspace reads and stale task writes', async () => {
    db = await openDatabase({ memory: true }); const store = new UpgradeStore(db); const provider = new FixtureExecutionProvider(store, scope);
    const first = await provider.createTask({ ...task, assigneeId: 'fixture-agent' }, 'first-task');
    await provider.updateTask(first.id, { description: 'Human changed this' }, first.fingerprint, 'first-update');
    await expect(provider.updateTask(first.id, { status: 'done' }, first.fingerprint, 'stale-update')).rejects.toMatchObject({ code: 'external_edit' });
    await expect(new FixtureExecutionProvider(store, { ...scope, ownerId: 'other' }).readTask(first.id)).rejects.toMatchObject({ status: 404 });
  });
});
