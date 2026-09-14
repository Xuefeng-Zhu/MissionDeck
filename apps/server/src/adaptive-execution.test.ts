import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADAPTIVE_SAMPLE_SOURCES, type AdaptiveAnalysis, type LaunchPack, type MissionExecution } from '@mission/domain';
import { openDatabase, type Database, type Scope } from './database.js';
import { ExecutionService } from './execution-service.js';
import { FixtureExecutionProvider } from './execution-provider.js';
import { ModelExecutionRunner, type ExecutionOutput, type ExecutionPlan, type ExecutionRunner, type ExecutionTaskInput } from './execution-runner.js';
import { resolveModelConfig } from './model-provider.js';
import { UpgradeStore } from './upgrade-store.js';
import { ProviderError } from './providers/types.js';

// These tests exercise the durable coordinator against real fixture documents and
// tasks. The runner is deliberately controlled; SDK/transport tests establish
// Strands Graph behavior separately and neither suite establishes live acceptance.
const scope: Scope = { ownerId: 'adaptive-owner', workspaceId: 'adaptive-workspace' };
const sampleSources = () => structuredClone(ADAPTIVE_SAMPLE_SOURCES);
const startInput = () => ({ requestId: randomUUID(), template: 'adaptive_launch' as const,
  goal: 'Prepare a reviewed launch pack from the fictional Harbor sources.', context: '',
  humanId: 'fixture-human', agentId: 'fixture-agent', maxTasks: 3, maxAgentRuns: 8, sources: sampleSources() });
const plan: ExecutionPlan = {
  summary: 'Analyze reviewed sources, obtain a structured human decision, and produce a launch pack.',
  tasks: [
    { key: 'analysis', title: 'Analyze launch readiness', description: 'Extract evidence, analyze readiness and risk, and synthesize decision options.', executor: 'agent', dependencies: [], completionCriteria: ['Save a cited decision brief.'] },
    { key: 'decision', title: 'Resolve the launch conflict', description: 'Select an option and record constraints.', executor: 'human', dependencies: ['analysis'], completionCriteria: ['Save a human decision for the current analysis.'] },
    { key: 'launch_pack', title: 'Produce launch pack', description: 'Prepare the final pack from the saved sources, analysis, and human decision.', executor: 'agent', dependencies: ['analysis', 'decision'], completionCriteria: ['Save the brief, checklist, announcement draft, and unresolved risks.'] },
  ],
};
let db: Database;
let store: UpgradeStore;
let provider: FixtureExecutionProvider;
let service: ExecutionService;
let runner: { mode: 'live'; plan: ReturnType<typeof vi.fn<ExecutionRunner['plan']>>; run: ReturnType<typeof vi.fn<ExecutionRunner['run']>> };
const services: ExecutionService[] = [];
const legacy = () => new ModelExecutionRunner(resolveModelConfig({ MODEL_MODE: 'fixture', MODEL_PROVIDER: 'openrouter', OPENROUTER_MODEL: 'synthetic/model', OPENAI_MODEL: 'synthetic/model' }));
function coordinator() {
  const next = new ExecutionService(db, () => provider, legacy(), undefined, runner);
  vi.spyOn(next, 'wake').mockImplementation(() => {});
  services.push(next);
  return next;
}
const read = async (id: string) => (await service.get(id, scope))!;
const state = (e: MissionExecution) => e.adaptive!;
const decisionInput = (e: MissionExecution) => ({ requestId: randomUUID(), expectedRevision: state(e).revision,
  analysisVersion: state(e).analysis!.version, optionId: 'private_beta', constraints: 'Disclose manual date entry; do not promise calendar integration.' });
const updateInput = (e: MissionExecution) => ({ requestId: randomUUID(), expectedRevision: state(e).revision,
  sources: sampleSources().map(s => s.id === 'engineering' ? { ...s, content: `${s.content}\nUpdate: Integration has now passed acceptance; launch owner must approve broader rollout.` } : s) });
