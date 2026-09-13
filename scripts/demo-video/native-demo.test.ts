import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { requirementBody, slidePayload, validateManifest } from './native-demo.js';

const manifest = () => JSON.parse(readFileSync(new URL('./example-manifest.json', import.meta.url), 'utf8'));
describe('dedicated native demo payloads', () => {
  it('creates visible editable slide elements with a separate element per bullet', () => {
    const m = validateManifest(manifest()); const p = slidePayload(m, 1);
    expect(p.layout).toEqual({ width: 960, height: 540 });
    expect(p.elements.filter(e => e.type === 'text').map(e => e.text)).toContain(m.deck.slides[1]!.title);
    for (const line of m.deck.slides[1]!.lines) expect(p.elements.some(e => e.type === 'text' && e.text === `•  ${line}`)).toBe(true);
    expect(new Set(p.elements.map(e => e.id)).size).toBe(p.elements.length);
    expect(p.elements.every(e => e.x >= 0 && e.y >= 0 && e.x + e.w <= 960 && e.y + e.h <= 540)).toBe(true);
  });
  it('keeps requirements text as native document nodes rather than HTML', () => {
    const m = validateManifest(manifest()); const doc = JSON.parse(requirementBody(m));
    expect(doc.type).toBe('doc'); expect(doc.content.filter((n: any) => n.type === 'heading')).toHaveLength(m.requirements.sections.length);
  });
  it('rejects non-demo channels, mentions, outsiders, and mislabeled automation messages', () => {
    for (const change of [
      (m: any) => { m.channel.name = 'general'; },
      (m: any) => { m.messages[0].content = 'Hello @everyone'; },
      (m: any) => { m.agentNames = ['Another person']; },
      (m: any) => { m.messages[0].speaker = 'MissionDeck'; },
    ]) { const m = manifest(); change(m); expect(() => validateManifest(m)).toThrow(); }
  });
});
