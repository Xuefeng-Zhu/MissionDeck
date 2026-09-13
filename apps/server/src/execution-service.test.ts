import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissionExecution } from '@mission/domain';
import { openDatabase, type Database, type Scope } from './database.js';
import { ExecutionService } from './execution-service.js';
import { FixtureExecutionProvider } from './execution-provider.js';
import { ModelExecutionRunner, type ExecutionOutput, type ExecutionRunner } from './execution-runner.js';
import { resolveModelConfig } from './model-provider.js';
import { UpgradeStore } from './upgrade-store.js';
import { HttpError } from './errors.js';
import { ProviderError } from './providers/types.js';

const scope: Scope = { ownerId: 'execution-owner', workspaceId: 'execution-workspace' };
const fixtureModel = () => new ModelExecutionRunner(resolveModelConfig({ MODEL_MODE: 'fixture', MODEL_PROVIDER: 'openrouter', OPENROUTER_MODEL: 'synthetic/model', OPENAI_MODEL: 'synthetic/model' }));
const startInput = () => ({ requestId: randomUUID(), goal: 'Prepare a launch brief, have me review positioning, then produce a final brief.', context: 'Product: MissionDeck. Audience: small project teams. Sources: supplied product notes only.', humanId: 'fixture-human', agentId: 'fixture-agent', maxTasks: 3, maxAgentRuns: 4 });
let db: Database;
let store: UpgradeStore;
let provider: FixtureExecutionProvider;
let service: ExecutionService;
let runner: { mode: 'fixture'; plan: ReturnType<typeof vi.fn<ExecutionRunner['plan']>>; run: ReturnType<typeof vi.fn<ExecutionRunner['run']>> };
const services: ExecutionService[] = [];

function coordinator(selectedRunner: ExecutionRunner = runner, selectedProvider = provider) {
  const selected = new ExecutionService(db, () => selectedProvider, selectedRunner);
  vi.spyOn(selected, 'wake').mockImplementation(() => {});
  services.push(selected);
  return selected;
}
const read = async (id: string) => (await service.get(id, scope))!;
const records = (kind: string) => store.list(kind, scope);
async function begin() { const started = await service.start(startInput(), scope); await service.pump(); return read(started.mission.id); }
async function reviewAndFinish(e: MissionExecution, feedback = 'Focus the positioning on shared ownership, with no unsupported claims.') {
  const review = e.tasks.find(task => task.assignee.kind === 'human')!;
  await service.review(e.missionId, review.id, scope, feedback);
  await service.pump();
  return read(e.missionId);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  db = await openDatabase({ memory: true });
  store = new UpgradeStore(db);
  provider = new FixtureExecutionProvider(store, scope);
  const model = fixtureModel();
  runner = { mode: 'fixture', plan: vi.fn(model.plan.bind(model)), run: vi.fn(model.run.bind(model)) };
  service = coordinator();
});
afterEach(async () => { await Promise.all(services.splice(0).map(item => item.stop())); await db?.close(); });

