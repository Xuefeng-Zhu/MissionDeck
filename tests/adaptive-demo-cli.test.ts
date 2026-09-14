import http, { type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { MissionExecution } from '@mission/domain';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const missionId = '12345678-1234-1234-1234-123456789012';
const pairing = 'controlled-local-pairing-code';
const token = 'a'.repeat(64);
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }))); });
function syntheticExecution(): MissionExecution {
  const at = new Date().toISOString();
  return {
    missionId, requestId: 'controlled-request', requestHash: 'controlled-hash', status: 'running', mode: 'live', modelMode: 'live', engine: 'strands',
    modelProvider: 'controlled', modelName: 'controlled-model', goal: 'Controlled CLI test only', context: '',
    human: { id: 'human-1', name: 'Controlled human', kind: 'human' }, agent: { id: 'agent-1', name: 'Controlled agent', kind: 'agent' }, summary: '',
    budget: { agentRuns: 1, maxAgentRuns: 8, maxTasks: 3 }, tasks: [], artifacts: [], operations: [], events: [], lastError: null, createdAt: at, updatedAt: at,
    adaptive: { revision: 1, sourceRevision: 1,
      sourceHistory: [{ revision: 1, sources: [{ id: 'source', title: 'Source', content: 'Reviewed test input', provenance: 'pasted', fingerprint: 'hash' }], createdAt: at, changeSummary: 'Initial' }],
      budget: { modelCalls: 1, toolCalls: 1, maxModelCalls: 40, maxToolCalls: 60 },
      analysis: { version: 'analysis-1', sourceRevision: 1, value: { summary: 'Controlled conflict', findings: [],
        options: [{ id: 'beta', label: 'Beta', description: 'Private beta', consequences: ['Narrow scope'] }, { id: 'delay', label: 'Delay', description: 'Wait for readiness', consequences: ['Later launch'] }],
        recommendedOptionId: 'beta', unresolvedRequirements: [], assumptions: [] } },
    },
  };
}
async function runCli(args: string[], directory: string, base = 'http://127.0.0.1:1', expectedExit = 0) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/adaptive-demo.ts', ...args], {
    cwd: repoRoot,
    env: { ...process.env, MISSIONDECK_BASE_URL: base, MISSIONDECK_ORIGIN: 'http://127.0.0.1:5173', MISSIONDECK_PAIRING_CODE: pairing,
      MISSIONDECK_DEMO_DIR: directory, MISSIONDECK_HUMAN_ID: 'human-1', MISSIONDECK_AGENT_ID: 'agent-1' },
  });
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); }); child.stderr.on('data', chunk => { output += String(chunk); });
  const exit = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  expect(exit, output).toBe(expectedExit); expect(output).not.toContain(pairing); expect(output).not.toContain(token);
  return output;
}
async function controlledBackend(mode: 'live' | 'fixture' = 'live') {
  const directory = await mkdtemp(join(tmpdir(), 'missiondeck-adaptive-cli-test-'));
  const execution = syntheticExecution(); execution.mode = mode;
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const counters = { start: 0, decision: 0, update: 0, verify: 0, reopen: 0 };
  const seen = new Set<string>();
  const lose = { start: true, decision: true, verify: true };
  const failures: string[] = [];
  const server = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += String(chunk);
      const input = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      res.setHeader('Content-Type', 'application/json');
      const send = (body: unknown, status = 200) => { res.statusCode = status; res.end(JSON.stringify(body)); };
      if (req.url === '/api/pair') { expect(input.code).toBe(pairing); send({ token }); return; }
      expect(req.headers.authorization).toBe(`Bearer ${token}`);
      if (req.url === '/api/execution/capabilities') { send({ mode, modelMode: 'live', enabled: true, blockers: [], adaptive: { enabled: true, blockers: [] }, humans: [execution.human], agents: [execution.agent] }); return; }
      if (req.method === 'GET') { send({ execution }); return; }
      requests.push({ path: req.url!, body: input });
      if (req.url === '/api/execution/missions') {
        if (!seen.has(String(input.requestId))) { seen.add(String(input.requestId)); counters.start++; }
        if (lose.start) { lose.start = false; res.destroy(); return; }
      } else if (req.url?.endsWith('/decision')) {
        if (!seen.has(String(input.requestId))) {
          seen.add(String(input.requestId)); counters.decision++; execution.adaptive!.revision++;
          execution.adaptive!.decision = { optionId: String(input.optionId), constraints: String(input.constraints), sourceRevision: 1, analysisVersion: 'analysis-1', actorId: 'controlled-owner', at: new Date().toISOString() };
        }
        if (lose.decision) { lose.decision = false; res.destroy(); return; }
      } else if (req.url?.endsWith('/sources')) {
        if (input.expectedRevision !== execution.adaptive!.revision) { send({ error: 'controlled stale revision' }, 409); return; }
        counters.update++; execution.adaptive!.revision++; execution.adaptive!.sourceRevision++;
      } else if (req.url?.endsWith('/control')) {
        counters.verify++; execution.status = 'blocked'; execution.pendingVerification = { statement: String(input.attestation), actorId: 'controlled-owner', at: new Date().toISOString() };
        if (lose.verify) { lose.verify = false; res.destroy(); return; }
      } else if (req.url?.endsWith('/reopen')) {
        if (execution.status !== 'completed') { send({ error: 'not completed' }, 409); return; }
        counters.reopen++; execution.status = 'needs_review'; execution.adaptive!.revision++; delete execution.outcomeVerification;
      } else { throw new Error('Unexpected mock endpoint.'); }
      send({ execution });
    } catch (error) { failures.push(error instanceof Error ? error.message : 'Mock request failed.'); res.statusCode = 500; res.end('{}'); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); servers.push(server);
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Mock server address missing.');
  return { directory, base: `http://127.0.0.1:${address.port}`, execution, counters, requests, failures };
}

