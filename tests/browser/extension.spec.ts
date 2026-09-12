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
    await expect(page.getByText('Mission Control',{exact:true}).first()).toBeVisible();
    await page.getByRole('button',{name:'Settings',exact:true}).first().click();
    const code=process.env.PAIRING_CODE || (await readFile(resolve(process.cwd(),'.data/pairing-code'),'utf8')).trim();
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
