import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import type {MissionExecution} from '@mission/domain';

const isolatedBackend='http://127.0.0.1:4321';
const frontendBackend='http://127.0.0.1:4318';
const fixturePairingCode='execution-demo-fixture-code';

async function requireFixtureBackend(request:APIRequestContext){
  const response=await request.get(`${isolatedBackend}/api/config`);
  expect(response.ok(),'The isolated fixture backend must be available before opening the UI.').toBe(true);
  const config=await response.json();
  expect(config.providerMode??config.mode,'Refusing to run the execution demo against a live workspace.').toBe('fixture');
  expect(config.modelMode,'Refusing to run the execution demo with live model calls.').toBe('fixture');
}

async function executionSnapshot(page:Page):Promise<MissionExecution>{
  return page.evaluate(async()=>{
    const token=sessionStorage.getItem('mission-control.session');
    const missionId=localStorage.getItem('mission-control.selected');
    if(!token||!missionId)throw new Error('The paired session and selected execution mission are required.');
    const response=await fetch(`http://127.0.0.1:4318/api/missions/${encodeURIComponent(missionId)}/execution`,{headers:{Authorization:`Bearer ${token}`}});
    if(!response.ok)throw new Error(`Execution read-back failed (${response.status}).`);
    const result=await response.json();
    if(!result.execution)throw new Error('No execution state was saved for the selected mission.');
    return result.execution;
  });
}

