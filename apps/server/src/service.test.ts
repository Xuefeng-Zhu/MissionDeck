import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProposal, type Mission, type Task } from '@mission/domain';
import { openDatabase, type Database } from './database.js';
import { MissionService } from './service.js';
import {
  FileFixtureRepository, FixtureWorkProvider, MemoryFixtureRepository, ProviderError,
  type WorkProvider,
} from './providers/index.js';

const NOW = '2026-09-12T16:00:00.000Z';
const scope = { ownerId: 'local-user', workspaceId: 'local-workspace' };
const databases = new Set<Database>();
const folders: string[] = [];

afterEach(async () => {
  for (const db of databases) await db.close();
  databases.clear();
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function harness(provider?: WorkProvider) {
  const db = await openDatabase({ memory: true });
  databases.add(db);
  const fixture = new FixtureWorkProvider(new MemoryFixtureRepository(), () => new Date(NOW));
  return { service: new MissionService(db, provider ?? fixture, () => NOW), db, fixture };
}

function taskFor(mission: Mission, suffix: string): Task {
  return {
    id: `${mission.id}-${suffix}`, title: `Approved task ${suffix}`, description: 'The exact approved task description.',
    status: 'todo', executor: 'human', ownerId: scope.ownerId, dependencies: [],
    criterionIds: mission.criteria.filter((c) => c.required).map((c) => c.id),
    remainingMinutes: 20, optional: false, deferred: false,
    completionEvidence: 'Human reviews the produced artifact.', provider: null,
  };
}

async function pendingPlan(service: MissionService, count = 1) {
  let mission = await service.create(scope);
  mission = await service.mutate(mission.id, scope, (m) => { m.contract.confirmed = true; });
  const proposal = createProposal(mission, {
    kind: 'plan', title: 'Explicitly reviewed integration plan', rationale: 'Only the displayed task fields are approved.',
    operations: Array.from({ length: count }, (_, index) => ({ type: 'add_task' as const, task: taskFor(mission, `task-${index}`) })),
  }, NOW);
  await service.saveProposal(mission.id, scope, proposal);
  return { mission, proposal };
}

function wrapped(fixture: FixtureWorkProvider, overrides: Partial<WorkProvider> = {}): WorkProvider {
  return {
    mode: 'fixture', discover: () => fixture.discover(), identity: () => fixture.identity(),
    createTask: (input, context) => fixture.createTask(input, context),
    readTask: (id) => fixture.readTask(id),
    updateTask: (id, patch, context) => fixture.updateTask(id, patch, context),
    ...overrides,
  };
}

describe('durable approval and provider boundary', () => {
  it('creates nothing before approval and rejects concurrent double approval', async () => {
    const { service, db } = await harness();
    const { mission, proposal } = await pendingPlan(service, 2);
    expect((await service.get(mission.id, scope)).tasks).toHaveLength(0);
    expect((await db.query('SELECT * FROM outbox')).rows).toHaveLength(0);
    const outcomes = await Promise.allSettled([
      service.approve(mission.id, proposal.id, proposal.payloadHash, scope),
      service.approve(mission.id, proposal.id, proposal.payloadHash, scope),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const saved = await service.get(mission.id, scope);
    expect(saved.approvals).toHaveLength(1);
    expect(saved.operations).toHaveLength(2);
    expect(saved.tasks.every((task) => task.provider?.state === 'synced')).toBe(true);
    expect((await db.query('SELECT * FROM outbox')).rows).toHaveLength(2);
  });

  it('rejects a stale proposal and altered displayed hash without creating records', async () => {
    const { service, db } = await harness();
    const { mission, proposal } = await pendingPlan(service);
    await expect(service.approve(mission.id, proposal.id, 'f'.repeat(64), scope)).rejects.toMatchObject({ status: 409, code: 'payload_mismatch' });
    await service.mutate(mission.id, scope, (m) => { m.contract.assumptions.push('An explicit later change.'); });
    await expect(service.approve(mission.id, proposal.id, proposal.payloadHash, scope)).rejects.toMatchObject({ status: 409, code: 'stale_proposal' });
    expect((await db.query('SELECT * FROM outbox')).rows).toHaveLength(0);
    expect((await service.get(mission.id, scope)).approvals).toHaveLength(0);
  });

  it('does not expose another owner or workspace mission through reads or approval', async () => {
    const { service } = await harness();
    const { mission, proposal } = await pendingPlan(service);
    for (const outsider of [{ ...scope, ownerId: 'someone-else' }, { ...scope, workspaceId: 'another-workspace' }]) {
      await expect(service.get(mission.id, outsider)).rejects.toMatchObject({ status: 404 });
      await expect(service.approve(mission.id, proposal.id, proposal.payloadHash, outsider)).rejects.toMatchObject({ status: 404 });
    }
    expect((await service.get(mission.id, scope)).tasks).toHaveLength(0);
  });

  it('retains a timeout-after-write ID and reconciles by read without creating again', async () => {
    const { service, fixture } = await harness();
    let creates = 0;
    service.provider = wrapped(fixture, { createTask: async (input, context) => {
      creates++;
      const written = await fixture.createTask(input, context);
      throw new ProviderError('outcome_unknown', 'simulated_timeout', 'Simulated timeout after a possible write.', written.id);
    } });
    const { mission, proposal } = await pendingPlan(service);
    const unknown = await service.approve(mission.id, proposal.id, proposal.payloadHash, scope);
    expect(unknown.tasks[0]!.provider).toMatchObject({ state: 'outcome_unknown' });
    expect(unknown.tasks[0]!.provider!.id).toMatch(/^fixture-/);
    expect(unknown.operations[0]).toMatchObject({ state: 'outcome_unknown', reconciliation: 'required' });
    await service.drain();
    const reconciled = await service.sync(mission.id, scope);
    expect(reconciled.operations[0]).toMatchObject({ state: 'synced', reconciliation: 'reconciled' });
    expect(reconciled.tasks[0]!.provider?.state).toBe('synced');
    expect(creates).toBe(1);
  });

  it('preserves the returned ID when the service-level read-back fails', async () => {
    const { service, fixture } = await harness();
    let reads = 0;
    service.provider = wrapped(fixture, { readTask: async (id) => {
      if (++reads === 1) throw new ProviderError('failed', 'simulated_read_error', 'Simulated read-only transport failure.');
      return fixture.readTask(id);
    } });
    const { mission, proposal } = await pendingPlan(service);
    const result = await service.approve(mission.id, proposal.id, proposal.payloadHash, scope);
    expect(result.tasks[0]!.provider).toMatchObject({ state: 'outcome_unknown' });
    expect(result.tasks[0]!.provider!.id).toMatch(/^fixture-/);
    expect((await service.sync(mission.id, scope)).operations[0]?.reconciliation).toBe('reconciled');
  });

  it('shows partial creation and leaves an unknown creation without ID for inspection', async () => {
    const { service, fixture, db } = await harness();
    let creates = 0;
    service.provider = wrapped(fixture, { createTask: async (input, context) => {
      creates++;
      if (creates === 2) {
        await fixture.createTask(input, context);
        throw new ProviderError('outcome_unknown', 'simulated_missing_response', 'Simulated response lost after write; no ID was received.');
      }
      return fixture.createTask(input, context);
    } });
    const { mission, proposal } = await pendingPlan(service, 2);
    const result = await service.approve(mission.id, proposal.id, proposal.payloadHash, scope);
    expect(result.tasks.filter((t) => t.provider?.state === 'synced')).toHaveLength(1);
    expect(result.tasks.filter((t) => t.provider?.state === 'outcome_unknown')).toHaveLength(1);
    expect(result.tasks.find((t) => t.provider?.state === 'outcome_unknown')!.provider!.id).toMatch(/^pending:/);
    await service.drain();
    await service.sync(mission.id, scope);
    expect(creates).toBe(2);
    expect((await db.query("SELECT * FROM outbox WHERE state='outcome_unknown'")).rows).toHaveLength(1);
  });

  it('flags a direct provider edit as conflict and never overwrites it', async () => {
    const { service, fixture } = await harness();
    const { mission, proposal } = await pendingPlan(service);
    const initial = await service.approve(mission.id, proposal.id, proposal.payloadHash, scope);
    const task = initial.tasks[0]!;
    const change = await service.editTask(mission.id, task.id, { title: 'Old approved suggestion' }, scope);
    await fixture.updateTask(task.provider!.id, { title: 'Direct human edit' }, { operationId: 'outside_human_update', expectedFingerprint: task.provider!.fingerprint! });
    const conflict = await service.approve(mission.id, change.proposal.id, change.proposal.payloadHash, scope);
    expect(conflict.tasks[0]!.provider?.state).toBe('conflict');
    expect((await fixture.readTask(task.provider!.id)).title).toBe('Direct human edit');
    const synced = await service.sync(mission.id, scope);
    expect(synced.tasks[0]?.title).toBe('Direct human edit');
  });

  it('approves local scheduling metadata even when provider discovery is unavailable', async () => {
    const { service, fixture } = await harness();
    const { mission, proposal } = await pendingPlan(service);
    const initial = await service.approve(mission.id, proposal.id, proposal.payloadHash, scope);
    service.provider = wrapped(fixture, { discover: async () => { throw new ProviderError('failed', 'offline', 'Simulated unavailable provider.'); } });
    const local = await service.editTask(mission.id, initial.tasks[0]!.id, { remainingMinutes: 45 }, scope);
    const result = await service.approve(mission.id, local.proposal.id, local.proposal.payloadHash, scope);
    expect(result.tasks[0]?.remainingMinutes).toBe(45);
    expect(result.operations).toHaveLength(1);
    expect(result.approvals).toHaveLength(2);
  });

  it('preserves a local blocker through title-only provider updates and sync', async () => {
    const { service, fixture } = await harness();
    const { mission, proposal } = await pendingPlan(service);
    const initial = await service.approve(mission.id, proposal.id, proposal.payloadHash, scope);
    const task = initial.tasks[0]!;
    await service.mutate(mission.id, scope, (m) => {
      m.tasks[0]!.status = 'blocked';
      m.tasks[0]!.blocker = 'The test environment is unavailable.';
    });
    const edit = await service.editTask(mission.id, task.id, { title: 'Clarified blocked task' }, scope);
    const updated = await service.approve(mission.id, edit.proposal.id, edit.proposal.payloadHash, scope);
    expect(updated.tasks[0]).toMatchObject({
      title: 'Clarified blocked task', status: 'blocked',
      blocker: 'The test environment is unavailable.',
      provider: { observedStatus: 'todo', state: 'synced' },
    });
    expect((await fixture.readTask(task.provider!.id)).status).toBe('todo');
    expect(service.health(updated).health).toBe('blocked');
    const synced = await service.sync(mission.id, scope);
    expect(synced.tasks[0]!.status).toBe('blocked');
    expect(synced.tasks[0]!.provider!.observedStatus).toBe('todo');
  });

  it.each(['completed', 'archived'] as const)('does not append recovery proposals to a %s mission', async (lifecycle) => {
    const { service } = await harness();
    const { mission, proposal } = await pendingPlan(service);
    await service.approve(mission.id, proposal.id, proposal.payloadHash, scope);
    if (lifecycle === 'completed') {
      for (const criterion of mission.criteria.filter((c) => c.required)) {
        await service.verify(mission.id, criterion.id, 'I independently verified this fixture requirement.', scope);
      }
      await service.complete(mission.id, scope);
    } else {
      await service.mutate(mission.id, scope, (m) => { m.lifecycle = 'archived'; });
    }
    const before = await service.get(mission.id, scope);
    await expect(service.recovery(mission.id, scope)).rejects.toMatchObject({ status: 409, code: 'mission_closed' });
    expect(await service.get(mission.id, scope)).toEqual(before);
  });

  it('compares an explicit provider status update against observed status after local resolution', async () => {
    const { service, fixture } = await harness();
    const { mission, proposal } = await pendingPlan(service);
    const initial = await service.approve(mission.id, proposal.id, proposal.payloadHash, scope);
    const task = initial.tasks[0]!;
    await service.mutate(mission.id, scope, (m) => {
      m.tasks[0]!.status = 'blocked';
      m.tasks[0]!.blocker = 'Waiting for a test environment.';
    });
    await fixture.updateTask(task.provider!.id, { status: 'blocked' }, {
      operationId: 'human_changed_external_status', expectedFingerprint: task.provider!.fingerprint!,
    });
    await service.sync(mission.id, scope);
    const resolved = await service.mutate(mission.id, scope, (m) => {
      delete m.tasks[0]!.blocker;
      m.tasks[0]!.status = 'todo';
      m.tasks[0]!.remainingMinutes = 10;
    });
    expect(resolved.tasks[0]!.provider!.observedStatus).toBe('blocked');
    const statusEdit = await service.editTask(mission.id, task.id, { status: 'todo' }, scope);
    const updated = await service.approve(mission.id, statusEdit.proposal.id, statusEdit.proposal.payloadHash, scope);
    expect(updated.operations).toHaveLength(2);
    expect(updated.tasks[0]).toMatchObject({ status: 'todo', provider: { observedStatus: 'todo', state: 'synced' } });
    expect((await fixture.readTask(task.provider!.id)).status).toBe('todo');
  });

  it('deduplicates normalized accepted evidence without duplicating proposed tasks', async () => {
    const { service } = await harness();
    const { mission, proposal } = await pendingPlan(service);
    await service.approve(mission.id, proposal.id, proposal.payloadHash, scope);
    const capture = { text: 'A two-minute demo video is required.', title: 'Labeled fixture requirements', sourceUrl: 'https://example.com/requirements?token=do-not-store', capturedAt: NOW, captureMethod: 'selection' as const, fixture: true };
    const first = await service.capture(mission.id, capture, scope);
    const again = await service.capture(mission.id, { ...capture, text: 'A two-minute   demo video is required.' }, scope);
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.mission.evidence).toHaveLength(1);
    expect(again.mission.evidence[0]?.sourceUrl).not.toContain('token');
    expect(again.mission.proposals.filter((p) => p.kind === 'requirement')).toHaveLength(1);
  });

  it('requires criterion verification separately from provider task completion', async () => {
    const { service } = await harness();
    const { mission, proposal } = await pendingPlan(service);
    const initial = await service.approve(mission.id, proposal.id, proposal.payloadHash, scope);
    const completion = await service.editTask(mission.id, initial.tasks[0]!.id, { status: 'reported_complete' }, scope);
    const result = await service.approve(mission.id, completion.proposal.id, completion.proposal.payloadHash, scope);
    expect(result.tasks[0]!.status).toBe('reported_complete');
    await expect(service.complete(mission.id, scope)).rejects.toMatchObject({ status: 422, code: 'needs_verification' });
    expect(result.criteria.every((c) => c.verificationState === 'needs_verification')).toBe(true);
  });

  it('rehydrates approved tasks, evidence, and provider IDs after disk database reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mission-persistence-test-'));
    folders.push(directory);
    const path = join(directory, 'postgres');
    let db = await openDatabase({ path });
    databases.add(db);
    const providerPath = join(directory, 'fixture-provider.json');
    let service = new MissionService(db, new FixtureWorkProvider(new FileFixtureRepository(providerPath), () => new Date(NOW)), () => NOW);
    const { mission, proposal } = await pendingPlan(service);
    const result = await service.approve(mission.id, proposal.id, proposal.payloadHash, scope);
    const actualId = result.tasks[0]!.provider!.id;
    await service.capture(mission.id, { text: 'Synthetic persistence test evidence.', title: 'Fixture note', capturedAt: NOW, captureMethod: 'manual', fixture: true }, scope);
    await db.close();
    databases.delete(db);
    db = await openDatabase({ path });
    databases.add(db);
    service = new MissionService(db, new FixtureWorkProvider(new FileFixtureRepository(providerPath), () => new Date(NOW)), () => NOW);
    const reloaded = await service.get(mission.id, scope);
    expect(reloaded.tasks[0]!.provider!.id).toBe(actualId);
    expect(reloaded.approvals).toHaveLength(1);
    expect(reloaded.evidence).toHaveLength(1);
    const synced = await service.sync(mission.id, scope);
    expect(synced.tasks[0]!.provider!.id).toBe(actualId);
    expect(synced.tasks[0]!.provider!.state).toBe('synced');
  });
});
