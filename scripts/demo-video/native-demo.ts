import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { config } from '../../apps/server/src/config.js';

/** Dedicated demo creation only. No existing artifact edits, external recipients or agent impersonation. */
export interface NativeDemoManifest {
  demoId: string;
  label: string;
  agentNames: Array<'Codex' | 'Hermes'>;
  requirements: { title: string; sections: Array<{ heading: string; paragraphs: string[] }> };
  deck: { title: string; slides: Array<{ eyebrow: string; title: string; subtitle?: string; lines: string[]; footer?: string }> };
  channel: { name: string; description: string };
  messages: Array<{ speaker: 'Human' | 'Codex' | 'Hermes' | 'MissionDeck'; content: string }>;
}
type Step = { inputHash: string; state: 'running' | 'done' | 'outcome_unknown'; acceptedId?: string; result?: any };
type DemoState = { demoId: string; manifestHash: string; scopeHash?: string; steps: Record<string, Step> };
const origin = 'https://app.ambiguous.ai';
const nativeId = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('Native response did not contain a valid UUID. Inspect before retrying.');
  return value;
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
export function validateManifest(raw: unknown): NativeDemoManifest {
  const m = raw as NativeDemoManifest;
  if (!m || !/^[a-z0-9][a-z0-9-]{3,60}$/.test(m.demoId) || !text(m.label, 100)
    || !Array.isArray(m.agentNames) || !m.agentNames.length || m.agentNames.some(n => !['Codex', 'Hermes'].includes(n)) || new Set(m.agentNames).size !== m.agentNames.length
    || !text(m.requirements?.title, 200) || !Array.isArray(m.requirements.sections) || !m.requirements.sections.length || m.requirements.sections.length > 15
    || m.requirements.sections.some(s => !text(s.heading, 200) || !Array.isArray(s.paragraphs) || s.paragraphs.length > 15 || s.paragraphs.some(p => !text(p, 2000)))
    || !text(m.deck?.title, 200) || !Array.isArray(m.deck.slides) || m.deck.slides.length < 2 || m.deck.slides.length > 8
    || m.deck.slides.some(s => !text(s.title, 90) || !text(s.eyebrow, 100) || (s.subtitle !== undefined && !text(s.subtitle, 100)) || !Array.isArray(s.lines) || s.lines.length > 3 || s.lines.some(l => !text(l, 140)))
    || !text(m.channel?.name, 100) || !/^[a-z0-9-]+$/.test(m.channel.name) || !/(?:^|-)demo(?:-|$)/.test(m.channel.name) || !text(m.channel.description, 1000)
    || !Array.isArray(m.messages) || m.messages.length > 12 || m.messages.some(p => !['Human', 'MissionDeck', ...m.agentNames].includes(p.speaker) || !text(p.content, 5000) || /@/.test(p.content)
      || (p.speaker === 'MissionDeck' && !p.content.startsWith('MissionDeck agent update (server drafting worker):') && !p.content.startsWith('MissionDeck demo integration:')))) {
    throw new Error('Invalid bounded demo manifest. Use a demo-prefixed channel, 2–8 slides, selected Codex/Hermes agents, and no mentions.');
  }
  if (JSON.stringify(m).length > 60_000) throw new Error('Demo content exceeds the supported size.');
  return m;
}

