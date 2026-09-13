import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { config } from '../../apps/server/src/config.js';
import { AmbiguousWorkProvider } from '../../apps/server/src/providers/ambiguous.js';
import type { MissionExecution } from '@mission/domain';

// One-off, explicitly authorized demo integration. This is not a general chat poller.
const channelId = 'a74ceb99-488c-4597-a512-c115e3634a35';
const missionId = 'ecd1f4d5-c46d-4e05-8833-0c5aa38aa452';
const taskId = 'ecd1f4d5-c46d-4e05-8833-0c5aa38aa452-07e7b98a-3a63-496b-ab7b-466458dc9afb';
const nativeBase = 'https://app.ambiguous.ai';
const localBase = 'http://127.0.0.1:4330';
const origin = 'http://127.0.0.1:5174';
const prefix = 'Human review (demo):';
const directory = fileURLToPath(new URL('../../artifacts/demo-video/', import.meta.url));
const ledgerPath = join(directory, 'chat-review-ledger.json');
type Entry = { messageId: string; channelId: string; missionId: string; taskId: string; feedbackHash: string; feedback: string; state: 'pending' | 'accepted'; recordedAt: string };
let token = ''; let pairingCode = '';
function safe(error: unknown) {
  let result = error instanceof Error ? error.message : String(error);
  for (const value of [config.AMBIGUOUS_API_KEY, token, pairingCode]) if (value) result = result.split(value).join('[REDACTED]');
  return result.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/(?:sk-|key-)[A-Za-z0-9_-]{8,}/g, '[REDACTED]').slice(0, 1000);
}
async function save(entry: Entry) {
  await mkdir(directory, { recursive: true }); const temp = `${ledgerPath}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 }); await rename(temp, ledgerPath);
}
async function local<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${localBase}${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`Local mission request returned HTTP ${response.status}; inspect the existing task before retrying.`);
  return await response.json() as T;
}
async function native(path: string): Promise<Record<string, unknown>> {
  if (![ `/api/channels/${channelId}`, `/api/channels/${channelId}/messages?limit=20` ].includes(path)) throw new Error('Unsupported channel read.');
  const response = await fetch(`${nativeBase}${path}`, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${config.AMBIGUOUS_API_KEY}`, 'API-Version': '1', Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Selected channel read returned HTTP ${response.status}.`);
  return await response.json() as Record<string, unknown>;
}
async function main() {
  if (process.argv[2] !== '--accept') { console.log('Usage: node --import tsx scripts/demo-video/accept-chat-review.ts --accept\nRequires MISSIONDECK_PAIRING_CODE. Reads one fixed private channel snapshot and imports exactly one real human review. Never sends a chat message or verifies mission completion.'); return; }
  pairingCode = process.env.MISSIONDECK_PAIRING_CODE ?? '';
  if (!pairingCode || !config.AMBIGUOUS_API_KEY || !config.AMBIGUOUS_EXPECTED_USER_ID || !config.AMBIGUOUS_EXPECTED_WORKSPACE_ID) throw new Error('The local pairing credential and verified native server identity are required.');
  token = (await local<{ token: string }>('/api/pair', { code: pairingCode })).token;
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid local pairing response.');
  const { execution } = await local<{ execution: MissionExecution }>(`/api/missions/${missionId}/execution`);
  if (execution.mode !== 'live' || execution.modelMode !== 'live' || execution.human.id !== config.AMBIGUOUS_EXPECTED_USER_ID) throw new Error('The mission modes or configured human identity do not match this handoff.');
  const task = execution.tasks.find(task => task.id === taskId);
  if (!task || task.assignee.id !== execution.human.id) throw new Error('The selected review task is not assigned to the configured human.');
  let previous: Entry | null = null;
  try { previous = JSON.parse(await readFile(ledgerPath, 'utf8')) as Entry; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('The existing review ledger could not be read.'); }
  if (previous) {
    if (previous.missionId !== missionId || previous.taskId !== taskId || previous.channelId !== channelId) throw new Error('The ledger belongs to another handoff.');
    if (task.reviewFeedback === previous.feedback) { await save({ ...previous, state: 'accepted' }); console.log(JSON.stringify({ status: 'already_accepted', missionId, taskId, sourceMessageId: previous.messageId })); return; }
    throw new Error('A previous handoff is already recorded. Its outcome must be reconciled; this script will not submit it again.');
  }
  if (task.status !== 'waiting_human' || execution.status !== 'running') throw new Error('The mission is not currently waiting for this human review.');
  const identity = await new AmbiguousWorkProvider({ apiKey: config.AMBIGUOUS_API_KEY, expectedUserId: config.AMBIGUOUS_EXPECTED_USER_ID, expectedWorkspaceId: config.AMBIGUOUS_EXPECTED_WORKSPACE_ID }).identity();
  if (!identity.verified) throw new Error('Native identity could not be verified.');
  const channel = await native(`/api/channels/${channelId}`);
  const members = Array.isArray(channel.members) ? channel.members.map(member => (member as { user_id?: unknown }).user_id) : [];
  const allowed = [execution.human.id, execution.agent.id].sort();
  if (channel.id !== channelId || !['private', 'dm'].includes(String(channel.type)) || channel.archived_at !== null || channel.member_count !== members.length || members.length !== 2 || JSON.stringify([...new Set(members)].sort()) !== JSON.stringify(allowed)) throw new Error('The channel does not have the exact complete private human-and-agent roster.');
  const listed = await native(`/api/channels/${channelId}/messages?limit=20`);
  const rows = Array.isArray(listed.data) ? listed.data : Array.isArray(listed.messages) ? listed.messages : null;
  if (!rows || listed.has_more === true) throw new Error('The bounded channel snapshot is unrecognized or incomplete; no feedback was imported.');
  const matches = rows.filter(raw => {
    const item = raw as Record<string, unknown>;
    const author = item.author && typeof item.author === 'object' ? (item.author as { id?: unknown }).id : undefined;
    const authors = [item.author_id, item.user_id, item.sender_id, author].filter(value => value !== undefined && value !== null);
    return typeof item.id === 'string' && /^[0-9a-f-]{36}$/i.test(item.id) && (item.channel_id === undefined || item.channel_id === channelId) && authors.length > 0 && authors.every(value => value === execution.human.id) && typeof item.content === 'string' && item.content.startsWith(prefix);
  }) as Array<{ id: string; content: string }>;
  if (matches.length !== 1) throw new Error(`Expected exactly one new review from the configured human; found ${matches.length}. No feedback was imported.`);
  const review = matches[0]!;
  const sourceUrl = `${nativeBase}/api/channels/${channelId}`;
  const feedback = `${review.content}\n\nSource: Ambiguous chat message ${review.id}\nChannel: ${sourceUrl}\nImported unchanged by the explicit demo chat handoff.`;
  if (feedback.length > 20000) throw new Error('The review exceeds the local task feedback limit.');
  const entry: Entry = { messageId: review.id, channelId, missionId, taskId, feedbackHash: createHash('sha256').update(feedback).digest('hex'), feedback, state: 'pending', recordedAt: new Date().toISOString() };
  await save(entry);
  await local(`/api/missions/${missionId}/execution/tasks/${taskId}/review`, { feedback });
  const accepted = (await local<{ execution: MissionExecution }>(`/api/missions/${missionId}/execution`)).execution;
  if (accepted.tasks.find(task => task.id === taskId)?.reviewFeedback !== feedback) throw new Error('The local review response was not confirmed; the pending ledger prevents duplicate submission.');
  await save({ ...entry, state: 'accepted' });
  console.log(JSON.stringify({ status: 'accepted', missionId, taskId, sourceMessageId: review.id, channelId, characters: review.content.length, missionStatus: accepted.status }));
}
main().catch(error => { console.error(safe(error)); process.exitCode = 1; });
