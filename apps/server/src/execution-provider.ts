import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query, Scope } from './database.js';
import { AmbiguousWorkProvider, type AmbiguousOptions } from './providers/ambiguous.js';
import { assertOperationId, fingerprint, ProviderError, workStatusSchema, type WorkStatus } from './providers/types.js';
import { UpgradeStore } from './upgrade-store.js';

export interface ExecutionAssignee { id: string; name: string; kind: 'human' | 'agent' }
export interface ExecutionDiscovery {
  mode: 'fixture' | 'live'; enabled: boolean; blockers: string[];
  humans: ExecutionAssignee[]; agents: ExecutionAssignee[];
}
export interface ExecutionTaskRecord {
  id: string; title: string; description: string; status: WorkStatus;
  assigneeId: string | null; parentTaskId: string | null; fingerprint: string;
  url: string | null; mode: 'fixture' | 'live';
}
export interface ExecutionDocumentRecord {
  id: string; title: string; content: string; fingerprint: string;
  url: string | null; mode: 'fixture' | 'live'; audienceIds: string[];
}
export interface ExecutionTaskInput {
  title: string; description: string; status: WorkStatus; assigneeId: string; parentTaskId?: string;
}
export interface ExecutionTaskPatch { description?: string; status?: WorkStatus; assigneeId?: string }
export interface ExecutionDependency { id: string; taskId: string; dependencyId: string }
export interface ExecutionWorkspaceProvider {
  readonly mode: 'fixture' | 'live';
  discover(): Promise<ExecutionDiscovery>;
  createTask(input: ExecutionTaskInput, operationId: string): Promise<ExecutionTaskRecord>;
  readTask(id: string): Promise<ExecutionTaskRecord>;
  updateTask(id: string, patch: ExecutionTaskPatch, expectedFingerprint: string, operationId: string): Promise<ExecutionTaskRecord>;
  addDependency(taskId: string, dependencyId: string, operationId: string): Promise<ExecutionDependency>;
  readDependency(taskId: string, dependencyId: string): Promise<ExecutionDependency | null>;
  createDocument(input: { title: string; content: string }, operationId: string): Promise<ExecutionDocumentRecord>;
  shareDocument(id: string, audienceIds: string[], operationId: string): Promise<ExecutionDocumentRecord>;
  readDocument(id: string): Promise<ExecutionDocumentRecord>;
}

const uuid = z.string().uuid();
const taskInput = z.object({ title: z.string().trim().min(1).max(255), description: z.string().max(20_000), status: workStatusSchema, assigneeId: z.string().min(1), parentTaskId: z.string().min(1).optional() }).strict();
const taskPatch = taskInput.pick({ description: true, status: true, assigneeId: true }).partial().refine(v => Object.keys(v).length > 0);
const documentInput = z.object({ title: z.string().trim().min(1).max(255), content: z.string().min(1).max(50_000) }).strict();
const nativeTask = z.object({
  id: uuid, title: z.string(), description: z.string().nullable(), status: workStatusSchema,
  assignee_id: uuid.nullable(), parent_task_id: uuid.nullable(), updated_at: z.string(),
  task_status_id: z.string().nullable().optional(), recurrence_rule: z.string().nullable().optional(),
});
const nativeDocument = z.object({
  id: uuid, title: z.string(), type: z.literal('doc'), content: z.string(), visibility: z.literal('restricted'),
  owner_id: uuid, updated_at: z.string().nullable().optional(),
});
const permissionsSchema = z.object({
  data: z.array(z.object({ type: z.enum(['user', 'team', 'guest']), user_id: uuid.nullable().optional(), role: z.string() })),
  total: z.number().int().nonnegative(), has_more: z.literal(false), pending: z.array(z.unknown()),
});
const assigneesSchema = z.object({
  data: z.array(z.object({ id: uuid, display_name: z.string(), type: z.enum(['human', 'agent']) })),
  total: z.number().int().nonnegative(), has_more: z.boolean(),
});

