import { randomUUID } from 'node:crypto';
import {
  executionStartSchema, missionSchema, adaptiveSourcesUpdateSchema, adaptiveDecisionInputSchema, adaptiveReopenSchema, adaptiveAnalysisSchema, launchPackSchema, type AdaptiveActivity, type ExecutionStart, type MissionExecution,
  type ExecutionTask, type ExecutionArtifact, type ExecutionCapabilities, type Mission,
} from '@mission/domain';
import type { Database, Scope, Query } from './database.js';
import { UpgradeStore, type UpgradeRecord } from './upgrade-store.js';
import { HttpError } from './errors.js';
import { fingerprint, ProviderError } from './providers/types.js';
import type { ExecutionWorkspaceProvider, ExecutionTaskRecord, ExecutionDocumentRecord } from './execution-provider.js';
import { validateExecutionPlan, type ExecutionRunner, type ExecutionTaskInput as RunnerTaskInput } from './execution-runner.js';
import { prepareAdaptiveSources, initialAdaptiveState, currentSources, sourceChanges, sourceDocument, validateAdaptiveCitations } from './adaptive-execution.js';
import { resolveModelConfig } from './model-provider.js';
import { config } from './config.js';
import { consumePublicDemoModelCall } from './demo-budget.js';

type WorkspaceFactory = (scope: Scope) => ExecutionWorkspaceProvider;
interface Journal {
  kind: 'task_create' | 'task_update' | 'dependency' | 'document_create' | 'document_share';
  state: 'running' | 'done' | 'failed' | 'outcome_unknown';
  input: Record<string, unknown>;
  hash: string;
  result?: unknown;
  providerId?: string;
  error?: string;
}
const key = (id: string) => `execution:${id}`;
const terminal = (e: MissionExecution) => ['completed', 'cancelled'].includes(e.status);
const active = (e: MissionExecution) => ['planning', 'running'].includes(e.status);
const message = (error: unknown) => error instanceof ProviderError || error instanceof HttpError ? error.message : 'Execution failed. Inspect the operation and retry when resolved.';
const sameAudience = (expected: ExecutionArtifact, observed: ExecutionDocumentRecord) => !expected.audienceIds || fingerprint([...expected.audienceIds].sort()) === fingerprint([...observed.audienceIds].sort());
const workspaceLabel = (e:MissionExecution) => e.mode==='fixture'?'the fixture workspace':'Ambiguous';
const demandsWorker = (e:MissionExecution) => e.status==='planning'||e.status==='running'&&(
  Boolean(e.pendingVerification)||e.tasks.some(task=>['running','saving'].includes(task.status)||task.status==='queued'&&task.dependsOn.every(id=>e.tasks.find(item=>item.id===id)?.status==='completed'))
);

/** Durable mission coordinator. Only the workspace adapter can perform external writes. */
export class ExecutionService {
  readonly store: UpgradeStore;
  private readonly holder = randomUUID();
  private pumping: Promise<void> | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private readonly aborts = new Map<string, AbortController>();
  private readonly ticking = new Set<string>();
  private workerCursor?:{at:string;id:string};
  private pollCursor?:{at:string;id:string};
  private stopped = false;
  private publicDemoLimits={maxMissions:config.PUBLIC_DEMO_MAX_MISSIONS,maxConcurrent:config.PUBLIC_DEMO_MAX_CONCURRENT,maxSourceRevisions:config.PUBLIC_DEMO_MAX_SOURCE_REVISIONS};
  constructor(readonly db: Database, readonly workspace: WorkspaceFactory, readonly runner: ExecutionRunner,
    readonly now: () => string = () => new Date().toISOString(), readonly adaptiveRunner?: ExecutionRunner) { this.store = new UpgradeStore(db); }

  configurePublicDemoLimits(limits:{maxMissions:number;maxConcurrent:number;maxSourceRevisions:number}) { this.publicDemoLimits={...limits}; }

  async abortScope(scope:Scope):Promise<void>{
    if(!scope.ownerId.startsWith('demo-user:'))return;
    const missions=await this.db.query<{mission_id:string}>("SELECT mission_id FROM upgrade_records WHERE kind='mission_execution' AND owner_id=$1 AND workspace_id=$2",[scope.ownerId,scope.workspaceId]);
    for(const mission of missions.rows)this.aborts.get(mission.mission_id)?.abort();
  }

  async abortExpiredDemoRuns():Promise<void>{
    const missions=await this.db.query<{mission_id:string}>("SELECT u.mission_id FROM upgrade_records u WHERE u.kind='mission_execution' AND u.owner_id LIKE 'demo-user:%' AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.owner_id=u.owner_id AND s.workspace_id=u.workspace_id AND s.expires_at>now())");
    for(const mission of missions.rows)this.aborts.get(mission.mission_id)?.abort();
  }

  private async assertPublicDemoWorkerCapacity(scope:Scope,q:Query,excludeMissionId?:string):Promise<void>{
    if(!scope.ownerId.startsWith('demo-user:'))return;
    const activeDemo=await q<{mission_id:string;data:MissionExecution;leased:boolean;session_live:boolean}>("SELECT u.mission_id,u.data,EXISTS (SELECT 1 FROM mission_execution_leases l WHERE l.mission_id=u.mission_id AND l.expires_at>now()) AS leased,EXISTS (SELECT 1 FROM sessions s WHERE s.owner_id=u.owner_id AND s.workspace_id=u.workspace_id AND s.expires_at>now()) AS session_live FROM upgrade_records u WHERE u.kind='mission_execution' AND u.owner_id LIKE 'demo-user:%'");
    // A call that crossed session expiry still consumes capacity until its lease
    // ends. Expiry cleanup deliberately retains leased scopes. Queued work
    // additionally requires a live session before it counts or pump() selects it.
    const activeCount=activeDemo.rows.filter(row=>row.mission_id!==excludeMissionId&&(row.leased||row.session_live&&demandsWorker(row.data))).length;
    if(activeCount>=this.publicDemoLimits.maxConcurrent)throw new HttpError(503,'The shared demo is at capacity. Try again in a few minutes.','demo_capacity');
  }

  private selectedRunner(e: MissionExecution): ExecutionRunner {
    if (e.engine !== 'strands') return this.runner;
    if (!this.adaptiveRunner) throw new HttpError(503, 'The Strands runner is not available.');
    return this.adaptiveRunner;
  }