test('sample mission runs through real fixture storage, human review, final verification, and reload',async({page,request},testInfo)=>{
  test.skip(testInfo.project.name!=='execution-chromium','Run this isolated backend regression with pnpm test:execution.');
  await requireFixtureBackend(request);

  // Forward API traffic to the real isolated fixture server. No API responses are mocked.
  await page.route(`${frontendBackend}/**`,async route=>{
    const source=new URL(route.request().url());
    if(source.origin!==frontendBackend||!source.pathname.startsWith('/api/')){
      await route.abort('blockedbyclient');
      return;
    }
    if(!['GET','HEAD','OPTIONS'].includes(route.request().method()))await requireFixtureBackend(request);
    const destination=new URL(source.pathname+source.search,isolatedBackend);
    const response=await route.fetch({url:destination.href,maxRedirects:0});
    await route.fulfill({response});
  });

  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',entry=>{if(entry.type()==='error')errors.push(entry.text());});

  await page.goto('/');
  await expect(page).toHaveTitle('Mission Control');
  await expect(page.getByText('Mission Control',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Settings',exact:true}).first().click();
  await page.getByLabel('Pairing code',{exact:true}).fill(fixturePairingCode);
  await page.getByRole('button',{name:'Pair workspace',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pair workspace',exact:true})).not.toBeVisible();

  await page.getByRole('button',{name:'New mission',exact:true}).click();
  await page.getByRole('button',{name:'Try a sample mission',exact:true}).click();
  await expect(page.getByLabel('Mission',{exact:true})).toHaveValue(/Prepare a launch brief/);
  await expect(page.getByLabel('Source material and context',{exact:true})).toHaveValue(/Fictional demo sources/);
  await expect(page.getByLabel('Human reviewer',{exact:true})).not.toHaveValue('');
  await expect(page.getByLabel('Working agent',{exact:true})).not.toHaveValue('');
  await page.screenshot({path:testInfo.outputPath('execution-start-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Start mission',exact:true}).click();
  await expect(page.locator('.execution-task-list > li')).toHaveCount(3,{timeout:60_000});

  const reviewTask=page.locator('.execution-task[data-state="waiting_human"]');
  await expect(reviewTask).toHaveCount(1,{timeout:60_000});
  await expect(reviewTask.getByRole('textbox',{name:/^Review feedback for /})).toBeVisible();
  const waiting=await executionSnapshot(page);
  expect(waiting.mode).toBe('fixture');
  expect(waiting.modelMode).toBe('fixture');
  expect(waiting.budget.agentRuns).toBe(1);
  const humanTask=waiting.tasks.find(task=>task.assignee.kind==='human');
  expect(humanTask?.status).toBe('waiting_human');
  expect(waiting.tasks.find(task=>task.assignee.kind==='agent'&&task.dependsOn.includes(humanTask!.id))?.status).toBe('queued');
  expect(waiting.tasks.every(task=>Boolean(task.providerId)&&!task.assignmentPending)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('execution-review-desktop.png'),fullPage:true});

  // Reload while waiting: the final agent must remain gated by persisted human feedback.
  await page.reload();
  await expect(page.getByRole('button',{name:'Execute',exact:true})).toHaveAttribute('aria-current','page');
  await expect(reviewTask.getByRole('textbox',{name:/^Review feedback for /})).toBeVisible();
  expect((await executionSnapshot(page)).budget.agentRuns).toBe(1);
  const feedback='Position Harbor as the shared home for human and agent work. Emphasize clear ownership and the latest saved draft. Keep all facts fictional and omit launch dates.';
  await reviewTask.getByRole('textbox',{name:/^Review feedback for /}).fill(feedback);
  await reviewTask.getByRole('button',{name:'Save review and continue',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review the mission outcome',exact:true})).toBeVisible({timeout:60_000});

  const ready=await executionSnapshot(page);
  expect(ready.tasks.every(task=>task.status==='completed')).toBe(true);
  expect(ready.budget.agentRuns).toBe(2);
  const finalTask=ready.tasks.find(task=>task.assignee.kind==='agent'&&task.dependsOn.includes(humanTask!.id));
  const finalArtifact=ready.artifacts.find(artifact=>artifact.kind==='deliverable'&&artifact.taskId===finalTask?.id);
  expect(finalArtifact?.content).toContain(feedback);
  const savedArtifacts=page.locator('[aria-label="Execution artifacts"]');
  const finalDocument=savedArtifacts.locator('.execution-artifact').filter({has:page.locator('.execution-artifact-title').filter({hasText:finalArtifact!.title})});
  await finalDocument.locator('summary').click();
  await expect(finalDocument.locator('pre')).toBeVisible();
  await expect(finalDocument.locator('pre')).toContainText(feedback);
  await page.getByLabel('Outcome verification',{exact:true}).fill('I reviewed the saved fixture launch brief and its linked human feedback. The demo workflow produced all expected documents; outputs remain clearly simulated.');
  await page.getByRole('button',{name:'Verify and complete mission',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Completed',exact:true})).toBeVisible({timeout:30_000});

  const completed=await executionSnapshot(page);
  expect(completed.status).toBe('completed');
  expect(completed.tasks.map(task=>task.status)).toEqual(['completed','completed','completed']);
  expect(completed.budget.agentRuns).toBe(2);
  expect(completed.tasks.filter(task=>task.assignee.kind==='agent').every(task=>Boolean(task.runId))).toBe(true);
  expect(completed.artifacts).toHaveLength(6);
  expect(completed.artifacts.map(artifact=>artifact.kind).sort()).toEqual(['brief','deliverable','deliverable','review','summary','verification']);
  expect(completed.artifacts.every(artifact=>artifact.mode==='fixture'&&artifact.id&&artifact.verifiedAt&&artifact.fingerprint&&artifact.content)).toBe(true);
  expect(completed.operations.length).toBeGreaterThan(0);
  expect(completed.operations.every(operation=>operation.state==='done')).toBe(true);
  expect(new Set(completed.tasks.map(task=>task.providerId)).size).toBe(3);
  expect(new Set(completed.artifacts.map(artifact=>artifact.id)).size).toBe(6);
  await expect(savedArtifacts.locator(':scope > .execution-artifact')).toHaveCount(5);
  await expect(page.locator('[aria-label="Saved mission brief"] > .execution-artifact')).toHaveCount(1);
  await expect(page.locator('.mission-header')).toContainText('No deadline set');
  await expect(page.locator('.mission-header .badge')).toHaveCount(0);
  await expect(page.locator('.mission-header')).not.toContainText('0 of');
  await page.screenshot({path:testInfo.outputPath('execution-completed-desktop.png'),fullPage:true});

  await page.reload();
  await expect(page.getByRole('heading',{name:'Completed',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Execute',exact:true})).toHaveAttribute('aria-current','page');
  const restored=await executionSnapshot(page);
  expect(restored.artifacts.map(artifact=>artifact.id)).toEqual(completed.artifacts.map(artifact=>artifact.id));
  expect(restored.budget.agentRuns).toBe(2);
  for(const viewport of [{width:1440,height:1000},{width:390,height:900}]){
    await page.setViewportSize(viewport);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No horizontal overflow at ${viewport.width}px`).toBe(true);
  }
  await page.screenshot({path:testInfo.outputPath('execution-completed-mobile.png'),fullPage:true});
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
  await writeFile(testInfo.outputPath('execution-result.json'),JSON.stringify({
    missionId:completed.missionId,status:completed.status,mode:completed.mode,modelMode:completed.modelMode,
    tasks:completed.tasks.map(task=>({id:task.id,providerId:task.providerId,assigneeId:task.assignee.id,status:task.status,runId:task.runId})),
    artifacts:completed.artifacts.map(artifact=>({id:artifact.id,kind:artifact.kind,verifiedAt:artifact.verifiedAt})),
    agentRuns:completed.budget.agentRuns,operations:completed.operations.map(operation=>({kind:operation.kind,state:operation.state})),
    title:await page.title(),viewports:[1440,390],errors,
  },null,2));
});
