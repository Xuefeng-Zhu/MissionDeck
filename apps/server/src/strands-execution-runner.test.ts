import { describe, expect, it, vi } from 'vitest';
import { ADAPTIVE_SAMPLE_SOURCES, type AdaptiveAnalysis, type LaunchPack } from '@mission/domain';
import { StrandsExecutionRunner, validateStrandsCitations } from './strands-execution-runner.js';
import { resolveModelConfig, type ModelEnvironment } from './model-provider.js';
import type { ExecutionTaskInput } from './execution-runner.js';

const selected = (overrides: Partial<ModelEnvironment> = {}) => resolveModelConfig({ MODEL_MODE: 'live', MODEL_PROVIDER: 'openrouter', OPENROUTER_MODEL: 'synthetic/model', OPENAI_MODEL: 'synthetic/direct', OPENROUTER_API_KEY: 'synthetic-selected-key', OPENAI_API_KEY: 'synthetic-unselected-key', ...overrides });
function fixture() {
  const sources = ADAPTIVE_SAMPLE_SOURCES.map(source => ({ ...source, fingerprint: `fingerprint-${source.id}` }));
  const citations = [{ sourceId: sources[1]!.id, sourceRevision: 1, excerpt: 'Calendar integration is not ready' }];
  const findings = [{ id: 'calendar', title: 'Calendar blocks broad release', kind: 'conflict' as const, detail: 'Use a limited beta or delay the broad release.', citations }];
  const analysis: AdaptiveAnalysis = { summary: 'Broad release is blocked by calendar readiness.', findings, unresolvedRequirements: ['Calendar integration'], options: [
    { id: 'beta', label: 'Limited beta', description: 'Invite 20 customers with manual date entry.', consequences: ['Disclose the missing integration.'] },
    { id: 'delay', label: 'Delay launch', description: 'Wait for the calendar integration.', consequences: ['A later launch date.'] },
  ], recommendedOptionId: 'beta', assumptions: [] };
  const pack: LaunchPack = { brief: 'Invite 20 beta customers using manual date entry.', checklist: ['Disclose the missing calendar integration.'], announcementDraft: 'Join the private beta; calendar integration is unavailable.', unresolvedRisks: ['Calendar integration remains incomplete.'], changeSummary: 'Changed the broad release to a limited beta following the saved decision.', citations };
  const consume = vi.fn(async (_kind: 'model' | 'tool') => {});
  const activity = vi.fn(async (_event: Parameters<NonNullable<ExecutionTaskInput['adaptive']>['activity']>[0]) => {});
  const input: ExecutionTaskInput = { goal: 'Prepare an honest launch plan.', context: '', task: { id: 'task-analysis', title: 'Analyze readiness', description: 'Analyze source evidence.', completionCriteria: ['Citations are checked.'] }, inputs: [], adaptive: {
    stage: 'analysis', sourceRevision: 1, sources, artifacts: [], readSource: vi.fn(async id => sources.find(s => s.id === id)!.content), readArtifact: vi.fn(async () => ''), consume, activity,
  } };
  return { input, analysis, pack, facts: { summary: analysis.summary, findings }, consume, activity };
}

