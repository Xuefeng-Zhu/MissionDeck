import type {AdaptiveActivity, ExecutionArtifact, ExecutionTask, MissionExecution} from '@mission/domain';

export type ExecutionGraphStatus = 'waiting' | 'running' | 'saving' | 'succeeded' | 'blocked' | 'failed' | 'cancelled' | 'uncertain' | 'unavailable';
export type ExecutionGraphNodeId = 'evidence' | 'readiness' | 'risk' | 'synthesis' | 'decision' | 'launch_pack' | 'delivery';
export interface ExecutionGraphNode {
  id: ExecutionGraphNodeId;
  label: string;
  status: ExecutionGraphStatus;
  summary: string;
  events: AdaptiveActivity[];
  sourceIds: string[];
  artifacts: ExecutionArtifact[];
  taskId?: string;
  startedAt?: string;
  finishedAt?: string;
}
export interface ExecutionGraph {
  nodes: ExecutionGraphNode[];
  sourceRevision: number;
  changeSummary: string;
  verified: boolean;
}

const agentLabels = {evidence: 'Evidence extraction', readiness: 'Readiness', risk: 'Risk', synthesis: 'Decision synthesis', launch_pack: 'Launch-pack agent'} as const;
const unsuccessful = new Set<ExecutionGraphStatus>(['blocked', 'failed', 'cancelled', 'uncertain']);
const lifecycleOrder: Record<AdaptiveActivity['kind'], number> = {agent_start: 0, model_call: 1, tool_start: 1, tool_end: 1, agent_end: 2, error: 2};

