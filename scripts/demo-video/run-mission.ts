import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { ExecutionCapabilities, ExecutionIdentity, ExecutionStart, MissionExecution } from '@mission/domain';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const outputDir = join(repoRoot, 'artifacts', 'demo-video');
const requestPath = join(outputDir, 'mission-request.json');
const goal = 'Prepare factual MissionDeck hackathon requirements, have a human review them, then draft a four-slide storyboard for a two-minute demo.';
const instructions = `\n\nExecution instructions for this mission:\nCreate exactly three tasks: (1) an agent drafts a factual requirements and capability brief using only this supplied material; (2) the selected human reviews and corrects that draft; (3) an agent writes a four-slide storyboard with speaker notes and a two-minute total timing after the draft and human review are saved. The final task is text drafting only. It must include four slide titles, concise on-slide copy, the exact product action to show, speaker notes, timing, and any unverified claim to avoid. Do not create slide files, record video, browse links, submit to a hackathon, publish, or send messages. Those are outside this text mission. Do not invent hackathon rules, eligibility, deadlines, prizes, integrations, or proof of live execution. Retain source titles and distinguish verified facts from missing evidence. Wait for actual human feedback; do not fabricate it.\n`;
type SavedRequest = { version: 1; baseUrl: string; briefPath: string; inputHash: string; input: ExecutionStart; missionId?: string; createdAt: string };
let sessionToken = '';
let pairingCode = '';
let requestOrigin = '';

