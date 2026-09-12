import { hashPayload } from './capture.js';
import { missionSchema, proposalOperationSchema, type Criterion, type Health, type Mission, type Proposal, type ProposalOperation, type Task } from './schemas.js';

export interface PlanIssue {
  code: 'duplicate_id' | 'missing_dependency' | 'cycle' | 'missing_criterion' | 'uncovered_criterion' | 'deferred_dependency' | 'invalid_effort' | 'unknown_owner';
  message: string;
  recordIds: string[];
}

/** Plans are validated as a complete candidate state before any write is authorized. */
export function validatePlan(mission: Pick<Mission, 'tasks' | 'criteria' | 'ownerId'>): { valid: boolean; issues: PlanIssue[] } {
  const issues: PlanIssue[] = [];
  const tasks = new Map(mission.tasks.map((task) => [task.id, task]));
  const criteria = new Set(mission.criteria.map((criterion) => criterion.id));
  for (const records of [mission.tasks, mission.criteria]) {
    const seen = new Set<string>();
    for (const record of records) {
      if (seen.has(record.id)) issues.push({ code: 'duplicate_id', message: `Duplicate record ID: ${record.id}`, recordIds: [record.id] });
      seen.add(record.id);
    }
  }
  for (const task of mission.tasks) {
    if (task.executor === 'human' && task.ownerId && task.ownerId !== mission.ownerId) issues.push({ code: 'unknown_owner', message: `${task.title} is assigned to an unconfirmed human owner. This MVP supports the mission owner only.`, recordIds: [task.id, task.ownerId] });
    if (task.remainingMinutes !== null && (!Number.isInteger(task.remainingMinutes) || task.remainingMinutes < 0)) issues.push({ code: 'invalid_effort', message: `${task.title} needs a nonnegative whole-minute estimate.`, recordIds: [task.id] });
    for (const dependency of task.dependencies) {
      const parent = tasks.get(dependency);
      if (!parent) issues.push({ code: 'missing_dependency', message: `${task.title} refers to missing dependency ${dependency}.`, recordIds: [task.id, dependency] });
      else if (!task.deferred && parent.deferred && parent.status !== 'reported_complete') issues.push({ code: 'deferred_dependency', message: `${task.title} depends on deferred work: ${parent.title}.`, recordIds: [task.id, parent.id] });
    }
    for (const criterionId of task.criterionIds) {
      if (!criteria.has(criterionId)) issues.push({ code: 'missing_criterion', message: `${task.title} refers to missing criterion ${criterionId}.`, recordIds: [task.id, criterionId] });
    }
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (visiting.has(id)) {
      const cycle = [...path.slice(path.indexOf(id)), id];
      issues.push({ code: 'cycle', message: `Dependency cycle: ${cycle.join(' → ')}`, recordIds: cycle });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of tasks.get(id)?.dependencies ?? []) if (tasks.has(dependency)) visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of mission.tasks) visit(task.id, []);
  for (const criterion of mission.criteria.filter((item) => item.required)) {
    if (!mission.tasks.some((task) => !task.optional && !task.deferred && task.criterionIds.includes(criterion.id))) issues.push({ code: 'uncovered_criterion', message: `Required outcome has no committed task: ${criterion.title}.`, recordIds: [criterion.id] });
  }
  return { valid: issues.length === 0, issues };
}

export interface ScheduleOptions {
  now: string;
  /** Concurrent tasks per explicit human owner; defaults to one. */
  humanConcurrency?: number;
  /** Shared capacity for approved agent work. */
  agentConcurrency?: number;
}

export interface ScheduledTask {
  taskId: string;
  resource: string;
  startAt: string;
  endAt: string;
  startMinutes: number;
  endMinutes: number;
}

export interface ScheduleProjection {
  eta: string | null;
  /** Partial projection for known schedulable work; never presented as a promised ETA. */
  qualifiedEta: string | null;
  feasible: boolean | null;
  scheduled: ScheduledTask[];
  unknownTaskIds: string[];
  blockedTaskIds: string[];
  unresolvedTaskIds: string[];
  assumptions: string[];
  issues: PlanIssue[];
}

