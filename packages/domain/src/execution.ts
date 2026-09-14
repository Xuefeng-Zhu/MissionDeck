import { z } from 'zod';
import { adaptiveSourcesSchema, type AdaptiveState, type AdaptiveActivity, type AdaptiveResult } from './adaptive.js';

export interface ExecutionIdentity { id: string; name: string; kind: 'human' | 'agent' }
export interface ExecutionCapabilities {
  enabled: boolean;
  mode: 'live' | 'fixture';
  modelMode: 'live' | 'fixture';
  blockers: string[];
  humans: ExecutionIdentity[];
  agents: ExecutionIdentity[];
  supportedWork: string;
  adaptive?: { enabled: boolean; blockers: string[]; modelProvider: string; modelName: string };
}
export const executionStartSchema = z.object({
  requestId: z.string().uuid(),
  goal: z.string().trim().min(5).max(500),
  context: z.string().trim().max(20000).default(''),
  humanId: z.string().min(1).max(160),
  agentId: z.string().min(1).max(160),
  maxTasks: z.number().int().min(3).max(12).default(8),
  maxAgentRuns: z.number().int().min(2).max(20).default(8),
  template: z.literal('adaptive_launch').optional(),
  sources: adaptiveSourcesSchema.optional(),
}).strict().refine(value => value.template === 'adaptive_launch' ? !!value.sources?.length && !value.context : !value.sources, 'Adaptive missions require reviewed sources instead of generic context.');
export type ExecutionStart = z.infer<typeof executionStartSchema>;
export type ExecutionStatus = 'planning' | 'running' | 'paused' | 'blocked' | 'needs_review' | 'completed' | 'cancelled';
export type ExecutionTaskStatus = 'queued' | 'running' | 'waiting_human' | 'saving' | 'completed' | 'blocked' | 'failed' | 'outcome_unknown' | 'cancelled';
export interface ExecutionArtifact {
  id: string;
  title: string;
  content: string;
  url: string | null;
  fingerprint: string;
  taskId: string | null;
  kind: 'brief' | 'deliverable' | 'review' | 'summary' | 'verification';
  verifiedAt: string;
  mode: 'live' | 'fixture';
  sourceRevision?: number;
  audienceIds?: string[];
}
export interface ExecutionTask {
  id: string;
  title: string;
  description: string;
  completionCriteria: string[];
  assignee: ExecutionIdentity;
  status: ExecutionTaskStatus;
  dependsOn: string[];
  version: number;
  providerId: string | null;
  providerUrl: string | null;
  providerFingerprint: string | null;
  providerDescription: string | null;
  runId: string | null;
  runStartedAt: string | null;
  runFinishedAt: string | null;
  artifacts: string[];
  lastError: string | null;
  pendingOutput?: { title: string; content: string; summary: string; adaptiveResult?: AdaptiveResult };
  reviewFeedback?: string;
  completionDescription?: string;
  assignmentPending?: boolean;
}
export interface ExecutionEvent { id: string; at: string; message: string; taskId?: string }
export interface ExecutionOperationSummary {
  id: string; kind: string; state: 'running' | 'done' | 'failed' | 'outcome_unknown';
  providerId?: string; error?: string;
}
export interface MissionExecution {
  engine?: 'direct' | 'strands';
  modelProvider?: string;
  modelName?: string;
  adaptive?: AdaptiveState;
  activity?: AdaptiveActivity[];
  missionId: string;
  requestId: string;
  requestHash: string;
  status: ExecutionStatus;
  mode: 'live' | 'fixture';
  modelMode: 'live' | 'fixture';
  goal: string;
  context: string;
  human: ExecutionIdentity;
  agent: ExecutionIdentity;
  summary: string;
  tasks: ExecutionTask[];
  artifacts: ExecutionArtifact[];
  budget: { maxTasks: number; maxAgentRuns: number; agentRuns: number };
  events: ExecutionEvent[];
  operations: ExecutionOperationSummary[];
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  outcomeVerification?: { actorId: string; statement: string; at: string };
  pendingVerification?: { actorId: string; statement: string; at: string };
  authorizedAssignees?: ExecutionIdentity[];
}