  async capabilities(scope: Scope): Promise<ExecutionCapabilities> {
    const native = await this.workspace(scope).discover();
    const blockers = [...native.blockers, ...(this.runner.setupRequired ?? []), ...(native.mode === 'live' && this.runner.mode !== 'live' ? ['Live workspace execution requires live model mode.'] : [])];
    const selected = resolveModelConfig();
    const adaptiveBlockers = [...native.blockers, ...(this.adaptiveRunner?.setupRequired ?? []), ...(!this.adaptiveRunner || this.adaptiveRunner.mode !== 'live' ? ['Adaptive launch review requires the live Strands runner.'] : [])];
    return { ...native, adaptive: {enabled: native.enabled && !adaptiveBlockers.length, blockers: adaptiveBlockers, modelProvider: this.adaptiveRunner?.modelProvider ?? selected.provider, modelName: this.adaptiveRunner?.modelName ?? selected.model}, enabled: native.enabled && !blockers.length, blockers, modelMode: this.runner.mode, supportedWork: 'Drafting and synthesis from supplied context, with human review. The server worker cannot browse, run code, send messages, or publish.' };
  }
  async managed(id: string, scope: Scope): Promise<boolean> {
    return (await this.db.query('SELECT id FROM upgrade_records WHERE id=$1 AND kind=$2 AND owner_id=$3 AND workspace_id=$4', [key(id), 'mission_execution', scope.ownerId, scope.workspaceId])).rows.length > 0;
  }
  async get(id: string, scope: Scope): Promise<MissionExecution | null> {
    if (!await this.db.get(id, scope)) throw new HttpError(404, 'Mission not found.');
    if (!await this.managed(id, scope)) return null;
    const saved = await this.store.get<MissionExecution>(key(id), 'mission_execution', scope);
    const operations = await this.store.list<Journal>('execution_operation', scope, id);
    const activity = saved.data.adaptive ? (await this.store.list<AdaptiveActivity>('adaptive_activity',scope,id)).map(r=>r.data).reverse() : undefined;
    return { ...saved.data, ...(activity ? {activity} : {}), operations: operations.map(o => ({ id: o.id, kind: o.data.kind, state: o.data.state, providerId: o.data.providerId, error: o.data.error })) };
  }
  private async required(id: string, scope: Scope, q?: Query): Promise<MissionExecution> {
    return (await this.store.get<MissionExecution>(key(id), 'mission_execution', scope, q)).data;
  }
  private event(e: MissionExecution, text: string, taskId?: string) {
    e.events.push({ id: randomUUID(), at: this.now(), message: text, ...(taskId ? { taskId } : {}) });
    e.events = e.events.slice(-200);
  }
  private async project(e: MissionExecution, scope: Scope, q: Query) {
    const m = await this.db.get(e.missionId, scope, q); if (!m) throw new HttpError(404, 'Mission not found.');
    m.lifecycle = e.status === 'completed' ? 'completed' : 'active';
    m.health = e.status === 'blocked' ? 'blocked' : 'unknown';
    if(e.adaptive && !e.outcomeVerification) for(const c of m.criteria){c.verificationState='needs_verification';delete c.attestation;}
    if (e.outcomeVerification) for (const c of m.criteria) { c.verificationState = 'verified'; c.attestation = { actorId: e.outcomeVerification.actorId, timestamp: e.outcomeVerification.at, statement: e.outcomeVerification.statement }; }
    m.tasks = e.tasks.map(t => ({
      id: t.id, title: t.title, description: t.description, executor: t.assignee.kind, ownerId: t.assignee.id,
      status: t.status === 'completed' ? 'reported_complete' : ['blocked','failed','outcome_unknown'].includes(t.status) ? 'blocked' : ['running','saving','waiting_human'].includes(t.status) ? 'in_progress' : 'todo',
      dependencies: t.dependsOn, criterionIds: m.criteria.map(c => c.id), remainingMinutes: t.status === 'completed' ? 0 : null,
      optional: false, deferred: false, completionEvidence: t.completionCriteria.join('\n').slice(0,2000),
      provider: t.providerId ? { id: t.providerId, fingerprint: t.providerFingerprint ?? undefined, state: 'synced', ...(t.providerUrl ? { url: t.providerUrl } : {}) } : null,
      ...(t.lastError ? { blocker: t.lastError.slice(0,2000) } : {}),
    }));
    m.revision++; m.updatedAt = this.now();
    await this.db.save(m, q);
  }
  private mutate(id: string, scope: Scope, fn: (e: MissionExecution, q: Query) => void | Promise<void>) {
    return this.db.transaction(async q => {
      const record = await this.store.get<MissionExecution>(key(id), 'mission_execution', scope, q);
      const demandedBefore=demandsWorker(record.data);
      await fn(record.data,q);
      if(!demandedBefore&&demandsWorker(record.data))await this.assertPublicDemoWorkerCapacity(scope,q,id);
      record.data.updatedAt = this.now(); record.revision++;
      await this.store.save(record, scope, q); await this.project(record.data, scope, q); return record.data;
    });
  }
  async start(raw: unknown, scope: Scope): Promise<{ mission: Mission; execution: MissionExecution }> {
    const input = executionStartSchema.parse(raw); const hash = fingerprint(input);
    const existing = await this.db.query<{ data: MissionExecution }>("SELECT data FROM upgrade_records WHERE kind='mission_execution' AND owner_id=$1 AND workspace_id=$2 AND data->>'requestId'=$3", [scope.ownerId, scope.workspaceId, input.requestId]);
    if (existing.rows[0]) {
      const e = existing.rows[0].data;
      if (e.requestHash !== hash) throw new HttpError(409, 'This start request was already used for different mission content.');
      return { mission: (await this.db.get(e.missionId, scope))!, execution: (await this.get(e.missionId, scope))! };
    }
    const capabilities = await this.capabilities(scope);
    const isAdaptive = input.template === 'adaptive_launch';
    const runner = isAdaptive ? this.adaptiveRunner : this.runner;
    const enabled = isAdaptive ? capabilities.adaptive?.enabled : capabilities.enabled;
    if (!enabled || !runner) throw new HttpError(503, (isAdaptive ? capabilities.adaptive?.blockers : capabilities.blockers)?.join(' ') || 'Execution is unavailable.');
    // A simulated planner must never silently drive live workspace writes.
    if (capabilities.mode === 'live' && runner.mode !== 'live') throw new HttpError(409, 'Live workspace execution requires live model mode.');
    const human = capabilities.humans.find(p => p.id === input.humanId);
    const agent = capabilities.agents.find(p => p.id === input.agentId);
    if (!human || !agent) throw new HttpError(422, 'Choose a current human and agent from the connected workspace.');
    const sources = isAdaptive ? prepareAdaptiveSources(input.sources) : undefined;
    const id = randomUUID(); const at = this.now();
    const adaptive = isAdaptive ? initialAdaptiveState(sources!,at) : undefined;
    if(adaptive&&scope.ownerId.startsWith('demo-user:'))adaptive.budget.maxModelCalls=Math.min(adaptive.budget.maxModelCalls,config.PUBLIC_DEMO_MAX_MODEL_CALLS);
    const execution: MissionExecution = {
      missionId: id, requestId: input.requestId, requestHash: hash, status: 'planning', mode: capabilities.mode, modelMode: runner.mode,
      engine: isAdaptive ? 'strands' : 'direct', ...(adaptive ? {adaptive,modelProvider:capabilities.adaptive!.modelProvider,modelName:capabilities.adaptive!.modelName} : {}),
      goal: input.goal, context: input.context, human, agent, authorizedAssignees: [human,agent], summary: '', tasks: [], artifacts: [],
      budget: { maxTasks: isAdaptive ? 3 : input.maxTasks, maxAgentRuns: input.maxAgentRuns, agentRuns: 0 }, events: [], operations: [], lastError: null, createdAt: at, updatedAt: at,
    };
    this.event(execution, isAdaptive ? 'Adaptive mission started. Strands analysis, human decision, source documents, and launch pack delivery are authorized within the work limits.' : 'Mission started. Task creation, bounded drafting, and artifact sharing with the selected assignees are authorized.');
    const mission = missionSchema.parse({
      id, ownerId: scope.ownerId, workspaceId: scope.workspaceId, goal: input.goal, deadline: new Date(Date.parse(at) + 7 * 86400000).toISOString(), timezone: 'UTC', lifecycle: 'active', health: 'unknown', revision: 0,
      contract: { confirmed: true, outcome: input.goal, constraints: [isAdaptive ? 'Analyze reviewed source snapshots with Strands; generate a launch pack after a versioned human decision.' : 'Draft and synthesize supplied context only.'], forbiddenActions: ['Send messages', 'Publish', 'Execute code', 'Browse external sources'], humanOwner: scope.ownerId,
        approvedCapabilities: ['Create assigned mission tasks and dependencies', 'Create and share mission documents with selected assignees', 'Run bounded drafting tasks'], assumptions: ['No deadline supplied; displayed date is a planning placeholder.'], unresolvedQuestions: [] },
      criteria: [{ id: `${id}-outcome`, title: input.goal, required: true, verificationMethod: 'Human reviews the saved deliverables against the mission outcome.', verificationState: 'needs_verification', evidenceIds: [] }],
      tasks: [], evidence: [], proposals: [], approvals: [], operations: [], artifacts: [], events: [], createdAt: at, updatedAt: at,
    });
    // Deduplication and persistence share the transaction gate, including concurrent requests.
    const result = await this.db.transaction(async q => {
      const duplicate = await q<{ data: MissionExecution }>("SELECT data FROM upgrade_records WHERE kind='mission_execution' AND owner_id=$1 AND workspace_id=$2 AND data->>'requestId'=$3", [scope.ownerId, scope.workspaceId, input.requestId]);
      if (duplicate.rows[0]) {
        if (duplicate.rows[0].data.requestHash !== hash) throw new HttpError(409, 'Start request content changed.');
        return { mission: (await this.db.get(duplicate.rows[0].data.missionId, scope, q))!, execution: duplicate.rows[0].data };
      }
      if(scope.ownerId.startsWith('demo-user:')){
        const own=await q('SELECT id FROM missions WHERE owner_id=$1 AND workspace_id=$2 LIMIT $3',[scope.ownerId,scope.workspaceId,this.publicDemoLimits.maxMissions]);
        if(own.rows.length>=this.publicDemoLimits.maxMissions)throw new HttpError(429,'This isolated demo session has used its mission allowance. Start a new session later to protect the shared demo budget.','demo_quota');
        await this.assertPublicDemoWorkerCapacity(scope,q);
      }
      await this.db.save(mission, q);
      await this.store.save({ id: key(id), kind: 'mission_execution', missionId: id, revision: 1, data: execution }, scope, q);
      return { mission, execution };
    });
    this.wake(); return result;
  }

