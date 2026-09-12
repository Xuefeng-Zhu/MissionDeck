export interface ContentBlock { kind:'heading'|'paragraph'|'list-item'|'link'|'table'|'status'; text:string; level?:number; href?:string; rows?:string[][]; headers?:Array<{row:number;column:number;scope:'row'|'col'}>; }
export interface PageExtraction {text:string;title:string;sourceUrl:string;truncated:boolean;method:'selection'|'page';blocks:ContentBlock[];completeness:'partial'|'readable'}
export const CAPTURE_LIMIT = 20_000;
export const INBOX_TTL = 10 * 60 * 1000;
export interface PendingCapture {
  blocks?: ContentBlock[]; completeness?: 'partial'|'readable'; snapshotId?: string; documentId?: string; navigationEpoch?: number; permissionEpoch?: number;
  text: string; sourceUrl: string; title: string; capturedAt: string;
  method: 'selection'|'page'|'manual'; truncated: boolean; intent?: 'evidence'|'task'|'impact'; expiresAt: number; contentHash?:string;
}
export async function captureTextHash(text:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export function safeSourceUrl(value: string): string {
  if (!value.trim()) return '';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS source URL, or leave it blank for a personal note.');
  url.username = ''; url.password = ''; url.hash = '';
  // Query strings routinely contain email addresses and access tokens. Retain none by default.
  url.search = '';
  return url.toString();
}
export function validatePending(value: unknown): PendingCapture | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Partial<PendingCapture>;
  if (typeof c.text !== 'string' || c.text.length > CAPTURE_LIMIT || typeof c.expiresAt !== 'number' || c.expiresAt <= Date.now()
    || typeof c.sourceUrl !== 'string' || typeof c.title !== 'string' || c.title.length > 500 || typeof c.capturedAt !== 'string' || !Number.isFinite(Date.parse(c.capturedAt)) || typeof c.truncated !== 'boolean'
    || !['selection','page','manual'].includes(c.method || '') || (c.contentHash!==undefined&&!/^[a-f0-9]{64}$/.test(c.contentHash))) return null;
  try { return {...c, sourceUrl: safeSourceUrl(c.sourceUrl)} as PendingCapture; } catch { return null; }
}

