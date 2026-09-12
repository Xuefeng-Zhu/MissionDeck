import { findDuplicateEvidence, hashContent } from './capture.js';
import { applyProposalOperations, projectSchedule, proposalHash, validateProposal } from './planning.js';
import { missionSchema, proposalSchema, type Evidence, type Mission, type Proposal, type ProposalOperation, type Task } from './schemas.js';

export const DEMO_NOW = '2026-09-12T16:00:00.000Z';
export const DEMO_TIMEZONE = 'America/Los_Angeles';

export interface ProposalInput {
  id?: string;
  kind: Proposal['kind'];
  title: string;
  operations: ProposalOperation[];
  rationale: string;
  evidenceIds?: string[];
  scheduleNote?: string;
}

export function createProposal(mission: Mission, input: ProposalInput, now: string = DEMO_NOW): Proposal {
  const affectedRecordIds = input.operations.map((operation) => {
    switch (operation.type) {
      case 'add_task': return operation.task.id;
      case 'update_task': return operation.taskId;
      case 'add_criterion': return operation.criterion.id;
      case 'update_criterion': return operation.criterionId;
      case 'update_contract': return mission.id;
    }
  });
  const base = {
    id: input.id ?? `proposal-${hashContent(`${mission.id}:${mission.revision}:${now}:${JSON.stringify(input)}`).slice(0, 20)}`,
    kind: input.kind,
    title: input.title,
    baseRevision: mission.revision,
    operations: input.operations,
    rationale: input.rationale,
    affectedRecordIds: [...new Set(affectedRecordIds)],
    evidenceIds: input.evidenceIds ?? [],
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + 60 * 60 * 1000).toISOString(),
    state: 'pending' as const,
    ...(input.scheduleNote ? { scheduleNote: input.scheduleNote } : {}),
  };
  return proposalSchema.parse({ ...base, payloadHash: proposalHash(base) });
}