/** Literal text keeps model output intact through Ambiguous's documented ProseMirror import. */
function documentBody(content: string): string {
  return JSON.stringify({ type: 'doc', content: content.split('\n').map(line => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) });
}
function documentText(content: string): string {
  let body: unknown;
  try { body = JSON.parse(content); } catch { return content; }
  const root = z.object({ type: z.literal('doc'), content: z.array(z.unknown()) }).safeParse(body);
  if (!root.success) throw new ProviderError('failed', 'invalid_document', 'The saved document has an unsupported body format.');
  function text(node: unknown): string {
    const v = z.object({ type: z.string(), text: z.string().optional(), content: z.array(z.unknown()).optional() }).parse(node);
    if (v.type === 'text') return v.text ?? '';
    if (v.type === 'hardBreak' || v.type === 'hard_break') return '\n';
    return (v.content ?? []).map(text).join(['doc', 'bulletList', 'orderedList', 'listItem', 'blockquote'].includes(v.type) ? '\n' : '');
  }
  return root.data.content.map(text).join('\n');
}

/** Native assignments, dependencies and documents only. No assistant/coworker dispatch endpoint is reachable. */
export class AmbiguousExecutionProvider implements ExecutionWorkspaceProvider {
  readonly mode = 'live' as const;
  private schemaCheckedAt = 0;
  constructor(private readonly options: AmbiguousOptions) {}