/** Project only the current fixed-template attempt; activity is evidence, not a task-state substitute. */
export function buildExecutionGraph(execution: MissionExecution): ExecutionGraph {
  const adaptive = execution.adaptive;
  const sourceRevision = adaptive?.sourceRevision ?? 0;
  const revision = adaptive?.sourceHistory.find(item => item.revision === sourceRevision);
  const knownSources = new Set(revision?.sources.map(source => source.id));
  const [analysisTask, decisionTask, packTask] = adaptive ? execution.tasks : [];
  const uncertainWrite = execution.operations.some(operation => operation.state === 'outcome_unknown');
  const activeWrite = execution.operations.some(operation => operation.state === 'running');
  const verified = execution.status === 'completed' && !!execution.outcomeVerification;

  function artifactsFor(task?: ExecutionTask): ExecutionArtifact[] {
    if (!task) return [];
    return execution.artifacts.filter(artifact => artifact.sourceRevision === sourceRevision && artifact.taskId === task.id && task.artifacts.includes(artifact.id) && !!artifact.verifiedAt);
  }
  function eventsFor(task?: ExecutionTask): AdaptiveActivity[] {
    if (!task?.runId) return [];
    // Storage breaks millisecond ties by random record IDs. Stable-sort lifecycle boundaries
    // so a tied terminal record cannot be mistaken for an event from before its own start.
    return (execution.activity ?? []).filter(event => event.sourceRevision === sourceRevision && event.runId === task.runId).slice().sort((a, b) => a.at.localeCompare(b.at) || lifecycleOrder[a.kind] - lifecycleOrder[b.kind]);
  }
  function sourceIds(events: AdaptiveActivity[], extra: string[] = []): string[] {
    return [...new Set([...events.flatMap(event => event.sourceId ? [event.sourceId] : []), ...extra])].filter(id => knownSources.has(id));
  }
  function pendingState(): {status: ExecutionGraphStatus; summary: string} {
    if (execution.status === 'cancelled') return {status: 'cancelled', summary: 'Mission cancelled before this work completed.'};
    if (uncertainWrite) return {status: 'uncertain', summary: 'Reconcile the uncertain workspace write before starting more work.'};
    if (execution.status === 'paused') return {status: 'blocked', summary: 'Mission paused. No new work will start until it resumes.'};
    if (execution.status === 'blocked') return {status: 'blocked', summary: 'Resolve the mission blocker before continuing.'};
    return {status: 'waiting', summary: 'Waiting for its prerequisites.'};
  }
  function taskFailure(task?: ExecutionTask): {status: ExecutionGraphStatus; summary: string} | undefined {
    if (!task) return;
    if (task.status === 'outcome_unknown') return {status: 'uncertain', summary: task.lastError || 'The task outcome requires reconciliation.'};
    if (task.status === 'failed') return {status: 'failed', summary: task.lastError || 'This task failed. Retry starts a new attempt.'};
    if (task.status === 'blocked') return {status: 'blocked', summary: task.lastError || 'This task is blocked.'};
    if (task.status === 'cancelled') return {status: 'cancelled', summary: 'This task was cancelled.'};
  }
  const analysisEvents = eventsFor(analysisTask);
  const analysisArtifacts = artifactsFor(analysisTask);
  const decisionArtifacts = artifactsFor(decisionTask).filter(artifact => artifact.kind === 'review');
  const packArtifacts = artifactsFor(packTask).filter(artifact => artifact.kind === 'deliverable');
  const currentAnalysis = adaptive?.analysis?.sourceRevision === sourceRevision ? adaptive.analysis : undefined;
  const currentDecision = adaptive?.decision?.sourceRevision === sourceRevision && adaptive.decision.analysisVersion === currentAnalysis?.version ? adaptive.decision : undefined;
  const decisionSaved = !!currentDecision && decisionTask?.status === 'completed' && decisionArtifacts.length > 0;

  function agentNode(id: keyof typeof agentLabels, task: ExecutionTask | undefined, prerequisites: ExecutionGraphNode[]): ExecutionGraphNode {
    const allEvents = id === 'launch_pack' ? eventsFor(task) : analysisEvents;
    const events = allEvents.filter(event => event.agent === id);
    const lastStartIndex = events.map(event => event.kind).lastIndexOf('agent_start');
    const attemptEvents = lastStartIndex >= 0 ? events.slice(lastStartIndex) : events;
    const end = attemptEvents.slice().reverse().find(event => event.kind === 'agent_end');
    const start = lastStartIndex >= 0 ? events[lastStartIndex] : undefined;
    let state: {status: ExecutionGraphStatus; summary: string};
    // Explicit accepted outcomes survive later delivery problems; generic invocation-ended events do not prove success.
    if (end?.outcome) state = {status: end.outcome, summary: end.summary};
    else if (taskFailure(task)) state = taskFailure(task)!;
    else if (execution.status === 'cancelled') state = {status: 'cancelled', summary: 'Mission cancelled before this invocation completed.'};
    else if (end) state = {status: 'unavailable', summary: 'Invocation ended, but this record does not contain a verified agent outcome.'};
    else if (start && task?.status === 'running') state = {status: 'running', summary: attemptEvents.at(-1)?.summary || `${agentLabels[id]} is running.`};
    else if (task && ['saving', 'completed'].includes(task.status)) state = {status: 'unavailable', summary: 'The task has progressed, but this agent’s outcome is absent from the retained activity.'};
    else if (task?.status === 'running' && !allEvents.length) state = {status: 'unavailable', summary: 'This task is running; per-agent activity is unavailable.'};
    else if (prerequisites.some(node => unsuccessful.has(node.status))) state = {status: 'blocked', summary: 'A prerequisite did not succeed. This agent cannot start.'};
    else state = pendingState();

    if (id === 'launch_pack' && !decisionSaved && !['cancelled', 'uncertain'].includes(state.status)) {
      state = {status: currentDecision || decisionTask?.status === 'saving' ? 'blocked' : pendingState().status, summary: 'Production requires a saved decision document and a verified completed human task.'};
    }
    const findings = currentAnalysis?.value.findings.filter(finding => id === 'readiness' ? finding.kind === 'readiness' : id === 'risk' ? finding.kind !== 'readiness' : id === 'synthesis') ?? [];
    const citations = id === 'launch_pack' && adaptive?.pack?.sourceRevision === sourceRevision ? adaptive.pack.value.citations : findings.flatMap(finding => finding.citations);
    const startedAt = start && Number.isFinite(Date.parse(start.at)) ? start.at : undefined;
    const finishedAt = end?.outcome && Number.isFinite(Date.parse(end.at)) && (!startedAt || Date.parse(end.at) >= Date.parse(startedAt)) ? end.at : undefined;
    return {id, label: agentLabels[id], ...state, events, sourceIds: sourceIds(events, citations.map(citation => citation.sourceId)), artifacts: id === 'synthesis' ? analysisArtifacts : id === 'launch_pack' ? packArtifacts : [], ...(task ? {taskId: task.id} : {}), ...(startedAt ? {startedAt} : {}), ...(finishedAt ? {finishedAt} : {})};
  }

  const evidence = agentNode('evidence', analysisTask, []);
  const readiness = agentNode('readiness', analysisTask, [evidence]);
  const risk = agentNode('risk', analysisTask, [evidence]);
  const synthesis = agentNode('synthesis', analysisTask, [readiness, risk]);
  // A failed branch prevents the join, including when other nodes never emitted activity.
  for (const node of [readiness, risk, synthesis]) {
    const prerequisites = node.id === 'synthesis' ? [readiness, risk] : [evidence];
    if (!node.events.length && prerequisites.some(prerequisite => unsuccessful.has(prerequisite.status))) {
      node.status = execution.status === 'cancelled' ? 'cancelled' : 'blocked';
      node.summary = 'A prerequisite did not succeed. This agent did not start.';
    }
  }

  let decisionState: {status: ExecutionGraphStatus; summary: string};
  if (decisionSaved) decisionState = {status: 'succeeded', summary: 'The selected option and constraints are saved; the human task is verified complete.'};
  else if (decisionTask?.status === 'saving' || currentDecision) {
    decisionState = uncertainWrite || decisionTask?.status === 'outcome_unknown'
      ? {status: 'uncertain', summary: 'The decision write is uncertain. Reconcile it before production.'}
      : taskFailure(decisionTask) ?? (execution.status === 'cancelled'
        ? {status: 'cancelled', summary: 'Mission cancelled before decision delivery was verified.'}
        : decisionTask?.lastError && execution.status === 'blocked' && !activeWrite
          ? {status: 'blocked', summary: decisionTask.lastError}
        : execution.status === 'paused' && !activeWrite
          ? {status: 'blocked', summary: 'Decision delivery is paused. Resume the mission to save and verify it.'}
        : {status: 'saving', summary: 'Saving decision. Production waits for the document and human task to be verified.'});
  } else decisionState = taskFailure(decisionTask) ?? (decisionTask?.status === 'waiting_human' && execution.status !== 'cancelled'
    ? {status: execution.status === 'paused' || execution.status === 'blocked' ? 'blocked' : 'waiting', summary: execution.status === 'paused' ? 'Resume the mission to save a decision.' : 'Review the cited brief, choose an option, and add any constraints.'}
    : pendingState());
  const decision: ExecutionGraphNode = {id: 'decision', label: 'Human decision', ...decisionState, events: [], sourceIds: sourceIds([], currentAnalysis?.value.findings.flatMap(finding => finding.citations.map(citation => citation.sourceId)) ?? []), artifacts: decisionArtifacts, ...(decisionTask ? {taskId: decisionTask.id} : {})};
  const launchPack = agentNode('launch_pack', packTask, [decision]);

  let deliveryState: {status: ExecutionGraphStatus; summary: string};
  if (packTask?.status === 'completed' && packArtifacts.length) deliveryState = {status: 'succeeded', summary: verified ? 'Documents saved. The mission owner has also verified the outcome.' : 'Documents saved and read back. Human verification of the mission outcome is still required.'};
  else if (packTask?.status === 'saving') deliveryState = uncertainWrite
    ? {status: 'uncertain', summary: 'A launch-pack write is uncertain. Reconcile it before claiming delivery.'}
    : packTask.lastError && execution.status === 'blocked' && !activeWrite
      ? {status: 'blocked', summary: packTask.lastError}
      : execution.status === 'paused' && !activeWrite
        ? {status: 'blocked', summary: 'Launch-pack delivery is paused. Resume the mission to save and verify the generated documents.'}
      : {status: 'saving', summary: 'Saving launch-pack documents and verifying their sharing and task completion.'};
  else if (packTask?.status === 'completed') deliveryState = {status: 'unavailable', summary: 'Task completion is recorded, but no verified launch-pack document is available for this source revision.'};
  else if (taskFailure(packTask)) deliveryState = taskFailure(packTask)!;
  else if (launchPack.status === 'succeeded') deliveryState = {status: 'waiting', summary: 'The launch pack was generated. Document delivery is not yet verified.'};
  else deliveryState = pendingState();
  const delivery: ExecutionGraphNode = {id: 'delivery', label: 'Document delivery', ...deliveryState, events: [], sourceIds: launchPack.sourceIds, artifacts: packArtifacts, ...(packTask ? {taskId: packTask.id} : {})};
  return {nodes: [evidence, readiness, risk, synthesis, decision, launchPack, delivery], sourceRevision, changeSummary: revision?.changeSummary ?? '', verified};
}
