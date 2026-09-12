import { createHash } from 'node:crypto';
import { z } from 'zod';

export const workStatusSchema = z.enum(['todo', 'in_progress', 'done', 'cancelled', 'blocked']);
export type WorkStatus = z.infer<typeof workStatusSchema>;
export const workCreateSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().max(4_000).default(''),
  status: workStatusSchema.default('todo'),
}).strict();
export const workUpdateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(4_000).optional(),
  status: workStatusSchema.optional(),
}).strict().refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  'At least one supported field is required',
);
export type WorkCreate = z.input<typeof workCreateSchema>;
export type WorkUpdate = z.infer<typeof workUpdateSchema>;

export interface ProviderIdentity {
  id: string;
  workspaceId: string;
  displayName: string;
  verified: boolean;
}

export interface ProviderCapabilities {
  mode: 'fixture' | 'live';
  provider: 'fixture' | 'ambiguous';
  schemaVersion: string;
  checkedAt: string;
  create: boolean;
  read: boolean;
  updateFields: Array<'title' | 'description' | 'status'>;
  statuses: WorkStatus[];
  nativeIdempotency: boolean;
  conditionalUpdates: boolean;
  automaticPolling: false;
  writesEnabled: boolean;
  setupRequired: string[];
}

export interface WorkRecord {
  id: string;
  title: string;
  description: string;
  status: WorkStatus;
  fingerprint: string;
  updatedAt: string | null;
  observedAt: string;
  /** Only use a canonical URL actually supplied by the provider. */
  url: string | null;
  mode: 'fixture' | 'live';
}

/** Supported task fields belong to the provider. Everything else stays local. */
export const FIELD_OWNERSHIP = {
  provider: ['title', 'description', 'status', 'providerId', 'providerUpdatedAt'],
  missionControl: [
    'missionId', 'criterionIds', 'dependencies', 'executor', 'remainingMinutes',
    'deadline', 'verification', 'evidence', 'blocker', 'optional', 'deferred',
    'approvals', 'operationLedger', 'syncState', 'lastObservedFingerprint',
  ],
} as const;

export interface WorkProvider {
  readonly mode: 'fixture' | 'live';
  discover(): Promise<ProviderCapabilities>;
  identity(): Promise<ProviderIdentity>;
  createTask(input: WorkCreate, context: { operationId: string }): Promise<WorkRecord>;
  readTask(id: string): Promise<WorkRecord>;
  updateTask(id: string, patch: WorkUpdate, context: {
    operationId: string;
    expectedFingerprint: string;
  }): Promise<WorkRecord>;
}

export type ProviderErrorState = 'failed' | 'conflict' | 'outcome_unknown';
/** Safe to expose message/code; never attach request headers or vendor bodies. */
export class ProviderError extends Error {
  constructor(
    public readonly state: ProviderErrorState,
    public readonly code: string,
    message: string,
    public readonly providerId?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function fingerprint(value: unknown): string {
  function stable(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(stable);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stable(child)]));
    }
    return item;
  }
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function assertOperationId(id: string): void {
  if (!/^[a-zA-Z0-9_-]{8,200}$/.test(id)) {
    throw new ProviderError('failed', 'invalid_operation_id', 'A durable operation ID is required.');
  }
}