export function dependentTaskIds(tasks: Task[], seedIds: string[]): string[] {
  const affected = new Set(seedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) if (!affected.has(task.id) && task.dependencies.some((id) => affected.has(id))) {
      affected.add(task.id);
      changed = true;
    }
  }
  return [...affected];
}

/** Deterministic non-preemptive list scheduling with dependency and executor capacity. */
export function projectSchedule(mission: Mission, options: ScheduleOptions): ScheduleProjection {
  const humanConcurrency = options.humanConcurrency ?? 1, agentConcurrency = options.agentConcurrency ?? 2;
  if (!Number.isInteger(humanConcurrency) || humanConcurrency < 1 || humanConcurrency > 20 || !Number.isInteger(agentConcurrency) || agentConcurrency < 1 || agentConcurrency > 20) throw new Error('Executor capacity must be a whole number between 1 and 20.');
  const start = Date.parse(options.now);
  if (!Number.isFinite(start)) throw new Error('A valid explicit scheduling clock is required.');
  const assumptions = [
    `Continuous availability from ${new Date(start).toISOString()}; working calendars and breaks are not modeled.`,
    `At most ${humanConcurrency} concurrent task${humanConcurrency === 1 ? '' : 's'} per human owner and ${agentConcurrency} across approved agents.`,
    'Remaining effort is a user-editable estimate. Tasks are non-preemptive; ready in-progress work continues before new tasks on the same capacity.',
    'Projections are provisional. Unresolved blockers or unknown effort prevent an exact ETA.',
  ];
  const validation = validatePlan(mission);
  const active = mission.tasks.filter((task) => !task.deferred && task.status !== 'reported_complete');
  const unknownTaskIds = active.filter((task) => task.remainingMinutes === null).map((task) => task.id);
  const blockedTaskIds = active.filter((task) => task.status === 'blocked').map((task) => task.id);
  const unavailable = new Set(dependentTaskIds(active, [...unknownTaskIds, ...blockedTaskIds]));
  const scheduled: ScheduledTask[] = [];
  const endTimes = new Map(mission.tasks.filter((task) => task.status === 'reported_complete').map((task) => [task.id, 0]));
  const resourceSlots = new Map<string, number[]>();
  const pending = active.filter((task) => !unavailable.has(task.id));
  while (pending.length && validation.valid) {
    const candidates = pending.filter((task) => task.dependencies.every((id) => endTimes.has(id))).map((task) => {
      const resource = task.executor === 'human' ? `human:${task.ownerId ?? mission.ownerId}` : 'agent';
      if (!resourceSlots.has(resource)) resourceSlots.set(resource, Array.from({ length: task.executor === 'human' ? humanConcurrency : agentConcurrency }, () => 0));
      const slots = resourceSlots.get(resource)!;
      const slot = slots.indexOf(Math.min(...slots));
      const dependenciesReady = Math.max(0, ...task.dependencies.map((id) => endTimes.get(id)!));
      const startMinutes = Math.max(dependenciesReady, slots[slot]!);
      return { task, resource, slot, startMinutes };
    }).sort((left, right) => left.startMinutes - right.startMinutes || Number(right.task.status === 'in_progress') - Number(left.task.status === 'in_progress') || Number(left.task.optional) - Number(right.task.optional) || mission.tasks.indexOf(left.task) - mission.tasks.indexOf(right.task));
    const next = candidates[0];
    if (!next) break;
    const endMinutes = next.startMinutes + next.task.remainingMinutes!;
    resourceSlots.get(next.resource)![next.slot] = endMinutes;
    endTimes.set(next.task.id, endMinutes);
    scheduled.push({ taskId: next.task.id, resource: next.resource, startMinutes: next.startMinutes, endMinutes, startAt: new Date(start + next.startMinutes * 60_000).toISOString(), endAt: new Date(start + endMinutes * 60_000).toISOString() });
    pending.splice(pending.indexOf(next.task), 1);
  }
  const unresolvedTaskIds = active.filter((task) => !endTimes.has(task.id)).map((task) => task.id);
  const knownMinutes = Math.max(0, ...scheduled.map((task) => task.endMinutes));
  const qualifiedEta = validation.valid ? new Date(start + knownMinutes * 60_000).toISOString() : null;
  const eta = !unresolvedTaskIds.length && validation.valid ? qualifiedEta : null;
  return { eta, qualifiedEta, feasible: eta ? Date.parse(eta) <= Date.parse(mission.deadline) : null, scheduled, unknownTaskIds, blockedTaskIds, unresolvedTaskIds, assumptions, issues: validation.issues };
}