  private async assertActive(id: string, scope: Scope) {
    const e = await this.required(id, scope);
    if (!active(e) || this.stopped) throw new HttpError(409, 'Mission is paused, blocked, cancelled, or complete.');
    const runner=this.selectedRunner(e);
    if(e.mode!==this.workspace(scope).mode || e.modelMode!==runner.mode || e.mode==='live'&&runner.mode!=='live' || e.adaptive && ((runner.modelProvider && runner.modelProvider!==e.modelProvider)||(runner.modelName && runner.modelName!==e.modelName)))throw new HttpError(409,'Execution configuration changed. Restore the original workspace and model modes before resuming.');
    const lease = await this.db.query('SELECT holder FROM mission_execution_leases WHERE mission_id=$1 AND holder=$2 AND expires_at>now()', [id, this.holder]);
    if (!lease.rows.length) throw new HttpError(409, 'Execution lease expired; stop and reconcile before continuing.');
  }
  private async operation<T>(e: MissionExecution, scope: Scope, step: string, kind: Journal['kind'], input: Record<string, unknown>, perform: (operationId: string) => Promise<T>): Promise<T> {
    await this.assertActive(e.missionId, scope);
    const id = `exec-op:${fingerprint({ missionId: e.missionId, step })}`; const hash = fingerprint(input);
    const claim = await this.db.transaction(async q => {
      const found = await q<{ data: Journal; revision: number }>('SELECT data,revision FROM upgrade_records WHERE id=$1 AND kind=$2 AND owner_id=$3 AND workspace_id=$4', [id, 'execution_operation', scope.ownerId, scope.workspaceId]);
      const old = found.rows[0];
      if (old && old.data.hash !== hash) throw new HttpError(409, 'Operation input changed. Reconcile the original work before continuing.');
      if (old?.data.state === 'done') return { result: old.data.result as T };
      if (old && ['running','outcome_unknown'].includes(old.data.state)) throw new ProviderError('outcome_unknown', 'reconcile_required', 'An earlier write needs reconciliation before work can continue.', old.data.providerId);
      const data: Journal = { kind, state: 'running', input, hash, ...(typeof input.id === 'string' ? { providerId: input.id } : {}) };
      await this.store.save({ id, kind: 'execution_operation', missionId: e.missionId, revision: (old?.revision ?? 0) + 1, data }, scope, q);
      return null;
    });
    if (claim) return claim.result;
    try {
      await this.assertActive(e.missionId, scope);
      const result = await perform(id.replace(':','_'));
      await this.db.transaction(async q => {
        const r = await this.store.get<Journal>(id, 'execution_operation', scope, q);
        r.revision++; r.data.state = 'done'; r.data.result = result;
        if (result && typeof result === 'object' && 'id' in result && typeof result.id === 'string') r.data.providerId = result.id;
        await this.store.save(r, scope, q);
      });
      return result;
    } catch (error) {
      await this.db.transaction(async q => {
        const r = await this.store.get<Journal>(id, 'execution_operation', scope, q);
        r.revision++; r.data.state = error instanceof ProviderError ? error.state === 'outcome_unknown' ? 'outcome_unknown' : 'failed' : error instanceof HttpError ? 'failed' : 'outcome_unknown';
        r.data.error = message(error); if (error instanceof ProviderError && error.providerId) r.data.providerId = error.providerId;
        await this.store.save(r, scope, q);
      });
      throw error;
    }
  }
  private async saveDocument(e: MissionExecution, scope: Scope, step: string, title: string, content: string, kind: ExecutionArtifact['kind'], taskId: string | null) {
    if (!title.trim() || title.length > 255 || !content.trim() || content.length > 50000) throw new HttpError(422, 'The combined document exceeds supported limits. No document write was attempted; reduce the task output or source material.');
    const provider = this.workspace(scope);
    const doc = await this.operation(e, scope, `${step}:create`, 'document_create', { title, content }, op => provider.createDocument({ title, content }, op));
    const audience = [...new Set((e.authorizedAssignees ?? [e.human,e.agent]).map(p => p.id))].sort();
    const expectedAudienceIds = [...new Set([...audience,...doc.audienceIds])].sort();
    const shared = await this.operation(e, scope, `${step}:share:${fingerprint(audience)}`, 'document_share', { id: doc.id, audienceIds: audience, expectedAudienceIds }, op => provider.shareDocument(doc.id, audience, op));
    const artifact: ExecutionArtifact = { id: shared.id, title: shared.title, content: shared.content, url: shared.url, fingerprint: shared.fingerprint, taskId, kind, verifiedAt: this.now(), mode: provider.mode, audienceIds: shared.audienceIds, ...(e.adaptive?{sourceRevision:e.adaptive.sourceRevision}:{}) };
    await this.mutate(e.missionId, scope, current => {
      if (!current.artifacts.some(a => a.id === artifact.id)) { current.artifacts.push(artifact); this.event(current, `Saved and verified ${artifact.title}.`, taskId ?? undefined); }
      if (taskId) { const t = current.tasks.find(t => t.id === taskId)!; if (!t.artifacts.includes(artifact.id)) t.artifacts.push(artifact.id); }
    });
    return artifact;
  }
  private async updateTask(e: MissionExecution, scope: Scope, t: ExecutionTask, step: string, patch: { description?: string; status?: 'todo' | 'in_progress' | 'done' | 'cancelled' | 'blocked'; assigneeId?: string }) {
    const provider = this.workspace(scope);
    const operationKey = `exec-op:${fingerprint({ missionId: e.missionId, step })}`;
    const prior = await this.db.query<{data:Journal}>('SELECT data FROM upgrade_records WHERE id=$1 AND owner_id=$2 AND workspace_id=$3', [operationKey, scope.ownerId, scope.workspaceId]);
    // An acknowledged step may outlive the following local projection commit. Replay its
    // immutable original input, including the original fingerprint, rather than deriving a new write.
    const input = (prior.rows[0]?.data.input ?? { id: t.providerId!, patch, expectedFingerprint: t.providerFingerprint! }) as {id:string;patch:typeof patch;expectedFingerprint:string};
    const observed = await this.operation(e, scope, step, 'task_update', input, async op => {
      const task = (await this.required(e.missionId,scope)).tasks.find(item=>item.id===t.id)!;
      if(task.version!==t.version)throw new HttpError(409,'Task assignment changed before the workspace update.','assignment_changed');
      return provider.updateTask(input.id, input.patch, input.expectedFingerprint, op);
    });
    await this.mutate(e.missionId, scope, current => this.observe(current.tasks.find(item => item.id === t.id)!, observed));
    return observed;
  }
  private observe(t: ExecutionTask, observed: ExecutionTaskRecord) {
    t.providerId = observed.id; t.providerUrl = observed.url; t.providerFingerprint = observed.fingerprint; t.providerDescription = observed.description;
  }
  private description(e: MissionExecution, t: ExecutionTask, brief?: ExecutionArtifact): string {
    const dependencies = t.dependsOn.map(id => { const d = e.tasks.find(t => t.id === id)!; return `${d.title}: ${d.providerId ?? d.id}`; }).join('\n');
    return `Mission: ${e.goal}\nMission ID: ${e.missionId}\nTask ID: ${t.id}${brief ? `\nMission brief document ID: ${brief.id}` : ''}\nExecutor: ${t.assignee.name} (${t.assignee.kind}); ${t.assignee.kind === 'agent' ? e.adaptive ? 'Strands server worker' : 'MissionDeck server drafting worker' : 'human work'}\n\n${t.description}\n\nCompletion criteria:\n${t.completionCriteria.map(c => `- ${c}`).join('\n')}\nDependencies:\n${dependencies || 'None'}\n${e.adaptive && t.assignee.kind==='human' ? 'Choose a versioned decision in MissionDeck. Marking this task done alone cannot authorize a decision.' : t.assignee.kind === 'human' ? `When ready, append your review feedback to this description and mark done in ${workspaceLabel(e)}, or submit feedback in MissionDeck.` : `Outputs are saved in ${workspaceLabel(e)} and linked here.`}`;
  }
  private async provision(e: MissionExecution, scope: Scope) {
    const provider = this.workspace(scope);
    for (const task of e.tasks) {
      if (task.providerId) continue;
      const input = { title: task.title, description: this.description(e, task), status: 'todo' as const, assigneeId: task.assignee.id };
      const created = await this.operation(e, scope, `task:${task.id}:create`, 'task_create', input, op => provider.createTask(input, op));
      e = await this.mutate(e.missionId, scope, current => this.observe(current.tasks.find(t => t.id === task.id)!, created));
    }
    for (const t of e.tasks) for (const dependency of t.dependsOn) {
      const target = e.tasks.find(t => t.id === dependency)!;
      await this.operation(e, scope, `dependency:${t.id}:${target.id}`, 'dependency', { taskId: t.providerId!, dependencyId: target.providerId! }, op => provider.addDependency(t.providerId!, target.providerId!, op));
    }
    if(e.adaptive){
      for(const source of currentSources(e.adaptive)){
        if(source.documentId) continue;
        const document=await this.saveDocument(e,scope,`source:v${e.adaptive!.sourceRevision}:${source.id}`,`Source v${e.adaptive!.sourceRevision}: ${source.title}`.slice(0,255),sourceDocument(source,e.adaptive!.sourceRevision),'brief',null);
        e=await this.mutate(e.missionId,scope,current=>{currentSources(current.adaptive!).find(s=>s.id===source.id)!.documentId=document.id;});
      }
    }
    let brief = e.artifacts.find(a => a.kind === 'brief' && (!e.adaptive || a.title.startsWith('Mission brief:') && a.sourceRevision === e.adaptive.sourceRevision));
    if (!brief) {
      const content = `Mission: ${e.goal}\n\n${e.summary}\n\nSupplied context and evidence:\n${e.context || 'No additional context supplied.'}\n\nTask index:\n${e.tasks.map(t => `${t.title}\nTask ID: ${t.providerId}\nAssigned to: ${t.assignee.name}\nDependencies: ${t.dependsOn.map(id => e.tasks.find(t => t.id === id)!.providerId).join(', ') || 'None'}\nDeliverable: ${t.completionCriteria.join('; ')}`).join('\n\n')}\n\nExecution: MissionDeck bounded server worker. Final mission completion requires human verification.`;
      brief = await this.saveDocument(e, scope, e.adaptive ? `brief:v${e.adaptive.sourceRevision}` : 'brief', `Mission brief: ${e.goal}`.slice(0,255), content, 'brief', null);
    }
    e = await this.required(e.missionId, scope);
    // Explicit reassignment can authorize an additional workspace member. Share existing
    // inputs before that assignee becomes eligible; retain earlier authorized recipients.
    if ((e.authorizedAssignees?.length ?? 2) > 2) {
      const audience = [...new Set(e.authorizedAssignees!.map(p=>p.id))].sort();
      for (const artifact of e.artifacts) {
        const original = await provider.readDocument(artifact.id);
        const expectedAudienceIds = [...new Set([...audience,...original.audienceIds])].sort();
        // Unexpected sharing is not silently adopted as new authority.
        const baseline=artifact.audienceIds??[];
        const authorizedAudience=new Set([...baseline,...audience]);
        // A successful or reconciled share can precede its local projection after
        // interruption. Accept those authorized additions, never outsiders/removal.
        if (e.adaptive && (baseline.some(p=>!original.audienceIds.includes(p)) || original.audienceIds.some(p=>!authorizedAudience.has(p))) || original.audienceIds.some(p=>!audience.includes(p)) && e.mode==='fixture') throw new HttpError(409,'Artifact audience changed outside mission authority.');
        const shared=await this.operation(e,scope,`audience:${artifact.id}:${fingerprint(audience)}`,'document_share',{id:artifact.id,audienceIds:audience,expectedAudienceIds},op=>provider.shareDocument(artifact.id,audience,op));
        await this.mutate(e.missionId,scope,current=>{current.artifacts.find(a=>a.id===artifact.id)!.audienceIds=shared.audienceIds;});
      }
    }
    for (const t of e.tasks) {
      // The durable update can be replayed after a crash; use the original baseline once.
      if (!t.assignmentPending && t.providerDescription?.includes(`Mission brief document ID: ${brief.id}`)) continue;
      const description = t.assignmentPending && t.providerDescription
        ? `${t.providerDescription}\n${e.adaptive ? `Source revision ${e.adaptive.sourceRevision}; assigned to` : 'Assignment updated:'} ${t.assignee.name} (${t.assignee.kind})\nMission brief document ID: ${brief.id}`
        : this.description(e, t, brief);
      if (description.length > 20000) throw new HttpError(422, 'The task description is too large to append the mission linkage. Existing content was preserved.');
      await this.updateTask(e, scope, t, `task:${t.id}:v${t.version}:link`, { description, assigneeId: t.assignee.id, ...(t.assignmentPending ? {status:'todo' as const} : {}) });
      await this.mutate(e.missionId, scope, current => { current.tasks.find(item => item.id === t.id)!.assignmentPending = false; });
    }
    await this.mutate(e.missionId, scope, current => { if (current.status === 'planning') { current.status = 'running'; this.event(current, 'Tasks, assignments, dependencies, and mission brief are saved in the workspace.'); } });
  }
  private async finishTask(e: MissionExecution, scope: Scope, t: ExecutionTask) {
    if (!t.pendingOutput) throw new HttpError(409, 'Task output is missing.');
    const output = t.pendingOutput;
    const content = `${output.content}\n\nExecution summary: ${output.summary}\nMission ID: ${e.missionId}\nTask ID: ${t.providerId}\nRun ID: ${t.runId ?? 'human-review'}${e.adaptive ? `\nSource revision: ${e.adaptive.sourceRevision}\nEngine: Strands\nModel: ${e.modelProvider}/${e.modelName}` : ''}\nCompletion criteria: ${t.completionCriteria.join('; ')}`;
    const artifact = await this.saveDocument(e, scope, `task:${t.id}:v${t.version}:output`, output.title.slice(0,255), content, t.assignee.kind === 'human' ? 'review' : 'deliverable', t.id);
    e = await this.required(e.missionId, scope); t = e.tasks.find(item => item.id === t.id)!;
    if (!t.completionDescription) {
      const description = `${t.providerDescription ?? t.description}\n\nSaved output document ID: ${artifact.id}\n${output.summary}`;
      if (description.length > 20000) throw new HttpError(422, 'The task description exceeds the supported limit. The output document is saved; existing task content was preserved.');
      e = await this.mutate(e.missionId, scope, current => { current.tasks.find(item => item.id === t.id)!.completionDescription = description; });
      t = e.tasks.find(item => item.id === t.id)!;
    }
    const description = t.completionDescription!;
    await this.updateTask(e, scope, t, `task:${t.id}:v${t.version}:complete`, { status: 'done', description });
    await this.mutate(e.missionId, scope, current => {
      const task = current.tasks.find(item => item.id === t.id)!;
      task.status = 'completed'; task.runFinishedAt = this.now(); task.lastError = null; delete task.pendingOutput;
      if(current.adaptive && output.adaptiveResult){
        const a=current.adaptive;const result=output.adaptiveResult;
        if(result.kind==='analysis')a.analysis={version:fingerprint({sourceRevision:a.sourceRevision,runId:task.runId,result:result.analysis}),sourceRevision:a.sourceRevision,value:result.analysis};
        else a.pack={sourceRevision:a.sourceRevision,value:result.pack};
        a.revision++;
      }
      this.event(current, `${task.title} delivered a verified workspace artifact.`, task.id);
    });
  }

