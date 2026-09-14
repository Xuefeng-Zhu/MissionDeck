import { adaptiveSourcesSchema, redactSensitiveText, sanitizeSourceUrl, type AdaptiveSource, type AdaptiveSourceInput, type AdaptiveState, type Mission, type SourceCitation } from '@mission/domain';
import { fingerprint } from './providers/types.js';
import { HttpError } from './errors.js';

/** Accepted browser excerpts must belong to this mission. URLs never authorize reads. */
export function prepareAdaptiveSources(raw: unknown, mission?: Mission): AdaptiveSource[] {
  return adaptiveSourcesSchema.parse(raw).map(source => {
    if (redactSensitiveText(source.title) !== source.title || redactSensitiveText(source.content) !== source.content)
      throw new HttpError(422, 'A source contains sensitive material. Remove it in the source editor before sharing.');
    if (source.sourceUrl && sanitizeSourceUrl(source.sourceUrl) !== source.sourceUrl)
      throw new HttpError(422, 'Remove credentials, private query parameters, or fragments from the source URL.');
    if (source.provenance === 'browser') {
      const accepted = mission?.evidence.find(e => e.id === source.evidenceId);
      if (!accepted || accepted.excerpt !== source.content || accepted.title !== source.title || accepted.sourceUrl !== (source.sourceUrl ?? null) || accepted.capturedAt !== source.capturedAt)
        throw new HttpError(422, 'Choose an already accepted browser excerpt from this mission. Edited excerpts must be pasted sources.');
    } else if (source.evidenceId) throw new HttpError(422, 'Only accepted browser excerpts may reference evidence.');
    return { ...source, fingerprint: fingerprint(source) };
  });
}

export function initialAdaptiveState(sources: AdaptiveSource[], at: string): AdaptiveState {
  return {revision:1,sourceRevision:1,sourceHistory:[{revision:1,sources,createdAt:at,changeSummary:'Initial reviewed sources.'}],budget:{modelCalls:0,toolCalls:0,maxModelCalls:40,maxToolCalls:60}};
}
export function currentSources(adaptive: AdaptiveState): AdaptiveSource[] {
  const revision = adaptive.sourceHistory.find(r=>r.revision===adaptive.sourceRevision);
  if (!revision) throw new HttpError(409,'The current source revision is unavailable.');
  return revision.sources;
}
export function sourceChanges(before:AdaptiveSource[],after:AdaptiveSource[]):string {
  const changes = after.filter(s=>!before.some(old=>old.id===s.id&&old.fingerprint===s.fingerprint)).map(s=>`${before.some(old=>old.id===s.id)?'Updated':'Added'}: ${s.title}`);
  changes.push(...before.filter(s=>!after.some(next=>next.id===s.id)).map(s=>`Removed: ${s.title}`));
  return changes.join('; ') || 'No source changes.';
}
export function validateAdaptiveCitations(citations:SourceCitation[],sources:AdaptiveSource[],revision:number) {
  for (const citation of citations) {
    const source = sources.find(s=>s.id===citation.sourceId);
    if (!source || citation.sourceRevision!==revision || !citation.excerpt.trim() || !source.content.includes(citation.excerpt))
      throw new HttpError(422,'The result contains a citation that does not match a retrieved source revision.','invalid_citation');
  }
}
export function sourceDocument(source:AdaptiveSource,revision:number):string {
  return `# ${source.title}\n\nSource ID: ${source.id}\nSource revision: ${revision}\nProvenance: ${source.provenance}\n${source.sourceUrl?`URL: ${source.sourceUrl}\n`:''}${source.capturedAt?`Captured: ${source.capturedAt}\n`:''}Fingerprint: ${source.fingerprint}\n\n${source.content}`;
}