/** Serialized by Chrome; must remain self-contained. Never read controls or editable drafts. */
export function readRequestedPage(): PageExtraction {
  const limit = 20_000;
  const cleanUrl=(raw:string)=>{try{const u=new URL(raw,location.href);if(!['http:','https:'].includes(u.protocol))return '';u.username='';u.password='';u.search='';u.hash='';return u.toString();}catch{return '';}};
  const mask=(value:string)=>value.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,'Bearer [REDACTED]').replace(/\b(password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)\s*[:=]\s*["']?[^\s"',;]+["']?/gi,'$1=[REDACTED]').replace(/\b(?:sk-(?:proj-)?[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g,'[REDACTED SECRET]');
  const selection = window.getSelection();
  const privateSelector = 'form,input,textarea,select,output,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[data-private],[autocomplete="one-time-code"]';
  if (selection && selection.toString().trim()) {
    const anchor = selection.anchorNode?.parentElement;
    const focus = selection.focusNode?.parentElement;
    if (anchor?.closest(privateSelector) || focus?.closest(privateSelector)) throw new Error('Editable drafts cannot be captured. Paste only the text you choose into a manual note.');
    for (const privateNode of document.querySelectorAll(privateSelector+',script,style,svg,canvas,iframe,object,embed,[hidden],[aria-hidden="true"]')) {
      for (let i=0;i<selection.rangeCount;i++) {
        if (selection.getRangeAt(i).intersectsNode(privateNode)) throw new Error('This selection crosses private or hidden content. Select a smaller excerpt or add a manual note.');
      }
    }
    for(const el of document.querySelectorAll('*')) { const style=getComputedStyle(el); if(style.display==='none'||style.visibility==='hidden'||style.opacity==='0') for(let i=0;i<selection.rangeCount;i++) if(selection.getRangeAt(i).intersectsNode(el)) throw new Error('This selection crosses private or hidden content.'); }
    const text = mask(selection.toString().trim());
    return {text:text.slice(0,limit),title:mask(document.title).slice(0,500),sourceUrl:cleanUrl(location.href),truncated:text.length>limit,method:'selection',blocks:[{kind:'paragraph',text:text.slice(0,limit)}],completeness:'readable'};
  }
  const root = document.querySelector('main,[role="main"],article') || document.body;
  const excluded = `${privateSelector},script,style,noscript,template,nav,header,footer,aside,svg,canvas,[hidden],[aria-hidden="true"]`;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode(node) {
    const element = node.parentElement;
    if (!element || element.closest(excluded)) return NodeFilter.FILTER_REJECT;
    for (let current:Element|null = element; current; current=current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return NodeFilter.FILTER_REJECT;
    }
    return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
  }});
  const pieces:string[] = []; const blocks:ContentBlock[]=[]; const groups=new Map<Element,ContentBlock>(); let length=0; let cutNode=false; let node:Node|null;
  while ((node=walker.nextNode()) && length <= limit) { const raw=node.textContent?.trim()||'';cutNode ||= raw.length>limit+1;const value=mask(raw.slice(0,limit+1)); pieces.push(value); length += value.length+1;
    const el=node.parentElement!; const group=el.closest('h1,h2,h3,h4,h5,h6,li,a,table,[role="table"],[role="status"],[role="alert"],p')||el;
    let block=groups.get(group); if(!block){const tag=group.tagName.toLowerCase();const kind:ContentBlock['kind']=/^h[1-6]$/.test(tag)?'heading':tag==='li'?'list-item':tag==='a'?'link':tag==='table'||group.getAttribute('role')==='table'?'table':['status','alert'].includes(group.getAttribute('role')||'')?'status':'paragraph';block={kind,text:''};if(kind==='heading')block.level=Number(tag[1]);if(kind==='link')block.href=cleanUrl(group.getAttribute('href')||'');groups.set(group,block);blocks.push(block);}block.text+=(block.text?'\n':'')+value.slice(0,Math.max(0,limit-(length-value.length-1)));
    if(block.kind==='table'){const row=el.closest('tr,[role="row"]');const cell=el.closest('td,th,[role="cell"],[role="columnheader"],[role="rowheader"]');if(row&&cell){block.rows ||= [];const rows=Array.from(group.querySelectorAll('tr,[role="row"]'));const ri=rows.indexOf(row);const cells=Array.from(row.querySelectorAll('td,th,[role="cell"],[role="columnheader"],[role="rowheader"]'));const ci=cells.indexOf(cell);if(ri>=0&&ri<200&&ci>=0&&ci<50){while(block.rows.length<=ri)block.rows.push([]);while(block.rows[ri]!.length<=ci)block.rows[ri]!.push('');if(cell.tagName.toLowerCase()==='th'||['columnheader','rowheader'].includes(cell.getAttribute('role')||'')){block.headers ||= [];if(!block.headers.some(h=>h.row===ri&&h.column===ci))block.headers.push({row:ri,column:ci,scope:cell.getAttribute('scope')==='row'||cell.getAttribute('role')==='rowheader'?'row':'col'});}block.rows[ri]![ci]=(block.rows[ri]![ci]||'')+value.slice(0,Math.max(0,limit-(length-value.length-1)));}}} }
  const text=pieces.join('\n');
  if (!text.trim()) throw new Error('No readable main text was found. This page may use a PDF viewer, canvas, or inaccessible frame. Add text manually.');
  return {text:text.slice(0,limit),title:mask(document.title).slice(0,500),sourceUrl:cleanUrl(location.href),truncated:cutNode||text.length>limit,method:'page',blocks,completeness:document.querySelector('iframe,canvas,embed,object,td[rowspan]:not([rowspan="1"]),th[rowspan]:not([rowspan="1"]),td[colspan]:not([colspan="1"]),th[colspan]:not([colspan="1"])')||document.readyState!=='complete'?'partial':'readable'};
}