  /** Every model/tool call reserves its budget before dispatch. Activity is a separate record. */
  private adaptiveRunContext(e:MissionExecution,scope:Scope,t:ExecutionTask,signal:AbortSignal):NonNullable<RunnerTaskInput['adaptive']> {
    const a=e.adaptive!;const sources=currentSources(a);const provider=this.workspace(scope);
    const artifacts=e.artifacts.filter(item=>item.sourceRevision===a.sourceRevision && item.taskId && t.dependsOn.includes(item.taskId));
    const ensureCurrent=async(q:Query=this.db.query,allowStoppedActivity=false)=>{
      if(signal.aborted&&!allowStoppedActivity)throw new HttpError(499,'The Strands run was cancelled.');
      const current=await this.required(e.missionId,scope,q);const task=current.tasks.find(task=>task.id===t.id);
      const stoppedActivity=allowStoppedActivity&&(signal.aborted||current.status==='cancelled');
      if(current.adaptive?.sourceRevision!==a.sourceRevision||task?.version!==t.version||task.runId!==t.runId
        ||terminal(current)&&!(stoppedActivity&&current.status==='cancelled')
        ||task.status!=='running'&&!(stoppedActivity&&task.status==='cancelled'))throw new HttpError(409,'This Strands run has been superseded.');
      // A cancelled invocation may record only its failed/cancelled end, even after
      // releasing its lease. This never authorizes reads, calls, or late output.
      if(stoppedActivity)return current;
      const lease=await q('SELECT holder FROM mission_execution_leases WHERE mission_id=$1 AND holder=$2 AND expires_at>now()',[e.missionId,this.holder]);
      if(!lease.rows.length)throw new HttpError(409,'This Strands run lost its execution lease. Reconcile before retrying.');
      return current;
    };
    return {stage:t.id===e.tasks[0]?.id?'analysis':'launch_pack',sourceRevision:a.sourceRevision,sources,
      analysis:a.analysis?.value,decision:a.decision,previousPack:a.previousPack,
      artifacts:artifacts.map(item=>({id:item.id,title:item.title,content:item.content})),
      readSource:async id=>{
        await ensureCurrent();const source=sources.find(s=>s.id===id);
        if(!source?.documentId)throw new HttpError(403,'This source is not available to the current mission run.');
        const saved=await provider.readDocument(source.documentId);
        const expected=e.artifacts.find(item=>item.id===source.documentId);
        if(saved.content!==sourceDocument(source,a.sourceRevision)||!expected||saved.title!==expected.title||!sameAudience(expected,saved))throw new HttpError(409,'A saved source or its sharing changed. Review and update its snapshot before continuing.');
        return source.content;
      },
      readArtifact:async id=>{
        await ensureCurrent();const expected=artifacts.find(item=>item.id===id);
        if(!expected)throw new HttpError(403,'This artifact is not available to the current mission run.');
        const saved=await provider.readDocument(id);
        if(saved.content!==expected.content||saved.title!==expected.title||!sameAudience(expected,saved))throw new HttpError(409,'A saved input artifact or its sharing changed. Review the updated input before continuing.');
        return saved.content;
      },
      consume:async kind=>this.db.transaction(async q=>{
        const current=await ensureCurrent(q);
        if(!active(current))throw new HttpError(409,'The mission is paused or blocked. No further Strands calls may start.');
        const record=await this.store.get<MissionExecution>(key(e.missionId),'mission_execution',scope,q);
        const budget=record.data.adaptive!.budget;const field=kind==='model'?'modelCalls':'toolCalls';const limit=kind==='model'?'maxModelCalls':'maxToolCalls';
        if(budget[field]>=budget[limit])throw new HttpError(409,`The mission ${kind} call budget is exhausted.`,'adaptive_budget_exhausted');
        if(kind==='model'&&scope.ownerId.startsWith('demo-user:'))await consumePublicDemoModelCall(q,config.PUBLIC_DEMO_DAILY_MODEL_LIMIT);
        budget[field]++;record.revision++;record.data.updatedAt=this.now();await this.store.save(record,scope,q);
      }),
      activity:async event=>this.db.transaction(async q=>{
        const stoppedEvent=['agent_end','tool_end','error'].includes(event.kind)&&['cancelled','failed'].includes(event.outcome??'');
        // Serialize the terminal exception with replacement runs and source changes.
        if(stoppedEvent)await q('SELECT id FROM upgrade_records WHERE id=$1 AND kind=$2 AND owner_id=$3 AND workspace_id=$4 FOR SHARE',[key(e.missionId),'mission_execution',scope.ownerId,scope.workspaceId]);
        await ensureCurrent(q,stoppedEvent);
        const data:AdaptiveActivity={...event,agent:event.agent.slice(0,100),summary:event.summary.slice(0,500),id:randomUUID(),runId:t.runId!,sourceRevision:a.sourceRevision,at:this.now()};
        await this.store.save({id:data.id,kind:'adaptive_activity',missionId:e.missionId,revision:1,data},scope,q);
        // Bounded persistent activity; cumulative usage lives separately in the mission budget.
        await q("DELETE FROM upgrade_records WHERE kind='adaptive_activity' AND mission_id=$1 AND owner_id=$2 AND workspace_id=$3 AND id NOT IN (SELECT id FROM upgrade_records WHERE kind='adaptive_activity' AND mission_id=$1 AND owner_id=$2 AND workspace_id=$3 ORDER BY updated_at DESC,id DESC LIMIT 200)",[e.missionId,scope.ownerId,scope.workspaceId]);
      }),
    };
  }

