import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ADAPTIVE_SAMPLE_SOURCES, adaptiveSourcesSchema, type ExecutionCapabilities, type ExecutionIdentity, type MissionExecution } from '@mission/domain';

const help = `Adaptive launch connected rehearsal

Usage: node --import tsx scripts/adaptive-demo.ts COMMAND [options]
Commands:
  start                         Preview a dedicated fictional demo mission.
  status                        Read saved execution, decisions and document links.
  decide --option ID [--constraints TEXT]
  update --sources FILE         Review a JSON array of named source snapshots.
  reopen                        Reopen a completed adaptive mission.
  verify --attestation TEXT      Record human verification of saved artifacts.
  export                        Save private local evidence files, with layer labels.
Options:
  --execute                     Dispatch a previewed mutation. Otherwise only local
                                session/read requests and a private journal are used.
  --mission-id UUID             Use an existing adaptive mission in this journal.
  --sources FILE                Optional source JSON for start; defaults to the
                                editable fictional Harbor sample.
  --help                        Show help without connecting or reading credentials.
Environment:
  MISSIONDECK_BASE_URL           Loopback backend (default http://127.0.0.1:4332).
  MISSIONDECK_ORIGIN             Loopback frontend (default http://127.0.0.1:5173).
  MISSIONDECK_PAIRING_CODE       Initial/recovery pairing code; never use a CLI argument.
  MISSIONDECK_DATA_DIR           Explicit alternative directory containing pairing-code.
  MISSIONDECK_HUMAN_ID           Exact connected human ID (required if not unique).
  MISSIONDECK_AGENT_ID           Exact connected agent ID (required if not unique).
  MISSIONDECK_DEMO_DIR           Private journal/session/export directory; default is the
                                gitignored artifacts/demo-video/adaptive directory.

Mutations require live workspace and model modes. Retry an uncertain idempotent
request with the same command and arguments; its saved request ID is reused.
Uncertain verify requests are inspected, never automatically dispatched again.
`;
const commands = ['start', 'status', 'decide', 'update', 'reopen', 'verify', 'export'] as const;
type Command = typeof commands[number];
type Mutation = Exclude<Command, 'status' | 'export'>;
interface Operation { id: string; command: Mutation; intentHash: string; path: string; payload: Record<string, unknown>; state: 'prepared' | 'dispatching' | 'accepted' | 'rejected' | 'uncertain'; at: string; httpStatus?: number; missionId?: string }
interface Journal { version: 1; baseUrl: string; missionId?: string; operations: Operation[] }
interface SessionCache { version: 1; baseUrl: string; origin: string; token: string; expiresAt: string }
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
let sessionToken = ''; let pairingSecret = ''; let origin = ''; let sessionCanRefresh = false; let releaseLock: (() => Promise<void>) | undefined;
const sessionExpiryMarginMs = 30_000;
const maxCachedSessionSeconds = 24 * 60 * 60;
const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
class ApiFailure extends Error { constructor(readonly status?: number) { super(status ? `MissionDeck returned HTTP ${status}. Inspect mission status and the saved request journal before retrying.` : 'MissionDeck did not confirm the response. The saved request journal must be retained for recovery.'); } }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function safeMessage(value: unknown) {
  let text = value instanceof Error ? value.message : 'The rehearsal command failed.';
  for (const secret of [sessionToken, pairingSecret]) if (secret) text = text.split(secret).join('[REDACTED]');
  return text.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/(?:sk-|key-)[A-Za-z0-9_-]{8,}/g, '[REDACTED]').slice(0, 1200);
}
function loopback(value: string, name: string) {
  let url: URL; try { url = new URL(value); } catch { throw new Error(`${name} must be a plain HTTP loopback URL.`); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(`${name} must be a plain HTTP loopback URL.`);
  return url.origin;
}
async function privateJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await chmod(dirname(path), 0o700);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); await rename(temporary, path);
}
function ownedOnly(uid: number, mode: number) {
  return (currentUid === undefined || uid === currentUid) && (mode & 0o077) === 0;
}
async function secureDemoDirectory(path: string, create: boolean) {
  let details;
  try { details = await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('MISSIONDECK_DEMO_DIR could not be inspected safely. Use a private owner-controlled directory.');
    if (!create) return false;
    await mkdir(path, { recursive: true, mode: 0o700 });
    details = await lstat(path);
  }
  if (details.isSymbolicLink() || !details.isDirectory() || !ownedOnly(details.uid, details.mode)) throw new Error('MISSIONDECK_DEMO_DIR must be a real current-user directory with no group or other permissions (for example mode 0700); symbolic links are refused.');
  return true;
}
async function secureSessionFile(path: string) {
  let details;
  try { details = await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new Error('The private session cache could not be inspected safely. Refusing to read or replace it.');
  }
  if (details.isSymbolicLink() || !details.isFile() || !ownedOnly(details.uid, details.mode)) throw new Error('The private session cache must be a real current-user file with no group or other permissions (for example mode 0600); symbolic links are refused. Refusing to read or replace it.');
  return true;
}
async function request<T>(base: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  catch { throw new ApiFailure(); }
  if (!response.ok) throw new ApiFailure(response.status); // Never print upstream response bodies.
  try { return await response.json() as T; } catch { throw new ApiFailure(); }
}
function validSessionCache(value: unknown, base: string): value is SessionCache {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<SessionCache>;
  const expiresAt = typeof candidate.expiresAt === 'string' ? Date.parse(candidate.expiresAt) : Number.NaN;
  return candidate.version === 1 && candidate.baseUrl === base && candidate.origin === origin &&
    typeof candidate.token === 'string' && /^[a-f0-9]{64}$/.test(candidate.token) &&
    Number.isFinite(expiresAt) && expiresAt > Date.now() + sessionExpiryMarginMs;
}
async function cachedSession(path: string, base: string) {
  if (!await secureDemoDirectory(dirname(path), false) || !await secureSessionFile(path)) return undefined;
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return validSessionCache(value, base) ? value.token : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw new Error('The private session cache could not be read. Check its owner-only permissions or use a separate MISSIONDECK_DEMO_DIR.');
  }
}
async function pairSession(base: string, path: string) {
  await secureDemoDirectory(dirname(path), true);
  await secureSessionFile(path);
  sessionToken = '';
  pairingSecret = process.env.MISSIONDECK_PAIRING_CODE?.trim() ?? '';
  if (!pairingSecret && process.env.MISSIONDECK_DATA_DIR) {
    try { pairingSecret = (await readFile(join(resolve(process.env.MISSIONDECK_DATA_DIR), 'pairing-code'), 'utf8')).trim(); }
    catch { throw new Error('The explicitly selected data directory has no readable pairing code.'); }
  }
  if (!pairingSecret) throw new Error('Set MISSIONDECK_PAIRING_CODE or the explicit MISSIONDECK_DATA_DIR for initial pairing or session recovery. The script does not search for credentials.');
  const paired = await request<{ token: string; expiresIn: number }>(base, '/api/pair', { code: pairingSecret });
  if (!/^[a-f0-9]{64}$/.test(paired.token) || !Number.isSafeInteger(paired.expiresIn) || paired.expiresIn <= 0) throw new Error('The backend did not issue a valid local session.');
  sessionToken = paired.token; sessionCanRefresh = false;
  const expiresAt = new Date(Date.now() + Math.min(paired.expiresIn, maxCachedSessionSeconds) * 1000).toISOString();
  await privateJson(path, { version: 1, baseUrl: base, origin, token: sessionToken, expiresAt } satisfies SessionCache);
}
async function initializeSession(base: string, path: string) {
  sessionToken = await cachedSession(path, base) ?? '';
  sessionCanRefresh = !!sessionToken;
  if (!sessionToken) await pairSession(base, path);
}
async function readRequest<T>(base: string, path: string, sessionPath: string): Promise<T> {
  try { return await request<T>(base, path); }
  catch (error) {
    if (!(error instanceof ApiFailure) || error.status !== 401 || !sessionCanRefresh) throw error;
    sessionCanRefresh = false;
    await pairSession(base, sessionPath);
    return request<T>(base, path);
  }
}
function selectIdentity(identities: ExecutionIdentity[], explicit: string | undefined, kind: 'human' | 'agent') {
  const choice = explicit ? identities.find(i => i.id === explicit) : identities.length === 1 ? identities[0] : undefined;
  if (!choice) throw new Error(`Set MISSIONDECK_${kind.toUpperCase()}_ID to an exact discovered ${kind} ID. Available IDs: ${identities.map(i => i.id).join(', ') || 'none'}.`);
  return choice;
}
function summary(e: MissionExecution, journal: Journal) {
  return { missionId: e.missionId, status: e.status, workspaceMode: e.mode, modelMode: e.modelMode, engine: e.engine,
    modelProvider: e.modelProvider, modelName: e.modelName, sourceRevision: e.adaptive?.sourceRevision, revision: e.adaptive?.revision,
    budget: e.adaptive?.budget, outerBudget: e.budget,
    decision: e.adaptive?.analysis ? { analysisVersion: e.adaptive.analysis.version, recommendedOptionId: e.adaptive.analysis.value.recommendedOptionId,
      options: e.adaptive.analysis.value.options, saved: e.adaptive.decision } : undefined,
    tasks: e.tasks.map(t => ({ id: t.id, title: t.title, status: t.status, assigneeId: t.assignee.id, assigneeKind: t.assignee.kind, providerId: t.providerId, providerUrl: t.providerUrl, version: t.version, runId: t.runId })),
    documents: e.artifacts.map(a => ({ id: a.id, title: a.title, kind: a.kind, url: a.url, sourceRevision: a.sourceRevision, verifiedAt: a.verifiedAt, current: a.sourceRevision === e.adaptive?.sourceRevision })),
    operations: e.operations, lastError: e.lastError ? safeMessage(new Error(e.lastError)) : null,
    unconfirmedRequests: journal.operations.filter(o => ['prepared', 'dispatching', 'uncertain'].includes(o.state)).map(o => ({ id: o.id, command: o.command, state: o.state, at: o.at })),
  };
}
function validateMission(e: MissionExecution | null): asserts e is MissionExecution {
  if (!e || e.engine !== 'strands' || !e.adaptive) throw new Error('The selected mission is not an adaptive Strands mission.');
}
function requireLive(e: Pick<MissionExecution, 'mode' | 'modelMode'>) {
  if (e.mode !== 'live' || e.modelMode !== 'live') throw new Error('Connected rehearsal mutations require live Ambiguous workspace and live model modes. Fixture execution cannot substitute for connected acceptance.');
}
async function readSources(path?: string) {
  if (!path) return structuredClone(ADAPTIVE_SAMPLE_SOURCES);
  let raw: unknown; try { raw = JSON.parse(await readFile(resolve(path), 'utf8')); } catch { throw new Error('The source file could not be read as JSON. Supply a JSON array of reviewed source snapshots.'); }
  const parsed = adaptiveSourcesSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Sources need one to five unique IDs and named, nonempty snapshots totaling at most 20,000 characters. Use the shared source format.');
  return parsed.data;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { execute: { type: 'boolean' }, help: { type: 'boolean' }, 'mission-id': { type: 'string' }, sources: { type: 'string' }, option: { type: 'string' }, constraints: { type: 'string' }, attestation: { type: 'string' } } });
  if (values.help || !positionals.length) { console.log(help); return; }
  const command = positionals[0] as Command;
  if (positionals.length !== 1 || !commands.includes(command)) throw new Error('Choose one supported command; use --help for usage.');
  if (values.sources && !['start', 'update'].includes(command) || values.option && command !== 'decide' || values.constraints && command !== 'decide' || values.attestation && command !== 'verify') throw new Error('An option does not belong to this command; use --help for usage.');
  const sources = ['start', 'update'].includes(command) ? await readSources(values.sources) : undefined;
  if (command === 'update' && !values.sources) throw new Error('Use update --sources FILE with the explicitly reviewed replacement snapshots.');
  if (command === 'decide' && (!values.option || values.option.length > 100 || (values.constraints?.trim().length ?? 0) > 4000)) throw new Error('decide requires --option ID and constraints of at most 4,000 characters.');
  if (command === 'verify' && (!values.attestation || values.attestation.trim().length < 10 || values.attestation.trim().length > 500)) throw new Error('verify requires a human --attestation of 10 to 500 characters after checking the saved outputs.');
  const base = loopback(process.env.MISSIONDECK_BASE_URL ?? 'http://127.0.0.1:4332', 'MISSIONDECK_BASE_URL');
  origin = loopback(process.env.MISSIONDECK_ORIGIN ?? 'http://127.0.0.1:5173', 'MISSIONDECK_ORIGIN');
  const outputDir = resolve(process.env.MISSIONDECK_DEMO_DIR ?? join(repoRoot, 'artifacts/demo-video/adaptive'));
  const journalPath = join(outputDir, 'request-journal.json');
  const sessionPath = join(outputDir, 'session.json');
  const readOnly = ['status', 'export'].includes(command);
  await secureDemoDirectory(outputDir, !readOnly);
  if (!readOnly) {
    const lockPath = join(outputDir, 'request-journal.lock');
    try { await mkdir(lockPath, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; throw new Error(`Another rehearsal mutation is running or was interrupted. Inspect ${join(lockPath, 'owner.json')} before removing a stale lock. Status remains available.`); }
    releaseLock = async () => { await unlink(join(lockPath, 'owner.json')).catch(() => {}); await rmdir(lockPath); };
    await privateJson(join(lockPath, 'owner.json'), { pid: process.pid, command, at: new Date().toISOString() });
  }
  let journal: Journal;
  try { journal = JSON.parse(await readFile(journalPath, 'utf8')) as Journal;
    if (journal.version !== 1 || !Array.isArray(journal.operations) || journal.baseUrl !== base) throw new Error('Invalid journal');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('The journal is unreadable or belongs to another backend. Preserve it and use its original backend and output directory.');
    journal = { version: 1, baseUrl: base, operations: [] };
  }
  if (values['mission-id'] && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values['mission-id'])) throw new Error('--mission-id must be a UUID.');
  if (values['mission-id'] && journal.missionId && values['mission-id'] !== journal.missionId) throw new Error('This journal belongs to another mission. Use a separate MISSIONDECK_DEMO_DIR.');
  const explicitMission = values['mission-id'] ?? journal.missionId;
  if (command === 'start' && values['mission-id']) throw new Error('start creates or reuses its journaled mission; do not supply --mission-id.');
  if (command !== 'start' && !explicitMission) throw new Error('No mission ID is saved. Start the dedicated demo or supply --mission-id.');
  await initializeSession(base, sessionPath);
  let execution: MissionExecution | undefined;
  if (explicitMission) {
    const loaded = (await readRequest<{ execution: MissionExecution | null }>(base, `/api/missions/${explicitMission}/execution`, sessionPath)).execution;
    validateMission(loaded); execution = loaded; journal.missionId = loaded.missionId;
  }
  if (command === 'status') { console.log(JSON.stringify(summary(execution!, journal), null, 2)); return; }
  if (command === 'export') {
    const e = execution!; const at = new Date().toISOString();
    const evidenceDir = join(outputDir, `export-${at.replace(/[:.]/g, '-')}`);
    const layer = e.mode === 'live' && e.modelMode === 'live' ? 'connected execution snapshot' : e.modelMode === 'live' ? 'real-model rehearsal with fixture workspace' : 'fixture execution';
    await privateJson(join(evidenceDir, 'execution.json'), { exportedAt: at, evidenceLayer: layer, limitation: 'Backend snapshots retain their last verified timestamps. This export does not perform fresh Ambiguous content or permission reads.', execution: e });
    await privateJson(join(evidenceDir, 'sources.json'), e.adaptive!.sourceHistory.at(-1)!.sources.map(({ fingerprint: _fingerprint, documentId: _documentId, ...source }) => source));
    const manifest = [];
    for (const [index, artifact] of e.artifacts.entries()) {
      const name = `${String(index + 1).padStart(2, '0')}-${artifact.kind}-${artifact.id.replace(/[^A-Za-z0-9_-]/g, '_')}.md`;
      await writeFile(join(evidenceDir, name), `${artifact.content}\n`, { flag: 'wx', mode: 0o600 });
      manifest.push({ filename: name, providerId: artifact.id, title: artifact.title, url: artifact.url, kind: artifact.kind, sourceRevision: artifact.sourceRevision, verifiedAt: artifact.verifiedAt });
    }
    await privateJson(join(evidenceDir, 'manifest.json'), { exportedAt: at, evidenceLayer: layer, ...summary(e, journal), artifacts: manifest });
    console.log(JSON.stringify({ exported: evidenceDir, evidenceLayer: layer, artifacts: manifest.length }, null, 2)); return;
  }
  const capabilities = await readRequest<ExecutionCapabilities>(base, '/api/execution/capabilities', sessionPath);
  if (capabilities.mode !== 'live' || capabilities.modelMode !== 'live' || !capabilities.adaptive?.enabled) throw new Error('The connected rehearsal requires enabled adaptive execution with live workspace and live model modes. Check Settings for setup requirements.');
  if (execution) requireLive(execution);
  if (command === 'start' && execution) { console.log(JSON.stringify(summary(execution, journal), null, 2)); return; }
  if (command === 'verify' && execution!.status === 'completed') {
    for (const operation of journal.operations.filter(o => o.command === 'verify' && o.state !== 'accepted' && o.payload.attestation === execution!.outcomeVerification?.statement)) operation.state = 'accepted';
    await privateJson(journalPath, journal); console.log(JSON.stringify(summary(execution!, journal), null, 2)); return;
  }
  const current = execution?.adaptive;
  const human = command === 'start' ? selectIdentity(capabilities.humans, process.env.MISSIONDECK_HUMAN_ID, 'human') : undefined;
  const agent = command === 'start' ? selectIdentity(capabilities.agents, process.env.MISSIONDECK_AGENT_ID, 'agent') : undefined;
  const intent = { command, missionId: execution?.missionId, ...(sources ? { sources } : {}), ...(human ? { humanId: human.id, agentId: agent!.id } : {}),
    ...(command === 'decide' ? { optionId: values.option, constraints: values.constraints?.trim() ?? '' } : {}), ...(command === 'verify' ? { attestation: values.attestation!.trim() } : {}) };
  const intentHash = digest(intent);
  const pending = journal.operations.find(o => ['prepared', 'dispatching', 'uncertain'].includes(o.state));
  if (pending && (pending.command !== command || pending.intentHash !== intentHash)) throw new Error(`An unconfirmed ${pending.command} request is saved. Repeat its original command and arguments or inspect status; do not replace its request ID or payload.`);
  if (pending?.command === 'verify' && pending.state !== 'prepared') throw new Error('The prior verification request is unconfirmed and cannot be replayed automatically. Inspect status and reconcile its operation in Mission Control. The original payload is preserved.');
  let operation = pending;
  if (!operation) {
    const requestId = randomUUID(); const prefix = `/api/missions/${execution?.missionId}/execution`;
    let path: string; let payload: Record<string, unknown>;
    if (command === 'start') { path = '/api/execution/missions'; payload = { requestId, template: 'adaptive_launch', goal: 'Adaptive launch connected demo: prepare the fictional Harbor launch pack and resolve the calendar conflict.', context: '', humanId: human!.id, agentId: agent!.id, maxTasks: 3, maxAgentRuns: 8, sources }; }
    else if (command === 'decide') {
      if (!current?.analysis) throw new Error('Wait for the current analysis and review its saved decision brief before selecting an option.');
      if (!current.analysis.value.options.some(o => o.id === values.option)) throw new Error('Select an option ID from the current decision brief shown by status.');
      if (current.decision) { if (current.decision.optionId !== values.option || current.decision.constraints !== (values.constraints?.trim() ?? '')) throw new Error('A decision is already recorded for this analysis. Update sources for a fresh decision.'); console.log(JSON.stringify(summary(execution!, journal), null, 2)); return; }
      path = `${prefix}/decision`; payload = { requestId, expectedRevision: current.revision, analysisVersion: current.analysis.version, optionId: values.option, constraints: values.constraints?.trim() ?? '' };
    } else if (command === 'update') { path = `${prefix}/sources`; payload = { requestId, expectedRevision: current!.revision, sources }; }
    else if (command === 'reopen') { path = `${prefix}/reopen`; payload = { requestId, expectedRevision: current!.revision }; }
    else { path = `${prefix}/control`; payload = { action: 'complete', attestation: values.attestation!.trim() }; }
    operation = { id: requestId, command, intentHash, path, payload, state: 'prepared', at: new Date().toISOString(), missionId: execution?.missionId };
    journal.operations.push(operation); await privateJson(journalPath, journal);
  }
  if (!values.execute) { console.log(JSON.stringify({ preview: true, externalWrites: false, method: 'POST', url: `${base}${operation.path}`, payload: operation.payload, journal: journalPath, next: 'Review this exact payload, then repeat this command with --execute.' }, null, 2)); return; }
  operation.state = 'dispatching'; await privateJson(journalPath, journal);
  let result: { execution: MissionExecution };
  try { result = await request<{ execution: MissionExecution }>(base, operation.path, operation.payload); validateMission(result.execution); }
  catch (error) { operation.state = error instanceof ApiFailure && error.status && error.status >= 400 && error.status < 500 ? 'rejected' : 'uncertain'; if (error instanceof ApiFailure && error.status) operation.httpStatus = error.status; await privateJson(journalPath, journal); throw error; }
  operation.state = 'accepted'; operation.missionId = result.execution.missionId; journal.missionId = result.execution.missionId;
  await privateJson(journalPath, journal); console.log(JSON.stringify(summary(result.execution, journal), null, 2));
}

main().catch(error => { console.error(safeMessage(error)); process.exitCode = 1; }).finally(async () => { if (releaseLock) await releaseLock().catch(() => { console.error('The private journal lock could not be released. Inspect it before another mutation.'); process.exitCode = 1; }); });
