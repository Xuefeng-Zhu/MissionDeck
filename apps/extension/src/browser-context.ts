import {z} from 'zod';
import {captureTextHash,INBOX_TTL,readRequestedPage,safeSourceUrl} from './capture';
import {ContextSessionManager,type ContextSnapshot} from './context-session';
const session=new ContextSessionManager();
const command=z.discriminatedUnion('type',[
 z.object({type:z.literal('CONTEXT_SCREENSHOT')}).strict(),
 z.object({type:z.literal('CONTEXT_START'),missionId:z.string().min(1).max(200),tabIds:z.array(z.number().int().nonnegative()).max(5),sites:z.array(z.string().url()).max(5)}).strict(),
 z.object({type:z.literal('CONTEXT_PAUSE')}).strict(),z.object({type:z.literal('CONTEXT_STATUS')}).strict(),
 z.object({type:z.literal('CONTEXT_REFRESH'),tabIds:z.array(z.number().int().nonnegative()).max(5)}).strict(),
 z.object({type:z.literal('CONTEXT_FREEZE'),requestId:z.string().min(1).max(200)}).strict()
]);
export async function captureAuthorizedTab(tabId:number){
 const before=await chrome.tabs.get(tabId);if(before.incognito||before.discarded||!before.url||!/^https?:/.test(before.url))throw new Error('Unavailable page. Use a manual excerpt; discarded tabs are not activated.');
 const epoch=session.epochs.get(tabId)||0, permissionEpoch=session.permissionEpoch;
 const result=(await chrome.scripting.executeScript({target:{tabId},func:readRequestedPage}))[0];
 const contentHash=await captureTextHash(JSON.stringify({text:result?.result?.text||'',blocks:result?.result?.blocks||[]}));
 const after=await chrome.tabs.get(tabId);
 if(!result?.result||before.url!==after.url||after.discarded||epoch!==(session.epochs.get(tabId)||0)||permissionEpoch!==session.permissionEpoch)throw new Error('Source changed during capture. Refresh it.');
 const data=result.result;
 return {...data,sourceUrl:safeSourceUrl(after.url!),title:data.title.slice(0,500),contentHash,capturedAt:new Date().toISOString(),expiresAt:Date.now()+INBOX_TTL,snapshotId:crypto.randomUUID(),sessionId:session.sessionId,missionId:session.missionId,tabId,windowId:after.windowId,documentId:result.documentId||'',navigationEpoch:epoch,permissionEpoch} satisfies ContextSnapshot;
}
export function installBrowserContext(){
 chrome.tabs.onUpdated.addListener((id,change)=>{if(change.url||change.status==='loading')session.navigate(id);});
 chrome.tabs.onRemoved.addListener(id=>{session.navigate(id);session.selected.delete(id);});
 chrome.permissions.onRemoved.addListener(()=>session.pause());
 chrome.runtime.onMessage.addListener((raw:unknown,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||!sender.url||new URL(sender.url).origin!==new URL(chrome.runtime.getURL('')).origin||new URL(sender.url).pathname!=='/index.html')return false;
  const parsed=command.safeParse(raw);if(!parsed.success)return false;
  void(async()=>{try{const cmd=parsed.data;
   if(cmd.type==='CONTEXT_SCREENSHOT'){const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});if(tab?.id===undefined)throw new Error('Open the intended page and click the toolbar icon first.');const source=await captureAuthorizedTab(tab.id);const before=await chrome.tabs.get(tab.id);const image=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});const after=await chrome.tabs.get(tab.id);const window=await chrome.windows.get(tab.windowId);if(!before.active||!after.active||!window.focused||before.url!==after.url||source.navigationEpoch!==(session.epochs.get(tab.id)||0)||source.permissionEpoch!==session.permissionEpoch)throw new Error('Visible tab changed during screenshot. Image discarded.');respond({image,sourceUrl:source.sourceUrl});return;}
   if(cmd.type==='CONTEXT_START'){for(const site of cmd.sites){const url=new URL(site);if(url.origin!==site||!['https:','http:'].includes(url.protocol)||!await chrome.permissions.contains({origins:[site+'/*']}))throw new Error('Exact site permission required.');}session.start(cmd.missionId,cmd.tabIds,cmd.sites);}
   if(cmd.type==='CONTEXT_PAUSE')session.pause();
   if(cmd.type==='CONTEXT_FREEZE'){respond({frozen:session.freeze(cmd.requestId)});return;}
   const errors:string[]=[];
   if(cmd.type==='CONTEXT_REFRESH')for(const tabId of cmd.tabIds){try{const tab=await chrome.tabs.get(tabId);const win=await chrome.windows.get(tab.windowId);const foreground=tab.active&&win.focused;if(!tab.url||!session.allowed(tabId,tab.url,foreground))throw new Error('Unselected tab or site outside consent.');if(!await chrome.permissions.contains({origins:[new URL(tab.url).origin+'/*']})){session.pause();throw new Error('Page permission lost.');}const snapshot=await captureAuthorizedTab(tabId);session.accept(snapshot,foreground);}catch(e){errors.push(e instanceof Error?e.message:'Capture unavailable');}}
   if(Date.now()>=session.expiresAt)session.pause();
   respond({sessionId:session.sessionId,paused:session.paused,expiresAt:session.expiresAt,missionId:session.missionId,snapshots:[...session.snapshots.values()],errors});
  }catch(e){respond({error:e instanceof Error?e.message:'Context unavailable'});}})();return true;
 });
}
