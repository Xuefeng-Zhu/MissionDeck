// @vitest-environment jsdom
import {beforeEach,describe,expect,it} from 'vitest';
import {CAPTURE_LIMIT,readRequestedPage,safeSourceUrl,validatePending} from './capture';

describe('user-requested capture boundary',()=>{
  beforeEach(()=>{document.body.innerHTML='';window.getSelection()?.removeAllRanges();});
  it('removes all query parameters, credentials and fragments',()=>{
    expect(safeSourceUrl('https://user:password@example.com/requirements?token=secret&email=person@example.com#draft')).toBe('https://example.com/requirements');
    expect(()=>safeSourceUrl('javascript:alert(1)')).toThrow();
  });
  it('captures readable main text and excludes form values, editable drafts and hidden content',()=>{
    document.body.innerHTML='<nav>Unrelated navigation</nav><main><h1>Requirements</h1><p>A two-minute demo video is required.</p><input value="private password"><textarea>private draft</textarea><div contenteditable="true">private editor</div><span hidden>secret hidden field</span><div style="display:none">CSS hidden secret</div><script>private script</script><form><output>private computed result</output></form></main>';
    expect(readRequestedPage().text).toBe('Requirements\nA two-minute demo video is required.');
  });
  it('rejects selections crossing private editors even when endpoints are ordinary text',()=>{
    document.body.innerHTML='<main><p id="start">Public before</p><div contenteditable="true">Private draft</div><p id="end">Public after</p></main>';
    const range=document.createRange();range.setStart(document.querySelector('#start')!.firstChild!,0);range.setEnd(document.querySelector('#end')!.firstChild!,5);window.getSelection()!.addRange(range);
    expect(()=>readRequestedPage()).toThrow('private or hidden');
  });
  it('captures only the selected excerpt',()=>{
    document.body.innerHTML='<main><p>Read this exact excerpt, not the whole page.</p></main>';
    const range=document.createRange();range.setStart(document.querySelector('p')!.firstChild!,5);range.setEnd(document.querySelector('p')!.firstChild!,23);window.getSelection()!.addRange(range);
    const result=readRequestedPage();expect(result.text).toBe('this exact excerpt');expect(result.method).toBe('selection');
  });
  it('limits content and marks truncation',()=>{document.body.innerHTML=`<main>${'a'.repeat(CAPTURE_LIMIT+100)}</main>`;const capture=readRequestedPage();expect(capture.text).toHaveLength(CAPTURE_LIMIT);expect(capture.truncated).toBe(true);});
  it('expires the pending inbox and rejects oversized or malformed messages',()=>{
    const capture={text:'excerpt',sourceUrl:'https://example.com/?token=secret',title:'Source',capturedAt:new Date().toISOString(),method:'page',expiresAt:Date.now()+60_000,truncated:false};
    expect(validatePending(capture)?.sourceUrl).toBe('https://example.com/');expect(validatePending({...capture,expiresAt:0})).toBeNull();expect(validatePending({...capture,text:'x'.repeat(CAPTURE_LIMIT+1)})).toBeNull();expect(validatePending({...capture,method:'history'})).toBeNull();
  });
});

describe('structured bounded extraction',()=>{
 beforeEach(()=>{document.body.innerHTML='';window.getSelection()?.removeAllRanges();});
 it('preserves table row/header relationships and literal formula-like text',()=>{document.body.innerHTML='<main><h2>Review</h2><table><tr><th>Requirement</th><th>Status</th></tr><tr><td>=IMPORTXML("untrusted")</td><td>Unknown</td></tr></table><ul><li>First</li></ul><a href="https://example.com/path?token=secret">Source</a><div role="alert">Build failed</div></main>';const s=readRequestedPage();expect(s.blocks.find(b=>b.kind==='table')?.rows).toEqual([['Requirement','Status'],['=IMPORTXML("untrusted")','Unknown']]);expect(s.blocks.find(b=>b.kind==='heading')?.level).toBe(2);expect(s.blocks.find(b=>b.kind==='link')?.href).toBe('https://example.com/path');expect(s.blocks.find(b=>b.kind==='status')?.text).toBe('Build failed');});
 it('does not include hidden table cell values or private-marked content',()=>{document.body.innerHTML='<main><p>Visible</p><table><tr><td>Public</td><td hidden>SECRET</td></tr></table><div data-private>PRIVATE</div><iframe>FRAME</iframe></main>';const s=readRequestedPage();expect(JSON.stringify(s)).not.toContain('SECRET');expect(JSON.stringify(s)).not.toContain('PRIVATE');expect(s.completeness).toBe('partial');});
 it('rejects CSS-hidden content intersecting a selection',()=>{document.body.innerHTML='<p id="a">Before</p><span style="visibility:hidden">secret</span><p id="b">After</p>';const range=document.createRange();range.setStart(document.querySelector('#a')!.firstChild!,0);range.setEnd(document.querySelector('#b')!.firstChild!,5);window.getSelection()!.addRange(range);expect(()=>readRequestedPage()).toThrow('private or hidden');});
});
it('keeps missing private cells as empty positions and masks obvious visible credentials',()=>{document.body.innerHTML='<main><table><tr><td hidden>secret</td><td>Public</td></tr></table><p>api_key=do-not-share</p></main>';window.getSelection()?.removeAllRanges();const s=readRequestedPage();expect(s.blocks.find(b=>b.kind==='table')?.rows).toEqual([['','Public']]);expect(s.text).not.toContain('do-not-share');});
it('retains table header roles and flags merged table structure as partial',()=>{document.body.innerHTML='<main><table><tr><th scope="row">Row</th><td colspan="2">Two columns</td></tr></table></main>';window.getSelection()?.removeAllRanges();const s=readRequestedPage();expect(s.blocks.find(b=>b.kind==='table')?.headers).toEqual([{row:0,column:0,scope:'row'}]);expect(s.completeness).toBe('partial');});
it('excludes SVG content in both page and selection extraction',()=>{document.body.innerHTML='<main><p>Public</p><svg><text>Embedded SVG</text></svg></main>';window.getSelection()?.removeAllRanges();expect(readRequestedPage().text).toBe('Public');const range=document.createRange();range.selectNodeContents(document.querySelector('svg text')!);window.getSelection()!.addRange(range);expect(()=>readRequestedPage()).toThrow('private or hidden');});