async function begin() { const started = await service.start(startInput(), scope); await service.pump(); return read(started.mission.id); }
async function decideAndFinish(e: MissionExecution) { await service.decide(e.missionId, scope, decisionInput(e)); await service.pump(); return read(e.missionId); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function analysisFor(input: ExecutionTaskInput): AdaptiveAnalysis {
  const adaptive = input.adaptive!;
  return {
    summary: 'The advertised calendar integration is not ready for the promised launch.',
    findings: [{ id: 'calendar-conflict', title: 'Calendar promise conflicts with engineering readiness',
      detail: 'A smaller beta can use manual date entry while the calendar integration is completed.', kind: 'conflict',
      citations: adaptive.sources.slice(0, 2).map(source => ({ sourceId: source.id, sourceRevision: adaptive.sourceRevision, excerpt: source.content.slice(0, 90) })) }],
    unresolvedRequirements: ['Human owner must decide the launch scope.'],
    options: [
      { id: 'private_beta', label: 'Run a private beta', description: 'Start with 20 customers and manual date entry.', consequences: ['Disclose that calendar integration is unavailable.'] },
      { id: 'delay_launch', label: 'Delay the launch', description: 'Wait until the integration is accepted.', consequences: ['Move the announced launch date.'] },
    ], recommendedOptionId: 'private_beta', assumptions: ['The supplied fictional snapshots are the only source material.'],
  };
}
async function controlledRun(input: ExecutionTaskInput): Promise<ExecutionOutput> {
  const adaptive = input.adaptive!;
  await adaptive.consume('model');
  for (const source of adaptive.sources) { await adaptive.consume('tool'); await adaptive.readSource(source.id); }
  await adaptive.activity({ agent: 'controlled-test-runner', kind: 'agent_end', summary: 'Controlled workflow output ready.' });
  if (adaptive.stage === 'analysis') {
    const analysis = analysisFor(input);
    return { title: 'Launch decision brief', content: JSON.stringify(analysis), summary: analysis.summary, adaptiveResult: { kind: 'analysis', analysis } };
  }
  const pack: LaunchPack = { brief: 'Run a private beta with manual date entry.', checklist: ['Confirm the selected beta participants.'],
    announcementDraft: 'Join the Harbor private beta. Calendar integration is not included.', unresolvedRisks: ['Calendar integration remains a limitation.'],
    changeSummary: adaptive.sourceRevision === 1 ? 'Initial pack incorporates the recorded human decision.' : 'Revised pack uses the latest engineering source and fresh human decision.',
    citations: [{ sourceId: adaptive.sources[0]!.id, sourceRevision: adaptive.sourceRevision, excerpt: adaptive.sources[0]!.content.slice(0, 90) }] };
  return { title: 'Reviewed launch pack', content: JSON.stringify(pack), summary: pack.changeSummary, adaptiveResult: { kind: 'launch_pack', pack } };
}

beforeEach(async () => {
  db = await openDatabase({ memory: true }); store = new UpgradeStore(db); provider = new FixtureExecutionProvider(store, scope);
  runner = { mode: 'live', plan: vi.fn(async () => structuredClone(plan)), run: vi.fn(controlledRun) };
  service = coordinator();
});
afterEach(async () => { await Promise.all(services.splice(0).map(s => s.stop())); await db?.close(); });

describe('adaptive launch coordinator', () => {
  it('persists reviewed sources and decisions, gates the launch pack, and verifies the outcome separately', async () => {
    const e = await begin();
    expect(e.engine).toBe('strands');
    expect(e.tasks.map(t => t.status)).toEqual(['completed', 'waiting_human', 'queued']);
    expect(state(e)).toMatchObject({ sourceRevision: 1, budget: { modelCalls: 1, toolCalls: 3, maxModelCalls: 40, maxToolCalls: 60 } });
    expect(state(e).sourceHistory).toHaveLength(1);
    for (const source of state(e).sourceHistory[0]!.sources) {
      expect(source.fingerprint).toBeTruthy(); expect(source.documentId).toBeTruthy();
      const document = await provider.readDocument(source.documentId!);
      expect(document.content).toContain(source.content);
      expect(document.audienceIds.sort()).toEqual(['fixture-agent', 'fixture-human']);
    }
    await service.pump(); expect(runner.run).toHaveBeenCalledTimes(1);
    await expect(service.review(e.missionId, e.tasks[1]!.id, scope, 'Approved')).rejects.toMatchObject({ status: 409 });
    const request = decisionInput(e);
    const final = await decideAndFinish(e);
    expect(final.status).toBe('needs_review');
    expect(final.tasks.every(t => t.status === 'completed')).toBe(true);
    expect(state(final).decision).toMatchObject({ optionId: request.optionId, constraints: request.constraints, actorId: scope.ownerId, sourceRevision: 1, analysisVersion: request.analysisVersion });
    expect(state(final).decision!.at).toBeTruthy();
    expect(runner.run.mock.calls[1]![0].adaptive).toMatchObject({ stage: 'launch_pack', sourceRevision: 1, decision: { optionId: request.optionId, constraints: request.constraints } });
    for (const artifact of final.artifacts) {
      const saved = await provider.readDocument(artifact.id);
      expect(saved.content).toBe(artifact.content); expect(saved.audienceIds.sort()).toEqual(['fixture-agent', 'fixture-human']);
    }
    await expect(service.control(e.missionId, scope, 'complete')).rejects.toMatchObject({ status: 422 });
    await service.control(e.missionId, scope, 'complete', 'I read the saved launch pack and verified the required outputs.');
    expect((await read(e.missionId)).status).toBe('completed');
    expect((await db.get(e.missionId, scope))!.criteria.every(c => c.verificationState === 'verified')).toBe(true);
  });

  it('requires a current analysis and deduplicates structured decisions', async () => {
    const started = await service.start(startInput(), scope);
    await expect(service.decide(started.mission.id, scope, { requestId: randomUUID(), expectedRevision: 1, analysisVersion: 'missing', optionId: 'private_beta', constraints: '' })).rejects.toMatchObject({ status: 409 });
    await service.pump(); const e = await read(started.mission.id); const request = decisionInput(e);
    await expect(service.decide(e.missionId, scope, { ...request, requestId: randomUUID(), analysisVersion: 'stale-analysis' })).rejects.toMatchObject({ status: 409 });
    await expect(service.decide(e.missionId, scope, { ...request, requestId: randomUUID(), optionId: 'invented-option' })).rejects.toMatchObject({ status: 422 });
    await service.decide(e.missionId, scope, request);
    await service.decide(e.missionId, scope, request);
    await expect(service.decide(e.missionId, scope, { ...request, constraints: 'Changed meaning under the same request.' })).rejects.toMatchObject({ status: 409 });
    await service.pump();
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect((await read(e.missionId)).artifacts.filter(a => a.kind === 'review')).toHaveLength(1);
  });

  it('versions source changes, preserves task identities and history, and requires a new decision', async () => {
    const initial = await begin(); const first = await decideAndFinish(initial); const staleDecision = decisionInput(initial);
    const request = updateInput(first); const originalDocuments = first.artifacts.map(a => [a.id, a.content] as const);
    const updated = (await service.updateSources(first.missionId, scope, request))!;
    expect(state(updated)).toMatchObject({ sourceRevision: 2 });
    expect(state(updated).analysis).toBeUndefined(); expect(state(updated).decision).toBeUndefined(); expect(state(updated).pack).toBeUndefined();
    expect(updated.outcomeVerification).toBeUndefined();
    expect(updated.tasks.map(t => t.id)).toEqual(first.tasks.map(t => t.id));
    expect(updated.tasks.map(t => t.version)).toEqual(first.tasks.map(t => t.version + 1));
    expect(state(updated).sourceHistory).toHaveLength(2);
    await service.updateSources(first.missionId, scope, request);
    await expect(service.updateSources(first.missionId, scope, { ...request, requestId: randomUUID() })).rejects.toMatchObject({ status: 409 });
    await expect(service.updateSources(first.missionId, scope, { ...request, sources: sampleSources() })).rejects.toMatchObject({ status: 409 });
    await service.pump(); const reanalyzed = await read(first.missionId);
    expect(reanalyzed.tasks.map(t => t.status)).toEqual(['completed', 'waiting_human', 'queued']);
    expect(state(reanalyzed).analysis!.version).not.toBe(state(initial).analysis!.version);
    await expect(service.decide(first.missionId, scope, { ...staleDecision, expectedRevision: state(reanalyzed).revision })).rejects.toMatchObject({ status: 409 });
    for (const [id, content] of originalDocuments) expect((await provider.readDocument(id)).content).toBe(content);
    const revised = await decideAndFinish(reanalyzed);
    expect(revised.artifacts.some(a => a.sourceRevision === 1)).toBe(true); expect(revised.artifacts.some(a => a.sourceRevision === 2)).toBe(true);
    expect(state(revised).pack).toMatchObject({ sourceRevision: 2, value: { changeSummary: expect.stringContaining('latest engineering source') } });
    expect(await store.list('fixture_execution_task', scope)).toHaveLength(3);
    expect(runner.run).toHaveBeenCalledTimes(4);
  });

  it('requires explicit reopening of a completed mission and invalidates prior outcome acceptance', async () => {
    const e = await decideAndFinish(await begin());
    await service.control(e.missionId, scope, 'complete', 'I checked every required artifact.');
    const completed = await read(e.missionId);
    await expect(service.updateSources(e.missionId, scope, updateInput(completed))).rejects.toMatchObject({ status: 409 });
    const request = { requestId: randomUUID(), expectedRevision: state(completed).revision };
    await service.reopen(e.missionId, scope, request); await service.reopen(e.missionId, scope, request);
    const reopened = await read(e.missionId);
    expect(reopened.status).not.toBe('completed'); expect(reopened.outcomeVerification).toBeUndefined();
    expect((await db.get(e.missionId, scope))!.criteria.every(c => c.verificationState !== 'verified')).toBe(true);
    await service.updateSources(e.missionId, scope, updateInput(reopened)); await service.pump();
    expect((await read(e.missionId)).tasks.map(t => t.status)).toEqual(['completed', 'waiting_human', 'queued']);
  });

  it('rejects source edits during a run and ignores a late result after cancellation', async () => {
    const begun = deferred<void>(); const answer = deferred<ExecutionOutput>(); let observedSignal: AbortSignal | undefined;
    runner.run.mockImplementationOnce(async (input, signal) => { observedSignal = signal; begun.resolve(); await answer.promise; return controlledRun(input); });
    const started = await service.start(startInput(), scope); const pumping = service.pump(); await begun.promise;
    const running = await read(started.mission.id);
    await expect(service.updateSources(running.missionId, scope, updateInput(running))).rejects.toMatchObject({ status: 409 });
    await service.control(running.missionId, scope, 'cancel'); expect(observedSignal?.aborted).toBe(true);
    answer.resolve({ title: 'Late result', content: 'Must not be accepted.', summary: 'Cancelled run.' }); await pumping;
    const cancelled = await read(running.missionId);
    expect(cancelled.status).toBe('cancelled'); expect(state(cancelled).analysis).toBeUndefined();
    expect(cancelled.artifacts.some(a => a.kind === 'deliverable')).toBe(false);
  });

  it('persists only matching terminal activity after cancellation without accepting late output or work', async () => {
    const reached = deferred<ExecutionTaskInput>(); const output = deferred<ExecutionOutput>();
    runner.run.mockImplementationOnce(async input => {
      await input.adaptive!.consume('model');
      await input.adaptive!.activity({ agent: 'evidence', kind: 'agent_start', summary: 'Evidence started.' });
      await input.adaptive!.activity({ agent: 'evidence', kind: 'tool_start', tool: 'read_mission_sources', toolCallId: 'cancelled-read', summary: 'Source read started.' });
      reached.resolve(input);
      return output.promise;
    });
    const started = await service.start(startInput(), scope); const pumping = service.pump();
    const input = await reached.promise; const adaptive = input.adaptive!; const analysis = analysisFor(input);
    try {
      const running = await read(started.mission.id);
      await service.control(started.mission.id, scope, 'cancel');
      const budget = state(await read(started.mission.id)).budget;
      await expect(adaptive.consume('model')).rejects.toMatchObject({ status: 499 });
      await expect(adaptive.consume('tool')).rejects.toMatchObject({ status: 499 });
      await expect(adaptive.readSource('requirements')).rejects.toMatchObject({ status: 499 });
      await expect(adaptive.readArtifact('unknown')).rejects.toMatchObject({ status: 499 });
      for (const event of [
        { agent: 'evidence', kind: 'agent_start' as const, summary: 'Must not start.' },
        { agent: 'evidence', kind: 'model_call' as const, summary: 'Must not call.' },
        { agent: 'evidence', kind: 'tool_start' as const, summary: 'Must not use a tool.' },
        { agent: 'evidence', kind: 'agent_end' as const, outcome: 'succeeded' as const, summary: 'Must not accept success.' },
      ]) await expect(adaptive.activity(event)).rejects.toMatchObject({ status: 499 });
      // Terminal diagnostics do not need execution authority after cancellation.
      await db.query('DELETE FROM mission_execution_leases WHERE mission_id=$1', [started.mission.id]);
      await adaptive.activity({ agent: 'evidence', kind: 'tool_end', tool: 'read_mission_sources', toolCallId: 'cancelled-read', outcome: 'cancelled', summary: 'Source read cancelled.' });
      await adaptive.activity({ agent: 'evidence', kind: 'agent_end', outcome: 'cancelled', summary: 'Evidence cancelled; no result accepted.' });
      await adaptive.activity({ agent: 'strands', kind: 'error', outcome: 'cancelled', summary: 'Strands cancelled.' });
      const cancelled = await read(started.mission.id);
      const terminalEvents = cancelled.activity!.filter(event => event.outcome === 'cancelled');
      expect(terminalEvents.map(event => event.kind).sort()).toEqual(['agent_end', 'error', 'tool_end']);
      expect(terminalEvents.every(event => event.runId === running.tasks[0]!.runId && event.sourceRevision === 1)).toBe(true);
      expect(terminalEvents.find(event => event.kind === 'tool_end')?.toolCallId).toBe('cancelled-read');
      expect(state(cancelled).budget).toEqual(budget);
      expect(await store.list('adaptive_activity', { ...scope, ownerId: 'different-owner' }, started.mission.id)).toEqual([]);
      expect(await store.list('adaptive_activity', { ...scope, workspaceId: 'different-workspace' }, started.mission.id)).toEqual([]);
    } finally {
      output.resolve({ title: 'Late structured success', content: 'Must not be saved.', summary: analysis.summary, adaptiveResult: { kind: 'analysis', analysis } });
      await pumping;
    }
    const cancelled = await read(started.mission.id);
    expect(cancelled.status).toBe('cancelled');
    expect(state(cancelled).analysis).toBeUndefined();
    expect(cancelled.artifacts.some(artifact => artifact.kind === 'deliverable')).toBe(false);
  });

  it('retains aborted shutdown diagnostics, discards late success, and rejects terminal events after retry', async () => {
    const reached = deferred<ExecutionTaskInput>(); const finish = deferred<void>();
    runner.run.mockImplementationOnce(async input => {
      await input.adaptive!.consume('model');
      reached.resolve(input); await finish.promise;
      await input.adaptive!.activity({ agent: 'evidence', kind: 'agent_end', outcome: 'cancelled', summary: 'Shutdown cancelled this invocation.' });
      const analysis = analysisFor(input);
      return { title: 'Late shutdown result', content: 'Must not be accepted.', summary: analysis.summary, adaptiveResult: { kind: 'analysis', analysis } };
    });
    const started = await service.start(startInput(), scope); const pumping = service.pump(); const oldInput = await reached.promise;
    const stopping = service.stop();
    finish.resolve(); await stopping; await pumping;
    const stopped = await read(started.mission.id);
    expect(stopped.activity!.some(event => event.kind === 'agent_end' && event.outcome === 'cancelled')).toBe(true);
    expect(stopped.tasks[0]!.pendingOutput).toBeUndefined();
    expect(state(stopped).analysis).toBeUndefined();
    expect(stopped.artifacts.some(artifact => artifact.title === 'Late shutdown result')).toBe(false);

    service = coordinator(); await service.recover();
    expect((await read(started.mission.id)).tasks[0]!.status).toBe('failed');
    await service.retry(started.mission.id, stopped.tasks[0]!.id, scope); await service.pump();
    const retried = await read(started.mission.id);
    expect(retried.tasks[0]!.runId).not.toBe(stopped.tasks[0]!.runId);
    expect(retried.tasks[0]!.version).toBe(stopped.tasks[0]!.version + 1);
    await expect(oldInput.adaptive!.activity({ agent: 'evidence', kind: 'agent_end', outcome: 'cancelled', summary: 'Stale shutdown event.' })).rejects.toMatchObject({ status: 409 });
    await service.updateSources(started.mission.id, scope, updateInput(retried));
    await expect(oldInput.adaptive!.activity({ agent: 'strands', kind: 'error', outcome: 'failed', summary: 'Stale source revision event.' })).rejects.toMatchObject({ status: 409 });
    expect((await read(started.mission.id)).activity!.some(event => event.summary.startsWith('Stale '))).toBe(false);
  });

  it('retains the human wait after restart and refuses workspace status edits as an implicit decision', async () => {
    const e = await begin(); const human = await provider.readTask(e.tasks[1]!.providerId!);
    await provider.updateTask(human.id, { status: 'done', description: `${human.description}\nApproved; proceed.` }, human.fingerprint, 'test-adaptive-workspace-review');
    await service.stop(); service = coordinator(); await service.recover(); await service.pump();
    const recovered = await read(e.missionId);
    expect(state(recovered).decision).toBeUndefined(); expect(runner.run).toHaveBeenCalledTimes(1);
    expect(recovered.tasks[2]!.status).toBe('queued');
    expect((await decideAndFinish(recovered)).status).toBe('needs_review');
    expect(await store.list('fixture_execution_task', scope)).toHaveLength(3);
  });

  it('reconciles an uncertain source write before analysis without duplicating the accepted document', async () => {
    const create = provider.createDocument.bind(provider); let createdId = '';
    const createSpy = vi.spyOn(provider, 'createDocument').mockImplementationOnce(async (input, operation) => {
      const saved = await create(input, operation); createdId = saved.id;
      throw new ProviderError('outcome_unknown', 'lost-source-response', 'Accepted document response was lost.', saved.id);
    });
    const blocked = await begin(); expect(blocked.status).toBe('blocked'); expect(runner.run).not.toHaveBeenCalled();
    await expect(service.updateSources(blocked.missionId, scope, updateInput(blocked))).rejects.toMatchObject({ status: 409 });
    const uncertain = blocked.operations.find(o => o.kind === 'document_create' && o.state === 'outcome_unknown')!;
    expect(uncertain.providerId).toBe(createdId);
    await service.stop(); service = coordinator(); await service.recover();
    await service.reconcile(blocked.missionId, scope, uncertain.id); await service.control(blocked.missionId, scope, 'resume'); await service.pump();
    const resumed = await read(blocked.missionId);
    expect(resumed.tasks.map(t => t.status)).toEqual(['completed', 'waiting_human', 'queued']);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect((await store.list('fixture_execution_document', scope)).filter(r => r.id === createdId)).toHaveLength(1);
    const firstInput = createSpy.mock.calls[0]![0];
    expect(createSpy.mock.calls.filter(([input]) => input.title === firstInput.title && input.content === firstInput.content)).toHaveLength(1);
  });

  it('reconciles a launch-pack write after restart without repeating the model invocation', async () => {
    const e = await begin(); const create = provider.createDocument.bind(provider); let failed = false;
    vi.spyOn(provider, 'createDocument').mockImplementation(async (input, operation) => {
      const saved = await create(input, operation);
      if (!failed && input.title.includes('Reviewed launch pack')) { failed = true; throw new ProviderError('outcome_unknown', 'lost-pack-response', 'Accepted launch pack response was lost.', saved.id); }
      return saved;
    });
    const blocked = await decideAndFinish(e); expect(blocked.status).toBe('blocked'); expect(runner.run).toHaveBeenCalledTimes(2);
    const uncertain = blocked.operations.find(o => o.state === 'outcome_unknown')!; expect(uncertain).toBeDefined();
    await expect(service.retry(e.missionId, blocked.tasks[2]!.id, scope)).rejects.toMatchObject({ status: 409 });
    await service.stop(); service = coordinator(); await service.recover();
    await service.reconcile(e.missionId, scope, uncertain.id); await service.control(e.missionId, scope, 'resume'); await service.pump();
    const final = await read(e.missionId); expect(final.status).toBe('needs_review'); expect(state(final).pack).toBeDefined();
    expect(runner.run).toHaveBeenCalledTimes(2); expect(final.artifacts.filter(a => a.title.includes('Reviewed launch pack'))).toHaveLength(1);
  });

  it('reconciles an accepted reassignment share before updating its local audience and resuming', async () => {
    const e = await begin();
    const replacementId = 'fixture-replacement-agent';
    const roster = await provider.discover();
    vi.spyOn(provider, 'discover').mockResolvedValue({ ...roster,
      agents: [...roster.agents, { id: replacementId, name: 'Replacement drafting agent', kind: 'agent' }] });
    const share = provider.shareDocument.bind(provider); let acceptedDocumentId = '';
    const sharing = vi.spyOn(provider, 'shareDocument').mockImplementation(async (id, audience, operation) => {
      const saved = await share(id, audience, operation);
      if (!acceptedDocumentId && audience.includes(replacementId)) {
        acceptedDocumentId = id;
        throw new ProviderError('outcome_unknown', 'lost-reassignment-share-response', 'Accepted share response was lost.', id);
      }
      return saved;
    });
    await service.reassign(e.missionId, e.tasks[2]!.id, scope, replacementId); await service.pump();
    const blocked = await read(e.missionId);
    expect(blocked.status).toBe('blocked');
    const uncertain = blocked.operations.find(operation => operation.kind === 'document_share' && operation.state === 'outcome_unknown')!;
    expect(uncertain.providerId).toBe(acceptedDocumentId);
    expect(blocked.artifacts.find(artifact => artifact.id === acceptedDocumentId)!.audienceIds).not.toContain(replacementId);
    expect((await provider.readDocument(acceptedDocumentId)).audienceIds).toContain(replacementId);
    expect(runner.run).toHaveBeenCalledTimes(1);

    await service.stop(); service = coordinator(); await service.recover();
    await service.reconcile(e.missionId, scope, uncertain.id); await service.control(e.missionId, scope, 'resume'); await service.pump();
    const resumed = await read(e.missionId);
    expect(resumed.tasks.map(task => task.status)).toEqual(['completed', 'waiting_human', 'queued']);
    expect((await provider.readTask(resumed.tasks[2]!.providerId!)).assigneeId).toBe(replacementId);
    expect(resumed.artifacts.map(artifact => artifact.id)).toEqual(e.artifacts.map(artifact => artifact.id));
    for (const artifact of resumed.artifacts) {
      expect(artifact.audienceIds).toEqual(['fixture-agent', 'fixture-human', replacementId].sort());
      expect((await provider.readDocument(artifact.id)).audienceIds).toEqual(artifact.audienceIds);
    }
    expect(sharing.mock.calls.filter(([id]) => id === acceptedDocumentId)).toHaveLength(1);
    const final = await decideAndFinish(resumed);
    expect(final.status).toBe('needs_review'); expect(state(final).pack).toBeDefined();
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it('binds tool reads to this mission and prevents arbitrary artifact access', async () => {
    runner.run.mockImplementationOnce(async input => {
      await expect(input.adaptive!.readSource('foreign-source')).rejects.toBeDefined();
      await expect(input.adaptive!.readArtifact('foreign-document')).rejects.toBeDefined();
      return controlledRun(input);
    });
    const e = await begin(); expect(state(e).analysis).toBeDefined();
    await expect(service.updateSources(e.missionId, { ...scope, ownerId: 'different-owner' }, updateInput(e))).rejects.toMatchObject({ status: 404 });
    await expect(service.decide(e.missionId, { ...scope, workspaceId: 'different-workspace' }, decisionInput(e))).rejects.toMatchObject({ status: 404 });
  });

  it('keeps consumed model budget across failure and retry and refuses calls beyond the cumulative cap', async () => {
    runner.run.mockImplementation(async input => {
      for (let i = 0; i < 41; i++) await input.adaptive!.consume('model');
      throw new Error('The cumulative budget must stop the runner first.');
    });
    const e = await begin(); expect(e.status).toBe('blocked');
    expect(state(e).budget.modelCalls).toBe(40); expect(e.lastError).toMatch(/budget/i);
    await service.retry(e.missionId, e.tasks[0]!.id, scope); await service.pump();
    expect(state(await read(e.missionId)).budget.modelCalls).toBe(40);
    expect((await read(e.missionId)).tasks[1]!.status).toBe('queued');
  });

  it('marks an interrupted revision analysis failed and requires a new bounded attempt after restart', async () => {
    const first = await begin();
    await service.updateSources(first.missionId, scope, updateInput(first));
    await db.transaction(async q => {
      const saved = await store.get<MissionExecution>(`execution:${first.missionId}`, 'mission_execution', scope, q);
      saved.data.tasks[0]!.status = 'running'; saved.data.tasks[0]!.runId = 'interrupted-analysis-v2';
      saved.data.budget.agentRuns++; saved.data.adaptive!.budget.modelCalls++; saved.revision++;
      await store.save(saved, scope, q);
    });
    await service.stop(); service = coordinator(); await service.recover(); await service.pump();
    const interrupted = await read(first.missionId);
    expect(interrupted.status).toBe('blocked');
    expect(interrupted.tasks[0]).toMatchObject({ status: 'failed', lastError: expect.stringContaining('interrupted') });
    expect(state(interrupted)).toMatchObject({ sourceRevision: 2, budget: { modelCalls: 2 } });
    expect(state(interrupted).analysis).toBeUndefined(); expect(state(interrupted).decision).toBeUndefined();
    expect(runner.run).toHaveBeenCalledTimes(1);
    await service.retry(first.missionId, interrupted.tasks[0]!.id, scope); await service.pump();
    const retried = await read(first.missionId);
    expect(retried.tasks.map(t => t.status)).toEqual(['completed', 'waiting_human', 'queued']);
    expect(state(retried)).toMatchObject({ sourceRevision: 2, analysis: { sourceRevision: 2 }, budget: { modelCalls: 3 } });
    expect(retried.tasks[0]!.version).toBe(interrupted.tasks[0]!.version + 1);
  });

  it('does not recover a stale candidate after another worker acquires its lease', async () => {
    const e = await begin();
    const operationId = `exec-op:${randomUUID()}`;
    const query = db.query.bind(db);
    let replacementStarted = false;
    const candidateQuery = vi.spyOn(db, 'query').mockImplementation(async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const result = await query<T>(sql, params);
      if (!replacementStarted && sql.includes('LEFT JOIN mission_execution_leases')) {
        expect(result.rows.some(row => row.mission_id === e.missionId)).toBe(true);
        replacementStarted = true;
        // Reproduce the interleaving after candidate selection, before recover's
        // transaction: a replacement worker obtains authority and begins work.
        await db.transaction(async q => {
          await q('SELECT id FROM missions WHERE id=$1 FOR UPDATE', [e.missionId]);
          await q("INSERT INTO mission_execution_leases(mission_id,holder,expires_at) VALUES($1,$2,now()+interval '2 minutes')", [e.missionId, 'newly-active-worker']);
          const saved = await store.get<MissionExecution>(`execution:${e.missionId}`, 'mission_execution', scope, q);
          saved.data.status = 'running';
          saved.data.tasks[0]!.status = 'running';
          saved.data.tasks[0]!.runId = 'newly-active-analysis';
          saved.revision++;
          await store.save(saved, scope, q);
          await store.save({ id: operationId, kind: 'execution_operation', missionId: e.missionId, revision: 1,
            data: { kind: 'document_create', state: 'running', input: { title: 'New worker output', content: 'Write in progress.' }, hash: 'new-worker-write' } }, scope, q);
        });
      }
      return result;
    });
    try { await coordinator().recover(); } finally { candidateQuery.mockRestore(); }
    expect(replacementStarted).toBe(true);
    const current = await read(e.missionId);
    expect(current.status).toBe('running');
    expect(current.tasks[0]).toMatchObject({ status: 'running', runId: 'newly-active-analysis', lastError: null });
    expect(current.operations.find(operation => operation.id === operationId)).toMatchObject({ state: 'running', error: undefined });
    expect((await db.query('SELECT holder FROM mission_execution_leases WHERE mission_id=$1', [e.missionId])).rows).toEqual([{ holder: 'newly-active-worker' }]);
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('reserves the tool budget atomically when independent agents request tools concurrently', async () => {
    const results: PromiseSettledResult<void>[] = [];
    runner.run.mockImplementationOnce(async input => {
      results.push(...await Promise.allSettled(Array.from({ length: 62 }, () => input.adaptive!.consume('tool'))));
      throw new Error('Controlled run ends after checking parallel tool reservations.');
    });
    const e = await begin();
    expect(e.status).toBe('blocked'); expect(state(e).budget.toolCalls).toBe(60);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(60);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(2);
    expect(state(e).analysis).toBeUndefined(); expect(e.tasks[2]!.status).toBe('queued');
  });

  it('never adopts changed adaptive content or permissions as fresh evidence during verification', async () => {
    const e = await decideAndFinish(await begin());
    const artifact = e.artifacts.find(a => a.kind === 'deliverable')!;
    const originalRead = provider.readDocument.bind(provider);
    const altered = vi.spyOn(provider, 'readDocument').mockImplementation(async id => {
      const saved = await originalRead(id);
      return id === artifact.id ? { ...saved, content: 'Externally replaced content.' } : saved;
    });
    await expect(service.control(e.missionId, scope, 'complete', 'I checked the saved launch pack.')).rejects.toMatchObject({status:409});
    expect((await read(e.missionId)).artifacts.find(a => a.id === artifact.id)!.content).toBe(artifact.content);
    altered.mockImplementation(async id => {
      const saved = await originalRead(id);
      return id === artifact.id ? { ...saved, audienceIds: [...saved.audienceIds, 'unapproved-recipient'] } : saved;
    });
    await expect(service.control(e.missionId, scope, 'complete', 'I checked the saved launch pack.')).rejects.toMatchObject({status:409});
    expect((await read(e.missionId)).outcomeVerification).toBeUndefined();
  });

  it('retains the fixed human decision role and respects an externally blocked reviewer task', async () => {
    const e = await begin(); const human = e.tasks[1]!;
    await expect(service.reassign(e.missionId, human.id, scope, 'fixture-agent')).rejects.toMatchObject({status:422});
    const saved = await provider.readTask(human.providerId!);
    await provider.updateTask(saved.id, {status:'blocked'}, saved.fingerprint, 'adaptive-review-block');
    await expect(service.decide(e.missionId, scope, decisionInput(e))).rejects.toMatchObject({status:409});
    expect(state(await read(e.missionId)).decision).toBeUndefined();
  });

  it('stops new Strands calls when paused while retaining consumed budget', async () => {
    const reached = deferred<ExecutionTaskInput>(); const continueRun = deferred<void>();
    runner.run.mockImplementationOnce(async input => {
      await input.adaptive!.consume('model'); reached.resolve(input); await continueRun.promise;
      await input.adaptive!.consume('model');
      return controlledRun(input);
    });
    const started = await service.start(startInput(), scope); const pumping = service.pump();
    await reached.promise; await service.control(started.mission.id, scope, 'pause'); continueRun.resolve(); await pumping;
    const paused = await read(started.mission.id);
    expect(paused.status).toBe('paused'); expect(paused.tasks[0]!.status).toBe('failed');
    expect(state(paused).budget.modelCalls).toBe(1); expect(state(paused).analysis).toBeUndefined();
  });

  it('rejects calls and late output after lease ownership is lost and recovery supersedes a run', async () => {
    const reached = deferred<ExecutionTaskInput>(); const output = deferred<ExecutionOutput>();
    runner.run.mockImplementationOnce(async input => { await input.adaptive!.consume('model'); reached.resolve(input); return output.promise; });
    const started = await service.start(startInput(), scope); const pumping = service.pump(); const input = await reached.promise;
    const analysis = analysisFor(input);
    await db.query('DELETE FROM mission_execution_leases WHERE mission_id=$1', [started.mission.id]);
    await expect(input.adaptive!.consume('tool')).rejects.toMatchObject({status:409});
    await expect(input.adaptive!.readSource('requirements')).rejects.toMatchObject({status:409});
    const replacement = coordinator(); await replacement.recover();
    output.resolve({title:'Late result',content:'Must not be saved.',summary:analysis.summary,adaptiveResult:{kind:'analysis',analysis}}); await pumping;
    const current = await read(started.mission.id);
    expect(current.tasks[0]!.status).toBe('failed'); expect(state(current).analysis).toBeUndefined();
    expect(current.artifacts.some(a=>a.title==='Late result')).toBe(false);
    expect(state(current).budget).toMatchObject({modelCalls:1,toolCalls:0});
  });

  it('does not let a stale worker error block the replacement run', async () => {
    const oldReached = deferred<ExecutionTaskInput>(); const failOld = deferred<void>();
    const replacementReached = deferred<void>(); const finishReplacement = deferred<void>();
    runner.run.mockImplementationOnce(async input => {
      await input.adaptive!.consume('model'); oldReached.resolve(input); await failOld.promise;
      throw new Error('Stale worker callback failed.');
    }).mockImplementationOnce(async input => {
      replacementReached.resolve(); await finishReplacement.promise;
      return controlledRun(input);
    });
    const started = await service.start(startInput(), scope); const oldPump = service.pump(); const oldInput = await oldReached.promise;
    const previous = await read(started.mission.id);
    await db.query('DELETE FROM mission_execution_leases WHERE mission_id=$1', [started.mission.id]);
    const replacement = coordinator(); await replacement.recover();
    await replacement.retry(started.mission.id, previous.tasks[0]!.id, scope);
    const replacementPump = replacement.pump(); await replacementReached.promise;
    const fresh = await read(started.mission.id);
    try {
      await expect(oldInput.adaptive!.activity({ agent: 'evidence', kind: 'agent_end', outcome: 'cancelled', summary: 'Superseded cancellation must not attach to the new run.' })).rejects.toMatchObject({ status: 409 });
      failOld.resolve(); await oldPump;
      const stillRunning = await read(started.mission.id);
      expect(stillRunning.status).toBe('running');
      expect(stillRunning.tasks[0]).toMatchObject({ status: 'running', runId: fresh.tasks[0]!.runId, lastError: null });
      expect(stillRunning.tasks[0]!.runId).not.toBe(previous.tasks[0]!.runId);
      expect(stillRunning.lastError).toBeNull();
      expect(stillRunning.activity!.some(event => event.summary.includes('Superseded cancellation'))).toBe(false);
      expect(state(stillRunning).budget.modelCalls).toBe(1);
    } finally { finishReplacement.resolve(); await replacementPump; }
    const finished = await read(started.mission.id);
    expect(finished.tasks.map(task => task.status)).toEqual(['completed', 'waiting_human', 'queued']);
    expect(state(finished).budget.modelCalls).toBe(2);
  });

});