  private async adaptiveMutation(id:string,scope:Scope,action:string,input:{requestId:string;expectedRevision:number},change:(e:MissionExecution,q:Query)=>Promise<void>|void) {
    await this.db.transaction(async q=>{
      await q('SELECT id FROM missions WHERE id=$1 AND owner_id=$2 AND workspace_id=$3 FOR UPDATE',[id,scope.ownerId,scope.workspaceId]);
      const requestKey=`adaptive-request:${fingerprint({id,action,requestId:input.requestId})}`;const hash=fingerprint(input);
      const old=await q<{data:{hash:string}}>('SELECT data FROM upgrade_records WHERE id=$1 AND kind=$2 AND owner_id=$3 AND workspace_id=$4',[requestKey,'adaptive_request',scope.ownerId,scope.workspaceId]);
      if(old.rows[0]){if(old.rows[0].data.hash!==hash)throw new HttpError(409,'This request ID was already used for a different change.');return;}
      const record=await this.store.get<MissionExecution>(key(id),'mission_execution',scope,q);const e=record.data;
      if(!e.adaptive||e.engine!=='strands')throw new HttpError(409,'This mission does not use adaptive launch review.');
      if(e.adaptive.revision!==input.expectedRevision)throw new HttpError(409,'The mission changed. Refresh before applying this decision or source update.');
      const lease=await q('SELECT holder FROM mission_execution_leases WHERE mission_id=$1 AND expires_at>now()',[id]);
      const pending=await q("SELECT id FROM upgrade_records WHERE kind='execution_operation' AND mission_id=$1 AND owner_id=$2 AND workspace_id=$3 AND data->>'state' IN ('running','outcome_unknown') LIMIT 1",[id,scope.ownerId,scope.workspaceId]);
      if(lease.rows.length||pending.rows.length||e.tasks.some(t=>['running','saving','outcome_unknown'].includes(t.status)))throw new HttpError(409,'Work is running, saving, or awaiting reconciliation. Retry this change when the mission is idle.');
      if(e.status==='cancelled')throw new HttpError(409,'Cancelled missions cannot be changed.');
      const mission=await this.db.get(id,scope,q);if(mission?.lifecycle==='archived')throw new HttpError(409,'Archived missions cannot be changed.');
      const demandedBefore=demandsWorker(e);
      await change(e,q);
      if(!demandedBefore&&demandsWorker(e))await this.assertPublicDemoWorkerCapacity(scope,q,id);
      record.revision++;e.updatedAt=this.now();await this.store.save(record,scope,q);await this.project(e,scope,q);
      await this.store.save({id:requestKey,kind:'adaptive_request',missionId:id,revision:1,data:{hash,action,at:this.now()}},scope,q);
    });
    this.wake();return this.get(id,scope);
  }

  async updateSources(id:string,scope:Scope,raw:unknown) {
    const input=adaptiveSourcesUpdateSchema.parse(raw);
    return this.adaptiveMutation(id,scope,'sources',input,async(e,q)=>{
      if(e.status==='completed')throw new HttpError(409,'Reopen this mission before updating its sources.');
      const sources=prepareAdaptiveSources(input.sources,(await this.db.get(id,scope,q))!);const a=e.adaptive!;const before=currentSources(a);
      if(fingerprint(before.map(({documentId,...s})=>s))===fingerprint(sources))return;
      if(scope.ownerId.startsWith('demo-user:')&&a.sourceRevision>=this.publicDemoLimits.maxSourceRevisions)throw new HttpError(429,'This demo has reached its source revision limit. Review the current Decision Receipt instead.','demo_quota');
      if(!e.tasks.length)throw new HttpError(409,'Wait for the initial mission tasks before updating sources.');
      const summary=sourceChanges(before,sources);a.sourceRevision++;a.revision++;
      a.sourceHistory.push({revision:a.sourceRevision,sources,createdAt:this.now(),changeSummary:summary});
      a.previousPack=a.pack?.value ?? a.previousPack;delete a.pack;delete a.analysis;delete a.decision;
      delete e.outcomeVerification;delete e.pendingVerification;
      for(const t of e.tasks){t.version++;t.status='queued';t.artifacts=[];t.runId=null;t.runStartedAt=null;t.runFinishedAt=null;t.lastError=null;t.assignmentPending=true;delete t.pendingOutput;delete t.reviewFeedback;delete t.completionDescription;}
      e.status='planning';e.lastError=null;e.summary=`Source revision ${a.sourceRevision}: ${summary}`;
      this.event(e,`${summary}. Previous analysis, decision, and deliverables are historical; a fresh decision will be required.`);
    });
  }

  async decide(id:string,scope:Scope,raw:unknown) {
    const input=adaptiveDecisionInputSchema.parse(raw);
    const before=await this.required(id,scope);const review=before.tasks[1];
    const observed=review?.providerId && review.status==='waiting_human' ? await this.workspace(scope).readTask(review.providerId):null;
    return this.adaptiveMutation(id,scope,'decision',input,e=>{
      if(!active(e))throw new HttpError(409,'Resume the mission before submitting a decision.');
      const a=e.adaptive!;const analysis=a.analysis;const t=e.tasks[1];
      if(!analysis||analysis.version!==input.analysisVersion||analysis.sourceRevision!==a.sourceRevision||!t||t.assignee.kind!=='human'||t.status!=='waiting_human')throw new HttpError(409,'This decision brief is stale or is not ready for human input.');
      if(observed){if(observed.assigneeId!==t.assignee.id||observed.title!==t.title||['cancelled','blocked'].includes(observed.status))throw new HttpError(409,'The human task changed ownership, title, or availability. Review its assignment first.');this.observe(t,observed);}
      const option=analysis.value.options.find(o=>o.id===input.optionId);if(!option)throw new HttpError(422,'Choose an option from the current decision brief.');
      a.decision={optionId:option.id,constraints:input.constraints,actorId:scope.ownerId,at:this.now(),sourceRevision:a.sourceRevision,analysisVersion:analysis.version};a.revision++;
      t.status='saving';t.pendingOutput={title:`Launch decision v${a.sourceRevision}`,content:`# Human launch decision\n\nSource revision: ${a.sourceRevision}\nAnalysis version: ${analysis.version}\nActor: ${scope.ownerId}\nTime: ${a.decision.at}\n\nSelected option: ${option.label} (${option.id})\n${option.description}\n\nConsequences:\n${option.consequences.map(c=>`- ${c}`).join('\n')}\n\nAdditional constraints:\n${input.constraints||'None.'}`,summary:`The mission owner selected ${option.label} for source revision ${a.sourceRevision}.`};
      this.event(e,'Human decision recorded; dependent work starts after it is saved and verified.',t.id);
    });
  }

