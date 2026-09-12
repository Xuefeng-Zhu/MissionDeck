import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  ProviderError, assertOperationId, fingerprint, workCreateSchema, workUpdateSchema,
  type ProviderCapabilities, type ProviderIdentity, type WorkCreate,
  type WorkProvider, type WorkRecord, type WorkUpdate,
} from './types.js';

export interface FixtureState {
  records: Record<string, WorkRecord>;
  operations: Record<string, { inputHash: string; recordId: string }>;
}

/** Inject a durable repository when embedding fixture mode in another process. */
export interface FixtureRepository {
  transact<T>(work: (state: FixtureState) => T): Promise<T>;
}

/** Single-process local-demo store. It is never a substitute for a live failure. */
export class FileFixtureRepository implements FixtureRepository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly filename: string) {}
  transact<T>(work: (state: FixtureState) => T): Promise<T> {
    const next = this.queue.then(async () => {
      let state: FixtureState;
      try {
        state = JSON.parse(await readFile(this.filename, 'utf8')) as FixtureState;
        if (!state.records || !state.operations) throw new Error('Invalid fixture store');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        state = { records: {}, operations: {} };
      }
      const result = work(state);
      await mkdir(dirname(this.filename), { recursive: true });
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await rename(temporary, this.filename);
      return structuredClone(result);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/** Explicit test-only repository; production fixture mode uses a durable store. */
export class MemoryFixtureRepository implements FixtureRepository {
  readonly state: FixtureState = { records: {}, operations: {} };
  async transact<T>(work: (state: FixtureState) => T): Promise<T> {
    const draft = structuredClone(this.state);
    const result = work(draft);
    this.state.records = draft.records;
    this.state.operations = draft.operations;
    return structuredClone(result);
  }
}

export class FixtureWorkProvider implements WorkProvider {
  readonly mode = 'fixture' as const;
  constructor(
    private readonly repository: FixtureRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async discover(): Promise<ProviderCapabilities> {
    return {
      mode: 'fixture', provider: 'fixture', schemaVersion: 'mission-control-fixture-v1',
      checkedAt: this.now().toISOString(), create: true, read: true,
      updateFields: ['title', 'description', 'status'],
      statuses: ['todo', 'in_progress', 'done', 'cancelled', 'blocked'],
      nativeIdempotency: true, conditionalUpdates: true, automaticPolling: false,
      writesEnabled: true,
      setupRequired: ['Fixture records are local simulation. Select live mode and verify an Ambiguous workspace to create real tasks.'],
    };
  }
  async identity(): Promise<ProviderIdentity> {
    return { id: 'fixture-user', workspaceId: 'fixture-workspace', displayName: 'Local fixture workspace', verified: true };
  }
  async createTask(input: WorkCreate, context: { operationId: string }): Promise<WorkRecord> {
    assertOperationId(context.operationId);
    const value = workCreateSchema.parse(input);
    const hash = fingerprint({ create: value });
    const id = await this.repository.transact((state) => {
      const prior = state.operations[context.operationId];
      if (prior) {
        if (prior.inputHash !== hash) throw new ProviderError('conflict', 'idempotency_conflict', 'The operation ID was already used for different fields.');
        return prior.recordId;
      }
      const id = `fixture-${randomUUID()}`;
      const updatedAt = this.now().toISOString();
      state.records[id] = {
        id, ...value, updatedAt, observedAt: updatedAt, mode: 'fixture', url: null,
        fingerprint: fingerprint({ id, ...value, updatedAt }),
      };
      state.operations[context.operationId] = { inputHash: hash, recordId: id };
      return id;
    });
    return this.readTask(id);
  }
  async readTask(id: string): Promise<WorkRecord> {
    return this.repository.transact((state) => {
      const record = state.records[id];
      if (!record) throw new ProviderError('failed', 'not_found', 'The fixture task does not exist.', id);
      return { ...record, observedAt: this.now().toISOString() };
    });
  }
  async updateTask(id: string, patch: WorkUpdate, context: { operationId: string; expectedFingerprint: string }): Promise<WorkRecord> {
    assertOperationId(context.operationId);
    const value = workUpdateSchema.parse(patch);
    const hash = fingerprint({ id, update: value });
    await this.repository.transact((state) => {
      const prior = state.operations[context.operationId];
      if (prior) {
        if (prior.inputHash !== hash || prior.recordId !== id) throw new ProviderError('conflict', 'idempotency_conflict', 'The operation ID was already used for a different update.', id);
        return;
      }
      const record = state.records[id];
      if (!record) throw new ProviderError('failed', 'not_found', 'The fixture task does not exist.', id);
      if (record.fingerprint !== context.expectedFingerprint) throw new ProviderError('conflict', 'external_edit', 'The task changed since this proposal was prepared. Review the current fields.', id);
      const updatedAt = this.now().toISOString();
      const next = { ...record, ...value, updatedAt, observedAt: updatedAt };
      next.fingerprint = fingerprint({ id, title: next.title, description: next.description, status: next.status, updatedAt });
      state.records[id] = next;
      state.operations[context.operationId] = { inputHash: hash, recordId: id };
    });
    return this.readTask(id);
  }
}