export function createDemoMission(now: string = DEMO_NOW, overrides: Partial<Mission> = {}): Mission {
  const ownerId = overrides.ownerId ?? 'local-user';
  const missionId = overrides.id ?? 'mission-demo';
  return missionSchema.parse({
    id: missionId,
    ownerId,
    workspaceId: 'local-workspace',
    goal: 'Prepare our hackathon project for submission',
    deadline: new Date(Date.parse(now) + 5 * 60 * 60 * 1000).toISOString(),
    timezone: DEMO_TIMEZONE,
    lifecycle: 'draft',
    health: 'unknown',
    revision: 0,
    contract: {
      confirmed: false,
      outcome: 'A verified build and complete submission package, ready for a human to submit.',
      constraints: ['Illustrative fixture deadline; not an actual event deadline.', 'One human owner; two concurrent agent tasks; continuous availability assumed.'],
      forbiddenActions: ['Do not publish, submit, purchase, or send messages externally.', 'Do not remove required deliverables or bypass verification.'],
      humanOwner: ownerId,
      approvedCapabilities: ['Propose plans', 'Analyze accepted evidence', 'Create and update tasks after explicit approval'],
      assumptions: ['Effort estimates are suggestions until reviewed.', 'The human owner remains available during the displayed planning window.'],
      unresolvedQuestions: ['Confirm the exact event deadline against the official requirements.'],
    },
    criteria: [
      { id: `${missionId}-criterion-build`, title: 'Working project build', required: true, verificationMethod: 'Record a passing build and a human review of the core journey.', verificationState: 'needs_verification', evidenceIds: [] },
      { id: `${missionId}-criterion-package`, title: 'Complete submission package', required: true, verificationMethod: 'Review the project description, links, and required assets.', verificationState: 'needs_verification', evidenceIds: [] },
      { id: `${missionId}-criterion-checklist`, title: 'Final readiness review', required: true, verificationMethod: 'Human owner attests that the submission checklist has been checked.', verificationState: 'needs_verification', evidenceIds: [] },
      { id: `${missionId}-criterion-polish`, title: 'Optional visual polish', required: false, verificationMethod: 'Human review of optional presentation refinements.', verificationState: 'needs_verification', evidenceIds: [] },
    ],
    tasks: [], evidence: [], proposals: [], approvals: [], operations: [], artifacts: [], events: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

function demoTask(id: string, title: string, remainingMinutes: number, executor: Task['executor'], criterionIds: string[], dependencies: string[], ownerId: string, optional = false): Task {
  return { id, title: title.slice(0, 500), description: 'Suggested fixture plan. Review the effort and dependencies before approval.', status: 'todo', executor, ...(executor === 'human' ? { ownerId } : {}), dependencies, criterionIds, remainingMinutes, optional, deferred: false, completionEvidence: 'Attach the result for human review; task completion alone does not verify the mission.', provider: null, suggested: true };
}

export function createDemoPlanProposal(mission: Mission, now: string = DEMO_NOW): Proposal {
  const required = mission.criteria.filter((criterion) => criterion.required);
  if (!required.length) throw new Error('Add at least one required success criterion before generating a plan.');
  const first = required[0]!, second = required[1] ?? first, third = required[2] ?? second;
  const optionalCriterion = mission.criteria.find((criterion) => !criterion.required);
  const fixtureContract = first.title === 'Working project build';
  const id = (suffix: string) => `${mission.id}-${suffix}`;
  const tasks = [
    demoTask(id('task-build'), fixtureContract ? 'Finish the core implementation' : `Prepare: ${first.title}`, 100, 'agent', [first.id], [], mission.ownerId),
    demoTask(id('task-description'), fixtureContract ? 'Draft the project description' : `Draft the approach: ${second.title}`, 70, 'human', [second.id], [], mission.ownerId),
    demoTask(id('task-verify'), fixtureContract ? 'Verify the end-to-end demo' : `Verify: ${first.title}`, 50, 'human', [first.id], [id('task-build')], mission.ownerId),
    demoTask(id('task-package'), fixtureContract ? 'Assemble the submission package' : `Complete: ${second.title}`, 40, 'human', [second.id], [id('task-description'), id('task-verify')], mission.ownerId),
    demoTask(id('task-checklist'), fixtureContract ? 'Review the final readiness checklist' : `Review: ${third.title}`, 30, 'human', [third.id], [id('task-package')], mission.ownerId),
    demoTask(id('task-polish'), fixtureContract ? 'Polish screenshots and presentation' : optionalCriterion ? `Optional: ${optionalCriterion.title}` : 'Optional presentation refinements', 50, 'human', optionalCriterion ? [optionalCriterion.id] : [], [id('task-checklist')], mission.ownerId, true),
    ...required.slice(3).map((criterion, index) => demoTask(id(`task-outcome-${index + 4}`), `Complete and verify: ${criterion.title}`, 45, 'human', [criterion.id], [id('task-verify')], mission.ownerId)),
  ];
  const operations: ProposalOperation[] = tasks.map((task) => ({ type: 'add_task', task }));
  const candidate = applyProposalOperations(mission, operations);
  const schedule = projectSchedule(candidate, { now });
  return createProposal(mission, { kind: 'plan', title: `Review your ${tasks.length}-step plan`, operations, rationale: 'A deterministic fixture template based on your editable criteria, with suggested effort and dependencies, one human owner, and one optional polish task. It is not a model-generated plan. No provider tasks exist until approval.', scheduleNote: `Provisional finish: ${schedule.eta ?? 'unknown'}. ${schedule.assumptions[0]}` }, now);
}

export interface EvidenceAnalysis {
  status: 'duplicate' | 'possible_duplicate' | 'proposal' | 'no_change';
  summary: string;
  proposal?: Proposal;
  duplicateEvidenceId?: string;
  possibleDuplicateEvidenceIds: string[];
}

/** Bounded fixture extractor; untrusted content is data and never determines executable operations. */
export function analyzeEvidence(mission: Mission, evidence: Evidence, now: string = DEMO_NOW): EvidenceAnalysis {
  const duplicates = findDuplicateEvidence(mission.evidence.filter((item) => item.id !== evidence.id), evidence);
  if (duplicates.exact) return { status: 'duplicate', summary: 'This exact excerpt is already accepted. No additional task is proposed.', duplicateEvidenceId: duplicates.exact.id, possibleDuplicateEvidenceIds: [] };
  if (duplicates.possible.length) return { status: 'possible_duplicate', summary: 'This resembles existing evidence. Review and merge the excerpts before proposing another task.', possibleDuplicateEvidenceIds: duplicates.possible.map((item) => item.id) };
  const matchesVideo = /(?:two[ -]minute|2[ -]minute).{0,60}(?:demo\s+)?video.{0,60}(?:required|must|mandatory)|(?:required|must|mandatory).{0,60}(?:two[ -]minute|2[ -]minute).{0,60}(?:demo\s+)?video/i.test(evidence.excerpt);
  if (!matchesVideo) return { status: 'no_change', summary: 'Evidence saved. The fixture analyzer did not identify its supported demo-video requirement. Enable OpenAI for broader requirement extraction.', possibleDuplicateEvidenceIds: [] };
  const existingCriterion = mission.criteria.find((criterion) => /demo.*video|video.*demo/i.test(criterion.title));
  const committedTask = existingCriterion && mission.tasks.find((task) => !task.optional && !task.deferred && task.criterionIds.includes(existingCriterion.id));
  const pendingCoverage = mission.proposals.some((proposal) => {
    const validation = validateProposal(mission, proposal, now);
    if (!validation.valid || !validation.candidate) return false;
    const videoCriterion = validation.candidate.criteria.find((criterion) => criterion.required && /demo.*video|video.*demo/i.test(criterion.title));
    return videoCriterion && validation.candidate.tasks.some((task) => !task.optional && !task.deferred && task.criterionIds.includes(videoCriterion.id));
  });
  if (existingCriterion?.required && committedTask || pendingCoverage) return { status: 'no_change', summary: 'A required demo-video criterion with committed work, or a current approval proposal, already covers this requirement. No duplicate task was created.', possibleDuplicateEvidenceIds: [] };
  const criterion = existingCriterion ?? { id: `${mission.id}-criterion-demo-video`, title: 'Two-minute demo video', required: true, verificationMethod: 'Human reviews an accessible video, confirms its duration, and attaches the final link.', verificationState: 'needs_verification' as const, evidenceIds: [evidence.id] };
  const verifyTask = mission.tasks.find((task) => /verify/i.test(task.title) && !task.optional && !task.deferred);
  const task = demoTask(`${mission.id}-task-demo-video`, 'Record and review the two-minute demo video', 80, 'human', [criterion.id], verifyTask ? [verifyTask.id] : [], mission.ownerId);
  task.description = 'Suggested from the accepted requirements excerpt. The existing demo must be verified before recording.';
  task.completionEvidence = 'Final video link, duration check, and human playback review.';
  const existingVideoTask = existingCriterion && mission.tasks.find((item) => item.criterionIds.includes(existingCriterion.id) && /video/i.test(item.title));
  const operations: ProposalOperation[] = [];
  if (!existingCriterion) operations.push({ type: 'add_criterion', criterion });
  else if (!existingCriterion.required) operations.push({ type: 'update_criterion', criterionId: criterion.id, patch: { required: true } });
  if (!committedTask) {
    if (existingVideoTask) {
      operations.push({ type: 'update_task', taskId: existingVideoTask.id, patch: { optional: false, deferred: false } });
      const visited = new Set<string>();
      const restoreDependencies = (id: string) => {
        if (visited.has(id)) return;
        visited.add(id);
        const dependency = mission.tasks.find((item) => item.id === id);
        if (!dependency || dependency.status === 'reported_complete') return;
        if (dependency.deferred) operations.push({ type: 'update_task', taskId: dependency.id, patch: { deferred: false } });
        dependency.dependencies.forEach(restoreDependencies);
      };
      existingVideoTask.dependencies.forEach(restoreDependencies);
    }
    else operations.push({ type: 'add_task', task });
  }
  const candidate = applyProposalOperations(mission, operations);
  const schedule = projectSchedule(candidate, { now });
  const upgrading = existingCriterion && !existingCriterion.required;
  return {
    status: 'proposal', summary: upgrading ? 'The accepted excerpt makes the existing optional demo video required. Review the criterion upgrade and its committed task coverage.' : 'The accepted excerpt requires a two-minute demo video that is missing from the mission or lacks committed work.', possibleDuplicateEvidenceIds: [],
    proposal: createProposal(mission, { kind: 'requirement', title: upgrading ? 'Make the existing demo video required' : 'Add the required demo video', operations, evidenceIds: [evidence.id], rationale: `Accepted source excerpt: “${evidence.excerpt.slice(0, 1200)}”. Recording is required. ${existingVideoTask || committedTask ? 'Reuse the existing task and preserve its estimate, dependencies, and verification requirements.' : 'The 80-minute estimate and dependency are suggestions for review.'}`, scheduleNote: schedule.eta ? `Provisional finish moves to ${schedule.eta}; ${schedule.feasible ? 'fits' : 'exceeds'} the deadline under the displayed capacity assumptions.` : 'Finish time remains unknown because the plan contains unresolved work.' }, now),
  };
}

/** Recovery preserves required outcomes, existing dependencies, and unresolved blocker facts. */
export function proposeRecovery(mission: Mission, now: string = DEMO_NOW): Proposal[] {
  const result: Proposal[] = [];
  const optional = mission.tasks.filter((task) => task.optional && !task.deferred && task.status !== 'reported_complete' && !mission.tasks.some((other) => !other.deferred && other.dependencies.includes(task.id)));
  const blocked = mission.tasks.filter((task) => task.status === 'blocked' && !task.deferred);
  const independent = mission.tasks.find((task) => task.executor === 'human' && task.status === 'todo' && !task.deferred && !task.optional && task.dependencies.every((id) => mission.tasks.find((parent) => parent.id === id)?.status === 'reported_complete'));
  const operations: ProposalOperation[] = optional.map((task) => ({ type: 'update_task', taskId: task.id, patch: { deferred: true } }));
  if (blocked.length && independent) operations.push({ type: 'update_task', taskId: independent.id, patch: { status: 'in_progress' } });
  if (operations.length) {
    const candidate = applyProposalOperations(mission, operations);
    const schedule = projectSchedule(candidate, { now });
    const proposal = createProposal(mission, { kind: 'recovery', title: blocked.length ? 'Protect required work and start independent drafting' : 'Defer optional polish', operations, rationale: `${optional.length ? 'Defer optional polish while preserving all required deliverables. ' : ''}${blocked.length && independent ? `Begin “${independent.title}”, whose dependencies are already satisfied. ` : ''}${blocked.length ? 'The blocker still needs a human resolution; this option cannot promise the current deadline.' : 'Use the recovered capacity for the required deliverables.'}`, scheduleNote: schedule.eta ? `Recomputed finish: ${schedule.eta}. ${schedule.feasible ? 'Fits the deadline under the displayed availability assumptions.' : 'Still exceeds the deadline; this option does not restore feasibility.'}` : 'ETA remains unknown while the blocker is unresolved. Required work and verification remain in the plan.' }, now);
    if (validateProposal(mission, proposal, now).valid) result.push(proposal);
  }
  const current = projectSchedule(mission, { now });
  if (current.feasible === false || blocked.length || current.unknownTaskIds.length) {
    const deadline = new Date(Math.max(Date.parse(mission.deadline) + 2 * 60 * 60 * 1000, current.eta ? Date.parse(current.eta) + 30 * 60 * 1000 : 0)).toISOString();
    const proposal = createProposal(mission, { kind: 'recovery', title: 'Request a later mission deadline', operations: [{ type: 'update_contract', patch: { deadline } }], rationale: 'Propose a two-hour extension (or 30 minutes beyond the current projection, whichever is later) to the local mission contract. This does not change an actual event deadline and requires the owner to confirm that an extension is permitted.', scheduleNote: blocked.length || current.unknownTaskIds.length ? `Proposed deadline: ${deadline}. ETA remains unknown; an extension alone does not resolve blockers or missing estimates.` : `Proposed deadline: ${deadline}. Current provisional finish: ${current.eta}.` }, now);
    if (validateProposal(mission, proposal, now).valid) result.push(proposal);
  }
  return result.slice(0, 2);
}