  async reopen(id:string,scope:Scope,raw:unknown) {
    const input=adaptiveReopenSchema.parse(raw);
    return this.adaptiveMutation(id,scope,'reopen',input,e=>{
      if(e.status!=='completed')throw new HttpError(409,'Only completed adaptive missions can be reopened.');
      delete e.outcomeVerification;delete e.pendingVerification;e.adaptive!.revision++;e.status='needs_review';
      this.event(e,'Mission reopened. Update the reviewed sources to run a new analysis.');
    });
  }
  private async taskStep(e: MissionExecution, scope: Scope, taskId: string) {
    let t = e.tasks.find(t => t.id === taskId)!;
    const provider = this.workspace(scope);
    const destination=workspaceLabel(e);
    if (t.status === 'saving' && t.pendingOutput) { await this.finishTask(e, scope, t); return; }
    if (!['queued','waiting_human'].includes(t.status) || !t.dependsOn.every(id => e.tasks.find(t => t.id === id)?.status === 'completed')) return;
    await this.assertActive(e.missionId, scope);
    const observed = await provider.readTask(t.providerId!);
    if (observed.assigneeId !== t.assignee.id || observed.title !== t.title) throw new HttpError(409, `The task assignee or title changed in ${destination}. Reassign or review it before continuing.`);
    if (observed.status === 'cancelled' || observed.status === 'blocked') throw new HttpError(409, `The workspace task is cancelled or blocked. Resolve it in ${destination}, then resume.`);
    if (t.assignee.kind === 'human') {
      if (t.status === 'queued') {
        await this.updateTask(e, scope, t, `task:${t.id}:v${t.version}:human-ready`, { status: 'in_progress' });
        await this.mutate(e.missionId, scope, current => { current.tasks.find(item => item.id === taskId)!.status = 'waiting_human'; this.event(current, `${t.assignee.name} can now review ${t.title}.`, t.id); });
        return;
      }
      if (e.adaptive) {
        if(observed.fingerprint!==t.providerFingerprint)await this.mutate(e.missionId,scope,current=>this.observe(current.tasks.find(task=>task.id===t.id)!,observed));
        return; // Observing external edits does not authorize a decision.
      }
      if (observed.status !== 'done') return;
      const feedback = observed.description !== t.providerDescription ? observed.description : '';
      const feedbackPrompt=`Add review feedback to the task description in ${destination}, then sync again.`;
      if (!feedback.trim()) { if (t.lastError !== feedbackPrompt) await this.mutate(e.missionId, scope, current => { current.tasks.find(item => item.id === taskId)!.lastError = feedbackPrompt; }); return; }
      e = await this.mutate(e.missionId, scope, current => {
        const task = current.tasks.find(item => item.id === taskId)!; this.observe(task, observed);
        if(task.status!=='waiting_human'||task.version!==t.version)return;
        task.status = 'saving'; task.pendingOutput = { title: `Review: ${task.title}`, content: feedback, summary: `Feedback recorded in ${destination} on the task assigned to ${task.assignee.name}.` };
      });
      await this.finishTask(e, scope, e.tasks.find(t => t.id === taskId)!); return;
    }
    if (observed.fingerprint !== t.providerFingerprint) throw new HttpError(409, `The agent task changed in ${destination}. Human edits are preserved; review or reassign before running.`);
    if (e.budget.agentRuns >= e.budget.maxAgentRuns) throw new HttpError(409, 'The authorized agent run budget is exhausted.');
    // Fetch authoritative input documents again, so the next agent uses the saved workspace version.
    const inputs: Array<{ title: string; content: string }> = [];
    const prerequisites=new Set<string>();const documentIds=new Set<string>();
    const collect=(taskId:string)=>{if(prerequisites.has(taskId))return;const dependency=e.tasks.find(t=>t.id===taskId)!;dependency.dependsOn.forEach(collect);prerequisites.add(taskId);dependency.artifacts.forEach(id=>documentIds.add(id));};
    t.dependsOn.forEach(collect);
    for(const documentId of documentIds){const document=await provider.readDocument(documentId);
      if(e.adaptive){const expected=e.artifacts.find(a=>a.id===documentId);if(!expected||expected.content!==document.content||expected.title!==document.title||!sameAudience(expected,document))throw new HttpError(409,'A dependency document or its sharing changed. Review updated sources before running.');}
      inputs.push({title:document.title,content:document.content});}
    await this.updateTask(e, scope, t, `task:${t.id}:v${t.version}:running`, { status: 'in_progress' });
    e = await this.mutate(e.missionId, scope, current => {
      if (!active(current)) throw new HttpError(409, 'Mission is no longer running.');
      const task = current.tasks.find(item => item.id === taskId)!;
      if (task.version !== t.version || task.assignee.id !== t.assignee.id) throw new HttpError(409, 'Task assignment changed before dispatch.','assignment_changed');
      task.status = 'running'; task.runId = randomUUID(); task.runStartedAt = this.now(); current.budget.agentRuns++;
      this.event(current, `Started ${current.adaptive?'Strands':'server drafting'} run for ${task.assignee.name}: ${task.title}.`, task.id);
    });
    t = e.tasks.find(t => t.id === taskId)!;
    const controller = new AbortController(); this.aborts.set(e.missionId, controller);
    try {
      const adaptive = e.adaptive ? this.adaptiveRunContext(e,scope,t,controller.signal) : undefined;
      const output = await this.selectedRunner(e).run({ goal: e.goal, context: e.context, task: { id: t.id, title: t.title, description: t.description, completionCriteria: t.completionCriteria }, inputs, ...(adaptive?{adaptive}:{}) }, controller.signal);
      if(e.adaptive && !output.blockedReason){
        if(!output.adaptiveResult) throw new HttpError(422,'Strands returned no structured launch result.');
        const result=output.adaptiveResult;
        if(adaptive!.stage==='analysis' && result.kind!=='analysis' || adaptive!.stage==='launch_pack' && result.kind!=='launch_pack')throw new HttpError(422,'Strands returned the wrong result for this task.');
        if(result.kind==='analysis'){adaptiveAnalysisSchema.parse(result.analysis);validateAdaptiveCitations(result.analysis.findings.flatMap(f=>f.citations),currentSources(e.adaptive),e.adaptive.sourceRevision);}
        else {launchPackSchema.parse(result.pack);validateAdaptiveCitations(result.pack.citations,currentSources(e.adaptive),e.adaptive.sourceRevision);}
      }
      const saved = await this.mutate(e.missionId, scope, async(current,q) => {
        const task = current.tasks.find(item => item.id === taskId)!;
        if (controller.signal.aborted || terminal(current) || task.version !== t.version || task.runId!==t.runId || e.adaptive && current.adaptive?.sourceRevision!==e.adaptive.sourceRevision) return;
        if(e.adaptive){
          const lease=await q('SELECT holder FROM mission_execution_leases WHERE mission_id=$1 AND holder=$2 AND expires_at>now()',[e.missionId,this.holder]);
          if(task.status!=='running'||!lease.rows.length)return;
        }
        if (output.blockedReason) { task.status = 'blocked'; task.lastError = output.blockedReason; current.status = 'blocked'; current.lastError = output.blockedReason; }
        else { task.status = 'saving'; task.pendingOutput = { title: output.title, content: output.content, summary: output.summary, ...(output.adaptiveResult?{adaptiveResult:output.adaptiveResult}:{}) }; }
      });
      if (active(saved) && !output.blockedReason && saved.tasks.find(t=>t.id===taskId)?.status==='saving') await this.finishTask(saved, scope, saved.tasks.find(t => t.id === taskId)!);
    } catch (error) {
      await this.mutate(e.missionId, scope, current => {
        const task = current.tasks.find(item => item.id === taskId)!;
        if (terminal(current) || task.version!==t.version || task.runId!==t.runId || e.adaptive && !['running','saving'].includes(task.status)) return;
        if (!task.pendingOutput) task.status = 'failed';
        task.lastError = message(error); if (current.status !== 'paused') current.status = 'blocked'; current.lastError = message(error);
      });
      throw error;
    } finally { this.aborts.delete(e.missionId); }
  }

