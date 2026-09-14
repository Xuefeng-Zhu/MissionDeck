import {describe,expect,it} from 'vitest';
import type {LaunchPack} from '@mission/domain';
import {launchPackMarkdown} from './LaunchExperience';

describe('launch pack export',()=>{
  it('retains source identity, revision, and exact cited excerpts',()=>{
    const pack:LaunchPack={brief:'Run a private beta.',checklist:['Confirm twenty participants.'],announcementDraft:'Harbor private beta opens Friday.',unresolvedRisks:['Calendar integration remains unavailable.'],changeSummary:'The owner constrained the launch scope.',citations:[{sourceId:'engineering',sourceRevision:2,excerpt:'Calendar integration needs two more weeks.'}]};
    const markdown=launchPackMarkdown(pack,[{id:'engineering',title:'Engineering status'}]);
    expect(markdown).toContain('## Source evidence');
    expect(markdown).toContain('Source: Engineering status');
    expect(markdown).toContain('Source ID: `engineering`');
    expect(markdown).toContain('Source revision: 2');
    expect(markdown).toContain('> Calendar integration needs two more weeks.');
  });
});
