import {CAPTURE_LIMIT, type PendingCapture} from './capture';
export const REQUEST_LIMIT=50_000;
export interface ContextSnapshot extends PendingCapture {snapshotId:string;sessionId:string;missionId:string;tabId:number;windowId:number;documentId:string;navigationEpoch:number;permissionEpoch:number;}
/** Memory-only: worker restart always requires renewed consent. Browser IDs never leave this boundary. */
export class ContextSessionManager {
  sessionId=crypto.randomUUID();
  missionId=''; expiresAt=0; paused=true; permissionEpoch=0;
  selected=new Set<number>(); sites=new Set<string>(); snapshots=new Map<number,ContextSnapshot>(); epochs=new Map<number,number>();
  start(missionId:string,tabIds:number[],sites:string[],now=Date.now()) {if(!missionId||tabIds.length>5||new Set(tabIds).size!==tabIds.length)throw new Error('Select up to five distinct tabs and an active mission.');this.pause();this.sessionId=crypto.randomUUID();this.missionId=missionId;this.selected=new Set(tabIds);this.sites=new Set(sites);this.expiresAt=now+10*60_000;this.paused=false;}
  pause(){this.paused=true;this.permissionEpoch++;this.snapshots.clear();}
  navigate(tabId:number){this.epochs.set(tabId,(this.epochs.get(tabId)||0)+1);this.snapshots.delete(tabId);}
  allowed(tabId:number,url:string,foreground:boolean,now=Date.now()){if(now>=this.expiresAt)this.pause();return !this.paused&&this.sites.has(new URL(url).origin)&&(foreground||this.selected.has(tabId));}
  accept(snapshot:ContextSnapshot,foreground:boolean,now=Date.now()){if(snapshot.sessionId!==this.sessionId||snapshot.missionId!==this.missionId||snapshot.permissionEpoch!==this.permissionEpoch||snapshot.navigationEpoch!==(this.epochs.get(snapshot.tabId)||0)||!this.allowed(snapshot.tabId,snapshot.sourceUrl,foreground,now))return false;if(foreground&&!this.selected.has(snapshot.tabId)){if(this.selected.size>=5)return false;for(const id of this.snapshots.keys())if(!this.selected.has(id)&&id!==snapshot.tabId)this.snapshots.delete(id);}if(this.snapshots.get(snapshot.tabId)?.contentHash===snapshot.contentHash)return false;this.snapshots.set(snapshot.tabId,snapshot);return true;}
  freeze(requestId:string,now=Date.now()){if(this.paused||now>=this.expiresAt)throw new Error('Context paused or expired.');let remaining=REQUEST_LIMIT;return {requestId,sessionId:this.sessionId,missionId:this.missionId,sources:[...this.snapshots.values()].filter(s=>s.expiresAt>now).map(s=>{const contextualText=s.blocks?.some(b=>b.kind==='table')?s.blocks.map(b=>b.kind==='table'?'Table (literal cell values; empty cells unknown): '+JSON.stringify({rows:b.rows,headers:b.headers}):b.text).join('\n'):s.text;const text=contextualText.slice(0,Math.min(CAPTURE_LIMIT,remaining));remaining-=text.length;return {snapshotId:s.snapshotId,sourceUrl:s.sourceUrl,title:s.title,capturedAt:s.capturedAt,text,contentHash:contextualText===s.text?s.contentHash:undefined,truncated:s.truncated||text.length<contextualText.length};}).filter(s=>s.text)};}
}

export type FrozenContext = ReturnType<ContextSessionManager['freeze']>;