  async tick(id: string, scope: Scope) {
    if (this.stopped || this.ticking.has(id)) return;
    this.ticking.add(id);
    const lease = await this.db.transaction(async q => {
      await q('SELECT id FROM missions WHERE id=$1 AND owner_id=$2 AND workspace_id=$3 FOR UPDATE',[id,scope.ownerId,scope.workspaceId]);
      return q("INSERT INTO mission_execution_leases(mission_id,holder,expires_at) VALUES($1,$2,now()+interval '2 minutes') ON CONFLICT(mission_id) DO UPDATE SET holder=excluded.holder,expires_at=excluded.expires_at WHERE mission_execution_leases.expires_at<now() OR mission_execution_leases.holder=excluded.holder RETURNING holder", [id, this.holder]);
    }).catch(error=>{this.ticking.delete(id);throw error;});
    if (!lease.rows.length) { this.ticking.delete(id); return; }
    const renew = setInterval(() => { void this.db.query("UPDATE mission_execution_leases SET expires_at=now()+interval '2 minutes' WHERE mission_id=$1 AND holder=$2 AND expires_at>now() RETURNING holder", [id, this.holder]).then(result=>{if(!result.rows.length)this.aborts.get(id)?.abort();}).catch(() => this.aborts.get(id)?.abort()); }, 20000); renew.unref();
    try {
      let e = await this.required(id, scope); if (!active(e)) return;
      await this.assertActive(id,scope);
      if (!e.tasks.length) {
        const plan = validateExecutionPlan(await this.selectedRunner(e).plan({ goal: e.goal, context: e.context, maxTasks: e.budget.maxTasks }),e.budget.maxTasks);
        e = await this.mutate(id, scope, current => {
          if (!active(current) || current.tasks.length) return;
          current.summary = plan.summary;
          const ids = new Map(plan.tasks.map(t => [t.key, `${id}-${randomUUID()}`]));
          current.tasks = plan.tasks.map(t => ({ id: ids.get(t.key)!, title: t.title, description: t.description, completionCriteria: t.completionCriteria,
            assignee: t.executor === 'agent' ? current.agent : current.human, status: 'queued', dependsOn: t.dependencies.map(k => ids.get(k)!), version: 1,
            providerId: null, providerUrl: null, providerFingerprint: null, providerDescription: null, runId: null, runStartedAt: null, runFinishedAt: null, artifacts: [], lastError: null }));
          this.event(current, `Broke the mission into ${current.tasks.length} assigned tasks.`);
        });
      }
      if (!active(e)) return;
      await this.provision(e, scope);
      e = await this.required(id, scope);
      for (const t of e.tasks) {
        e = await this.required(id, scope); if (!active(e)) return;
        await this.taskStep(e, scope, t.id);
      }
      e = await this.required(id, scope);
      if (active(e) && e.tasks.length && e.tasks.every(t => t.status === 'completed')) {
        if(e.pendingVerification){
          const verification=e.pendingVerification;
          await this.saveDocument(e,scope,`verification:${fingerprint(verification)}`,`Outcome verified: ${e.goal}`.slice(0,255),`Mission: ${e.goal}\nMission ID: ${e.missionId}${e.adaptive ? `\nSource revision: ${e.adaptive.sourceRevision}` : ''}\n\nMission owner verification (${verification.at}):\n${verification.statement}\n\nSaved deliverables:\n${e.artifacts.filter(a=>a.kind!=='verification' && (!e.adaptive || a.sourceRevision === e.adaptive.sourceRevision)).map(a=>`${a.title}: ${a.id}`).join('\n')}`,'verification',null);
          await this.mutate(id,scope,current=>{if(active(current)){current.status='completed';current.outcomeVerification=verification;delete current.pendingVerification;this.event(current,`Mission outcome verified by the owner: ${verification.statement}`);}});
          return;
        }
        if (!e.artifacts.some(a => a.kind === 'summary' && (!e.adaptive || a.sourceRevision===e.adaptive.sourceRevision))) await this.saveDocument(e, scope, e.adaptive?`summary:v${e.adaptive.sourceRevision}`:'summary', `Mission results: ${e.goal}`.slice(0,255), `Mission: ${e.goal}\n\n${e.tasks.map(t => `${t.title}\nAssignee: ${t.assignee.name}\nTask ID: ${t.providerId}\nOutput document IDs: ${t.artifacts.join(', ')}\nCriteria: ${t.completionCriteria.join('; ')}`).join('\n\n')}\n\nAll outputs were saved and read back. Human verification of the mission outcome is still required.`, 'summary', null);
        await this.mutate(id, scope, current => { if (active(current)) { current.status = 'needs_review'; this.event(current, 'All task outputs are saved. Review the deliverables to verify the mission outcome.'); } });
      }
    } catch (error) {
      if(error instanceof HttpError&&error.code==='assignment_changed')return;
      await this.mutate(id, scope, async(e,q) => {
        if(e.adaptive){const lease=await q('SELECT holder FROM mission_execution_leases WHERE mission_id=$1 AND holder=$2 AND expires_at>now()',[id,this.holder]);if(!lease.rows.length)return;}
        if (active(e)) { e.status = 'blocked'; e.lastError = message(error); this.event(e, e.lastError); }
      }).catch(() => {});
    } finally { clearInterval(renew); this.ticking.delete(id); await this.db.query('DELETE FROM mission_execution_leases WHERE mission_id=$1 AND holder=$2', [id, this.holder]); }
  }

  async control(id: string, scope: Scope, action: 'pause' | 'resume' | 'cancel' | 'complete', attestation?: string) {
    let verifiedRevision: number | undefined;
    if(action==='complete'){
      if(!attestation?.trim()||attestation.trim().length<10||attestation.length>500)throw new HttpError(422,'Provide an outcome verification statement between 10 and 500 characters.');
      const e=await this.required(id,scope);if(e.status!=='needs_review')throw new HttpError(409,'The mission is not ready for outcome verification.');
      const destination=workspaceLabel(e);
      verifiedRevision=e.adaptive?.revision;
      for(const artifact of e.artifacts.filter(a=>!e.adaptive||a.sourceRevision===e.adaptive.sourceRevision)){
        const latest=await this.workspace(scope).readDocument(artifact.id);
        if(e.adaptive && !sameAudience(artifact,latest))throw new HttpError(409,'A saved artifact has different sharing permissions. Restore the authorized audience before verifying.');
        if(latest.title!==artifact.title||latest.content!==artifact.content){
          if(e.adaptive)throw new HttpError(409,`A saved adaptive artifact changed in ${destination}. Restore its reviewed content or update the source snapshots and rerun before verifying.`);
          await this.mutate(id,scope,current=>{const a=current.artifacts.find(a=>a.id===artifact.id)!;Object.assign(a,{title:latest.title,content:latest.content,fingerprint:latest.fingerprint,verifiedAt:this.now()});});
          throw new HttpError(409,`A saved artifact changed in ${destination}. Review the refreshed content before verifying the outcome.`);
        }
      }
    }
    const updated = await this.mutate(id, scope, e => {
      if (terminal(e)) throw new HttpError(409, 'This execution is already closed.');
      if (action === 'complete') {
        if(e.adaptive?.revision!==verifiedRevision)throw new HttpError(409,'The source revision or decision changed during verification. Review the current outputs first.');
        if (e.status !== 'needs_review' || e.tasks.some(t => t.status !== 'completed') || !attestation?.trim()) throw new HttpError(409, 'Review every output and provide an outcome verification statement first.');
        e.status = 'running'; e.pendingVerification = { actorId: scope.ownerId, statement: attestation.trim(), at: this.now() }; this.event(e, `Saving the mission owner outcome verification in ${workspaceLabel(e)}.`);
      } else if (action === 'pause') { e.status = 'paused'; this.event(e, 'Mission paused. No new work will start; results already transmitted are retained.'); }
      else if (action === 'cancel') { e.status = 'cancelled'; for (const t of e.tasks) if (t.status !== 'completed') t.status = 'cancelled'; this.event(e, 'Mission cancelled. Existing workspace records and completed outputs are retained.'); }
      else { if (e.tasks.some(t => ['failed','blocked','outcome_unknown'].includes(t.status))) throw new HttpError(409, 'Retry, reassign, or reconcile the blocked task first.'); e.status = e.tasks.length ? 'running' : 'planning'; e.lastError = null; this.event(e, 'Mission resumed within its original scope and budget.'); }
    });
    if (action === 'cancel') this.aborts.get(id)?.abort();
    if(action==='complete'){await this.tick(id,scope);return (await this.get(id,scope))!;}
    if (action === 'resume') this.wake(); return updated;
  }
  async review(id: string, taskId: string, scope: Scope, feedback: string) {
    if((await this.required(id,scope)).adaptive)throw new HttpError(409,'Use the versioned decision card for this adaptive mission.');
    if(feedback.trim().length<3||feedback.length>20000)throw new HttpError(422,'Provide human feedback between 3 and 20000 characters.');
    await this.mutate(id, scope, e => {
      if (!active(e)) throw new HttpError(409, 'Resume the mission before submitting work.');
      const t = e.tasks.find(t => t.id === taskId);
      if (!t || t.assignee.kind !== 'human' || t.status !== 'waiting_human') throw new HttpError(409, 'This task is not waiting for human input.');
      t.status = 'saving'; t.reviewFeedback = feedback; t.pendingOutput = { title: `Review: ${t.title}`, content: feedback, summary: `Mission owner feedback for the task assigned to ${t.assignee.name}, submitted through MissionDeck.` };
      this.event(e, 'Human feedback recorded for workspace delivery.', t.id);
    });
    this.wake(); return this.get(id, scope);
  }
  async retry(id: string, taskId: string, scope: Scope) {
    await this.mutate(id, scope, e => {
      if (terminal(e)) throw new HttpError(409, 'Execution is closed.');
      const t = e.tasks.find(t => t.id === taskId);
      if (!t || !['failed','blocked'].includes(t.status) || t.pendingOutput) throw new HttpError(409, 'Only a failed or blocked drafting run can be retried. Reconcile uncertain writes separately.');
      t.status = 'queued'; t.version++; t.lastError = null; t.runId = null;
      e.status = 'running'; e.lastError = null; this.event(e, 'Task queued for a new bounded attempt.', t.id);
    });
    this.wake(); return this.get(id, scope);
  }
  async reassign(id: string, taskId: string, scope: Scope, assigneeId: string) {
    const capabilities = await this.capabilities(scope); const assignee = [...capabilities.humans, ...capabilities.agents].find(p => p.id === assigneeId);
    const e = await this.required(id, scope);
    if (!assignee) throw new HttpError(422, 'Choose a current assignee from this workspace.');
    const task=e.tasks.find(t=>t.id===taskId);if(!task)throw new HttpError(404,'Task not found.');
    if(e.adaptive && assignee.kind !== (taskId===e.tasks[1]?.id ? 'human' : 'agent'))throw new HttpError(422,'Adaptive analysis and production require an agent; the decision task requires a human reviewer.');
    const observed=task.providerId?await this.workspace(scope).readTask(task.providerId):null;
    await this.mutate(id, scope, current => {
      const t = current.tasks.find(t => t.id === taskId);
      if (terminal(current) || !t || !['queued','waiting_human','blocked','failed'].includes(t.status) || t.pendingOutput) throw new HttpError(409, 'Pause in-flight work before changing its assignment.');
      t.assignee = assignee; t.version++; t.status = 'queued'; t.lastError = null; t.runId = null;
      if(current.adaptive)current.adaptive.revision++;
      if(observed)this.observe(t,observed);
      current.authorizedAssignees??=[current.human,current.agent];if(!current.authorizedAssignees.some(p=>p.id===assignee.id))current.authorizedAssignees.push(assignee);
      // Reassignment is applied in the worker before another task can start.
      t.assignmentPending = true; if(current.status!=='paused')current.status = 'planning'; current.lastError = null;
      this.event(current, `Reassigned ${t.title} to ${assignee.name}.`, t.id);
    });
    this.wake(); return this.get(id, scope);
  }