export interface CompletionAssessment {
  allowed: boolean;
  verifiedCriteria: number;
  totalRequired: number;
  missing: { criterionId: string; reason: string }[];
}

export function criterionVerified(criterion: Criterion, mission: Pick<Mission, 'ownerId' | 'evidence'>): boolean {
  if (criterion.verificationState !== 'verified') return false;
  const acceptedIds = new Set(mission.evidence.map((evidence) => evidence.id));
  const evidenceBacked = criterion.evidenceIds.length > 0 && criterion.evidenceIds.every((id) => acceptedIds.has(id));
  const authorizedAttestation = criterion.attestation?.actorId === mission.ownerId && !!criterion.attestation.statement.trim();
  return evidenceBacked || authorizedAttestation;
}

export function canCompleteMission(mission: Mission): CompletionAssessment {
  const required = mission.criteria.filter((criterion) => criterion.required);
  const missing = required.filter((criterion) => !criterionVerified(criterion, mission)).map((criterion) => ({ criterionId: criterion.id, reason: criterion.verificationState === 'reported_complete' ? 'Reported complete still needs verification.' : criterion.verificationState === 'verified' ? 'Verification needs accepted evidence or an authorized human attestation.' : 'Required criterion needs verification.' }));
  return { allowed: mission.contract.confirmed && required.length > 0 && missing.length === 0, verifiedCriteria: required.length - missing.length, totalRequired: required.length, missing };
}

export function assessMissionHealth(mission: Mission, options: ScheduleOptions) {
  const schedule = projectSchedule(mission, options);
  const completion = canCompleteMission(mission);
  const reasons: string[] = [];
  let health: Health;
  if (!schedule.issues.length && completion.allowed) {
    health = 'on_track';
    reasons.push('Every required criterion has verification evidence or an authorized attestation.');
  } else if (schedule.blockedTaskIds.length) {
    health = 'blocked';
    const affected = dependentTaskIds(mission.tasks, schedule.blockedTaskIds);
    const threatened = mission.criteria.filter((criterion) => criterion.required && mission.tasks.some((task) => affected.includes(task.id) && task.criterionIds.includes(criterion.id)));
    reasons.push(`Blocked work affects ${affected.length} task${affected.length === 1 ? '' : 's'}.`);
    if (threatened.length) reasons.push(`Required outcomes threatened: ${threatened.map((criterion) => criterion.title).join(', ')}.`);
    reasons.push('An unresolved blocker prevents a reliable finish time.');
  } else if (schedule.feasible === false) {
    health = 'at_risk';
    reasons.push(`Estimated finish ${schedule.eta} is later than the mission deadline.`);
  } else if (schedule.feasible === null) {
    health = 'unknown';
    reasons.push(...schedule.issues.map((issue) => issue.message));
    if (schedule.unknownTaskIds.length) reasons.push(`${schedule.unknownTaskIds.length} task${schedule.unknownTaskIds.length === 1 ? '' : 's'} need effort estimates.`);
    if (!reasons.length) reasons.push('The current plan does not support a reliable finish estimate.');
  } else if (mission.tasks.length === 0 || !mission.contract.confirmed) {
    health = 'unknown';
    reasons.push('Confirm the contract and approve a covered plan to calculate feasibility.');
  } else {
    health = 'on_track';
    reasons.push('The capacity-aware projection fits the deadline under the displayed availability assumptions.');
  }
  return { health, schedule, verifiedCriteria: completion.verifiedCriteria, totalRequired: completion.totalRequired, reasons };
}