export function requirementBody(m: NativeDemoManifest): string {
  const paragraph = (value: string) => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
  return JSON.stringify({ type: 'doc', content: [
    paragraph(`${m.label} · Demo artifacts created by MissionDeck. Human decisions and agent-authored material share this workspace.`),
    ...m.requirements.sections.flatMap(section => [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: section.heading }] },
      ...section.paragraphs.map(paragraph),
    ]),
  ] });
}
export function slidePayload(m: NativeDemoManifest, index: number) {
  const slide = m.deck.slides[index]!;
  const el = (key: string, value: string, x: number, y: number, w: number, h: number, fontSize: number, color: string, bold = false) => ({
    id: `${m.demoId}-${index}-${key}`, type: 'text' as const, text: value, x, y, w, h,
    fontSize, fontWeight: bold ? 'bold' : 'normal', fontFamily: 'Inter', color, colorUserSet: true,
    align: 'left', verticalAlign: 'top',
  });
  return {
    id: `${m.demoId}-slide-${index}`, layout: { width: 960, height: 540 }, background: '#101522',
    elements: [
      { id: `${m.demoId}-${index}-accent`, type: 'shape' as const, shape: 'rect', x: 54, y: 56, w: 7, h: 50, fill: '#C5F277', fillUserSet: true, strokeWidth: 0 },
      el('eyebrow', slide.eyebrow.toUpperCase(), 78, 56, 810, 28, 15, '#C5F277', true),
      el('title', slide.title, 54, 118, 840, 120, slide.title.length > 50 ? 38 : 46, '#F7F8FA', true),
      ...(slide.subtitle ? [el('subtitle', slide.subtitle, 56, 231, 850, 48, 32, '#C5F277')] : []),
      ...slide.lines.map((line, i) => el(`line-${i}`, `•  ${line}`, 58, (slide.subtitle ? 306 : 276) + i * 64, 834, 58, 32, '#D9DFEA')),
      el('footer', slide.footer ?? `${m.label} · ${index + 1} / ${m.deck.slides.length}`, 56, 507, 850, 22, 12, '#97A4B9'),
    ], notes: `${m.label}. Native editable slide with one text element per visual block.`,
  };
}
function plainDoc(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const v = value as { type?: string; text?: string; content?: unknown[] };
  return v.type === 'text' ? v.text ?? '' : (v.content ?? []).map(plainDoc).join('\n');
}