  async reconcile(id: string, scope: Scope, operationId: string, suppliedId?: string) {
    const e = await this.required(id, scope); const record = await this.store.get<Journal>(operationId, 'execution_operation', scope);
    const destination=workspaceLabel(e);
    if (record.missionId !== id || record.data.state !== 'outcome_unknown') throw new HttpError(409, 'Select an uncertain operation from this mission.');
    const op = record.data; const provider = this.workspace(scope); const providerId = op.kind==='dependency'?String(op.input.taskId):op.providerId ?? suppliedId;
    if (!providerId) throw new HttpError(409, `Inspect ${destination} and enter the actual record ID. The create will not be repeated.`);
    let observed: ExecutionTaskRecord | ExecutionDocumentRecord;
    if (op.kind.startsWith('document')) {
      observed = await provider.readDocument(providerId);
      if (op.kind === 'document_create' && (observed.title !== op.input.title || observed.content !== op.input.content)) throw new HttpError(409, 'Document content does not match the original operation.');
      if (op.kind === 'document_share' && fingerprint([...(op.input.expectedAudienceIds as string[]??op.input.audienceIds as string[])].sort())!==fingerprint([...observed.audienceIds].sort())) throw new HttpError(409, `Document sharing does not match the authorized audience. Inspect it in ${destination}.`);
    } else if (op.kind === 'dependency') {
      const relation=await provider.readDependency(String(op.input.taskId),String(op.input.dependencyId));
      if(!relation)throw new HttpError(409,`The expected dependency is not present. Inspect the task in ${destination}.`);
      await this.db.transaction(async q=>{const current=await this.store.get<Journal>(record.id,record.kind,scope,q);current.revision++;current.data={...current.data,state:'done',result:relation,providerId:relation.id,error:undefined};await this.store.save(current,scope,q);});
      return this.get(id,scope);
    }
    else {
      observed = await provider.readTask(providerId);
      const expected = op.kind === 'task_create' ? op.input : op.input.patch as Record<string, unknown>;
      if (!Object.entries(expected).filter(([k]) => ['title','description','status','assigneeId','parentTaskId'].includes(k)).every(([k,v]) => observed[k as keyof typeof observed] === v)) throw new HttpError(409, 'Task fields do not match the original operation. Human edits were preserved.');
    }
    await this.db.transaction(async q => {
      const current = await this.store.get<Journal>(record.id, record.kind, scope, q);
      if (current.data.state !== 'outcome_unknown') throw new HttpError(409, 'Operation changed; refresh.');
      current.data = { ...current.data, state: 'done', result: observed, providerId, error: undefined }; current.revision++; await this.store.save(current, scope, q);
    });
    await this.mutate(e.missionId, scope, current => { current.lastError = null; this.event(current, `Reconciled ${op.kind} using workspace record ${providerId}.`); });
    return this.get(id, scope);
  }
  async recover() {
    const records = await this.db.query<{ mission_id: string; owner_id: string; workspace_id: string }>("SELECT r.mission_id,r.owner_id,r.workspace_id FROM upgrade_records r LEFT JOIN mission_execution_leases l ON l.mission_id=r.mission_id WHERE r.kind='mission_execution' AND (l.mission_id IS NULL OR l.expires_at<now()) AND (r.owner_id NOT LIKE 'demo-user:%' OR EXISTS (SELECT 1 FROM sessions s WHERE s.owner_id=r.owner_id AND s.workspace_id=r.workspace_id AND s.expires_at>now())) AND (EXISTS (SELECT 1 FROM upgrade_records op WHERE op.kind='execution_operation' AND op.mission_id=r.mission_id AND op.owner_id=r.owner_id AND op.workspace_id=r.workspace_id AND op.data->>'state'='running') OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.data->'tasks','[]'::jsonb)) task WHERE task->>'status'='running'))");
    for (const row of records.rows) {
      const scope = { ownerId: row.owner_id, workspaceId: row.workspace_id };
      await this.db.transaction(async q=>{
        // Serialize with lease acquisition: a candidate discovered above may already
        // have been resumed by another coordinator before this transaction starts.
        await q('SELECT id FROM missions WHERE id=$1 AND owner_id=$2 AND workspace_id=$3 FOR UPDATE',[row.mission_id,scope.ownerId,scope.workspaceId]);
        const lease=await q('SELECT holder FROM mission_execution_leases WHERE mission_id=$1 AND expires_at>now()',[row.mission_id]);
        if(lease.rows.length)return;
        const ops=await q<{id:string}>("SELECT id FROM upgrade_records WHERE kind='execution_operation' AND mission_id=$1 AND owner_id=$2 AND workspace_id=$3 AND data->>'state'='running'",[row.mission_id,scope.ownerId,scope.workspaceId]);
        for(const op of ops.rows){
          const current=await this.store.get<Journal>(op.id,'execution_operation',scope,q);
          current.revision++;current.data.state='outcome_unknown';current.data.error='Server interrupted during a workspace write. Reconcile the record before retrying.';
          await this.store.save(current,scope,q);
        }
        const record=await this.store.get<MissionExecution>(key(row.mission_id),'mission_execution',scope,q);const current=record.data;
        if(terminal(current)||!ops.rows.length&&!current.tasks.some(t=>t.status==='running'))return;
        for(const t of current.tasks)if(t.status==='running'){t.status='failed';t.lastError='Server interrupted the drafting run. Retry explicitly within the remaining budget.';}
        current.status='blocked';current.lastError='Execution was interrupted. Inspect task runs and reconcile pending writes.';current.updatedAt=this.now();record.revision++;
        await this.store.save(record,scope,q);await this.project(current,scope,q);
      });
    }
  }
  wake() { if (!this.stopped) void this.pump().catch(()=>{}); }
  pump(): Promise<void> {
    if (this.pumping) return this.pumping;
    this.pumping = (async () => {
      await this.recover();
      type Candidate={id:string;mission_id:string;owner_id:string;workspace_id:string;updated_at:string;data:MissionExecution};
      const page=async(cursor?:{at:string;id:string})=>this.db.query<Candidate>(`SELECT r.id,r.mission_id,r.owner_id,r.workspace_id,r.updated_at::text AS updated_at,r.data FROM upgrade_records r WHERE r.kind='mission_execution' AND r.data->>'status' IN ('planning','running') AND (r.owner_id NOT LIKE 'demo-user:%' OR EXISTS (SELECT 1 FROM sessions s WHERE s.owner_id=r.owner_id AND s.workspace_id=r.workspace_id AND s.expires_at>now())) ${cursor?'AND (r.updated_at>$1 OR (r.updated_at=$1 AND r.id>$2))':''} ORDER BY r.updated_at,r.id LIMIT 50`,cursor?[cursor.at,cursor.id]:[]);
      const workers:Candidate[]=[];let workerCursor=this.workerCursor;
      // Capacity demand and scheduler eligibility are different. Scan a bounded,
      // rotating window for work that can advance immediately, so large sets of
      // human waits cannot permanently hide a model-ready mission.
      for(let pages=0;pages<20&&workers.length<50;pages++){
        const batch=await page(workerCursor);
        workers.push(...batch.rows.filter(row=>demandsWorker(row.data)).slice(0,50-workers.length));
        if(batch.rows.length<50){workerCursor=undefined;break;}
        const last=batch.rows.at(-1)!;workerCursor={at:last.updated_at,id:last.id};
      }
      this.workerCursor=workerCursor;
      // Human waits, provider edits, reassignment projections, and configuration
      // drift still need bounded polling. Rotate this independent 50-row page so
      // every active mission remains observable without consuming demo capacity.
      let polled=await page(this.pollCursor);
      if(!polled.rows.length&&this.pollCursor)polled=await page();
      if(polled.rows.length){const last=polled.rows.at(-1)!;this.pollCursor=polled.rows.length===50?{at:last.updated_at,id:last.id}:undefined;}
      else this.pollCursor=undefined;
      const workerIds=new Set(workers.map(row=>row.mission_id));
      const ready=[...workers,...polled.rows.filter(row=>!workerIds.has(row.mission_id))];
      for (const row of ready) { if (this.stopped) break; await this.tick(row.mission_id, { ownerId: row.owner_id, workspaceId: row.workspace_id }); }
    })().finally(() => { this.pumping = null; });
    return this.pumping;
  }
  async listen(intervalMs = 5000) { await this.recover(); this.timer = setInterval(() => { void this.pump().catch(() => {}); }, intervalMs); this.timer.unref(); this.wake(); }
  async stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.aborts.forEach(c => c.abort()); await this.pumping; }
}
