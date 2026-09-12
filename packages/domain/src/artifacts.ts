import { z } from 'zod';

export const workspaceAppSchema = z.enum(['docs', 'sheets', 'slides', 'mail', 'chat', 'calendar', 'tasks', 'automations', 'assistant']);
export type WorkspaceApp = z.infer<typeof workspaceAppSchema>;
const text = z.string().max(50_000);
const id = z.string().min(1).max(200);
export const artifactOperationSchema = z.object({
  id, app: workspaceAppSchema, action: z.enum(['create', 'update', 'prepare', 'send', 'invite']),
  title: z.string().min(1).max(255), content: text,
  targetId: id.optional(), expectedFingerprint: id.optional(), beforeContent: text.optional(),
  sourceSnapshotIds: z.array(id).max(20), dependsOn: z.array(id).max(20).default([]),
  audience: z.array(z.string().min(1).max(320)).max(100).default([]),
  replacementApproved: z.boolean().default(false),
  cells: z.array(z.object({ row: z.number().int().nonnegative(), column: id, value: text, rowKey: id }).strict()).max(200).optional(),
  threadId: z.string().uuid().optional(),
  slideIndex: z.number().int().nonnegative().optional(),
  startAt: z.iso.datetime().optional(), endAt: z.iso.datetime().optional(), timezone: z.string().max(100).optional(),
  verification: z.literal('read_back').default('read_back'),
}).strict().superRefine((op,ctx)=>{
  if(op.action==='update' && (!op.targetId || !op.expectedFingerprint)) ctx.addIssue({code:'custom',message:'Updates require a selected target and reviewed fingerprint.'});
  if(['send','invite'].includes(op.action) && !op.audience.length) ctx.addIssue({code:'custom',message:'Communications require an explicit audience.'});
  if(op.app==='calendar' && (!op.startAt || !op.endAt || !op.timezone || Date.parse(op.endAt)<=Date.parse(op.startAt))) ctx.addIssue({code:'custom',message:'Calendar proposals require ordered times and an explicit timezone.'});
});
export type ArtifactOperation = z.infer<typeof artifactOperationSchema>;
export const artifactPlanSchema = z.object({
  id, missionId: id, missionRevision: z.number().int().nonnegative(), outcome: text,
  sourceSnapshots: z.array(z.object({ snapshotId:id, contentHash:id, audience:z.array(z.string()).max(100) }).strict()).max(20),
  operations: z.array(artifactOperationSchema).min(1).max(30),
  createdAt: z.iso.datetime(),
}).strict().superRefine((plan,ctx)=>{
  const seen=new Set<string>(); const sources=new Set(plan.sourceSnapshots.map(s=>s.snapshotId));
  for(const op of plan.operations){
    if(seen.has(op.id) || op.dependsOn.some(d=>!seen.has(d))) ctx.addIssue({code:'custom',message:'Operations need unique IDs and earlier dependencies.'});
    seen.add(op.id);
    if(op.sourceSnapshotIds.some(s=>!sources.has(s))) ctx.addIssue({code:'custom',message:'An operation references an unreviewed source.'});
  }
});
export type ArtifactPlan = z.infer<typeof artifactPlanSchema>;
export interface WorkspaceArtifact {
  id: string; app: WorkspaceApp; title: string; content: string; fingerprint: string;
  url: string|null; mode:'live'|'fixture'; verifiedAt:string|null;
  state:'proposal'|'accepted'|'verified'|'conflict'|'outcome_unknown'|'failed';
}
/** Literal source strings stay literal. Never guess missing values or emit executable formulas. */
export function literalSpreadsheetValue(value:string):string { return value; }