function safeMessage(value: unknown) {
  let message = value instanceof Error ? value.message : String(value);
  for (const secret of [sessionToken, pairingCode]) if (secret) message = message.split(secret).join('[REDACTED]');
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/(?:sk-|key-)[A-Za-z0-9_-]{8,}/g, '[REDACTED]').slice(0, 1200);
}
async function atomicJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}
async function loadRequest(): Promise<SavedRequest | null> {
  try { return JSON.parse(await readFile(requestPath, 'utf8')) as SavedRequest; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('The saved demo mission request could not be read. Preserve it for recovery.'); }
}
function backendUrl() {
  const url = new URL(process.env.MISSIONDECK_BASE_URL ?? 'http://127.0.0.1:4330');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('MISSIONDECK_BASE_URL must be a plain HTTP loopback backend URL.');
  return url.origin;
}
async function request<T>(base: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', ...(requestOrigin ? { Origin: requestOrigin } : {}), ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(`MissionDeck HTTP ${response.status}: ${safeMessage(result.error ?? 'Request failed; inspect the saved mission state before retrying.')}`);
  return result;
}
function chooseIdentity(identities: ExecutionIdentity[], explicitId: string | undefined, kind: 'human' | 'agent') {
  const selected = explicitId ? identities.find(identity => identity.id === explicitId) : identities.length === 1 ? identities[0] : undefined;
  if (!selected) throw new Error(`Set MISSIONDECK_${kind.toUpperCase()}_ID to a current ${kind} identity. Available: ${identities.map(identity => `${identity.name} (${identity.id})`).join(', ') || 'none'}.`);
  return selected;
}
function statusSummary(execution: MissionExecution) {
  return {
    missionId: execution.missionId, status: execution.status, mode: execution.mode, modelMode: execution.modelMode,
    agentRuns: execution.budget.agentRuns, maxAgentRuns: execution.budget.maxAgentRuns,
    tasks: execution.tasks.map(task => ({ id: task.id, title: task.title, assignee: task.assignee.name, executor: task.assignee.kind, status: task.status, providerId: task.providerId, runId: task.runId, error: task.lastError })),
    artifacts: execution.artifacts.map(artifact => ({ id: artifact.id, title: artifact.title, kind: artifact.kind, characters: artifact.content.length, verifiedAt: artifact.verifiedAt })),
    lastError: execution.lastError,
    nextAction: execution.tasks.some(task => task.status === 'waiting_human') ? 'A human must review the saved draft in MissionDeck or Ambiguous.' : execution.status === 'needs_review' ? 'A human must inspect the saved final outputs before outcome verification.' : undefined,
  };
}
function requireMissionId(value: string | undefined): string {
  if (!value || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error('No saved mission ID is available. Run create once after authorization, or provide --mission-id.');
  return value;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { brief: { type: 'string' }, 'mission-id': { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  const command = positionals[0] ?? 'help';
  if (values.help || command === 'help') {
    console.log(`Usage: node --import tsx scripts/demo-video/run-mission.ts <create|status|export> [--brief path] [--mission-id uuid]\n\nEnvironment: MISSIONDECK_PAIRING_CODE (required); MISSIONDECK_BASE_URL (default http://127.0.0.1:4330); MISSIONDECK_ORIGIN (default http://127.0.0.1:5174); MISSIONDECK_HUMAN_ID and MISSIONDECK_AGENT_ID when multiple identities are available.\n\ncreate starts real live work exactly once through the persisted request ID. status reads once. export writes the latest server-verified artifacts under artifacts/demo-video. Human review and outcome verification remain manual. Provider and model credentials are used only by the backend; this CLI never loads .env or stores session tokens.`);
    return;
  }
  if (!['create', 'status', 'export'].includes(command) || positionals.length !== 1) throw new Error('Choose exactly one command: create, status, or export.');
  pairingCode = process.env.MISSIONDECK_PAIRING_CODE ?? '';
  if (!pairingCode.trim()) throw new Error('Set MISSIONDECK_PAIRING_CODE for the isolated backend. Do not pass credentials as command arguments.');
  const base = backendUrl();
  const origin = new URL(process.env.MISSIONDECK_ORIGIN ?? 'http://127.0.0.1:5174');
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('MISSIONDECK_ORIGIN must be the loopback frontend origin.');
  requestOrigin = origin.origin;
  const saved = await loadRequest();
  if (saved && saved.baseUrl !== base && !values['mission-id']) throw new Error('The saved request belongs to a different backend. Use the original MISSIONDECK_BASE_URL to preserve idempotency.');
  const paired = await request<{ token: string }>(base, '/api/pair', { code: pairingCode });
  sessionToken = paired.token;
  if (!/^[a-f0-9]{64}$/.test(sessionToken)) throw new Error('The backend did not issue a valid local session.');
  let missionId = values['mission-id'] ?? saved?.missionId;
  if (command === 'create') {
    if (values['mission-id']) throw new Error('Do not supply --mission-id with create; it uses the persisted idempotent request.');
    const capabilities = await request<ExecutionCapabilities>(base, '/api/execution/capabilities');
    if (!capabilities.enabled || capabilities.mode !== 'live' || capabilities.modelMode !== 'live') throw new Error(`This demo requires enabled live workspace and live model modes. ${capabilities.blockers.join(' ')}`);
    const human = chooseIdentity(capabilities.humans, process.env.MISSIONDECK_HUMAN_ID ?? saved?.input.humanId, 'human');
    const agent = chooseIdentity(capabilities.agents, process.env.MISSIONDECK_AGENT_ID ?? saved?.input.agentId, 'agent');
    const briefPath = values.brief ? resolve(values.brief) : saved?.briefPath ?? fileURLToPath(new URL('./mission-brief.md', import.meta.url));
    const brief = await readFile(briefPath, 'utf8');
    const context = `${brief.trim()}${instructions}`;
    if (!brief.trim() || context.length > 20000) throw new Error('Supply a nonempty brief that fits within the 20,000-character mission context limit, including orchestration instructions.');
    const input: ExecutionStart = { requestId: saved?.input.requestId ?? randomUUID(), goal, context, humanId: human.id, agentId: agent.id, maxTasks: 3, maxAgentRuns: 4 };
    const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    if (saved && saved.inputHash !== inputHash) throw new Error('The existing demo mission request has different content or assignees. Its request ID will not be reused for changed work. Preserve this run and inspect it first.');
    await mkdir(outputDir, { recursive: true });
    const state: SavedRequest = saved ?? { version: 1, baseUrl: base, briefPath, inputHash, input, createdAt: new Date().toISOString() };
    // Persist the exact request before dispatch. If the response is lost, a repeated
    // create sends the same request ID and cannot duplicate the native mission.
    await atomicJson(requestPath, state);
    await atomicJson(join(outputDir, 'source.json'), { goal, briefPath, suppliedBrief: brief, executionInstructions: instructions.trim(), context, human, agent, maxTasks: 3, maxAgentRuns: 4 });
    const created = await request<{ execution: MissionExecution }>(base, '/api/execution/missions', input);
    missionId = requireMissionId(created.execution.missionId);
    await atomicJson(requestPath, { ...state, missionId });
    console.log(JSON.stringify(statusSummary(created.execution), null, 2));
    return;
  }
  const execution = (await request<{ execution: MissionExecution }>(base, `/api/missions/${requireMissionId(missionId)}/execution`)).execution;
  if (!execution) throw new Error('The selected mission has no execution record.');
  if (command === 'export') {
    if (execution.mode !== 'live' || execution.modelMode !== 'live') throw new Error('This demo export requires an actual live workspace and live model mission. A fixture run cannot substitute for it.');
    await mkdir(outputDir, { recursive: true });
    await atomicJson(join(outputDir, 'source.json'), { missionId: execution.missionId, goal: execution.goal, context: execution.context, human: execution.human, agent: execution.agent, authorizedAssignees: execution.authorizedAssignees, budget: execution.budget, mode: execution.mode, modelMode: execution.modelMode });
    await atomicJson(join(outputDir, 'execution.json'), execution);
    await atomicJson(join(outputDir, 'results.json'), { exportedAt: new Date().toISOString(), note: 'Artifact contents are the backend’s last verified Ambiguous snapshots; each record retains its verification time.', ...statusSummary(execution) });
    const manifest = [];
    for (const [index, artifact] of execution.artifacts.entries()) {
      const name = `${String(index + 1).padStart(2, '0')}-${artifact.kind}-${artifact.id.replace(/[^a-zA-Z0-9_.-]/g, '_')}.md`;
      await writeFile(join(outputDir, name), `${artifact.content}\n`, { mode: 0o600 });
      manifest.push({ filename: name, providerId: artifact.id, title: artifact.title, kind: artifact.kind, taskId: artifact.taskId, verifiedAt: artifact.verifiedAt, url: artifact.url });
    }
    await atomicJson(join(outputDir, 'artifact-manifest.json'), manifest);
    console.log(JSON.stringify({ exported: outputDir, ...statusSummary(execution) }, null, 2));
    return;
  }
  console.log(JSON.stringify(statusSummary(execution), null, 2));
}

main().catch(error => { console.error(safeMessage(error)); process.exitCode = 1; });
