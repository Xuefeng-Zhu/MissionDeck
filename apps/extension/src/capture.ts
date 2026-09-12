export const CAPTURE_LIMIT = 20_000;
export const INBOX_TTL = 10 * 60 * 1000;
export interface PendingCapture {
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
export function readRequestedPage(): {text:string;title:string;sourceUrl:string;truncated:boolean;method:'selection'|'page'} {
  const limit = 20_000;
  const selection = window.getSelection();
  const privateSelector = 'form,input,textarea,select,output,[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
  if (selection && selection.toString().trim()) {
    const anchor = selection.anchorNode?.parentElement;
    const focus = selection.focusNode?.parentElement;
    if (anchor?.closest(privateSelector) || focus?.closest(privateSelector)) throw new Error('Editable drafts cannot be captured. Paste only the text you choose into a manual note.');
    for (const privateNode of document.querySelectorAll(privateSelector+',script,style,[hidden],[aria-hidden="true"]')) {
      for (let i=0;i<selection.rangeCount;i++) {
        if (selection.getRangeAt(i).intersectsNode(privateNode)) throw new Error('This selection crosses private or hidden content. Select a smaller excerpt or add a manual note.');
      }
    }
    const text = selection.toString().trim();
    return {text:text.slice(0,limit),title:document.title.slice(0,500),sourceUrl:location.href,truncated:text.length>limit,method:'selection'};
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
  const pieces:string[] = []; let length=0; let node:Node|null;
  while ((node=walker.nextNode()) && length <= limit) { const value=node.textContent?.trim() || ''; pieces.push(value); length += value.length+1; }
  const text=pieces.join('\n');
  if (!text.trim()) throw new Error('No readable main text was found. This page may use a PDF viewer, canvas, or inaccessible frame. Add text manually.');
  return {text:text.slice(0,limit),title:document.title.slice(0,500),sourceUrl:location.href,truncated:text.length>limit,method:'page'};
}
