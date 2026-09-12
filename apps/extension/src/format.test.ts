import {describe,expect,it} from 'vitest';
import {formatTimestampsInText,localInput,zonedInputToIso} from './format';
describe('exact deadlines in the displayed timezone',()=>{
  it('formats and resolves a mission zone independently of the host timezone',()=>{
    expect(localInput('2026-09-13T22:00:00.000Z','America/Los_Angeles')).toBe('2026-09-13T15:00');
    expect(zonedInputToIso('2026-09-13T15:00','America/Los_Angeles')).toBe('2026-09-13T22:00:00.000Z');
  });
  it('handles fractional timezone offsets',()=>expect(zonedInputToIso('2026-09-13T15:00','Asia/Kathmandu')).toBe('2026-09-13T09:15:00.000Z'));
  it('renders schedule timestamps in the mission zone while preserving the impact explanation',()=>expect(formatTimestampsInText('Proposed deadline: 2026-09-13T22:00:00.000Z. ETA remains unknown.','America/Los_Angeles')).toBe('Proposed deadline: Sep 13, 2026, 3:00 PM PDT. ETA remains unknown.'));
  it('rejects nonexistent spring-forward wall times',()=>expect(()=>zonedInputToIso('2026-03-08T02:30','America/Los_Angeles')).toThrow('does not exist'));
  it('rejects invalid calendar dates',()=>expect(()=>zonedInputToIso('2026-02-30T15:00','America/Los_Angeles')).toThrow());
});
