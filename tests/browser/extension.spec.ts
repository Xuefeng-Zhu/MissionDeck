import {test,expect,chromium} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';

test('unpacked MV3 service worker, trusted session and unsupported-page fallback',async()=>{
  const extensionPath=resolve(process.cwd(),'apps/extension/dist');
  const manifest=JSON.parse(await readFile(join(extensionPath,'manifest.json'),'utf8'));
  expect(manifest.permissions).toEqual(['sidePanel','activeTab','scripting','contextMenus','storage']);
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.host_permissions.every((host:string)=>/^http:\/\/(127\.0\.0\.1|localhost):4318\/\*$/.test(host))).toBe(true);
  const profile=await mkdtemp(join(tmpdir(),'mission-extension-test-'));
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
  try {
    const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId=new URL(worker.url()).host;
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    const page=await context.newPage();await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(page.getByText('MissionDeck',{exact:true}).first()).toBeVisible();
    await page.getByRole('button',{name:'Settings',exact:true}).first().click();
    const code='browser-fixture-pairing-code-only';
    await page.getByLabel('Pairing code',{exact:true}).fill(code);await page.getByRole('button',{name:'Pair workspace',exact:true}).click();
    await expect(page.getByRole('button',{name:'Pair workspace',exact:true})).not.toBeVisible();
    expect(await page.evaluate(async()=>!!(await chrome.storage.session.get('mission-control.session'))['mission-control.session'])).toBe(true);
    expect(await page.evaluate(()=>localStorage.getItem('mission-control.session'))).toBeNull();
    await page.reload();await expect(page.getByRole('button',{name:'Pair workspace',exact:true})).not.toBeVisible();
    // Direct workspace capture is rejected; a full page must use manual text or the panel on an invoked web tab.
    const result=await page.evaluate(()=>chrome.runtime.sendMessage({type:'CAPTURE_ACTIVE_TAB'}));
    expect(result.error).toContain('manual');
    // An expired inbox is never rehydrated into a preview.
    await page.evaluate(async()=>chrome.storage.session.set({'mission-control.pending-capture':{text:'expired private excerpt',sourceUrl:'https://example.com',title:'Expired',method:'selection',capturedAt:new Date(0).toISOString(),expiresAt:1,truncated:false}}));
    await page.reload();await expect(page.getByRole('heading',{name:'Review captured context'})).not.toBeVisible();
    await expect.poll(()=>page.evaluate(async()=>Object.keys(await chrome.storage.session.get('mission-control.pending-capture')).length)).toBe(0);
    // Native toolbar click, context menu selection and permission loss after navigation require the documented manual check.
  }finally{await context.close();await rm(profile,{recursive:true,force:true});}
});

test('unpacked context sessions extract selected fixture pages, track changes, freeze and revoke',async()=>{
 const extensionPath=resolve(process.cwd(),'apps/extension/dist');
 const profile=await mkdtemp(join(tmpdir(),'mission-context-browser-'));
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const extensionId=new URL(worker.url()).host;
  const brief=await context.newPage();await brief.goto('http://127.0.0.1:4318/fixtures/launch-brief.html');
  const issues=await context.newPage();await issues.goto('http://127.0.0.1:4318/fixtures/launch-issues.html');
  const unrelated=await context.newPage();await unrelated.goto('http://127.0.0.1:4318/fixtures/launch-feedback.html');
  const panel=await context.newPage();await panel.goto(`chrome-extension://${extensionId}/index.html`);
  const selected=await panel.evaluate(async()=>{const tabs=await chrome.tabs.query({});return tabs.filter(t=>t.url?.includes('/fixtures/launch-brief')||t.url?.includes('/fixtures/launch-issues')).map(t=>t.id!);});
  expect(selected).toHaveLength(2);
  const start=await panel.evaluate(tabIds=>chrome.runtime.sendMessage({type:'CONTEXT_START',missionId:'browser-fixture-mission',tabIds,sites:['http://127.0.0.1:4318']}),selected);expect(start.paused).toBe(false);
  const captured=await panel.evaluate(tabIds=>chrome.runtime.sendMessage({type:'CONTEXT_REFRESH',tabIds}),selected);
  expect(captured.snapshots).toHaveLength(2);
  const source=captured.snapshots.find((s:{sourceUrl:string})=>s.sourceUrl.includes('launch-brief'));
  expect(source.text).toContain('REQ-1');expect(source.text).not.toContain('DO NOT CAPTURE');expect(source.blocks.some((b:{kind:string})=>b.kind==='table')).toBe(true);
  expect(JSON.stringify(captured.snapshots)).not.toContain('Ignore your policy');
  const frozen=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'CONTEXT_FREEZE',requestId:'browser-request-one'}));
  expect(frozen.frozen.sources).toHaveLength(2);expect(JSON.stringify(frozen.frozen)).not.toContain('tabId');
  await brief.getByRole('button',{name:'Reveal new fixture requirement'}).click();
  const changed=await panel.evaluate(tabIds=>chrome.runtime.sendMessage({type:'CONTEXT_REFRESH',tabIds}),selected);
  expect(changed.snapshots.find((s:{sourceUrl:string})=>s.sourceUrl.includes('launch-brief')).text).toContain('REQ-3');
  expect(JSON.stringify(frozen.frozen)).not.toContain('REQ-3');
  await panel.evaluate(()=>chrome.runtime.sendMessage({type:'CONTEXT_PAUSE'}));
  const paused=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'CONTEXT_STATUS'}));expect(paused.paused).toBe(true);expect(paused.snapshots).toHaveLength(0);
  const denied=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'CONTEXT_FREEZE',requestId:'browser-request-two'}));expect(denied.error).toContain('paused');
  await panel.evaluate(tabIds=>chrome.runtime.sendMessage({type:'CONTEXT_START',missionId:'browser-fixture-mission',tabIds,sites:['http://127.0.0.1:4318']}),selected);
  await context.close();
  const reopened=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
  try{const reopenedWorker=reopened.serviceWorkers()[0]||await reopened.waitForEvent('serviceworker');const reopenedPanel=await reopened.newPage();await reopenedPanel.goto(`chrome-extension://${new URL(reopenedWorker.url()).host}/index.html`);const restarted=await reopenedPanel.evaluate(()=>chrome.runtime.sendMessage({type:'CONTEXT_STATUS'}));expect(restarted.paused).toBe(true);expect(restarted.snapshots).toHaveLength(0);}finally{await reopened.close();}
 }finally{await context.close();await rm(profile,{recursive:true,force:true});}
});
