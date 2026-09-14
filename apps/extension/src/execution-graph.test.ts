import {describe, expect, it} from 'vitest';
import type {AdaptiveActivity, ExecutionArtifact, ExecutionTask, MissionExecution} from '@mission/domain';
import {buildExecutionGraph, type ExecutionGraphNodeId} from './execution-graph';

const at = (second: number) => `2026-09-14T12:00:${String(second).padStart(2, '0')}.000Z`;
const human = {id: 'human', name: 'Reviewer', kind: 'human' as const};
const agent = {id: 'agent', name: 'Worker', kind: 'agent' as const};
function task(id: string, assignee = agent as ExecutionTask['assignee']): ExecutionTask {
  return {id, title: id, description: id, completionCriteria: ['Verified delivery'], assignee, status: 'queued', dependsOn: [], version: 1, providerId: `external-${id}`, providerUrl: null, providerFingerprint: 'fingerprint', providerDescription: id, runId: null, runStartedAt: null, runFinishedAt: null, artifacts: [], lastError: null};
}
function mission(): MissionExecution {
  const analysis = task('analysis');
  const decision = {...task('decision', human), dependsOn: ['analysis']};
  const pack = {...task('pack'), dependsOn: ['analysis', 'decision']};
  return {missionId: 'mission', requestId: 'request', requestHash: 'hash', status: 'running', engine: 'strands', mode: 'fixture', modelMode: 'fixture', goal: 'Review launch', context: '', human, agent, summary: '', tasks: [analysis, decision, pack], artifacts: [], budget: {agentRuns: 1, maxAgentRuns: 8, maxTasks: 3}, events: [], operations: [], lastError: null, createdAt: at(0), updatedAt: at(0), activity: [], adaptive: {revision: 1, sourceRevision: 1, sourceHistory: [{revision: 1, createdAt: at(0), changeSummary: 'Initial reviewed sources.', sources: [{id: 'engineering', title: 'Engineering status', content: 'Calendar integration is unavailable.', provenance: 'pasted', fingerprint: 'source-hash'}]}], budget: {modelCalls: 1, toolCalls: 2, maxModelCalls: 40, maxToolCalls: 60}}};
}
function event(agent: string, kind: AdaptiveActivity['kind'], second: number, extra: Partial<AdaptiveActivity> = {}): AdaptiveActivity {
  return {id: `${agent}-${kind}-${second}`, agent, kind, at: at(second), runId: 'analysis-run', sourceRevision: 1, summary: `${agent} ${kind}`, ...extra};
}
function node(execution: MissionExecution, id: ExecutionGraphNodeId) {
  return buildExecutionGraph(execution).nodes.find(item => item.id === id)!;
}
function artifact(execution: MissionExecution, taskIndex: number, kind: ExecutionArtifact['kind']) {
  const t = execution.tasks[taskIndex];
  const result: ExecutionArtifact = {id: `${t.id}-document`, taskId: t.id, title: `${t.id} output`, content: 'Saved content', url: 'https://example.test/document', fingerprint: 'document-hash', kind, verifiedAt: at(10), mode: 'fixture', sourceRevision: execution.adaptive!.sourceRevision};
  execution.artifacts.push(result);
  t.artifacts.push(result.id);
  return result;
}
function savedAnalysis(execution: MissionExecution) {
  const a = execution.adaptive!;
  execution.tasks[0].status = 'completed';
  execution.tasks[0].runId = 'analysis-run';
  a.analysis = {version: 'analysis-v1', sourceRevision: 1, value: {summary: 'Calendar launch conflict', findings: [{id: 'calendar', kind: 'conflict', title: 'Calendar unavailable', detail: 'Engineering reports an unavailable integration.', citations: [{sourceId: 'engineering', sourceRevision: 1, excerpt: 'Calendar integration is unavailable.'}]}], unresolvedRequirements: ['Working integration'], options: [{id: 'beta', label: 'Private beta', description: 'Use manual entry.', consequences: ['Smaller audience']}, {id: 'wait', label: 'Wait', description: 'Wait for the integration.', consequences: ['Later launch']}], recommendedOptionId: 'beta', assumptions: []}};
  execution.tasks[1].status = 'waiting_human';
  artifact(execution, 0, 'deliverable');
}
function savedDecision(execution: MissionExecution) {
  savedAnalysis(execution);
  execution.adaptive!.decision = {optionId: 'beta', constraints: 'Disclose manual entry.', actorId: human.id, at: at(11), sourceRevision: 1, analysisVersion: 'analysis-v1'};
  execution.tasks[1].status = 'completed';
  artifact(execution, 1, 'review');
}