describe('adaptive connected-demo CLI with a controlled local HTTP backend', () => {
  it('shows help and rejects invalid arguments without connecting or reading credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'missiondeck-adaptive-help-test-'));
    expect(await runCli(['--help'], directory)).toContain('Uncertain verify requests are inspected');
    expect(await runCli(['unknown'], directory, undefined, 1)).toContain('Choose one supported command');
    expect(await runCli(['verify'], directory, undefined, 1)).toContain('requires a human --attestation');
    expect(await readdir(directory)).toEqual([]);
  });

  it('previews without external writes, replays exact uncertain requests, rejects stale changes, and exports private labeled evidence', async () => {
    const mock = await controlledBackend();
    const cli = (args: string[], exit = 0) => runCli(args, mock.directory, mock.base, exit);
    const preview = JSON.parse(await cli(['start']));
    expect(preview).toMatchObject({ preview: true, externalWrites: false }); expect(mock.requests).toHaveLength(0);
    await cli(['start', '--execute'], 1); await cli(['start', '--execute']);
    expect(mock.counters.start).toBe(1);
    expect(mock.requests[0]!.body).toEqual(mock.requests[1]!.body);
    expect(mock.requests[0]!.body.requestId).toBe(preview.payload.requestId);
    await cli(['decide', '--option', 'beta', '--constraints', 'Keep scope narrow']); expect(mock.counters.decision).toBe(0);
    await cli(['decide', '--option', 'beta', '--constraints', 'Keep scope narrow', '--execute'], 1);
    await cli(['decide', '--option', 'delay', '--execute'], 1); expect(mock.counters.decision).toBe(1);
    await cli(['decide', '--option', 'beta', '--constraints', 'Keep scope narrow', '--execute']); expect(mock.counters.decision).toBe(1);
    const decisionRequests = mock.requests.filter(r => r.path.endsWith('/decision'));
    expect(decisionRequests[0]!.body).toEqual(decisionRequests[1]!.body);
    const sources = join(mock.directory, 'replacement.json');
    await writeFile(sources, JSON.stringify([{ id: 'source', title: 'Source', content: 'Changed reviewed input', provenance: 'pasted' }]));
    await cli(['update', '--sources', sources]); mock.execution.adaptive!.revision++;
    await cli(['update', '--sources', sources, '--execute'], 1); expect(mock.counters.update).toBe(0);
    await cli(['update', '--sources', sources]); await cli(['update', '--sources', sources, '--execute']); expect(mock.counters.update).toBe(1);
    const sourceRequests = mock.requests.filter(r => r.path.endsWith('/sources'));
    expect(sourceRequests[0]!.body.requestId).not.toBe(sourceRequests[1]!.body.requestId);
    const statement = 'I read and verified the saved outputs.';
    await cli(['verify', '--attestation', statement, '--execute'], 1);
    expect(await cli(['verify', '--attestation', statement, '--execute'], 1)).toContain('cannot be replayed automatically'); expect(mock.counters.verify).toBe(1);
    mock.execution.status = 'completed'; mock.execution.outcomeVerification = { statement, actorId: 'controlled-owner', at: new Date().toISOString() }; delete mock.execution.pendingVerification;
    await cli(['verify', '--attestation', statement, '--execute']); expect(mock.counters.verify).toBe(1);
    await cli(['reopen']); expect(mock.counters.reopen).toBe(0); await cli(['reopen', '--execute']); expect(mock.counters.reopen).toBe(1);
    const exported = JSON.parse(await cli(['export']));
    expect(exported.evidenceLayer).toBe('connected execution snapshot');
    const evidence = JSON.parse(await readFile(join(exported.exported, 'execution.json'), 'utf8'));
    expect(evidence.limitation).toContain('does not perform fresh Ambiguous');
    expect((await stat(join(mock.directory, 'request-journal.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(mock.directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(exported.exported, 'execution.json'))).mode & 0o777).toBe(0o600);
    expect(await readdir(mock.directory)).not.toContain('request-journal.lock'); expect(mock.failures).toEqual([]);
  }, 40_000);

  it('refuses fixture-mode mutations and keeps fixture exports labeled as such', async () => {
    const mock = await controlledBackend('fixture');
    expect(await runCli(['start', '--execute'], mock.directory, mock.base, 1)).toContain('live workspace and live model modes');
    expect(mock.requests).toHaveLength(0);
    const exported = JSON.parse(await runCli(['export', '--mission-id', missionId], mock.directory, mock.base));
    expect(exported.evidenceLayer).toBe('real-model rehearsal with fixture workspace');
    expect(mock.requests).toHaveLength(0); expect(mock.failures).toEqual([]);
  });
});
