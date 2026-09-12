import { z } from 'zod';
import {
  ProviderError, assertOperationId, fingerprint, workCreateSchema, workStatusSchema,
  workUpdateSchema, type ProviderCapabilities, type ProviderIdentity,
  type WorkCreate, type WorkProvider, type WorkRecord, type WorkUpdate,
} from './types.js';

const ORIGIN = 'https://app.ambiguous.ai';
const uuid = z.string().uuid();
const identitySchema = z.object({
  id: uuid, workspace_id: uuid.nullable(), display_name: z.string(),
  needs_workspace_setup: z.boolean().optional(),
});
const taskSchema = z.object({
  id: uuid, title: z.string(), description: z.string().nullable(),
  status: workStatusSchema, updated_at: z.string().nullable().optional(),
  task_status_id: z.string().nullable().optional(),
  recurrence_rule: z.string().nullable().optional(),
}).passthrough();
type RawTask = z.infer<typeof taskSchema>;
type SchemaObject = Record<string, any>;

export interface AmbiguousOptions {
  apiKey?: string;
  expectedWorkspaceId?: string;
  expectedUserId?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  now?: () => Date;
}

/** REST-only allowlist, deliberately narrower than the vendor's full schema. */
export class AmbiguousWorkProvider implements WorkProvider {
  readonly mode = 'live' as const;
  private readonly requestFetch: typeof globalThis.fetch;
  private readonly now: () => Date;
  private discovery?: ProviderCapabilities;
  constructor(private readonly options: AmbiguousOptions) {
    this.requestFetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  private async request(path: string, method = 'GET', body?: unknown, publicSchema = false): Promise<unknown> {
    const isWrite = method !== 'GET';
    if (!publicSchema && !this.options.apiKey) {
      throw new ProviderError('failed', 'missing_credentials', 'Set AMBIGUOUS_API_KEY on the server using the intended workspace Connect instructions.');
    }
    // No caller-controlled origin, arbitrary path, redirects, or generic HTTP tool.
    if (!['/api/openapi.json', '/api/users/me', '/api/tasks'].includes(path)
      && !/^\/api\/tasks\/[0-9a-f-]{36}$/i.test(path)) {
      throw new ProviderError('failed', 'unsupported_path', 'This provider operation is not supported.');
    }
    let response: Response;
    try {
      response = await this.requestFetch(`${ORIGIN}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(this.options.timeoutMs ?? 12_000),
        headers: {
          Accept: 'application/json', 'API-Version': '1',
          ...(publicSchema ? {} : { Authorization: `Bearer ${this.options.apiKey}` }),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ProviderError(
        isWrite ? 'outcome_unknown' : 'failed', 'request_unconfirmed',
        isWrite
          ? 'Ambiguous did not confirm this write. Inspect the workspace before retrying; a task may already exist.'
          : 'Ambiguous could not be reached. Live mode remains selected; check connectivity and try the read again.',
      );
    }
    if (!response.ok) {
      const retry = Number(response.headers.get('Retry-After'));
      const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : undefined;
      const state = isWrite && response.status >= 500 ? 'outcome_unknown' : 'failed';
      const message = response.status === 401 ? 'Ambiguous rejected the server credential. Check the intended workspace Connect instructions.'
        : response.status === 403 ? 'This Ambiguous identity does not have permission for the operation.'
        : response.status === 429 ? 'Ambiguous rate limited this request. Honor Retry-After before retrying.'
        : `Ambiguous returned HTTP ${response.status}.${state === 'outcome_unknown' ? ' The write outcome is unknown; inspect before retrying.' : ''}`;
      throw new ProviderError(state, `provider_http_${response.status}`, message, undefined, retryAfter);
    }
    try {
      return await response.json();
    } catch {
      throw new ProviderError(isWrite ? 'outcome_unknown' : 'failed', 'invalid_response',
        isWrite ? 'Ambiguous accepted a write but its response could not be read. Inspect the workspace before retrying.' : 'Ambiguous returned an unreadable response.');
    }
  }

  async identity(): Promise<ProviderIdentity> {
    const parsed = identitySchema.safeParse(await this.request('/api/users/me'));
    if (!parsed.success || !parsed.data.workspace_id || parsed.data.needs_workspace_setup) {
      throw new ProviderError('failed', 'identity_unverified', 'The credential did not identify an existing workspace. Use the intended workspace Connect instructions.');
    }
    const user = parsed.data;
    return {
      id: user.id, workspaceId: user.workspace_id!, displayName: user.display_name,
      verified: user.id === this.options.expectedUserId && user.workspace_id === this.options.expectedWorkspaceId,
    };
  }

  async discover(): Promise<ProviderCapabilities> {
    const schema = await this.request('/api/openapi.json', 'GET', undefined, true) as SchemaObject;
    const resolve = (value: SchemaObject | undefined): SchemaObject => {
      if (!value) return {};
      const ref = value.$ref;
      return typeof ref === 'string' && ref.startsWith('#/components/schemas/')
        ? schema.components?.schemas?.[ref.split('/').at(-1)!] ?? {} : value;
    };
    const paths = schema.paths ?? {};
    const create = paths['/api/tasks']?.post;
    const read = paths['/api/tasks/{id}']?.get;
    const update = paths['/api/tasks/{id}']?.patch;
    const createFields = resolve(create?.requestBody?.content?.['application/json']?.schema).properties ?? {};
    const updateFields = resolve(update?.requestBody?.content?.['application/json']?.schema).properties ?? {};
    const currentStatuses: unknown = resolve(updateFields.status).enum;
    const statuses = workStatusSchema.options.filter((status) => Array.isArray(currentStatuses) && currentStatuses.includes(status));
    const supportedFields = (['title', 'description', 'status'] as const).filter((key) => Boolean(updateFields[key]));
    const supportedCreate = Boolean(create && createFields.title && createFields.description && createFields.status);
    const setupRequired: string[] = [];
    if (!this.options.apiKey) setupRequired.push('Set AMBIGUOUS_API_KEY in the server .env from the intended workspace Connect instructions.');
    if (!this.options.expectedWorkspaceId || !this.options.expectedUserId) {
      setupRequired.push('Read the connected identity, then set AMBIGUOUS_EXPECTED_WORKSPACE_ID and AMBIGUOUS_EXPECTED_USER_ID to those reviewed IDs before enabling writes.');
    }
    let verified = false;
    if (this.options.apiKey) {
      const identity = await this.identity();
      verified = identity.verified;
      if (!verified && this.options.expectedWorkspaceId && this.options.expectedUserId) {
        setupRequired.push('The connected identity does not match the configured user and workspace IDs. Writes are disabled.');
      }
    }
    if (!supportedCreate || !read || !update || !statuses.length) setupRequired.push('The current API schema no longer supports the reviewed task operations. Adapter review is required.');
    this.discovery = {
      mode: 'live', provider: 'ambiguous', schemaVersion: String(schema.info?.version ?? 'unknown'),
      checkedAt: this.now().toISOString(), create: supportedCreate, read: Boolean(read),
      updateFields: [...supportedFields], statuses,
      // Task endpoints have no documented idempotency or conditional-write headers.
      // Even if the schema adds them later, enabling them requires adapter review.
      nativeIdempotency: false, conditionalUpdates: false, automaticPolling: false,
      writesEnabled: verified && supportedCreate && Boolean(read && update) && statuses.length > 0,
      setupRequired,
    };
    return this.discovery;
  }

  private async ensureWrite(status?: string): Promise<ProviderCapabilities> {
    const stale = !this.discovery || this.now().getTime() - Date.parse(this.discovery.checkedAt) > 300_000;
    const capability = stale ? await this.discover() : this.discovery!;
    // Revalidate the principal before every write, even while schema is cached.
    const identity = await this.identity();
    if (!capability.writesEnabled || !identity.verified) {
      throw new ProviderError('failed', 'write_identity_unverified', 'Verify the connected Ambiguous user and workspace IDs before enabling task writes.');
    }
    if (status && !capability.statuses.includes(status as any)) {
      throw new ProviderError('failed', 'unsupported_status', 'This status is not present in the current provider schema.');
    }
    return capability;
  }

  private parseTask(body: unknown, isWrite = false): RawTask {
    const wrapped = z.object({ task: taskSchema }).safeParse(body);
    if (!wrapped.success) throw new ProviderError(isWrite ? 'outcome_unknown' : 'failed', 'invalid_task',
      isWrite ? 'Ambiguous accepted a write but did not return a valid task ID. Inspect before retrying.' : 'Ambiguous returned an invalid task record.');
    return wrapped.data.task;
  }

  private record(task: RawTask): WorkRecord {
    if (task.title.length > 255 || (task.description?.length ?? 0) > 4_000) {
      throw new ProviderError('conflict', 'external_content_limit', 'The provider task exceeds the local review limits. Review it in Ambiguous; its content was not truncated or overwritten.', task.id);
    }
    return {
      id: task.id, title: task.title, description: task.description ?? '', status: task.status,
      updatedAt: task.updated_at ?? null, observedAt: this.now().toISOString(),
      // Task schema supplies IDs and task_key, but no canonical URL. Do not invent one.
      url: null, mode: 'live',
      fingerprint: fingerprint({
        id: task.id, title: task.title, description: task.description, status: task.status,
        updated_at: task.updated_at ?? null, task_status_id: task.task_status_id ?? null,
        recurrence_rule: task.recurrence_rule ?? null,
      }),
    };
  }

  async readTask(id: string): Promise<WorkRecord> {
    uuid.parse(id);
    const task = this.parseTask(await this.request(`/api/tasks/${id}`));
    if (task.id !== id) throw new ProviderError('failed', 'read_id_mismatch', 'Ambiguous returned a different task ID than requested.', id);
    return this.record(task);
  }

  private async readBack(id: string, desired: WorkUpdate): Promise<WorkRecord> {
    let record: WorkRecord;
    try { record = await this.readTask(id); }
    catch {
      throw new ProviderError('outcome_unknown', 'readback_unconfirmed', 'Ambiguous returned this task ID but read-back failed. Read this same ID again; do not recreate the task.', id);
    }
    for (const field of ['title', 'description', 'status'] as const) {
      if (desired[field] !== undefined && desired[field] !== record[field]) {
        throw new ProviderError('conflict', 'readback_mismatch', 'The provider read-back differs from the approved fields. Review the record; do not overwrite it automatically.', id);
      }
    }
    return record;
  }

  async createTask(input: WorkCreate, context: { operationId: string }): Promise<WorkRecord> {
    assertOperationId(context.operationId);
    const value = workCreateSchema.parse(input);
    await this.ensureWrite(value.status);
    const task = this.parseTask(await this.request('/api/tasks', 'POST', value), true);
    // Local operation IDs are intentionally not advertised as provider deduplication.
    return this.readBack(task.id, value);
  }

  async updateTask(id: string, patch: WorkUpdate, context: { operationId: string; expectedFingerprint: string }): Promise<WorkRecord> {
    uuid.parse(id);
    assertOperationId(context.operationId);
    const value = workUpdateSchema.parse(patch);
    const capability = await this.ensureWrite(value.status);
    if (Object.keys(value).some((key) => !capability.updateFields.includes(key as any))) {
      throw new ProviderError('failed', 'unsupported_field', 'The current provider schema does not support this update.', id);
    }
    const current = this.parseTask(await this.request(`/api/tasks/${id}`));
    if (current.id !== id || this.record(current).fingerprint !== context.expectedFingerprint) {
      throw new ProviderError('conflict', 'external_edit', 'The Ambiguous task changed since the proposal was prepared. Review the current fields before approving again.', id);
    }
    if (value.status && (current.task_status_id || (current.recurrence_rule && value.status === 'done'))) {
      throw new ProviderError('conflict', 'external_workflow', 'This task has a custom status or recurring completion behavior. Review that workflow in Ambiguous before changing its status.', id);
    }
    try {
      const updated = this.parseTask(await this.request(`/api/tasks/${id}`, 'PATCH', value), true);
      if (updated.id !== id) throw new ProviderError('outcome_unknown', 'write_id_mismatch', 'Ambiguous returned a different ID after the update. Inspect the original task.', id);
    } catch (error) {
      if (error instanceof ProviderError && error.state === 'outcome_unknown' && !error.providerId) {
        throw new ProviderError(error.state, error.code, error.message, id, error.retryAfterSeconds);
      }
      throw error;
    }
    return this.readBack(id, value);
  }
}
