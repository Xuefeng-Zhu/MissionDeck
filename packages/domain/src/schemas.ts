import { z } from 'zod';

export const idSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
export const timestampSchema = z.string().datetime({ offset: true });
const shortText = z.string().trim().min(1).max(500);
export const lifecycleSchema = z.enum(['draft', 'active', 'completed', 'archived']);
export const healthSchema = z.enum(['on_track', 'at_risk', 'blocked', 'unknown']);
export const verificationStateSchema = z.enum(['needs_verification', 'reported_complete', 'verified']);
export const syncStateSchema = z.enum(['pending', 'synced', 'failed', 'conflict', 'outcome_unknown']);

export const missionContractSchema = z.object({
  confirmed: z.boolean(),
  outcome: shortText,
  constraints: z.array(shortText).max(40),
  forbiddenActions: z.array(shortText).max(40),
  humanOwner: idSchema,
  approvedCapabilities: z.array(shortText).max(20),
  assumptions: z.array(shortText).max(40),
  unresolvedQuestions: z.array(shortText).max(40),
}).strict();

export const criterionSchema = z.object({
  id: idSchema,
  title: shortText,
  required: z.boolean(),
  verificationMethod: shortText,
  verificationState: verificationStateSchema,
  evidenceIds: z.array(idSchema).max(100),
  attestation: z.object({ actorId: idSchema, timestamp: timestampSchema, statement: shortText }).strict().optional(),
}).strict();

export const providerMappingSchema = z.object({
  id: z.string().min(1).max(300),
  url: z.string().url().max(2000).optional(),
  fingerprint: z.string().max(200).optional(),
  observedStatus: z.enum(['todo','in_progress','done','cancelled','blocked']).optional(),
  state: syncStateSchema,
  lastSyncedAt: timestampSchema.optional(),
  error: z.string().max(2000).optional(),
}).strict();

export const taskSchema = z.object({
  id: idSchema,
  title: shortText,
  description: z.string().max(4000),
  status: z.enum(['todo', 'in_progress', 'blocked', 'reported_complete']),
  executor: z.enum(['human', 'agent']),
  ownerId: idSchema.optional(),
  dependencies: z.array(idSchema).max(100),
  criterionIds: z.array(idSchema).max(100),
  remainingMinutes: z.number().int().min(0).max(525600).nullable(),
  optional: z.boolean(),
  deferred: z.boolean(),
  completionEvidence: z.string().min(1).max(2000),
  provider: providerMappingSchema.nullable(),
  blocker: z.string().max(2000).optional(),
  suggested: z.boolean().optional(),
}).strict();

export const captureMethodSchema = z.enum(['selection', 'page', 'manual', 'research']);
export const evidenceSchema = z.object({
  id: idSchema,
  sourceUrl: z.string().url().max(2000).nullable(),
  title: shortText,
  excerpt: z.string().trim().min(1).max(20000),
  capturedAt: timestampSchema,
  acceptedAt: timestampSchema,
  captureMethod: captureMethodSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  truncated: z.boolean(),
  retention: z.enum(['excerpt', 'until_mission_deleted']),
  fixture: z.boolean(),
}).strict();

// Patches cannot overwrite record identity or external mappings.
export const taskPatchSchema = taskSchema.omit({ id: true, provider: true }).partial();
export const criterionPatchSchema = criterionSchema.omit({ id: true }).partial();
export const contractPatchSchema = missionContractSchema.partial().extend({
  deadline: timestampSchema.optional(),
  timezone: z.string().min(1).max(100).optional(),
});
export const proposalOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_task'), task: taskSchema }).strict(),
  z.object({ type: z.literal('update_task'), taskId: idSchema, patch: taskPatchSchema }).strict(),
  z.object({ type: z.literal('add_criterion'), criterion: criterionSchema }).strict(),
  z.object({ type: z.literal('update_criterion'), criterionId: idSchema, patch: criterionPatchSchema }).strict(),
  z.object({ type: z.literal('update_contract'), patch: contractPatchSchema }).strict(),
]);
export const proposalSchema = z.object({
  id: idSchema,
  kind: z.enum(['plan', 'requirement', 'recovery', 'contract']),
  title: shortText,
  baseRevision: z.number().int().nonnegative(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  operations: z.array(proposalOperationSchema).min(1).max(100),
  rationale: z.string().min(1).max(5000),
  affectedRecordIds: z.array(idSchema).max(200),
  evidenceIds: z.array(idSchema).max(100),
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  state: z.enum(['pending', 'approved', 'rejected', 'stale']),
  scheduleNote: z.string().max(2000).optional(),
}).strict();

export const approvalSchema = z.object({
  id: idSchema,
  actorId: idSchema,
  proposalId: idSchema,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  timestamp: timestampSchema,
}).strict();

export const operationRecordSchema = z.object({
  id: idSchema,
  idempotencyKey: idSchema,
  proposalId: idSchema,
  taskId: idSchema,
  kind: z.enum(['create', 'update', 'research']),
  state: syncStateSchema,
  attempts: z.array(z.object({ timestamp: timestampSchema, outcome: z.string().max(2000) }).strict()).max(20),
  result: z.string().max(4000).nullable(),
  reconciliation: z.enum(['not_needed', 'required', 'reconciled', 'unavailable']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();

export const artifactSchema = z.object({
  id: idSchema,
  title: shortText,
  content: z.string().max(50000),
  evidenceIds: z.array(idSchema).max(100),
  reviewState: z.enum(['needs_review', 'accepted', 'rejected']),
  createdAt: timestampSchema,
  sourceUrls: z.array(z.string().url()).max(20),
}).strict();

export const auditEventSchema = z.object({
  id: idSchema,
  actorId: idSchema,
  type: z.string().min(1).max(120),
  timestamp: timestampSchema,
  relevantIds: z.array(idSchema).max(200),
  summary: z.string().min(1).max(2000),
}).strict();

export const missionSchema = z.object({
  id: idSchema,
  ownerId: idSchema,
  workspaceId: idSchema,
  goal: shortText,
  deadline: timestampSchema,
  timezone: z.string().min(1).max(100),
  lifecycle: lifecycleSchema,
  health: healthSchema,
  revision: z.number().int().nonnegative(),
  contract: missionContractSchema,
  criteria: z.array(criterionSchema).max(100),
  tasks: z.array(taskSchema).max(200),
  evidence: z.array(evidenceSchema).max(500),
  proposals: z.array(proposalSchema).max(200),
  approvals: z.array(approvalSchema).max(200),
  operations: z.array(operationRecordSchema).max(500),
  artifacts: z.array(artifactSchema).max(100),
  events: z.array(auditEventSchema).max(2000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();

export type Mission = z.infer<typeof missionSchema>;
export type MissionContract = z.infer<typeof missionContractSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Criterion = z.infer<typeof criterionSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type ProposalOperation = z.infer<typeof proposalOperationSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type OperationRecord = z.infer<typeof operationRecordSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type Health = z.infer<typeof healthSchema>;
export type SyncState = z.infer<typeof syncStateSchema>;
