import {captureAuthorizedTab,installBrowserContext} from './browser-context';
installBrowserContext();
import {CAPTURE_LIMIT, INBOX_TTL, captureTextHash, readRequestedPage, safeSourceUrl} from './capture';

const inboxKey='mission-control.pending-capture';
const menus = [{id:'mission-add',title:'Add to mission'},{id:'mission-task',title:'Create task'},{id:'mission-impact',title:'Check mission impact'}];
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  chrome.contextMenus.removeAll(() => menus.forEach(menu => chrome.contextMenus.create({...menu,contexts:['selection']})));
});
chrome.action.onClicked.addListener(tab => {
  if (tab.id !== undefined) {
    const opening=chrome.sidePanel.open({tabId:tab.id});
    void opening.then(async()=>{const capture=await captureAuthorizedTab(tab.id!);await chrome.storage.session.set({[inboxKey]:capture});}).catch(async error=>{await chrome.storage.session.set({'mission-control.capture-error':error instanceof Error?error.message:'Capture unavailable. Use a manual note.'});});
  }
});
chrome.contextMenus.onClicked.addListener((info,tab) => {
  if (!menus.some(menu=>menu.id===info.menuItemId) || tab?.id === undefined) return;
  // Invoke immediately on the browser's user-gesture event, before storage or injection awaits.
  const panelOpen=chrome.sidePanel.open({tabId:tab.id});
  void (async()=>{
    try {
      await panelOpen;
      if(tab.incognito) throw new Error('Incognito capture is disabled.');
      // Read through the exclusion-aware capture function; selectionText alone can include editable drafts.
      const data = await captureAuthorizedTab(tab.id!);
      if (!data || data.method !== 'selection') throw new Error('The selection is no longer available. Select text again or use a manual note.');
      await chrome.storage.session.set({[inboxKey]:{...data,text:data.text.slice(0,CAPTURE_LIMIT),contentHash:await captureTextHash(data.text),sourceUrl:safeSourceUrl(data.sourceUrl),capturedAt:new Date().toISOString(),expiresAt:Date.now()+INBOX_TTL,intent:info.menuItemId==='mission-task'?'task':info.menuItemId==='mission-impact'?'impact':'evidence'}});
    } catch(error) {
      await chrome.storage.session.set({'mission-control.capture-error':error instanceof Error?error.message:'Capture unavailable. Use manual text.'});
    }
  })();
});
chrome.runtime.onMessage.addListener((message:unknown,sender,sendResponse)=>{
  if (sender.id!==chrome.runtime.id || !sender.url || new URL(sender.url).pathname!=='/index.html') return false;
  if (!message || typeof message!=='object' || Object.keys(message).length!==1 || (message as {type?:unknown}).type!=='CAPTURE_ACTIVE_TAB') return false;
  void (async()=>{
    try {
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if (tab?.id===undefined) throw new Error('No active tab. Open a web page and click the Mission Control toolbar icon.');
      if (tab.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('Open the side panel on the web page you want to capture, or add a manual note here.');
      const data=await captureAuthorizedTab(tab.id);
      if (!data) throw new Error('No readable text found. Add a manual note.');
      sendResponse({capture:{...data,contentHash:await captureTextHash(data.text),sourceUrl:safeSourceUrl(data.sourceUrl),capturedAt:new Date().toISOString(),expiresAt:Date.now()+INBOX_TTL}});
    } catch(error) { sendResponse({error:'Page access unavailable. Click the Mission Control toolbar icon on this tab, then capture again. Browser pages, extension-store pages, and some documents require manual text. '+(error instanceof Error?error.message:'')}); }
  })();
  return true;
});