  private async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const publicRead = path === '/api/openapi.json' && method === 'GET';
    const allowed = (path === '/api/openapi.json' && method === 'GET')
      || (path === '/api/users?limit=100' && method === 'GET')
      || (path === '/api/tasks' && method === 'POST')
      || (/^\/api\/tasks\/[0-9a-f-]{36}$/i.test(path) && ['GET', 'PATCH'].includes(method))
      || (/^\/api\/tasks\/[0-9a-f-]{36}\/relations$/i.test(path) && ['GET', 'POST'].includes(method))
      || (path === '/api/documents' && method === 'POST')
      || (/^\/api\/documents\/[0-9a-f-]{36}$/i.test(path) && method === 'GET')
      || (/^\/api\/documents\/[0-9a-f-]{36}\/permissions$/i.test(path) && ['GET', 'POST'].includes(method));
    if (!allowed) throw new ProviderError('failed', 'unsupported_path', 'This execution operation is not supported.');
    if (!publicRead && !this.options.apiKey) throw new ProviderError('failed', 'missing_credentials', 'Set the server Ambiguous API key before using live execution.');
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(`https://app.ambiguous.ai${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(this.options.timeoutMs ?? 12_000),
        headers: { Accept: 'application/json', 'API-Version': '1', ...(!publicRead ? { Authorization: `Bearer ${this.options.apiKey}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new ProviderError(method === 'GET' ? 'failed' : 'outcome_unknown', 'request_unconfirmed', 'Ambiguous did not confirm the request. Inspect an uncertain write before retrying.'); }
    if (!response.ok) throw new ProviderError(method !== 'GET' && response.status >= 500 ? 'outcome_unknown' : 'failed', `provider_http_${response.status}`, `Ambiguous returned HTTP ${response.status}. Live mode remains selected.`);
    try { return await response.json(); }
    catch { throw new ProviderError(method === 'GET' ? 'failed' : 'outcome_unknown', 'invalid_response', 'Ambiguous returned an unreadable response.'); }
  }
  private async identity() {
    const identity = await new AmbiguousWorkProvider(this.options).identity();
    if (!identity.verified) throw new ProviderError('failed', 'identity_unverified', 'The connected Ambiguous user and workspace must match the configured expected IDs.');
    return identity;
  }
  private async assignees(): Promise<ExecutionAssignee[]> {
    const result = assigneesSchema.safeParse(await this.request('/api/users?limit=100'));
    if (!result.success) throw new ProviderError('failed', 'invalid_assignees', 'Ambiguous returned an unrecognized workspace roster.');
    if (result.data.has_more || result.data.total !== result.data.data.length) throw new ProviderError('failed', 'incomplete_assignees', 'This workspace roster exceeds the supported 100-person list. A filtered picker is required before execution.');
    return result.data.data.map(v => ({ id: v.id, name: v.display_name, kind: v.type }));
  }
  private async schema() {
    if (Date.now() - this.schemaCheckedAt < 300_000) return;
    const spec = await this.request('/api/openapi.json') as { paths?: Record<string, any>; components?: { schemas?: Record<string, any> } };
    const resolve = (v: any): any => v?.$ref ? spec.components?.schemas?.[String(v.$ref).split('/').at(-1)!] : v;
    for (const [path, method, fields] of [
      ['/api/tasks', 'post', ['title', 'description', 'status', 'assignee_id', 'parent_task_id']],
      ['/api/tasks/{id}', 'patch', ['description', 'status', 'assignee_id']],
      ['/api/tasks/{id}/relations', 'post', ['target_task_id', 'type']],
      ['/api/documents', 'post', ['type', 'title', 'content', 'visibility']],
      ['/api/documents/{id}/permissions', 'post', ['user_id', 'role']],
    ] as const) {
      const operation = spec.paths?.[path]?.[method];
      const properties = resolve(operation?.requestBody?.content?.['application/json']?.schema)?.properties;
      if (!fields.every(f => properties?.[f])) throw new ProviderError('failed', 'schema_changed', 'Ambiguous no longer documents the execution fields this adapter uses. Review the adapter before launching.');
    }
    for (const path of ['/api/users', '/api/tasks/{id}', '/api/tasks/{id}/relations', '/api/documents/{id}', '/api/documents/{id}/permissions']) {
      if (!spec.paths?.[path]?.get) throw new ProviderError('failed', 'schema_changed', 'An Ambiguous execution read-back endpoint is unavailable.');
    }
    this.schemaCheckedAt = Date.now();
  }
  async discover(): Promise<ExecutionDiscovery> {
    try {
      await this.identity(); await this.schema(); const identities = await this.assignees();
      return { mode: this.mode, enabled: true, blockers: [], humans: identities.filter(i => i.kind === 'human'), agents: identities.filter(i => i.kind === 'agent') };
    } catch (e) { return { mode: this.mode, enabled: false, blockers: [e instanceof ProviderError ? e.message : 'Ambiguous execution discovery failed.'], humans: [], agents: [] }; }
  }
  private async beforeWrite(operationId: string, audienceIds: string[] = []) {
    assertOperationId(operationId);
    const identity = await this.identity(); await this.schema();
    if (audienceIds.length) {
      const identities = await this.assignees();
      if (audienceIds.some(id => !identities.some(i => i.id === id))) throw new ProviderError('failed', 'assignee_scope', 'Every assignee and document recipient must be a verified member of this workspace.');
    }
    return identity;
  }
  private task(body: unknown, write = false): ExecutionTaskRecord {
    const parsed = z.object({ task: nativeTask }).safeParse(body);
    if (!parsed.success) {
      const acceptedId = z.object({ task: z.object({ id: uuid }) }).safeParse(body);
      throw new ProviderError(write ? 'outcome_unknown' : 'failed', 'invalid_task', 'Ambiguous returned an unverifiable task. Inspect before retrying a write.', acceptedId.success ? acceptedId.data.task.id : undefined);
    }
    const t = parsed.data.task;
    // Verified against the official app's resource notification resolver (2026-09-12).
    return { id: t.id, title: t.title, description: t.description ?? '', status: t.status, assigneeId: t.assignee_id, parentTaskId: t.parent_task_id, fingerprint: fingerprint(t), url: `https://app.ambiguous.ai/tasks?task=${t.id}`, mode: this.mode };
  }
  async readTask(id: string): Promise<ExecutionTaskRecord> {
    uuid.parse(id); await this.identity();
    const record = this.task(await this.request(`/api/tasks/${id}`));
    if (record.id !== id) throw new ProviderError('failed', 'read_id_mismatch', 'Ambiguous returned another task.', id);
    return record;
  }
  private async taskReadback(id: string, wanted: Partial<ExecutionTaskRecord>): Promise<ExecutionTaskRecord> {
    try {
      const record = await this.readTask(id);
      if (Object.entries(wanted).some(([key, value]) => record[key as keyof ExecutionTaskRecord] !== value)) throw new Error('Fields differ');
      return record;
    } catch { throw new ProviderError('outcome_unknown', 'readback_unconfirmed', 'The task write returned an ID but its saved fields were not confirmed. Read this ID again before retrying.', id); }
  }
  async createTask(input: ExecutionTaskInput, operationId: string): Promise<ExecutionTaskRecord> {
    const value = taskInput.parse(input); uuid.parse(value.assigneeId); if (value.parentTaskId) uuid.parse(value.parentTaskId);
    await this.beforeWrite(operationId, [value.assigneeId]);
    const result = this.task(await this.request('/api/tasks', 'POST', { title: value.title, description: value.description, status: value.status, assignee_id: value.assigneeId, ...(value.parentTaskId ? { parent_task_id: value.parentTaskId } : {}) }), true);
    return this.taskReadback(result.id, { title: value.title, description: value.description, status: value.status, assigneeId: value.assigneeId, parentTaskId: value.parentTaskId ?? null });
  }
  async updateTask(id: string, patch: ExecutionTaskPatch, expectedFingerprint: string, operationId: string): Promise<ExecutionTaskRecord> {
    uuid.parse(id); const value = taskPatch.parse(patch); if (value.assigneeId) uuid.parse(value.assigneeId);
    await this.beforeWrite(operationId, value.assigneeId ? [value.assigneeId] : []);
    const raw = await this.request(`/api/tasks/${id}`); const current = this.task(raw);
    if (current.id !== id || current.fingerprint !== expectedFingerprint) throw new ProviderError('conflict', 'external_edit', 'The task changed in Ambiguous. Human edits were preserved.', id);
    const parsed = z.object({ task: nativeTask }).parse(raw).task;
    if (value.status && (parsed.task_status_id || parsed.recurrence_rule)) throw new ProviderError('conflict', 'external_workflow', 'Review this recurring task or custom status in Ambiguous before changing its status.', id);
    try {
      const result = this.task(await this.request(`/api/tasks/${id}`, 'PATCH', { ...(value.description !== undefined ? { description: value.description } : {}), ...(value.status ? { status: value.status } : {}), ...(value.assigneeId ? { assignee_id: value.assigneeId } : {}) }), true);
      if (result.id !== id) throw new ProviderError('outcome_unknown', 'write_id_mismatch', 'Ambiguous returned a different task after an update.', id);
    } catch (e) { if (e instanceof ProviderError && e.state === 'outcome_unknown') throw new ProviderError(e.state, e.code, e.message, id); throw e; }
    return this.taskReadback(id, value);
  }
  async addDependency(taskId: string, dependencyId: string, operationId: string): Promise<ExecutionDependency> {
    uuid.parse(taskId); uuid.parse(dependencyId);
    if (taskId === dependencyId) throw new ProviderError('failed', 'self_dependency', 'A task cannot depend on itself.');
    await this.beforeWrite(operationId);
    const existing = await this.readDependency(taskId, dependencyId);
    if (existing) return existing;
    await this.request(`/api/tasks/${taskId}/relations`, 'POST', { target_task_id: dependencyId, type: 'blocked_by' });
    try { const observed = await this.readDependency(taskId, dependencyId); if (!observed) throw new Error('Absent'); return observed; }
    catch { throw new ProviderError('outcome_unknown', 'readback_unconfirmed', 'The dependency write was accepted but its edge was not confirmed. Inspect the task before retrying.', taskId); }
  }
  async readDependency(taskId: string, dependencyId: string): Promise<ExecutionDependency | null> {
    uuid.parse(taskId); uuid.parse(dependencyId); await this.identity();
    const schema = z.object({ data: z.array(z.object({ id: uuid, source_task_id: uuid, target_task_id: uuid, type: z.string() })), total: z.number().int().nonnegative(), has_more: z.boolean() });
    const list = schema.safeParse(await this.request(`/api/tasks/${taskId}/relations`));
    if (!list.success) throw new ProviderError('failed', 'invalid_dependencies', 'Ambiguous returned an unrecognized dependency list.', taskId);
    if (list.data.has_more || list.data.total !== list.data.data.length) throw new ProviderError('failed', 'incomplete_dependencies', 'The complete dependency graph could not be read.', taskId);
    const edge = list.data.data.find(r => r.source_task_id === taskId && r.target_task_id === dependencyId && r.type === 'blocked_by');
    return edge ? { id: edge.id, taskId, dependencyId } : null;
  }
  private async document(id: string): Promise<{ record: ExecutionDocumentRecord; ownerId: string }> {
    const raw = nativeDocument.safeParse(await this.request(`/api/documents/${id}`));
    if (!raw.success || raw.data.id !== id) throw new ProviderError('failed', 'invalid_document', 'The document is not a verified restricted Ambiguous document.', id);
    const permissions = permissionsSchema.safeParse(await this.request(`/api/documents/${id}/permissions`));
    if (!permissions.success || permissions.data.total !== permissions.data.data.length || permissions.data.pending.length || permissions.data.data.some(p => p.type !== 'user' || !p.user_id)) throw new ProviderError('failed', 'audience_unverified', 'The document has an incomplete or broader audience. Review it in Ambiguous.', id);
    const doc = raw.data;
    // The official router and canonical resource resolver both use /docs/:id.
    return { ownerId: doc.owner_id, record: { id: doc.id, title: doc.title, content: documentText(doc.content), fingerprint: fingerprint({ document: doc, permissions: permissions.data.data }), url: `https://app.ambiguous.ai/docs/${doc.id}`, mode: this.mode, audienceIds: [...new Set([doc.owner_id, ...permissions.data.data.map(p => p.user_id!)])].sort() } };
  }
  async readDocument(id: string): Promise<ExecutionDocumentRecord> {
    uuid.parse(id); await this.identity(); return (await this.document(id)).record;
  }
  async createDocument(input: { title: string; content: string }, operationId: string): Promise<ExecutionDocumentRecord> {
    const value = documentInput.parse(input); const identity = await this.beforeWrite(operationId);
    const accepted = await this.request('/api/documents', 'POST', { type: 'doc', title: value.title, content: documentBody(value.content), visibility: 'restricted' });
    const id = z.object({ id: uuid }).safeParse(accepted);
    if (!id.success) throw new ProviderError('outcome_unknown', 'invalid_write_response', 'Document creation returned no verifiable ID. Inspect the workspace before retrying.');
    try {
      const doc = await this.document(id.data.id);
      if (doc.ownerId !== identity.id || doc.record.title !== value.title || doc.record.content !== value.content || doc.record.audienceIds.some(p => p !== identity.id)) throw new Error('Saved document differs');
      return doc.record;
    } catch { throw new ProviderError('outcome_unknown', 'readback_unconfirmed', 'Document creation returned an ID but its saved content and audience were not confirmed.', id.data.id); }
  }
  async shareDocument(id: string, audienceIds: string[], operationId: string): Promise<ExecutionDocumentRecord> {
    uuid.parse(id); z.array(uuid).max(100).parse(audienceIds);
    const identity = await this.beforeWrite(operationId, audienceIds);
    const allowed = new Set([identity.id, ...audienceIds]); const before = await this.document(id);
    if (before.ownerId !== identity.id || before.record.audienceIds.some(p => !allowed.has(p))) throw new ProviderError('conflict', 'audience_changed', 'This document is not owned by the connected identity or already has additional recipients. Its sharing was preserved.', id);
    let wrote = false;
    try {
      for (const userId of allowed) {
        if (before.record.audienceIds.includes(userId)) continue;
        // Workspace members only. No external invites, teams, public links or ownership transfer.
        wrote = true;
        await this.request(`/api/documents/${id}/permissions`, 'POST', { user_id: userId, role: 'editor' });
      }
      const after = await this.document(id);
      if (after.record.content !== before.record.content || after.record.title !== before.record.title || after.record.audienceIds.length !== allowed.size || after.record.audienceIds.some(p => !allowed.has(p))) throw new Error('Audience differs');
      return after.record;
    } catch (e) { if (wrote) throw new ProviderError('outcome_unknown', 'sharing_unconfirmed', 'Document sharing may be partially applied. Read this document and its permissions before retrying.', id); throw e; }
  }
}