describe('durable fixture mission execution', () => {
  it('creates assigned workspace tasks, waits for a human, consumes saved feedback, and only completes after outcome verification', async () => {
    const e = await begin();
    expect(e.status).toBe('running');
    expect(e.tasks.map(task => task.status)).toEqual(['completed', 'waiting_human', 'queued']);
    expect(e.budget.agentRuns).toBe(1);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect((await records('fixture_execution_task'))).toHaveLength(3);
    expect((await records('fixture_execution_dependency'))).toHaveLength(3);
    expect(e.artifacts.map(artifact => artifact.kind).sort()).toEqual(['brief', 'deliverable']);
    for (const task of e.tasks) {
      expect(task.providerId).toMatch(/^fixture-/);
      const saved = await provider.readTask(task.providerId!);
      expect(saved.assigneeId).toBe(task.assignee.id);
      expect(saved.description).toContain(e.missionId);
    }
    for (const artifact of e.artifacts) {
      const saved = await provider.readDocument(artifact.id);
      expect(saved.content).toBe(artifact.content);
      expect(saved.audienceIds.sort()).toEqual(['fixture-agent', 'fixture-human']);
      expect(artifact.mode).toBe('fixture');
    }
    await service.pump();
    expect(runner.run).toHaveBeenCalledTimes(1);
    const feedback = 'Put shared ownership first; remove any claim of external research.';
    const finished = await reviewAndFinish(e, feedback);
    expect(finished.status).toBe('needs_review');
    expect(finished.tasks.map(task => task.status)).toEqual(['completed', 'completed', 'completed']);
    expect(finished.budget.agentRuns).toBe(2);
    expect(finished.artifacts.map(artifact => artifact.kind).sort()).toEqual(['brief', 'deliverable', 'deliverable', 'review', 'summary']);
    expect(runner.run.mock.calls[1]![0].inputs.some(input => input.content.includes(feedback))).toBe(true);
    const final = finished.artifacts.find(artifact => artifact.taskId === finished.tasks[2]!.id)!;
    expect((await provider.readDocument(final.id)).content).toContain(feedback);
    expect((await db.get(e.missionId, scope))!.criteria[0]!.verificationState).toBe('needs_verification');
    await expect(service.control(e.missionId, scope, 'complete')).rejects.toMatchObject({ status: 422 });
    await service.control(e.missionId, scope, 'complete', 'I reviewed the saved launch brief and it satisfies the supplied mission.');
    expect((await read(e.missionId)).status).toBe('completed');
    const mission = (await db.get(e.missionId, scope))!;
    expect(mission.lifecycle).toBe('completed');
    expect(mission.criteria[0]).toMatchObject({ verificationState: 'verified', attestation: { actorId: scope.ownerId } });
    await service.pump();
    expect(runner.run).toHaveBeenCalledTimes(2);
    const verification = (await read(e.missionId)).artifacts.find(artifact => artifact.kind === 'verification')!;
    expect((await provider.readDocument(verification.id)).content).toContain('I reviewed the saved launch brief');
    expect((await records('fixture_execution_document'))).toHaveLength(6);
  });

  it('deduplicates repeated and concurrent start requests and rejects changed content under the same request id', async () => {
    const input = startInput();
    const starts = await Promise.all([service.start(input, scope), service.start(input, scope), service.start(input, scope)]);
    expect(new Set(starts.map(result => result.mission.id)).size).toBe(1);
    expect(await db.list(scope)).toHaveLength(1);
    await service.pump();
    const again = await service.start(input, scope);
    expect(again.mission.id).toBe(starts[0]!.mission.id);
    await service.pump();
    expect(runner.plan).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect((await records('fixture_execution_task'))).toHaveLength(3);
    await expect(service.start({ ...input, context: 'Changed scope' }, scope)).rejects.toMatchObject({ status: 409 });
  });

  it('reconciles human feedback supplied in the workspace, while a done status alone cannot release the final task', async () => {
    const e = await begin(); const human = e.tasks[1]!;
    const before = await provider.readTask(human.providerId!);
    const done = await provider.updateTask(before.id, { status: 'done' }, before.fingerprint, 'test-human-status-only');
    await service.pump();
    expect((await read(e.missionId)).tasks[1]).toMatchObject({ status: 'waiting_human', lastError: expect.stringContaining('review feedback') });
    expect(runner.run).toHaveBeenCalledTimes(1);
    await provider.updateTask(done.id, { description: `${done.description}\n\nHuman review: emphasize shared ownership.` }, done.fingerprint, 'test-human-feedback');
    await service.pump();
    expect((await read(e.missionId)).status).toBe('needs_review');
    expect(runner.run.mock.calls[1]![0].inputs.some(input => input.content.includes('Human review: emphasize shared ownership.'))).toBe(true);
  });

  it('supplies saved outputs from transitive prerequisites when the final task depends on human review only', async () => {
    const plan = await fixtureModel().plan({ goal: startInput().goal, context: startInput().context, maxTasks: 3 });
    plan.tasks[2]!.dependencies = ['review'];
    runner.plan.mockResolvedValueOnce(plan);
    const e = await begin();
    await reviewAndFinish(e, 'Preserve the draft positioning and emphasize shared ownership.');
    const finalInputs = runner.run.mock.calls[1]![0].inputs;
    expect(finalInputs.some(input => input.title === '[Fixture] Draft from supplied mission context')).toBe(true);
    expect(finalInputs.some(input => input.content.includes('Preserve the draft positioning'))).toBe(true);
    expect(finalInputs).toHaveLength(2);
  });

  it('keeps early human work and final agents behind unsatisfied dependencies', async () => {
    const started = await service.start(startInput(), scope);
    await expect(service.review(started.mission.id, 'not-ready', scope, 'Premature approval')).rejects.toMatchObject({ status: 409 });
    runner.run.mockRejectedValueOnce(new HttpError(502, 'The draft model is unavailable.', 'execution_model_failed'));
    await service.pump();
    const e = await read(started.mission.id);
    expect(e.status).toBe('blocked');
    expect(e.tasks.map(task => task.status)).toEqual(['failed', 'queued', 'queued']);
    await expect(service.review(e.missionId, e.tasks[1]!.id, scope, 'Premature approval')).rejects.toMatchObject({ status: 409 });
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('rejects empty human feedback without releasing dependent work or creating a review artifact', async () => {
    const e = await begin();
    await expect(service.review(e.missionId, e.tasks[1]!.id, scope, '   ')).rejects.toMatchObject({ status: 422 });
    await service.pump();
    expect((await read(e.missionId)).tasks.map(task => task.status)).toEqual(['completed', 'waiting_human', 'queued']);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect((await records('fixture_execution_document'))).toHaveLength(2);
  });

  it('prevents workspace access from a different owner or workspace', async () => {
    const e = await begin();
    await expect(service.get(e.missionId, { ...scope, ownerId: 'different-owner' })).rejects.toMatchObject({ status: 404 });
    await expect(service.control(e.missionId, { ...scope, workspaceId: 'different-workspace' }, 'cancel')).rejects.toMatchObject({ status: 404 });
    expect((await read(e.missionId)).status).toBe('running');
  });
});

describe('execution controls and bounded retries', () => {
  it('pauses before dispatch, resumes within budget, and cancels without erasing existing workspace output', async () => {
    const { mission } = await service.start(startInput(), scope);
    await service.control(mission.id, scope, 'pause'); await service.pump();
    expect(runner.plan).not.toHaveBeenCalled();
    expect((await records('fixture_execution_task'))).toHaveLength(0);
    await service.control(mission.id, scope, 'resume'); await service.pump();
    const before = await read(mission.id);
    await service.control(mission.id, scope, 'pause');
    await expect(service.review(mission.id, before.tasks[1]!.id, scope, 'Feedback')).rejects.toMatchObject({ status: 409 });
    await service.control(mission.id, scope, 'cancel'); await service.pump();
    const cancelled = await read(mission.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.tasks.map(task => task.status)).toEqual(['completed', 'cancelled', 'cancelled']);
    expect(cancelled.artifacts).toEqual(before.artifacts);
    expect((await records('fixture_execution_document'))).toHaveLength(2);
    expect(runner.run).toHaveBeenCalledTimes(1);
    await expect(service.control(mission.id, scope, 'resume')).rejects.toMatchObject({ status: 409 });
  });

  it('retains a model result received while paused and saves it once on resume without a duplicate model call', async () => {
    const started = deferred<void>(); const answer = deferred<ExecutionOutput>();
    runner.run.mockImplementationOnce(async () => { started.resolve(); return answer.promise; });
    const { mission } = await service.start(startInput(), scope);
    const pumping = service.pump(); await started.promise;
    await service.control(mission.id, scope, 'pause');
    answer.resolve({ title: 'Retained draft', content: 'Draft received after pause.', summary: 'Draft only.' });
    await pumping;
    expect((await read(mission.id))).toMatchObject({ status: 'paused', budget: { agentRuns: 1 } });
    expect((await records('fixture_execution_document'))).toHaveLength(1);
    await service.control(mission.id, scope, 'resume'); await service.pump();
    const resumed = await read(mission.id);
    expect(resumed.tasks.map(task => task.status)).toEqual(['completed', 'waiting_human', 'queued']);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(resumed.artifacts.filter(artifact => artifact.title === 'Retained draft')).toHaveLength(1);
  });

  it('cancels an in-flight run, aborts the model, and never accepts the cancelled result', async () => {
    const started = deferred<void>(); let aborted = false;
    runner.run.mockImplementationOnce(async (_input, signal) => {
      started.resolve();
      return new Promise<ExecutionOutput>((_resolve, reject) => signal!.addEventListener('abort', () => { aborted = true; reject(new HttpError(499, 'Run cancelled.', 'execution_aborted')); }, { once: true }));
    });
    const { mission } = await service.start(startInput(), scope);
    const pumping = service.pump(); await started.promise;
    await service.control(mission.id, scope, 'cancel'); await pumping;
    expect(aborted).toBe(true);
    expect((await read(mission.id)).tasks.every(task => task.status === 'cancelled')).toBe(true);
    expect((await records('fixture_execution_document'))).toHaveLength(1);
  });

  it('writes a reassignment to the workspace before any work starts under the replacement assignee', async () => {
    const e = await begin(); const final = e.tasks[2]!;
    await service.reassign(e.missionId, final.id, scope, 'fixture-human');
    await service.pump();
    const reassigned = await read(e.missionId);
    expect(reassigned.status).toBe('running');
    expect((await provider.readTask(final.providerId!)).assigneeId).toBe('fixture-human');
    expect(reassigned.tasks[2]).toMatchObject({ assignee: { id: 'fixture-human', kind: 'human' }, version: 2, status: 'queued' });
    await service.review(e.missionId, e.tasks[1]!.id, scope, 'Positioning approved; prepare the final text.'); await service.pump();
    expect((await read(e.missionId)).tasks[2]!.status).toBe('waiting_human');
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('keeps a paused mission paused when changing a queued task assignee', async () => {
    const e = await begin();
    await service.control(e.missionId, scope, 'pause');
    await service.reassign(e.missionId, e.tasks[2]!.id, scope, 'fixture-human');
    await service.pump();
    expect((await read(e.missionId)).status).toBe('paused');
    expect(runner.run).toHaveBeenCalledTimes(1);
    await service.control(e.missionId, scope, 'resume'); await service.pump();
    expect((await provider.readTask(e.tasks[2]!.providerId!)).assigneeId).toBe('fixture-human');
  });

  it('counts failed calls against the authorized budget and never spends an extra run after exhaustion', async () => {
    runner.run.mockRejectedValue(new HttpError(502, 'Selected model unavailable.', 'execution_model_failed'));
    const { mission } = await service.start({ ...startInput(), maxAgentRuns: 2 }, scope);
    await service.pump();
    const e = await read(mission.id);
    expect(e.tasks[0]!.status).toBe('failed');
    await expect(service.control(mission.id, scope, 'resume')).rejects.toMatchObject({ status: 409 });
    await service.retry(mission.id, e.tasks[0]!.id, scope); await service.pump();
    const twice = await read(mission.id);
    expect(twice.budget.agentRuns).toBe(2);
    expect(twice.tasks[0]!.version).toBe(2);
    await service.retry(mission.id, e.tasks[0]!.id, scope); await service.pump();
    expect((await read(mission.id)).status).toBe('blocked');
    expect((await read(mission.id)).lastError).toContain('budget');
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect((await records('fixture_execution_task'))).toHaveLength(3);
  });

  it('can retry a failed drafting task successfully while preserving the original records', async () => {
    runner.run.mockRejectedValueOnce(new HttpError(502, 'Temporary selected-model failure.', 'execution_model_failed'));
    const e = await begin(); const providerIds = e.tasks.map(task => task.providerId);
    await service.retry(e.missionId, e.tasks[0]!.id, scope); await service.pump();
    const retried = await read(e.missionId);
    expect(retried.tasks.map(task => task.status)).toEqual(['completed', 'waiting_human', 'queued']);
    expect(retried.tasks.map(task => task.providerId)).toEqual(providerIds);
    expect(retried.budget.agentRuns).toBe(2);
    expect(retried.tasks[0]!.version).toBe(2);
  });
});

describe('restart and uncertain workspace writes', () => {
  it('blocks a paused mission after restart when runner mode changed and makes no new provider writes or model calls', async () => {
    const e = await begin();
    await service.control(e.missionId, scope, 'pause'); await service.stop();
    const switched = { mode: 'live' as const, plan: vi.fn<ExecutionRunner['plan']>(), run: vi.fn<ExecutionRunner['run']>() };
    service = coordinator(switched); await service.recover();
    await service.control(e.missionId, scope, 'resume'); await service.pump();
    expect((await read(e.missionId)).status).toBe('blocked');
    expect((await read(e.missionId)).lastError).toContain('configuration changed');
    expect(switched.plan).not.toHaveBeenCalled(); expect(switched.run).not.toHaveBeenCalled();
    expect((await records('fixture_execution_document'))).toHaveLength(2);
    expect((await records('fixture_execution_task'))).toHaveLength(3);
  });

  it('holds a durable lease so a second coordinator cannot dispatch the same ready task', async () => {
    const started = deferred<void>(); const answer = deferred<ExecutionOutput>();
    runner.run.mockImplementationOnce(async () => { started.resolve(); return answer.promise; });
    const { mission } = await service.start(startInput(), scope);
    const firstPump = service.pump(); await started.promise;
    const second = coordinator(); await second.pump();
    answer.resolve({ title: 'Single leased draft', content: 'Draft from the only dispatched worker.', summary: 'One model run.' });
    await firstPump;
    expect(runner.plan).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect((await read(mission.id)).budget.agentRuns).toBe(1);
    expect((await records('fixture_execution_task'))).toHaveLength(3);
    expect((await records('fixture_execution_document'))).toHaveLength(2);
  });

  it('resumes a saved human wait after coordinator restart without rerunning the first agent or duplicating records', async () => {
    const e = await begin();
    await service.stop(); service = coordinator(); await service.recover(); await service.pump();
    expect(runner.plan).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect((await records('fixture_execution_task'))).toHaveLength(3);
    const done = await reviewAndFinish(await read(e.missionId));
    expect(done.status).toBe('needs_review');
    expect((await records('fixture_execution_document'))).toHaveLength(5);
  });

  it('reconciles an uncertain task create after restart without repeating the create', async () => {
    const create = provider.createTask.bind(provider);
    const createSpy = vi.spyOn(provider, 'createTask').mockImplementationOnce(async (input, op) => {
      const saved = await create(input, op);
      throw new ProviderError('outcome_unknown', 'synthetic-lost-readback', 'Create was accepted but the response was lost.', saved.id);
    });
    const e = await begin();
    expect(e.status).toBe('blocked');
    expect((await records('fixture_execution_task'))).toHaveLength(1);
    const uncertain = e.operations.find(operation => operation.state === 'outcome_unknown')!;
    expect(uncertain).toMatchObject({ kind: 'task_create', providerId: expect.stringMatching(/^fixture-/) });
    await service.stop(); service = coordinator(); await service.recover();
    await service.control(e.missionId, scope, 'resume'); await service.pump();
    expect((await read(e.missionId)).status).toBe('blocked');
    expect(createSpy).toHaveBeenCalledTimes(1);
    await service.reconcile(e.missionId, scope, uncertain.id);
    await service.control(e.missionId, scope, 'resume'); await service.pump();
    const resumed = await read(e.missionId);
    expect(resumed.tasks.map(task => task.status)).toEqual(['completed', 'waiting_human', 'queued']);
    expect(createSpy).toHaveBeenCalledTimes(3);
    expect((await records('fixture_execution_task'))).toHaveLength(3);
    expect(resumed.tasks[0]!.providerId).toBe(uncertain.providerId);
  });

  it('marks an interrupted model run failed on restart and requires explicit retry within the remaining budget', async () => {
    const e = await begin();
    await db.transaction(async q => {
      const saved = await store.get<MissionExecution>(`execution:${e.missionId}`, 'mission_execution', scope, q);
      saved.data.tasks[2]!.status = 'running'; saved.data.tasks[2]!.runId = 'synthetic-interrupted-run'; saved.data.budget.agentRuns++;
      saved.revision++; await store.save(saved, scope, q);
    });
    await service.stop(); service = coordinator(); await service.recover(); await service.pump();
    const recovered = await read(e.missionId);
    expect(recovered.status).toBe('blocked');
    expect(recovered.tasks[2]).toMatchObject({ status: 'failed', lastError: expect.stringContaining('interrupted') });
    expect(recovered.budget.agentRuns).toBe(2);
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('retains the generated draft across an uncertain artifact create, reconciles it after restart, and never repeats the model call', async () => {
    const create = provider.createDocument.bind(provider);
    let count = 0;
    const createSpy = vi.spyOn(provider, 'createDocument').mockImplementation(async (input, op) => {
      const saved = await create(input, op);
      if (++count === 2) throw new ProviderError('outcome_unknown', 'synthetic-document-readback', 'The document write was accepted but its read-back was lost.', saved.id);
      return saved;
    });
    const e = await begin();
    expect(e.status).toBe('blocked');
    expect(e.tasks[0]).toMatchObject({ status: 'saving', pendingOutput: { title: expect.stringContaining('Fixture') } });
    expect(runner.run).toHaveBeenCalledTimes(1);
    const uncertain = e.operations.find(operation => operation.kind === 'document_create' && operation.state === 'outcome_unknown')!;
    expect(uncertain).toBeDefined();
    await expect(service.retry(e.missionId, e.tasks[0]!.id, scope)).rejects.toMatchObject({ status: 409 });
    await service.stop(); service = coordinator(); await service.recover();
    await service.reconcile(e.missionId, scope, uncertain.id);
    await service.control(e.missionId, scope, 'resume'); await service.pump();
    expect((await read(e.missionId)).tasks.map(task => task.status)).toEqual(['completed', 'waiting_human', 'queued']);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect((await records('fixture_execution_document'))).toHaveLength(2);
  });

  it('keeps final outcome unverified until an uncertain verification document is reconciled and shared after restart', async () => {
    const e = await reviewAndFinish(await begin());
    const create = provider.createDocument.bind(provider);
    const createSpy = vi.spyOn(provider, 'createDocument').mockImplementationOnce(async (input, op) => {
      const saved = await create(input, op);
      throw new ProviderError('outcome_unknown', 'synthetic-verification-readback', 'Verification document was accepted but not confirmed.', saved.id);
    });
    const confirmation = 'I verified the final brief satisfies the supplied mission and human review.';
    await service.control(e.missionId, scope, 'complete', confirmation);
    const blocked = await read(e.missionId);
    expect(blocked.status).toBe('blocked');
    expect((await db.get(e.missionId, scope))!.criteria[0]!.verificationState).toBe('needs_verification');
    const uncertain = blocked.operations.find(operation => operation.kind === 'document_create' && operation.state === 'outcome_unknown')!;
    await service.stop(); service = coordinator(); await service.recover();
    await service.reconcile(e.missionId, scope, uncertain.id);
    await service.control(e.missionId, scope, 'resume'); await service.pump();
    const finished = await read(e.missionId);
    expect(finished.status).toBe('completed');
    expect((await db.get(e.missionId, scope))!.criteria[0]!.verificationState).toBe('verified');
    expect(finished.artifacts.find(artifact => artifact.kind === 'verification')!.content).toContain(confirmation);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect((await records('fixture_execution_document'))).toHaveLength(6);
    expect(runner.run).toHaveBeenCalledTimes(2);
  });
});