describe('adaptive execution graph projection', () => {
  it('shows both specialists running and keeps synthesis behind their join', () => {
    const execution = mission();
    Object.assign(execution.tasks[0], {status: 'running', runId: 'analysis-run'});
    execution.activity = [event('evidence', 'agent_start', 0), event('evidence', 'agent_end', 1, {outcome: 'succeeded'}), event('readiness', 'agent_start', 2), event('risk', 'agent_start', 2), event('risk', 'tool_start', 3, {toolCallId: 'source-read', tool: 'read_mission_sources', sourceId: 'engineering'})];
    expect(node(execution, 'evidence')).toMatchObject({status: 'succeeded', startedAt: at(0), finishedAt: at(1)});
    expect(node(execution, 'readiness')).toMatchObject({status: 'running', startedAt: at(2)});
    expect(node(execution, 'readiness').finishedAt).toBeUndefined();
    expect(node(execution, 'risk')).toMatchObject({status: 'running', sourceIds: ['engineering']});
    expect(node(execution, 'risk').events.at(-1)?.toolCallId).toBe('source-read');
    expect(node(execution, 'synthesis').status).toBe('waiting');
  });

  it('orders same-millisecond lifecycle boundaries while preserving other tied activity order', () => {
    const execution = mission();
    Object.assign(execution.tasks[0], {status: 'running', runId: 'analysis-run'});
    const end = event('evidence', 'agent_end', 1, {outcome: 'succeeded'});
    const firstTool = event('evidence', 'tool_end', 1, {id: 'first-tool', tool: 'list_mission_sources'});
    const secondTool = event('evidence', 'tool_end', 1, {id: 'second-tool', tool: 'read_mission_sources'});
    const start = event('evidence', 'agent_start', 1);
    execution.activity = [end, firstTool, secondTool, start];
    expect(node(execution, 'evidence')).toMatchObject({status: 'succeeded', startedAt: at(1), finishedAt: at(1), events: [start, firstTool, secondTool, end]});
    expect(execution.activity).toEqual([end, firstTool, secondTool, start]);
  });

  it('blocks a failed join without inventing a synthesis invocation', () => {
    const execution = mission();
    Object.assign(execution.tasks[0], {status: 'failed', runId: 'analysis-run', lastError: 'The risk agent failed.'});
    execution.status = 'blocked';
    execution.activity = [event('evidence', 'agent_end', 1, {outcome: 'succeeded'}), event('readiness', 'agent_end', 3, {outcome: 'succeeded'}), event('risk', 'agent_start', 2), event('risk', 'agent_end', 4, {outcome: 'failed', summary: 'Risk validation failed.'})];
    expect(node(execution, 'readiness').status).toBe('succeeded');
    expect(node(execution, 'risk').status).toBe('failed');
    expect(node(execution, 'synthesis')).toMatchObject({status: 'blocked', events: []});
    expect(node(execution, 'synthesis').startedAt).toBeUndefined();
  });

  it('waits for both the decision document and verified human task before production', () => {
    const execution = mission();
    savedDecision(execution);
    execution.tasks[1].status = 'saving';
    expect(node(execution, 'decision').status).toBe('saving');
    expect(node(execution, 'launch_pack').status).toBe('blocked');
    execution.tasks[1].status = 'completed';
    execution.tasks[1].artifacts = [];
    expect(node(execution, 'decision').status).toBe('saving');
    expect(node(execution, 'launch_pack').status).toBe('blocked');
    execution.tasks[1].artifacts = ['decision-document'];
    expect(node(execution, 'decision').status).toBe('succeeded');
    expect(node(execution, 'launch_pack').status).toBe('waiting');
  });

  it('rejects a decision tied to a previous analysis even on the same source revision', () => {
    const execution = mission();
    savedDecision(execution);
    execution.adaptive!.decision!.analysisVersion = 'superseded-analysis';
    expect(node(execution, 'decision').status).not.toBe('succeeded');
    Object.assign(execution.tasks[2], {status: 'running', runId: 'pack-run'});
    execution.activity = [event('launch_pack', 'agent_start', 12, {runId: 'pack-run'})];
    expect(node(execution, 'launch_pack').status).not.toBe('running');
  });

  it('keeps uncertain decision writes visible and blocks production', () => {
    const execution = mission();
    savedDecision(execution);
    execution.tasks[1].status = 'saving';
    execution.operations = [{id: 'write', kind: 'document_share', state: 'outcome_unknown'}];
    expect(node(execution, 'decision').status).toBe('uncertain');
    expect(node(execution, 'launch_pack').status).not.toBe('running');
  });

  it('shows an acknowledged decision delivery failure as blocked, instead of saving forever', () => {
    const execution = mission();
    savedDecision(execution);
    execution.status = 'blocked';
    execution.tasks[1].status = 'saving';
    execution.tasks[1].lastError = 'Workspace sharing was rejected.';
    execution.operations = [{id: 'write', kind: 'document_share', state: 'failed'}];
    expect(node(execution, 'decision')).toMatchObject({status: 'blocked', summary: 'Workspace sharing was rejected.'});
    expect(node(execution, 'launch_pack').status).toBe('blocked');
  });

  it.each([{id: 'decision', taskIndex: 1}, {id: 'delivery', taskIndex: 2}] as const)('shows paused $id delivery as blocked until a write is actually running', ({id, taskIndex}) => {
    const execution = mission();
    savedDecision(execution);
    execution.status = 'paused';
    execution.tasks[taskIndex].status = 'saving';
    expect(node(execution, id).status).toBe('blocked');
    expect(node(execution, id).summary).toContain('Resume the mission');
    execution.operations = [{id: 'write', kind: 'document_create', state: 'running'}];
    expect(node(execution, id).status).toBe('saving');
    execution.operations[0].state = 'done';
    expect(node(execution, id).status).toBe('blocked');
    execution.operations[0].state = 'outcome_unknown';
    expect(node(execution, id).status).toBe('uncertain');
    execution.operations[0].state = 'done';
    execution.tasks[taskIndex].status = 'failed';
    execution.tasks[taskIndex].lastError = 'Delivery failed.';
    expect(node(execution, id)).toMatchObject({status: 'failed', summary: 'Delivery failed.'});
  });

  it('distinguishes accepted generation, uncertain delivery, saved documents, and owner verification', () => {
    const execution = mission();
    savedDecision(execution);
    Object.assign(execution.tasks[2], {status: 'saving', runId: 'pack-run'});
    execution.activity = [event('launch_pack', 'agent_start', 12, {runId: 'pack-run'}), event('launch_pack', 'agent_end', 15, {runId: 'pack-run', outcome: 'succeeded'})];
    expect(node(execution, 'launch_pack').status).toBe('succeeded');
    expect(node(execution, 'delivery').status).toBe('saving');
    execution.operations = [{id: 'write', kind: 'document_share', state: 'outcome_unknown'}];
    expect(node(execution, 'delivery').status).toBe('uncertain');
    expect(node(execution, 'launch_pack').status).toBe('succeeded');
    execution.operations[0].state = 'done';
    execution.tasks[2].status = 'completed';
    execution.status = 'needs_review';
    artifact(execution, 2, 'deliverable');
    expect(node(execution, 'delivery').status).toBe('succeeded');
    expect(buildExecutionGraph(execution).verified).toBe(false);
    execution.pendingVerification = {actorId: human.id, statement: 'I reviewed the saved pack.', at: at(20)};
    expect(buildExecutionGraph(execution).verified).toBe(false);
    execution.status = 'completed';
    expect(buildExecutionGraph(execution).verified).toBe(false);
    execution.outcomeVerification = execution.pendingVerification;
    expect(buildExecutionGraph(execution).verified).toBe(true);
  });

  it('ignores superseded attempts even when their events arrive later', () => {
    const execution = mission();
    Object.assign(execution.tasks[0], {status: 'running', runId: 'retry-run', version: 2});
    execution.activity = [event('evidence', 'agent_start', 0, {runId: 'retry-run'}), event('evidence', 'agent_end', 30, {outcome: 'succeeded'}), event('risk', 'agent_end', 31, {outcome: 'failed'})];
    expect(node(execution, 'evidence')).toMatchObject({status: 'running', events: [execution.activity[0]]});
    expect(node(execution, 'risk').status).toBe('waiting');
    execution.tasks[0].runId = null;
    execution.tasks[0].status = 'queued';
    expect(node(execution, 'evidence')).toMatchObject({status: 'waiting', events: []});
  });

  it('resets the projection to a new source revision and excludes historical artifacts', () => {
    const execution = mission();
    savedDecision(execution);
    artifact(execution, 2, 'deliverable');
    execution.activity = [event('evidence', 'agent_end', 1, {outcome: 'succeeded'})];
    execution.adaptive!.sourceRevision = 2;
    execution.adaptive!.sourceHistory.push({...execution.adaptive!.sourceHistory[0], revision: 2, changeSummary: 'Engineering added a beta constraint.'});
    for (const t of execution.tasks) Object.assign(t, {status: 'queued', runId: null, artifacts: []});
    const graph = buildExecutionGraph(execution);
    expect(graph).toMatchObject({sourceRevision: 2, changeSummary: 'Engineering added a beta constraint.', verified: false});
    expect(graph.nodes.every(item => item.status === 'waiting' && item.events.length === 0 && item.artifacts.length === 0)).toBe(true);
    expect(execution.artifacts).toHaveLength(3);
  });

  it('requires both source revision and run ID even if a late record reuses the current run ID', () => {
    const execution = mission();
    Object.assign(execution.tasks[0], {status: 'running', runId: 'analysis-run'});
    execution.activity = [event('evidence', 'agent_start', 1, {sourceRevision: 2}), event('evidence', 'agent_end', 2, {sourceRevision: 2, outcome: 'succeeded'})];
    expect(node(execution, 'evidence')).toMatchObject({status: 'unavailable', events: []});
  });

  it('does not keep an agent running after its authoritative task has failed or moved to saving', () => {
    const execution = mission();
    Object.assign(execution.tasks[0], {status: 'failed', runId: 'analysis-run', lastError: 'Interrupted before an accepted outcome.'});
    execution.activity = [event('evidence', 'agent_start', 1)];
    expect(node(execution, 'evidence').status).toBe('failed');
    execution.tasks[0].status = 'saving';
    expect(node(execution, 'evidence').status).toBe('unavailable');
    execution.tasks[0].status = 'outcome_unknown';
    expect(node(execution, 'evidence').status).toBe('uncertain');
  });

  it('does not interpret legacy invocation-ended activity or task completion as agent success', () => {
    const execution = mission();
    savedAnalysis(execution);
    execution.activity = [event('evidence', 'agent_start', 0), event('evidence', 'agent_end', 1)];
    expect(node(execution, 'evidence')).toMatchObject({status: 'unavailable'});
    expect(node(execution, 'evidence').finishedAt).toBeUndefined();
    for (const id of ['readiness', 'risk', 'synthesis'] as const) {
      expect(node(execution, id).status).toBe('unavailable');
    }
  });

  it('retains explicit outcomes with truncated starts but cannot invent their durations', () => {
    const execution = mission();
    Object.assign(execution.tasks[0], {status: 'running', runId: 'analysis-run'});
    execution.activity = [event('evidence', 'agent_end', 10, {outcome: 'succeeded'})];
    expect(node(execution, 'evidence').status).toBe('succeeded');
    expect(node(execution, 'evidence').startedAt).toBeUndefined();
    expect(node(execution, 'evidence').finishedAt).toBe(at(10));
    execution.activity = [];
    expect(node(execution, 'evidence').status).toBe('unavailable');
  });

  it('allows existing invocations to finish while paused and prevents new ones from starting', () => {
    const execution = mission();
    Object.assign(execution.tasks[0], {status: 'running', runId: 'analysis-run'});
    execution.status = 'paused';
    execution.activity = [event('evidence', 'agent_end', 1, {outcome: 'succeeded'}), event('readiness', 'agent_start', 2), event('risk', 'agent_start', 2)];
    expect(node(execution, 'readiness').status).toBe('running');
    expect(node(execution, 'risk').status).toBe('running');
    expect(node(execution, 'synthesis').status).toBe('blocked');
    expect(node(execution, 'decision').status).toBe('blocked');
    execution.activity.push(event('readiness', 'agent_end', 3, {outcome: 'succeeded'}));
    expect(node(execution, 'readiness').status).toBe('succeeded');
  });

  it('retains accepted results on cancellation without presenting unfinished work as running', () => {
    const execution = mission();
    Object.assign(execution.tasks[0], {status: 'cancelled', runId: 'analysis-run'});
    execution.status = 'cancelled';
    execution.activity = [event('evidence', 'agent_end', 1, {outcome: 'succeeded'}), event('readiness', 'agent_start', 2), event('risk', 'agent_end', 3, {outcome: 'cancelled'})];
    expect(node(execution, 'evidence').status).toBe('succeeded');
    expect(node(execution, 'readiness').status).toBe('cancelled');
    expect(node(execution, 'risk').status).toBe('cancelled');
    expect(node(execution, 'delivery').status).toBe('cancelled');
  });

  it('uses current artifacts and accessible source references without counting activity as budget', () => {
    const execution = mission();
    savedAnalysis(execution);
    execution.activity = [event('synthesis', 'tool_end', 5, {sourceId: 'secret-outside-mission'}), event('synthesis', 'agent_end', 7, {outcome: 'succeeded'})];
    expect(node(execution, 'synthesis').sourceIds).toEqual(['engineering']);
    expect(node(execution, 'synthesis').artifacts).toEqual(execution.artifacts);
    const before = JSON.stringify(execution);
    buildExecutionGraph(execution);
    expect(JSON.stringify(execution)).toBe(before);
    expect(execution.adaptive!.budget).toMatchObject({modelCalls: 1, toolCalls: 2});
  });

  it('does not let historical failed operations poison a clean retry', () => {
    const execution = mission();
    execution.operations = [{id: 'old-write', kind: 'document_create', state: 'failed', error: 'Previous attempt failed.'}];
    Object.assign(execution.tasks[0], {status: 'running', runId: 'new-run'});
    execution.activity = [event('evidence', 'agent_start', 3, {runId: 'new-run'})];
    expect(node(execution, 'evidence').status).toBe('running');
  });
});
