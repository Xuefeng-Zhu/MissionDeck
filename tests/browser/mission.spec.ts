import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

async function pair(page:Page){
  await page.goto('/');
  await page.getByRole('button',{name:'Settings',exact:true}).first().click();
  const code=process.env.PAIRING_CODE || (await readFile(resolve(process.cwd(),'.data/pairing-code'),'utf8')).trim();
  await page.getByLabel('Pairing code',{exact:true}).fill(code);
  await page.getByRole('button',{name:'Pair workspace',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pair workspace',exact:true})).not.toBeVisible();
}
async function assertNoHorizontalOverflow(page:Page,width:number){
  await page.setViewportSize({width,height:1000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
}
async function openFreshFixtureMission(page:Page){
  const id=await page.evaluate(async()=>{const token=sessionStorage.getItem('mission-control.session');const response=await fetch('http://127.0.0.1:4318/api/missions/demo',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:'{}'});if(!response.ok)throw new Error('Fixture mission preparation failed.');return (await response.json()).mission.id as string;});
  await page.evaluate(missionId=>localStorage.setItem('mission-control.selected',missionId),id);await page.reload();
}

test('complete fixture mission loop, controlled edits, duplicate evidence and persistence',async({page,request})=>{
  const config=await (await request.get('http://127.0.0.1:4318/api/config')).json();
  test.skip(config.providerMode!=='fixture'||config.modelMode!=='fixture','Browser fixture test never writes to a live provider.');
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await pair(page);
  await page.getByRole('button',{name:'New mission',exact:true}).click();
  // Create through the editable contract; fixture-specific criteria keep the documented six-task scenario.
  await page.getByLabel('Outcome',{exact:true}).fill('Prepare our hackathon project for submission');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  // A fresh profile may still show existing missions; the explicit demo entry point is also available via API-backed UI smoke setup.
  await openFreshFixtureMission(page);
  await expect(page.getByRole('heading',{name:'Review your mission contract'})).toBeVisible();
  await page.getByRole('button',{name:'Confirm contract & generate plan'}).click();
  await expect(page.getByRole('heading',{name:'Review your 6-step plan'})).toBeVisible();
  const proposal=page.locator('.proposal-card').first();
  await proposal.getByRole('button',{name:'Edit',exact:true}).click();
  await proposal.getByLabel('Effort in minutes',{exact:true}).first().fill('105');
  await proposal.locator('.change-row').first().getByLabel('Draft the project description',{exact:true}).check();
  await proposal.getByRole('button',{name:'Save revised proposal'}).click();
  await expect(page.getByText('Revised proposal saved.',{exact:false})).toBeVisible();
  await page.locator('.proposal-card').filter({has:page.getByRole('button',{name:'Approve and create tasks'})}).last().getByRole('button',{name:'Approve and create tasks'}).click();
  await expect(page.locator('.task-list > li')).toHaveCount(6);
  await page.getByRole('button',{name:'Finish the core implementation',exact:true}).click();
  await expect(page.locator('.task-detail').getByText('synced',{exact:true})).toBeVisible();
  await expect(page.locator('.task-detail code')).toContainText(/fixture/i);
  await page.getByRole('button',{name:'Finish the core implementation',exact:true}).click();
  await page.getByRole('button',{name:'Capture page',exact:true}).click();
  await page.getByLabel('Excerpt',{exact:true}).fill('A two-minute demo video is required. The video must show the complete project journey.');
  await page.getByLabel('Title',{exact:true}).fill('Fixture hackathon requirements');
  await page.getByLabel('Source URL',{exact:true}).fill('http://127.0.0.1:4318/fixtures/requirements.html?token=must-not-be-retained#private');
  await page.getByRole('button',{name:'Send to Mission Control',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Add the required demo video'})).toBeVisible();
  await page.getByRole('button',{name:'Approve changes',exact:true}).click();
  await expect(page.locator('.task-list > li')).toHaveCount(7);
  await page.getByRole('button',{name:'Capture page',exact:true}).click();
  await page.getByLabel('Excerpt',{exact:true}).fill('A two-minute demo video is required. The video must show the complete project journey.');
  await page.getByLabel('Title',{exact:true}).fill('Fixture hackathon requirements');
  await page.getByRole('button',{name:'Send to Mission Control',exact:true}).click();
  await expect(page.getByText('This exact evidence is already in your mission.',{exact:false})).toBeVisible();
  await expect(page.locator('.task-list > li')).toHaveCount(7);
  await page.getByRole('button',{name:'Finish the core implementation',exact:true}).click();
  await page.getByLabel('Report a blocker',{exact:true}).fill('Fixture blocker: build is waiting on a missing dependency.');
  await page.getByRole('button',{name:'Mark blocked',exact:true}).click();
  await expect(page.locator('.task-row.is-expanded')).toContainText('Blocked');
  await page.getByRole('button',{name:'Review recovery options',exact:true}).click();
  const recovery=page.locator('.proposal-card--recovery').first();
  await expect(recovery).toContainText('ETA remains unknown');
  await recovery.getByRole('button',{name:'Approve changes',exact:true}).click();
  await expect(page.locator('.task-row.is-deferred')).toContainText('Polish screenshots');
  await page.reload();
  await expect(page.locator('.task-list > li')).toHaveCount(7);
  await page.getByRole('button',{name:'Activity',exact:true}).click();
  await expect(page.locator('.activity-list')).toContainText('blocker');
  await page.getByRole('button',{name:/^Evidence(?: \d+)?$/}).click();
  await expect(page.locator('.evidence-row')).toHaveCount(1);
  await expect(page.locator('.evidence-row a')).toHaveAttribute('href','http://127.0.0.1:4318/fixtures/requirements.html');
  await page.getByRole('button',{name:'Plan',exact:true}).click();
  for(const width of [360,390,400,480])await assertNoHorizontalOverflow(page,width);
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'test-results/mission-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:1000});
  await page.screenshot({path:'test-results/mission-panel.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('capture stays unsent until reviewed and can be discarded',async({page})=>{
  await pair(page);await page.getByRole('button',{name:'Capture page',exact:true}).click();
  let transmitted=false;page.on('request',request=>{if(request.url().startsWith('http://127.0.0.1:4318')&&request.postData()?.includes('UNSENT_PRIVATE_CONTEXT_9c6d'))transmitted=true;});
  await page.getByLabel('Excerpt',{exact:true}).fill('UNSENT_PRIVATE_CONTEXT_9c6d');
  await page.getByRole('button',{name:'Discard',exact:true}).click();
  await expect(page.getByLabel('Excerpt',{exact:true})).not.toBeVisible();expect(transmitted).toBe(false);
});

test('reject creates no tasks and explicit criterion attestations complete a fixture mission',async({page,request})=>{
  const config=await (await request.get('http://127.0.0.1:4318/api/config')).json();
  test.skip(config.providerMode!=='fixture'||config.modelMode!=='fixture','Browser fixture test never writes to a live provider.');
  await pair(page);await openFreshFixtureMission(page);
  await page.getByRole('button',{name:'Confirm contract & generate plan'}).click();
  await expect(page.getByRole('heading',{name:'Review your 6-step plan'})).toBeVisible();
  await page.getByRole('button',{name:'Reject',exact:true}).click();
  await expect(page.locator('.task-list > li')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Approve and create tasks'})).not.toBeVisible();
  await page.getByRole('button',{name:'Generate plan',exact:true}).click();
  await page.getByRole('button',{name:'Approve and create tasks',exact:true}).click();
  await expect(page.locator('.task-list > li')).toHaveCount(6);
  await page.getByRole('button',{name:'Verify completion',exact:true}).click();
  await expect(page.getByRole('button',{name:'Complete verified mission',exact:true})).toBeDisabled();
  for(const title of ['Working project build','Complete submission package','Final readiness review']){
    const row=page.locator('.verification-row').filter({has:page.getByText(title,{exact:true})});
    await row.getByLabel(`Attestation for ${title}`,{exact:true}).fill(`Fixture browser test attestation: simulated review of ${title}; no real project outcome is asserted.`);
    await row.getByRole('button',{name:'Attest & verify criterion',exact:true}).click();
    await expect(row.getByText('verified',{exact:true})).toBeVisible();
  }
  await page.getByRole('button',{name:'Complete verified mission',exact:true}).click();
  await expect(page.locator('.mission-header').getByText('Completed',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.locator('.mission-header').getByText('Completed',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Reopen mission',exact:true})).toBeVisible();
});