export class NativeDemo {
  private state!: DemoState;
  private humanId = '';
  private audience: string[] = [];
  private readonly stateFile: string;
  constructor(private manifest: NativeDemoManifest, private execute: boolean) {
    this.stateFile = resolve('scripts/demo-video/state', `${manifest.demoId}.json`);
  }
  async initialize() {
    const manifestHash = hash(this.manifest);
    const scopeHash = hash({ demoId: this.manifest.demoId, label: this.manifest.label, agents: this.manifest.agentNames, channel: this.manifest.channel });
    try { this.state = JSON.parse(await readFile(this.stateFile, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.state = { demoId: this.manifest.demoId, manifestHash, scopeHash, steps: {} };
    }
    if (this.state.scopeHash ? this.state.scopeHash !== scopeHash : this.state.manifestHash !== manifestHash) throw new Error('This demo ID already belongs to another scope. Use a fresh demoId; existing demo work is preserved.');
    // Each executed step remains immutable. Unexecuted slide content and later chat cues may be prepared separately.
    this.state.scopeHash = scopeHash;
    const me = await this.request('/api/users/me');
    if (me.id !== config.AMBIGUOUS_EXPECTED_USER_ID || me.workspace_id !== config.AMBIGUOUS_EXPECTED_WORKSPACE_ID || me.type !== 'human') throw new Error('Expected human/workspace identity did not match.');
    this.humanId = nativeId(me.id);
    const roster = await this.request('/api/users?limit=100');
    if (!Array.isArray(roster.data) || roster.has_more || roster.total !== roster.data.length) throw new Error('Workspace roster is incomplete.');
    this.audience = [this.humanId, ...this.manifest.agentNames.map(name => {
      const matches = roster.data.filter((person: any) => person.type === 'agent' && person.display_name === name);
      if (matches.length !== 1) throw new Error(`The ${name} agent identity is missing or ambiguous.`);
      return nativeId(matches[0].id);
    })].sort();
    if (Object.keys(this.state.steps).length) await this.persist();
    return { humanId: this.humanId, agentNames: this.manifest.agentNames, participantCount: this.audience.length, stateFile: this.stateFile };
  }
  private async persist() {
    await mkdir(dirname(this.stateFile), { recursive: true });
    const temp = `${this.stateFile}.tmp`;
    await writeFile(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 }); await rename(temp, this.stateFile);
  }
  private async request(path: string, method = 'GET', body?: unknown): Promise<any> {
    const allowed = (['/api/users/me', '/api/users?limit=100'].includes(path) && method === 'GET')
      || (['/api/documents', '/api/slides', '/api/channels'].includes(path) && method === 'POST')
      || (/^\/api\/documents\/[0-9a-f-]{36}$/i.test(path) && method === 'GET')
      || (/^\/api\/documents\/[0-9a-f-]{36}\/permissions$/i.test(path) && ['GET', 'POST'].includes(method))
      || (/^\/api\/slides\/[0-9a-f-]{36}\/data$/i.test(path) && method === 'GET')
      || (/^\/api\/slides\/[0-9a-f-]{36}\/slides\/0$/i.test(path) && method === 'PATCH')
      || (/^\/api\/slides\/[0-9a-f-]{36}\/slides$/i.test(path) && method === 'POST')
      || (/^\/api\/channels\/[0-9a-f-]{36}$/i.test(path) && method === 'GET')
      || (/^\/api\/channels\/[0-9a-f-]{36}\/messages$/i.test(path) && method === 'POST')
      || (/^\/api\/channels\/[0-9a-f-]{36}\/messages\/[0-9a-f-]{36}$/i.test(path) && method === 'GET');
    if (!allowed) throw new Error('Unreviewed native route refused.');
    if (method !== 'GET' && !this.execute) throw new Error('Native writes require the explicit --execute flag and the root recording cue.');
    if (!config.AMBIGUOUS_API_KEY) throw new Error('The server human API credential is not configured.');
    let response: Response;
    try { response = await fetch(`${origin}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${config.AMBIGUOUS_API_KEY}`, 'API-Version': '1', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { throw new Error('Native request outcome was not confirmed. Inspect the journal; do not repeat a create.'); }
    if (!response.ok) throw new Error(`Native ${method} returned HTTP ${response.status}; response details are withheld to avoid credential or personal-data logging.`);
    try { return await response.json(); } catch { throw new Error('Native response was unreadable. Inspect the journal before retrying.'); }
  }
  private async step<T>(key: string, input: unknown, fn: (accepted: (id: string) => Promise<void>) => Promise<T>): Promise<T> {
    const old = this.state.steps[key]; const inputHash = hash(input);
    if (old) {
      if (old.inputHash !== inputHash) throw new Error(`Input for ${key} changed; preserve the existing demo and use a new demoId.`);
      if (old.state === 'done') return old.result as T;
      throw new Error(`${key} needs manual read-only reconciliation${old.acceptedId ? ` for native ID ${old.acceptedId}` : ''}; automatic write replay is refused.`);
    }
    if (!this.execute) throw new Error('This action requires --execute.');
    this.state.steps[key] = { inputHash, state: 'running' }; await this.persist();
    try {
      const result = await fn(async id => { this.state.steps[key]!.acceptedId = nativeId(id); await this.persist(); });
      this.state.steps[key] = { ...this.state.steps[key]!, state: 'done', result }; await this.persist(); return result;
    } catch (error) { this.state.steps[key]!.state = 'outcome_unknown'; await this.persist(); throw error; }
  }
  private nativeResult(step: string): { id: string; url: string } {
    const value = this.state.steps[step]; if (value?.state !== 'done') throw new Error(`Complete ${step} first.`); return value.result;
  }
  private async verifyPermissions(id: string) {
    const permissions = await this.request(`/api/documents/${nativeId(id)}/permissions`);
    if (!Array.isArray(permissions.data) || permissions.has_more !== false || permissions.total !== permissions.data.length || permissions.pending?.length || permissions.data.some((p: any) => p.type !== 'user' || !p.user_id)) throw new Error('Artifact audience is not a complete user-only roster.');
    const members = [...new Set<string>([this.humanId, ...permissions.data.map((p: any) => nativeId(p.user_id))])].sort();
    if (members.some(id => !this.audience.includes(id))) throw new Error('Artifact has an additional recipient. Existing sharing was preserved.');
    return members;
  }
  private async share(id: string, kind: string) {
    const existing = await this.verifyPermissions(id);
    for (const userId of this.audience) {
      if (existing.includes(userId)) continue;
      await this.step(`${kind}:share:${userId}`, { id, userId, role: 'editor' }, async () => {
        await this.request(`/api/documents/${id}/permissions`, 'POST', { user_id: userId, role: 'editor' });
        if (!(await this.verifyPermissions(id)).includes(userId)) throw new Error('Saved artifact permission did not read back.'); return { id, userId };
      });
    }
    if (JSON.stringify(await this.verifyPermissions(id)) !== JSON.stringify(this.audience)) throw new Error('Saved artifact audience is incomplete.');
  }
  async requirements() {
    const input = { type: 'doc', title: `${this.manifest.label} — ${this.manifest.requirements.title}`, visibility: 'restricted', content: requirementBody(this.manifest) };
    const doc = await this.step('requirements:create', input, async accepted => {
      const saved = await this.request('/api/documents', 'POST', input); const id = nativeId(saved.id); await accepted(id);
      const observed = await this.request(`/api/documents/${id}`);
      if (observed.id !== id || observed.type !== 'doc' || observed.visibility !== 'restricted' || observed.owner_id !== this.humanId || observed.title !== input.title || plainDoc(JSON.parse(observed.content)) !== plainDoc(JSON.parse(input.content))) throw new Error('Requirement document content/owner did not match read-back.');
      return { id, title: input.title, url: `${origin}/docs/${id}` };
    });
    await this.share(doc.id, 'requirements'); return doc;
  }
  async bindRequirements(id: string) {
    nativeId(id);
    const observed = await this.request(`/api/documents/${id}`);
    if (observed.id !== id || observed.type !== 'doc' || observed.owner_id !== this.humanId || observed.visibility !== 'restricted') throw new Error('Selected source is not a restricted requirements document owned by the configured human.');
    if (JSON.stringify(await this.verifyPermissions(id)) !== JSON.stringify(this.audience)) throw new Error('The requirements document audience must already match the demo participants. No permissions were changed.');
    const previous = this.state.steps['requirements:create'];
    if (previous && (previous.state !== 'done' || previous.result?.id !== id)) throw new Error('Another requirements record is already bound; it was preserved.');
    const result = { id, title: observed.title, url: `${origin}/docs/${id}`, source: 'existing mission runner document' };
    if (!previous) { this.state.steps['requirements:create'] = { inputHash: hash({ bindExisting: id }), state: 'done', acceptedId: id, result }; await this.persist(); }
    return result;
  }
  private async verifySlide(deckId: string, index: number, payload: ReturnType<typeof slidePayload>) {
    const observed = await this.request(`/api/slides/${nativeId(deckId)}/data`);
    if (observed.id !== deckId || observed.owner_id !== this.humanId || observed.visibility !== 'restricted') throw new Error('Deck identity/visibility changed.');
    const slide = observed.data?.slides?.[index];
    if (!slide || slide.background !== payload.background || !Array.isArray(slide.elements) || slide.elements.length !== payload.elements.length) throw new Error('Native slide does not match the requested visible content.');
    for (const element of payload.elements) {
      const item = slide.elements.find((e: any) => e.id === element.id);
      if (!item || Object.entries(element).some(([k, v]) => item[k] !== v)) throw new Error('Native slide element fields did not read back.');
    }
    return { id: deckId, slideIndex: index, textBlocks: payload.elements.filter(e => e.type === 'text').length };
  }
  async slides() {
    const input = { title: `${this.manifest.label} — ${this.manifest.deck.title}`, visibility: 'restricted' };
    const deck = await this.step('slides:create', input, async accepted => {
      const saved = await this.request('/api/slides', 'POST', input); const id = nativeId(saved.id); await accepted(id);
      const observed = await this.request(`/api/slides/${id}/data`);
      if (observed.id !== id || observed.owner_id !== this.humanId || observed.visibility !== 'restricted' || observed.data?.slides?.length !== 1) throw new Error('New restricted deck did not read back with one blank slide.');
      return { id, title: input.title, url: `${origin}/slides/${id}` };
    });
    for (let i = 0; i < this.manifest.deck.slides.length; i++) {
      const payload = slidePayload(this.manifest, i);
      await this.step(`slides:page:${i}`, { deckId: deck.id, payload }, async () => {
        if (i === 0) await this.request(`/api/slides/${deck.id}/slides/0`, 'PATCH', { background: payload.background, layout: payload.layout, elements: payload.elements, notes: payload.notes });
        else await this.request(`/api/slides/${deck.id}/slides`, 'POST', { slide: payload });
        return this.verifySlide(deck.id, i, payload);
      });
    }
    await this.share(deck.id, 'slides'); return { ...deck, slideCount: this.manifest.deck.slides.length };
  }
  private async verifyChannel(id: string) {
    const channel = await this.request(`/api/channels/${nativeId(id)}`);
    const ids = (channel.members ?? []).map((m: any) => nativeId(m.user_id)).sort();
    if (channel.id !== id || channel.name !== this.manifest.channel.name || channel.description !== this.manifest.channel.description || channel.type !== 'private' || channel.creator_id !== this.humanId || channel.archived_at || channel.member_count !== ids.length || JSON.stringify(ids) !== JSON.stringify(this.audience)) throw new Error('The dedicated channel identity, membership or visibility does not match this demo.');
    return channel;
  }
  async channel() {
    const input = { name: this.manifest.channel.name, description: this.manifest.channel.description, type: 'private', preset: 'conversation', member_ids: this.audience };
    return this.step('channel:create', input, async accepted => {
      const saved = await this.request('/api/channels', 'POST', input); const id = nativeId(saved.id ?? saved.channel?.id); await accepted(id);
      await this.verifyChannel(id); return { id, name: input.name, url: `${origin}/chat/${id}` };
    });
  }
  async message(index: number) {
    const entry = this.manifest.messages[index]; if (!entry) throw new Error('The requested message index is not in the manifest.');
    const channel = this.nativeResult('channel:create'); await this.verifyChannel(channel.id);
    const substitutions: Record<string, string> = {
      '{{documentUrl}}': this.state.steps['requirements:create']?.result?.url ?? '',
      '{{slidesUrl}}': this.state.steps['slides:create']?.result?.url ?? '',
      '{{channelUrl}}': channel.url,
    };
    let content = entry.content;
    for (const [key, value] of Object.entries(substitutions)) { if (content.includes(key) && !value) throw new Error('Create the linked native artifact before posting this message.'); content = content.replaceAll(key, value); }
    if (/\{\{/.test(content) || /@/.test(content)) throw new Error('Message has unresolved variables or mentions.');
    // Native author remains the real authenticated human; body attribution identifies the agent contribution.
    content = entry.speaker === 'MissionDeck' ? content : entry.speaker === 'Human' ? `**Human mission owner**\n\n${content}` : `**${entry.speaker} · agent contribution**\n*Posted by MissionDeck through the authorized human connection.*\n\n${content}`;
    return this.step(`message:${index}`, { channelId: channel.id, content }, async accepted => {
      const saved = await this.request(`/api/channels/${channel.id}/messages`, 'POST', { content, starts_new_block: true }); const id = nativeId(saved.id); await accepted(id);
      const observed = await this.request(`/api/channels/${channel.id}/messages/${id}`);
      if (observed.id !== id || observed.channel_id !== channel.id || observed.content !== content || observed.author?.id !== this.humanId || observed.author?.type !== 'human' || observed.thread_id !== null) throw new Error('Message content and genuine native author did not read back.');
      return { id, channelId: channel.id, nativeAuthor: 'human', contribution: entry.speaker, url: channel.url };
    });
  }
  status() { return { demoId: this.state.demoId, steps: Object.fromEntries(Object.entries(this.state.steps).map(([k, v]) => [k, { state: v.state, acceptedId: v.acceptedId, result: v.result }])) }; }
}

async function main() {
  const [command, filename, ...flags] = process.argv.slice(2);
  if (!command || !filename || !['preview', 'requirements', 'bind-requirements', 'slides', 'channel', 'message', 'status'].includes(command)) throw new Error('Usage: tsx scripts/demo-video/native-demo.ts <preview|requirements|bind-requirements|slides|channel|message|status> <manifest.json> [--execute] [--index=0] [--document-id=UUID]');
  const manifest = validateManifest(JSON.parse(await readFile(resolve(filename), 'utf8')));
  if (command === 'preview') {
    console.log(JSON.stringify({ demoId: manifest.demoId, label: manifest.label, agents: manifest.agentNames, requirements: manifest.requirements, slides: manifest.deck.slides, channel: manifest.channel, messages: manifest.messages, note: 'Preview only. No network or native writes. Native agent contribution messages retain the authenticated human author.' }, null, 2)); return;
  }
  const demo = new NativeDemo(manifest, flags.includes('--execute')); const identity = await demo.initialize();
  let result: unknown;
  if (command === 'status') result = demo.status();
  else if (command === 'bind-requirements') result = await demo.bindRequirements(flags.find(f => f.startsWith('--document-id='))?.slice(14) ?? '');
  else if (command === 'message') result = await demo.message(Number(flags.find(f => f.startsWith('--index='))?.slice(8) ?? '0'));
  else if (command === 'requirements') result = await demo.requirements();
  else if (command === 'slides') result = await demo.slides();
  else result = await demo.channel();
  console.log(JSON.stringify({ ...identity, result }, null, 2));
}
if (process.argv[1]?.endsWith('native-demo.ts')) main().catch(error => { console.error(error instanceof Error ? error.message : 'Demo operation failed.'); process.exitCode = 1; });