/** Explicit fixture workspace backed by the existing scoped database, including operation deduplication. */
export class FixtureExecutionProvider implements ExecutionWorkspaceProvider {
  readonly mode = 'fixture' as const;
  constructor(private readonly store: UpgradeStore, private readonly scope: Scope) {}
  async discover(): Promise<ExecutionDiscovery> {
    return { mode: this.mode, enabled: true, blockers: [], humans: [{ id: 'fixture-human', name: 'You (fixture)', kind: 'human' }], agents: [{ id: 'fixture-agent', name: 'Drafting agent (fixture)', kind: 'agent' }] };
  }
  private async knownAudience(ids: string[]) {
    const roster = await this.discover();
    if (ids.some(id => ![...roster.humans, ...roster.agents].some(i => i.id === id))) throw new ProviderError('failed', 'assignee_scope', 'The fixture assignee is not in this workspace.');
  }
  private async operation<T>(operationId: string, input: unknown, work: (q: Query) => Promise<T>): Promise<T> {
    assertOperationId(operationId);
    return this.store.db.transaction(async q => {
      const key = `fixture-execution-op-${operationId}`; const hash = fingerprint(input);
      const rows = await q<{ data: { hash: string; result: T } }>('SELECT data FROM upgrade_records WHERE id=$1 AND kind=$2 AND owner_id=$3 AND workspace_id=$4', [key, 'fixture_execution_operation', this.scope.ownerId, this.scope.workspaceId]);
      if (rows.rows[0]) {
        if (rows.rows[0].data.hash !== hash) throw new ProviderError('conflict', 'idempotency_conflict', 'This operation ID was used for different fields.');
        return rows.rows[0].data.result;
      }
      const result = await work(q);
      await this.store.save({ id: key, kind: 'fixture_execution_operation', revision: 1, data: { hash, result } }, this.scope, q);
      return result;
    });
  }
  async createTask(input: ExecutionTaskInput, operationId: string): Promise<ExecutionTaskRecord> {
    const value = taskInput.parse(input); await this.knownAudience([value.assigneeId]);
    return this.operation(operationId, { createTask: value }, async q => {
      if (value.parentTaskId) await this.store.get(value.parentTaskId, 'fixture_execution_task', this.scope, q);
      const record: ExecutionTaskRecord = { ...value, id: `fixture-${randomUUID()}`, parentTaskId: value.parentTaskId ?? null, mode: this.mode, url: null, fingerprint: '' };
      record.fingerprint = fingerprint({ ...record, fingerprint: undefined });
      await this.store.save({ id: record.id, kind: 'fixture_execution_task', revision: 1, data: record }, this.scope, q); return record;
    });
  }
  async readTask(id: string): Promise<ExecutionTaskRecord> { return (await this.store.get<ExecutionTaskRecord>(id, 'fixture_execution_task', this.scope)).data; }
  async updateTask(id: string, patch: ExecutionTaskPatch, expectedFingerprint: string, operationId: string): Promise<ExecutionTaskRecord> {
    const value = taskPatch.parse(patch); if (value.assigneeId) await this.knownAudience([value.assigneeId]);
    return this.operation(operationId, { id, patch: value, expectedFingerprint }, async q => {
      const prior = await this.store.get<ExecutionTaskRecord>(id, 'fixture_execution_task', this.scope, q);
      if (prior.data.fingerprint !== expectedFingerprint) throw new ProviderError('conflict', 'external_edit', 'This task changed. Refresh its current fields before updating.', id);
      const record = { ...prior.data, ...value }; record.fingerprint = fingerprint({ ...record, fingerprint: undefined });
      await this.store.save({ ...prior, revision: prior.revision + 1, data: record }, this.scope, q); return record;
    });
  }
  async addDependency(taskId: string, dependencyId: string, operationId: string): Promise<ExecutionDependency> {
    if (taskId === dependencyId) throw new ProviderError('failed', 'self_dependency', 'A task cannot depend on itself.');
    return this.operation(operationId, { taskId, dependencyId }, async q => {
      await this.store.get(taskId, 'fixture_execution_task', this.scope, q); await this.store.get(dependencyId, 'fixture_execution_task', this.scope, q);
      const record = { id: `fixture-${randomUUID()}`, taskId, dependencyId };
      await this.store.save({ id: record.id, kind: 'fixture_execution_dependency', revision: 1, data: record }, this.scope, q); return record;
    });
  }
  async readDependency(taskId: string, dependencyId: string): Promise<ExecutionDependency | null> {
    await this.readTask(taskId); await this.readTask(dependencyId);
    const result = await this.store.db.query<{ data: ExecutionDependency }>("SELECT data FROM upgrade_records WHERE kind='fixture_execution_dependency' AND owner_id=$1 AND workspace_id=$2 AND data->>'taskId'=$3 AND data->>'dependencyId'=$4 LIMIT 1", [this.scope.ownerId, this.scope.workspaceId, taskId, dependencyId]);
    return result.rows[0]?.data ?? null;
  }
  async createDocument(input: { title: string; content: string }, operationId: string): Promise<ExecutionDocumentRecord> {
    const value = documentInput.parse(input);
    return this.operation(operationId, { createDocument: value }, async q => {
      const record: ExecutionDocumentRecord = { ...value, id: `fixture-${randomUUID()}`, mode: this.mode, url: null, fingerprint: '', audienceIds: ['fixture-human'] };
      record.fingerprint = fingerprint({ ...record, fingerprint: undefined });
      await this.store.save({ id: record.id, kind: 'fixture_execution_document', revision: 1, data: record }, this.scope, q); return record;
    });
  }
  async readDocument(id: string): Promise<ExecutionDocumentRecord> { return (await this.store.get<ExecutionDocumentRecord>(id, 'fixture_execution_document', this.scope)).data; }
  async shareDocument(id: string, audienceIds: string[], operationId: string): Promise<ExecutionDocumentRecord> {
    await this.knownAudience(audienceIds);
    return this.operation(operationId, { id, audienceIds }, async q => {
      const prior = await this.store.get<ExecutionDocumentRecord>(id, 'fixture_execution_document', this.scope, q);
      const allowed = [...new Set(['fixture-human', ...audienceIds])].sort();
      if (prior.data.audienceIds.some(p => !allowed.includes(p))) throw new ProviderError('conflict', 'audience_changed', 'The fixture document already has additional recipients.', id);
      const record = { ...prior.data, audienceIds: allowed }; record.fingerprint = fingerprint({ ...record, fingerprint: undefined });
      await this.store.save({ ...prior, revision: prior.revision + 1, data: record }, this.scope, q); return record;
    });
  }
}