/** Pure candidate transformation; calling this does not constitute approval or authorization. */
export function applyProposalOperations(mission: Mission, rawOperations: ProposalOperation[]): Mission {
  const candidate = structuredClone(mission);
  for (const rawOperation of rawOperations) {
    const operation = proposalOperationSchema.parse(rawOperation);
    switch (operation.type) {
      case 'add_task':
        if (candidate.tasks.some((task) => task.id === operation.task.id)) throw new Error(`Task ${operation.task.id} already exists.`);
        candidate.tasks.push(operation.task);
        break;
      case 'update_task': {
        const index = candidate.tasks.findIndex((task) => task.id === operation.taskId);
        if (index < 0) throw new Error(`Task ${operation.taskId} does not exist.`);
        candidate.tasks[index] = { ...candidate.tasks[index]!, ...operation.patch };
        break;
      }
      case 'add_criterion':
        if (candidate.criteria.some((criterion) => criterion.id === operation.criterion.id)) throw new Error(`Criterion ${operation.criterion.id} already exists.`);
        candidate.criteria.push(operation.criterion);
        break;
      case 'update_criterion': {
        const index = candidate.criteria.findIndex((criterion) => criterion.id === operation.criterionId);
        if (index < 0) throw new Error(`Criterion ${operation.criterionId} does not exist.`);
        candidate.criteria[index] = { ...candidate.criteria[index]!, ...operation.patch };
        break;
      }
      case 'update_contract': {
        const { deadline, timezone, ...patch } = operation.patch;
        candidate.contract = { ...candidate.contract, ...patch };
        if (deadline) candidate.deadline = deadline;
        if (timezone) candidate.timezone = timezone;
        break;
      }
    }
  }
  return missionSchema.parse(candidate);
}

/** Hash all fields that affect what the user is approving, excluding mutable state and the hash itself. */
export function proposalPayload(proposal: Omit<Proposal, 'payloadHash'> | Proposal) {
  const { id, kind, title, baseRevision, operations, rationale, affectedRecordIds, evidenceIds, createdAt, expiresAt, scheduleNote } = proposal;
  return { id, kind, title, baseRevision, operations, rationale, affectedRecordIds, evidenceIds, createdAt, expiresAt, ...(scheduleNote === undefined ? {} : { scheduleNote }) };
}

export function proposalHash(proposal: Omit<Proposal, 'payloadHash'> | Proposal): string {
  return hashPayload(proposalPayload(proposal));
}

export function validateProposal(mission: Mission, proposal: Proposal, now: string): { valid: boolean; reasons: string[]; candidate: Mission | null } {
  const reasons: string[] = [];
  if (proposal.baseRevision !== mission.revision) reasons.push('Proposal is stale: mission revision changed.');
  if (proposal.state !== 'pending') reasons.push('Only pending proposals can be approved.');
  if (!Number.isFinite(Date.parse(now)) || Date.parse(proposal.expiresAt) <= Date.parse(now)) reasons.push('Proposal has expired.');
  if (proposal.payloadHash !== proposalHash(proposal)) reasons.push('Proposal payload changed; a new approval is required.');
  let candidate: Mission | null = null;
  try {
    candidate = applyProposalOperations(mission, proposal.operations);
    if (proposal.kind !== 'contract') reasons.push(...validatePlan(candidate).issues.map((issue) => issue.message));
    if (proposal.kind !== 'contract') {
      for (const criterion of mission.criteria.filter((item) => item.required)) if (!candidate.criteria.find((item) => item.id === criterion.id)?.required) reasons.push('A plan, requirement, or recovery proposal cannot downgrade a required outcome. Edit the mission contract explicitly.');
    }
    if (proposal.kind === 'recovery') {
      for (const task of mission.tasks) {
        const updated = candidate.tasks.find((item) => item.id === task.id)!;
        if (!task.optional && updated.deferred) reasons.push('Recovery cannot defer required work.');
        if (task.dependencies.some((dependency) => !updated.dependencies.includes(dependency))) reasons.push('Recovery cannot remove existing dependencies.');
        if (task.status === 'blocked' && updated.status !== 'blocked') reasons.push('Recovery cannot declare an unresolved blocker resolved. Record its resolution separately.');
      }
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : 'Invalid proposal operations.');
  }
  return { valid: reasons.length === 0, reasons, candidate };
}

export function missionImpact(mission: Mission, changedTaskIds: string[], options: ScheduleOptions) {
  const affectedTaskIds = dependentTaskIds(mission.tasks, changedTaskIds);
  const threatenedCriteria = mission.criteria.filter((criterion) => criterion.required && mission.tasks.some((task) => affectedTaskIds.includes(task.id) && task.criterionIds.includes(criterion.id)));
  return { affectedTaskIds, threatenedCriteria, ...assessMissionHealth(mission, options) };
}