interface Call { agent: string; body: any; request: Request }
let nextToolCallId = 0;
function response(calls: Array<{ name: string; arguments: unknown }>) {
  const chunks = [
    { id: 'synthetic', object: 'chat.completion.chunk', created: 0, model: 'synthetic/model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: calls.map((call, index) => ({ index, id: `call-${++nextToolCallId}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) }, finish_reason: null }] },
    { id: 'synthetic', object: 'chat.completion.chunk', created: 0, model: 'synthetic/model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  ];
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}
function scripted(f: ReturnType<typeof fixture>, override?: (call: Call, occurrence: number) => Response | Promise<Response | undefined> | undefined) {
  const requests: Call[] = [];
  const counts = new Map<string, number>();
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const request = new Request(url, init);
    const body = JSON.parse(await request.text());
    const agent = /Specialist: ([\w_]+)/.exec(body.messages.find((m: any) => m.role === 'system').content)?.[1] ?? 'unknown';
    const call = { agent, body, request }; requests.push(call);
    const occurrence = (counts.get(agent) ?? 0) + 1; counts.set(agent, occurrence);
    const alternate = await override?.(call, occurrence); if (alternate) return alternate;
    if ((agent === 'evidence' || agent === 'launch_pack') && occurrence === 1) return response([{ name: 'list_mission_sources', arguments: {} }]);
    if ((agent === 'evidence' || agent === 'launch_pack') && occurrence === 2) return response([{ name: 'read_mission_sources', arguments: { sourceIds: f.input.adaptive!.sources.map(source => source.id) } }]);
    if (agent === 'launch_pack' && occurrence === 3 && f.input.adaptive!.artifacts.length) return response([{ name: 'read_mission_artifacts', arguments: { artifactIds: f.input.adaptive!.artifacts.map(artifact => artifact.id) } }]);
    return response([{ name: 'strands_structured_output', arguments: agent === 'synthesis' ? f.analysis : agent === 'launch_pack' ? f.pack : f.facts }]);
  });
  return { requests, transport, counts };
}

describe('Strands SDK execution', () => {
  it('uses the real SDK graph, scoped tools, parallel specialists and validated synthesis', async () => {
    const f = fixture(); let resolveRisk!: () => void;
    const riskStarted = new Promise<void>(resolve => { resolveRisk = resolve; });
    const s = scripted(f, async call => {
      if (call.agent === 'readiness') await riskStarted;
      if (call.agent === 'risk') resolveRisk();
      return undefined;
    });
    const result = await new StrandsExecutionRunner(selected(), s.transport).run(f.input);
    expect(result.adaptiveResult).toEqual({ kind: 'analysis', analysis: f.analysis });
    expect(s.requests.map(r => r.agent)).toEqual(['evidence', 'evidence', 'evidence', 'readiness', 'risk', 'synthesis']);
    const synthesisInput = JSON.stringify(s.requests.find(r => r.agent === 'synthesis')!.body.messages.filter((m: any) => m.role !== 'system'));
    expect(synthesisInput).toContain('[node: readiness]');
    expect(synthesisInput).toContain('[node: risk]');
    expect(synthesisInput).toContain('Calendar blocks broad release');
    expect(f.input.adaptive!.readSource).toHaveBeenCalledTimes(3);
    expect(f.consume.mock.calls.filter(([kind]) => kind === 'model')).toHaveLength(s.requests.length);
    expect(f.consume.mock.calls.filter(([kind]) => kind === 'tool')).toHaveLength(6);
    expect(f.activity.mock.calls.some(([event]) => event.kind === 'tool_start' && event.tool === 'read_mission_sources')).toBe(true);
    expect(f.activity.mock.calls.some(([event]) => event.kind === 'tool_end' && event.sourceId === 'engineering')).toBe(true);
    const events = f.activity.mock.calls.map(([event]) => event);
    const terminalEvents = events.filter(event => event.kind === 'agent_end');
    expect(terminalEvents.map(event => ({ agent: event.agent, outcome: event.outcome })).sort((a, b) => a.agent.localeCompare(b.agent))).toEqual([
      { agent: 'evidence', outcome: 'succeeded' }, { agent: 'readiness', outcome: 'succeeded' }, { agent: 'risk', outcome: 'succeeded' }, { agent: 'synthesis', outcome: 'succeeded' },
    ]);
    expect(terminalEvents[0]?.agent).toBe('evidence');
    expect(terminalEvents.at(-1)?.agent).toBe('synthesis');
    const branchEvents = events.filter(event => ['readiness', 'risk'].includes(event.agent) && ['agent_start', 'agent_end'].includes(event.kind));
    expect(branchEvents.map(event => event.kind)).toEqual(['agent_start', 'agent_start', 'agent_end', 'agent_end']);
    for (const start of events.filter(event => event.kind === 'tool_start')) {
      expect(start.toolCallId).toMatch(/^call-\d+$/);
      const ends = events.filter(event => event.kind === 'tool_end' && event.agent === start.agent && event.toolCallId === start.toolCallId);
      expect(ends.length).toBeGreaterThan(0);
      expect(ends.every(event => event.tool === start.tool && event.outcome === 'succeeded')).toBe(true);
    }
    const sourceReads = events.filter(event => event.kind === 'tool_end' && event.tool === 'read_mission_sources');
    expect(sourceReads).toHaveLength(4); // One invocation result plus three source-detail records.
    expect(new Set(sourceReads.map(event => event.toolCallId)).size).toBe(1);
    expect(new Set(events.filter(event => event.kind === 'tool_end').map(event => event.toolCallId)).size).toBe(6);
    for (const r of s.requests) {
      expect(r.request.url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(r.request.headers.get('authorization')).toBe('Bearer synthetic-selected-key');
      expect(r.body).toMatchObject({ model: 'synthetic/model', max_completion_tokens: 4096, store: false, parallel_tool_calls: false, provider: { allow_fallbacks: false } });
      expect(r.body.provider).not.toHaveProperty('require_parameters');
      expect(JSON.stringify(r.body)).not.toContain('synthetic-unselected-key');
    }
    expect(result.content).toContain('A human decision is required');
  });

  it('rejects partial analysis without starting synthesis when the risk branch fails', async () => {
    const f = fixture(); let readinessFinished!: () => void;
    const readinessComplete = new Promise<void>(resolve => { readinessFinished = resolve; });
    f.activity.mockImplementation(async event => {
      if (event.agent === 'readiness' && event.kind === 'agent_end') readinessFinished();
    });
    const s = scripted(f, async call => {
      if (call.agent !== 'risk') return undefined;
      // Let the evidence and readiness branches finish successfully before the
      // other specialist fails, so one valid branch cannot authorize synthesis.
      await readinessComplete;
      return Response.json({ error: { message: 'Controlled risk specialist unavailable.' } }, { status: 503 });
    });
    await expect(new StrandsExecutionRunner(selected(), s.transport).run(f.input)).rejects.toMatchObject({ code: 'strands_graph_failed' });
    expect(f.input.adaptive!.readSource).toHaveBeenCalledTimes(3);
    for (const agent of ['evidence', 'readiness']) {
      expect(f.activity.mock.calls.some(([event]) => event.agent === agent && event.kind === 'tool_end'
        && event.tool === 'strands_structured_output' && event.summary.endsWith('succeeded.'))).toBe(true);
    }
    expect(s.counts.get('risk')).toBe(1);
    expect(s.counts.has('synthesis')).toBe(false);
    expect(f.activity.mock.calls.some(([event]) => event.agent === 'synthesis')).toBe(false);
    expect(f.activity.mock.calls.filter(([event]) => event.agent === 'risk' && event.kind === 'agent_end').map(([event]) => event.outcome)).toEqual(['failed']);
    expect(f.consume.mock.calls.filter(([kind]) => kind === 'model')).toHaveLength(5);
  });

  it('reads the saved decision dependencies and produces a revised unsent pack', async () => {
    const f = fixture();
    Object.assign(f.input.adaptive!, { stage: 'launch_pack', analysis: f.analysis, decision: { optionId: 'beta', constraints: 'Only 20 customers.', actorId: 'human', at: '2026-09-14T00:00:00Z', sourceRevision: 1, analysisVersion: 'v1' }, artifacts: [{ id: 'decision-doc', title: 'Human decision', content: 'Choose beta. Only 20 customers.' }] });
    f.input.adaptive!.readArtifact = vi.fn(async () => 'Choose beta. Only 20 customers.');
    const s = scripted(f);
    const result = await new StrandsExecutionRunner(selected(), s.transport).run(f.input);
    expect(result.adaptiveResult).toEqual({ kind: 'launch_pack', pack: f.pack });
    expect(f.input.adaptive!.readArtifact).toHaveBeenCalledWith('decision-doc');
    expect(result.content).toContain('Announcement draft — not sent');
    expect(s.requests).toHaveLength(4);
    expect(f.activity.mock.calls.filter(([event]) => event.kind === 'agent_end').map(([event]) => ({ agent: event.agent, outcome: event.outcome }))).toEqual([{ agent: 'launch_pack', outcome: 'succeeded' }]);
  });

  it('rejects a fabricated citation through bounded SDK repairs without starting specialists', async () => {
    const f = fixture(); f.facts.findings[0]!.citations[0]!.excerpt = 'A fictional unobserved source claim';
    const s = scripted(f);
    await expect(new StrandsExecutionRunner(selected(), s.transport).run(f.input)).rejects.toMatchObject({ code: 'strands_graph_failed' });
    expect(s.counts.get('evidence')).toBe(6);
    expect(s.counts.has('synthesis')).toBe(false);
    expect(f.consume.mock.calls.filter(([kind]) => kind === 'model')).toHaveLength(6);
    expect(f.activity.mock.calls.filter(([event]) => event.kind === 'agent_end').map(([event]) => event.outcome)).toEqual(['failed']);
    expect(f.activity.mock.calls.filter(([event]) => event.tool === 'strands_structured_output' && event.kind === 'tool_end').every(([event]) => event.outcome === 'failed')).toBe(true);
  });

  it('keeps a repaired structured result running until the valid result is accepted', async () => {
    const f = fixture();
    const s = scripted(f, (call, occurrence) => {
      if (call.agent === 'evidence' && occurrence === 3) {
        return response([{ name: 'strands_structured_output', arguments: { ...f.facts, findings: [{ ...f.facts.findings[0], citations: [{ sourceId: 'engineering', sourceRevision: 1, excerpt: 'Fabricated quote' }] }] } }]);
      }
      if (call.agent === 'evidence' && occurrence === 4) {
        expect(f.activity.mock.calls.some(([event]) => event.agent === 'evidence' && event.kind === 'agent_end')).toBe(false);
      }
      return undefined;
    });
    await new StrandsExecutionRunner(selected(), s.transport).run(f.input);
    const evidence = f.activity.mock.calls.map(([event]) => event).filter(event => event.agent === 'evidence');
    expect(evidence.filter(event => event.kind === 'tool_end' && event.tool === 'strands_structured_output').map(event => event.outcome)).toEqual(['failed', 'succeeded']);
    expect(evidence.filter(event => event.kind === 'agent_end').map(event => event.outcome)).toEqual(['succeeded']);
    expect(evidence.at(-1)).toMatchObject({ kind: 'agent_end', outcome: 'succeeded' });
    expect(f.consume.mock.calls.filter(([kind]) => kind === 'model')).toHaveLength(7);
  });

  it('reports an invalid launch pack as failed even when the SDK invocation ends', async () => {
    const f = fixture();
    Object.assign(f.input.adaptive!, { stage: 'launch_pack', analysis: f.analysis, decision: { optionId: 'beta', constraints: '', actorId: 'human', at: '2026-09-14T00:00:00Z', sourceRevision: 1, analysisVersion: 'v1' } });
    f.pack.citations = [{ sourceId: 'engineering', sourceRevision: 1, excerpt: 'Fabricated quote' }];
    const s = scripted(f);
    await expect(new StrandsExecutionRunner(selected(), s.transport).run(f.input)).rejects.toMatchObject({ code: 'agent_turn_limit' });
    expect(f.activity.mock.calls.filter(([event]) => event.kind === 'agent_end').map(([event]) => ({ agent: event.agent, outcome: event.outcome }))).toEqual([{ agent: 'launch_pack', outcome: 'failed' }]);
    expect(s.requests).toHaveLength(6);
  });

  it('refuses unretrieved, stale revision and non-exact source citations', () => {
    const f = fixture(); const citation = f.analysis.findings[0]!.citations[0]!;
    for (const value of [{ ...citation, sourceId: 'outside' }, { ...citation, sourceRevision: 2 }, { ...citation, excerpt: 'not a verbatim source quote' }]) {
      expect(() => validateStrandsCitations([value], f.input.adaptive!.sources, 1, new Set(['engineering']))).toThrow();
    }
    expect(() => validateStrandsCitations([citation], f.input.adaptive!.sources, 1, new Set())).toThrow();
  });

  it('does not let an invented source ID reach the source callback', async () => {
    const f = fixture(); const s = scripted(f, call => call.agent === 'evidence' ? response([{ name: 'read_mission_source', arguments: { sourceId: 'outside' } }]) : undefined);
    await expect(new StrandsExecutionRunner(selected(), s.transport).run(f.input)).rejects.toMatchObject({ code: 'strands_graph_failed' });
    expect(f.input.adaptive!.readSource).not.toHaveBeenCalled();
  });

  it('checks the durable model budget before any transport request', async () => {
    const f = fixture(); f.input.adaptive!.consume = vi.fn(async () => { throw new Error('synthetic private budget detail'); });
    const s = scripted(f);
    const failure = await new StrandsExecutionRunner(selected(), s.transport).run(f.input).catch(error => error);
    expect(failure.code).toBe('strands_graph_failed');
    expect(failure.message).not.toContain('private budget');
    expect(s.transport).not.toHaveBeenCalled();
  });

  it('does not retry provider errors or expose their body', async () => {
    const f = fixture(); const s = scripted(f, () => Response.json({ error: { message: 'synthetic credential-like detail' } }, { status: 429 }));
    const failure = await new StrandsExecutionRunner(selected(), s.transport).run(f.input).catch(error => error);
    expect(failure.message).not.toContain('credential-like');
    expect(s.requests).toHaveLength(1);
    expect(f.activity.mock.calls.filter(([event]) => event.kind === 'agent_end').map(([event]) => event.outcome)).toEqual(['failed']);
  });

  it('checks the durable tool budget before reading any source', async () => {
    const f = fixture(); f.input.adaptive!.consume = vi.fn(async kind => { if (kind === 'tool') throw new Error('private tool budget detail'); });
    const s = scripted(f);
    await expect(new StrandsExecutionRunner(selected(), s.transport).run(f.input)).rejects.toMatchObject({ code: 'strands_graph_failed' });
    expect(f.input.adaptive!.readSource).not.toHaveBeenCalled();
    expect(s.requests).toHaveLength(1);
  });

  it('uses only the selected direct OpenAI endpoint when configured', async () => {
    const f = fixture(); const s = scripted(f);
    await new StrandsExecutionRunner(selected({ MODEL_PROVIDER: 'openai' }), s.transport).run(f.input);
    expect(s.requests.every(r => r.request.url === 'https://api.openai.com/v1/chat/completions' && r.request.headers.get('authorization') === 'Bearer synthetic-unselected-key')).toBe(true);
    expect(s.requests.every(r => r.body.provider === undefined)).toBe(true);
  });

  it('propagates cancellation to an in-flight SDK request and discards output', async () => {
    const f = fixture(); const controller = new AbortController(); let requestSeen!: () => void;
    const seen = new Promise<void>(resolve => { requestSeen = resolve; });
    const s = scripted(f, call => new Promise<Response>((_resolve, reject) => {
      requestSeen(); call.request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const pending = new StrandsExecutionRunner(selected(), s.transport).run(f.input, controller.signal);
    await seen; controller.abort('synthetic private abort reason');
    await expect(pending).rejects.toMatchObject({ code: 'execution_aborted' });
    expect(s.requests).toHaveLength(1);
    expect(f.activity.mock.calls.filter(([event]) => event.kind === 'agent_end').map(([event]) => event.outcome)).toEqual(['cancelled']);
    expect(JSON.stringify(f.activity.mock.calls)).not.toContain('synthetic private abort reason');
  });

  it('reports a cancelled writer without accepting a late model result', async () => {
    const f = fixture(); const controller = new AbortController();
    Object.assign(f.input.adaptive!, { stage: 'launch_pack', analysis: f.analysis, decision: { optionId: 'beta', constraints: '', actorId: 'human', at: '2026-09-14T00:00:00Z', sourceRevision: 1, analysisVersion: 'v1' } });
    const s = scripted(f, (call, occurrence) => {
      if (call.agent === 'launch_pack' && occurrence === 3) controller.abort();
      return undefined;
    });
    await expect(new StrandsExecutionRunner(selected(), s.transport).run(f.input, controller.signal)).rejects.toMatchObject({ code: 'execution_aborted' });
    expect(f.activity.mock.calls.filter(([event]) => event.kind === 'agent_end').map(([event]) => ({ agent: event.agent, outcome: event.outcome }))).toEqual([{ agent: 'launch_pack', outcome: 'cancelled' }]);
  });

  it('enforces the four-minute outer timeout without accepting an unfinished read', async () => {
    const f = fixture(); const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
    let readStarted!: () => void; const started = new Promise<void>(resolve => { readStarted = resolve; });
    f.input.adaptive!.readSource = vi.fn(async () => { readStarted(); return new Promise<string>(() => {}); });
    const s = scripted(f);
    try {
      const pending = new StrandsExecutionRunner(selected(), s.transport).run(f.input);
      await started;
      expect(timeout).toHaveBeenCalledWith(240_000);
      deadline.abort(new DOMException('Synthetic deadline elapsed', 'TimeoutError'));
      await expect(pending).rejects.toMatchObject({ code: 'execution_aborted' });
      expect(s.requests).toHaveLength(2);
      expect(f.activity.mock.calls.filter(([event]) => event.kind === 'agent_end').map(([event]) => event.outcome)).toEqual(['cancelled']);
      const readStart = f.activity.mock.calls.find(([event]) => event.kind === 'tool_start' && event.tool === 'read_mission_sources')?.[0];
      expect(readStart?.toolCallId).toBeTruthy();
      expect(f.activity.mock.calls.some(([event]) => event.kind === 'tool_end' && event.toolCallId === readStart?.toolCallId && event.outcome === 'cancelled')).toBe(true);
    } finally { timeout.mockRestore(); }
  });

  it('rejects changed source contents and never includes a read error body in model requests', async () => {
    const f = fixture(); f.input.adaptive!.readSource = vi.fn(async () => { throw new Error('private read credential detail'); });
    const s = scripted(f);
    await expect(new StrandsExecutionRunner(selected(), s.transport).run(f.input)).rejects.toMatchObject({ code: 'strands_graph_failed' });
    expect(JSON.stringify(s.requests.map(r => r.body))).not.toContain('private read credential detail');
    expect(s.counts.has('readiness')).toBe(false);
    f.input.adaptive!.readSource = vi.fn(async () => 'A source changed after the revision was saved.');
    const changed = scripted(f);
    await expect(new StrandsExecutionRunner(selected(), changed.transport).run(f.input)).rejects.toMatchObject({ code: 'strands_graph_failed' });
    expect(changed.counts.has('synthesis')).toBe(false);
  });

  it('requires live setup and a current human decision without model calls', async () => {
    const f = fixture(); const s = scripted(f);
    const fixtureRunner = new StrandsExecutionRunner(selected({ MODEL_MODE: 'fixture' }), s.transport);
    expect(fixtureRunner.setupRequired.join(' ')).toContain('MODEL_MODE=live');
    await expect(fixtureRunner.run(f.input)).rejects.toMatchObject({ code: 'model_unavailable' });
    f.input.adaptive!.stage = 'launch_pack';
    await expect(new StrandsExecutionRunner(selected(), s.transport).run(f.input)).rejects.toMatchObject({ code: 'human_decision_required' });
    expect(s.transport).not.toHaveBeenCalled();
  });
});
