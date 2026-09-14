import {test,expect,chromium,type APIRequestContext,type BrowserContext,type CDPSession,type Page,type Route,type TestInfo} from '@playwright/test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import type {Mission,MissionExecution} from '@mission/domain';

const isolatedBackend='http://127.0.0.1:4333';
const frontendBackend='http://127.0.0.1:4318';
const pairingCode='adaptive-browser-fixture-code';
const reviewedTitle='Reviewed fictional launch owner update';
const reviewedExcerpt='Fictional launch owner update: approve a broader rollout only after calendar acceptance is documented. Keep the announcement as an unsent draft for final human review.';
const reviewedUrl='https://example.test/launch-owner-update';
const execFileAsync=promisify(execFile);
const recordingPath=process.env.ADAPTIVE_DEMO_VIDEO?.trim();
const demoPause=(milliseconds:number)=>recordingPath?new Promise<void>(resolve=>setTimeout(resolve,milliseconds)):Promise.resolve();

async function startWindowRecording(output:string){
  const recorder=process.env.MISSIONDECK_WINDOW_RECORDER?.trim();
  if(!recorder)throw new Error('MISSIONDECK_WINDOW_RECORDER is required when ADAPTIVE_DEMO_VIDEO is set.');
  const listed=await execFileAsync(recorder,['list'],{timeout:20_000,encoding:'utf8'});
  const event=listed.stdout.trim().split('\n').map(line=>JSON.parse(line)).find(value=>value.event==='windows');
  const candidates=(event?.windows??[]).filter((window:{bundleId:string;title:string;width:number})=>window.bundleId==='com.google.chrome.for.testing'&&window.title.includes('Mission Control')&&window.width>=1000);
  if(candidates.length!==1)throw new Error(`Expected one isolated Mission Control Chrome window for recording; found ${candidates.length}.`);
  const child=spawn(recorder,['record','--window-id',String(candidates[0].windowId),'--output',output,'--duration','300','--width','1920'],{stdio:['ignore','pipe','pipe']});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  let stdout='';let stderr='';child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});
  await new Promise<void>((resolveReady,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('The selected-window recorder did not produce its first frame.')),20_000);
    const inspect=()=>{if(stdout.split('\n').some(line=>{try{return JSON.parse(line).event==='first_frame';}catch{return false;}})){clearTimeout(timeout);resolveReady();}};
    child.stdout.on('data',inspect);child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`The selected-window recorder exited before capture (${code}): ${stderr.slice(0,500)}`));});
  });
  return {stop:async()=>{
    child.kill('SIGINT');
    const code=await new Promise<number|null>(resolveExit=>child.once('exit',resolveExit));
    if(code!==0)throw new Error(`The selected-window recorder failed (${code}): ${stderr.slice(0,500)}`);
    const events=stdout.trim().split('\n').map(line=>JSON.parse(line));
    const finished=events.find(value=>value.event==='finished');if(!finished)throw new Error('The recording ended without a finalized video.');
    await writeFile(output.replace(/\.mp4$/,'.capture.json'),JSON.stringify({events},null,2));
  }};
}

async function assertControlledBackend(request:APIRequestContext){
  const response=await request.get(`${isolatedBackend}/__adaptive_test__`);
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({workspace:'fixture',runner:'controlled-browser-test',liveModelCalls:false,liveAmbiguousCalls:false});
}

async function forwardBackend(context:BrowserContext,request:APIRequestContext){
  await assertControlledBackend(request);
  await context.route(`${frontendBackend}/**`,async route=>{
    const source=new URL(route.request().url());
    if(source.origin!==frontendBackend||!source.pathname.startsWith('/api/')){await route.abort('blockedbyclient');return;}
    const response=await route.fetch({url:new URL(source.pathname+source.search,isolatedBackend).href,maxRedirects:0});
    await route.fulfill({response});
  });
}

async function snapshot(page:Page):Promise<{execution:MissionExecution;mission:Mission}>{
  return page.evaluate(async()=>{
    const extension=typeof chrome!=='undefined'&&Boolean(chrome.runtime?.id);
    const token=extension?(await chrome.storage.session.get('mission-control.session'))['mission-control.session']:sessionStorage.getItem('mission-control.session');
    const id=localStorage.getItem('mission-control.selected');
    if(!id||!token)throw new Error('The paired session and selected mission are required.');
    const headers={Authorization:`Bearer ${token}`};
    const [executionResponse,missionResponse]=await Promise.all([
      fetch(`http://127.0.0.1:4318/api/missions/${encodeURIComponent(id)}/execution`,{headers}),
      fetch(`http://127.0.0.1:4318/api/missions/${encodeURIComponent(id)}`,{headers}),
    ]);
    if(!executionResponse.ok||!missionResponse.ok)throw new Error('Saved mission read-back failed.');
    return {execution:(await executionResponse.json()).execution,mission:(await missionResponse.json()).mission};
  });
}

async function pair(page:Page){
  await expect(page).toHaveTitle('Mission Control');
  await expect(page.locator('.brand:visible').getByText('Mission Control',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Settings',exact:true}).first().click();
  await page.getByLabel('Pairing code',{exact:true}).fill(pairingCode);
  await page.getByRole('button',{name:'Pair workspace',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pair workspace',exact:true})).not.toBeVisible();
}

async function startSample(page:Page,afterStarted?:()=>Promise<void>){
  if(await page.getByLabel('Switch mission',{exact:true}).isVisible())await page.getByLabel('Switch mission',{exact:true}).selectOption('new');
  else await page.getByRole('button',{name:'New mission',exact:true}).click();
  await demoPause(900);
  await page.locator('input[value="adaptive_launch"]').check();
  await page.getByRole('button',{name:'Try the adaptive launch sample',exact:true}).click();
  await expect(page.getByLabel('Source 1 name',{exact:true})).toHaveValue(/Product requirements/);
  await expect(page.getByLabel('Source 2 material',{exact:true})).toHaveValue(/Calendar integration is not ready/);
  await expect(page.getByLabel('Human reviewer',{exact:true})).not.toHaveValue('');
  await expect(page.getByLabel('Working agent',{exact:true})).not.toHaveValue('');
  await expect(page.getByRole('button',{name:'Start mission',exact:true})).toBeEnabled();
  await demoPause(2400);
  await page.getByRole('button',{name:'Start mission',exact:true}).click();
  await afterStarted?.();
  await expect(page.getByRole('button',{name:'Save decision and continue',exact:true})).toBeVisible({timeout:60_000});
  await expect(page.locator('.execution-task[data-state="waiting_human"]')).toHaveCount(1);
  await expect(page.getByRole('textbox',{name:/^Review feedback for /})).toHaveCount(0);
  await expect(page.getByLabel('Execution engine and model')).toContainText('controlled-browser-test');
  await expect(page.getByLabel('Execution engine and model')).toContainText('deterministic-runner-no-live-model');
}

async function decide(page:Page,optionId:string,constraints:string){
  await page.locator(`.adaptive-option input[value="${optionId}"]`).check();
  await page.getByLabel('Additional constraints',{exact:true}).fill(constraints);
  await page.getByRole('button',{name:'Save decision and continue',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review the mission outcome',exact:true})).toBeVisible({timeout:60_000});
  await expect(page.getByRole('heading',{name:'What changed in the launch pack',exact:true})).toBeVisible();
}

async function screenshot(page:Page,testInfo:TestInfo,name:string,width:number){
  await page.setViewportSize({width,height:1000});
  await page.evaluate(()=>window.scrollTo(0,0));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No horizontal overflow at ${width}px`).toBe(true);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath(name),fullPage:true});
}

async function armPhases(request:APIRequestContext,stage:'analysis'|'launch_pack',phases:string[]){
  const response=await request.post(`${isolatedBackend}/__adaptive_test__/gates`,{data:{stage,phases}});
  expect(response.ok()).toBe(true);
  return (await response.json()).id as string;
}
async function releasePhase(request:APIRequestContext,id:string,phase:string){
  const response=await request.post(`${isolatedBackend}/__adaptive_test__/gates/${id}/release`,{data:{phase}});
  expect(response.ok()).toBe(true);
}

async function browserPaint(page:Page){
  await page.evaluate(()=>new Promise<void>(resolvePaint=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolvePaint()))));
}

/** Delay one real GET response while later reads continue through normal routes. */
async function holdExecutionRead(page:Page,outcome:'failure'|'snapshot'){
  const pattern=`${frontendBackend}/api/missions/*/execution`;
  let captured!:(route:Route)=>void;
  const received=new Promise<Route>(resolveReceived=>{captured=resolveReceived;});
  let resume!:()=>void;
  const suspended=new Promise<void>(resolveResume=>{resume=resolveResume;});
  let claimed=false;
  const handler=async(route:Route)=>{
    if(claimed){await route.fallback();return;}
    claimed=true;
    const path=new URL(route.request().url());
    const response=outcome==='snapshot'?await route.fetch({url:new URL(path.pathname+path.search,isolatedBackend).href,maxRedirects:0}):undefined;
    captured(route);
    await suspended;
    if(response)await route.fulfill({response});
    else await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Delayed controlled refresh failure.'}})});
  };
  await page.route(pattern,handler);
  await page.getByRole('button',{name:'Refresh execution',exact:true}).click();
  const original=await received;
  let released=false;
  return {request:original.request(),release:async()=>{
    if(released)return;released=true;
    const finished=page.waitForEvent('requestfinished',{predicate:request=>request===original.request()});
    resume();await finished;await browserPaint(page);
    await page.unroute(pattern,handler);
  }};
}

test('live graph displays controlled parallel activity, source revisions, durable decisions and human verification',async({page,context,request},testInfo)=>{
  test.skip(testInfo.project.name!=='adaptive-chromium','Use playwright.adaptive.config.ts for the isolated controlled harness.');
  await forwardBackend(context,request);
  await page.emulateMedia({reducedMotion:'reduce'});
  const analysisGate=await armPhases(request,'analysis',['readiness','risk','synthesis']);
  const ownedGates=[analysisGate];
  const delayedReads:Array<Awaited<ReturnType<typeof holdExecutionRead>>>=[];
  const graph=page.getByLabel('Execution graph',{exact:true});
  const node=(id:string)=>graph.locator(`[data-graph-node="${id}"]`);
  try{
    await page.goto('/');await pair(page);
    await startSample(page,async()=>{
      await expect(node('readiness')).toHaveAttribute('data-state','running',{timeout:60_000});
      await expect(node('risk')).toHaveAttribute('data-state','running');
      await expect(node('evidence')).toHaveAttribute('data-state','succeeded');
      await expect(node('synthesis')).not.toHaveAttribute('data-state','running');
      await expect(graph).toContainText('Source revision 1');
      await expect(node('launch_pack')).not.toHaveAttribute('data-state','running');
      await node('readiness').focus();await page.keyboard.press('Enter');
      await expect(node('readiness')).toHaveAttribute('aria-pressed','true');
      await expect(page.getByLabel('Selected execution step',{exact:true})).toContainText(/readiness/i);
      expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
      expect(await graph.evaluate(element=>element.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length)).toBe(0);
      await graph.screenshot({path:testInfo.outputPath('execution-graph-parallel-desktop.png')});
      await page.setViewportSize({width:390,height:1000});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await graph.screenshot({path:testInfo.outputPath('execution-graph-parallel-sidepanel-width.png')});
      await page.setViewportSize({width:1440,height:1000});

      await releasePhase(request,analysisGate,'readiness');
      await expect(node('readiness')).toHaveAttribute('data-state','succeeded');
      await expect(node('risk')).toHaveAttribute('data-state','running');
      const held=await request.get(`${isolatedBackend}/__adaptive_test__/gates/${analysisGate}`);
      expect((await held.json()).entered).not.toContain('synthesis');
      await expect(node('synthesis')).not.toHaveAttribute('data-state','running');

      // A failed polling request retains the prior graph, visibly marked stale.
      const executionRoute=`${frontendBackend}/api/missions/*/execution`;
      await page.route(executionRoute,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Controlled refresh interruption.'}})}));
      await page.getByRole('button',{name:'Refresh execution',exact:true}).click();
      await expect(graph).toHaveAttribute('data-stale','true');
      await expect(graph).toContainText('Updates interrupted · showing last confirmed state');
      await expect(node('risk')).toHaveAttribute('data-state','running');
      await page.unroute(executionRoute);
      await page.getByRole('button',{name:'Refresh execution',exact:true}).click();
      await expect(graph).not.toHaveAttribute('data-stale','true');

      const oldFailure=await holdExecutionRead(page,'failure');delayedReads.push(oldFailure);
      const newerSuccess=page.waitForResponse(response=>response.url().endsWith('/execution')&&response.request()!==oldFailure.request&&response.status()===200);
      await page.getByRole('button',{name:'Refresh execution',exact:true}).click();
      await newerSuccess;await browserPaint(page);
      await oldFailure.release();
      await expect(graph).not.toHaveAttribute('data-stale','true');
      await expect(graph).not.toContainText('Updates interrupted');

      // Keep an older successful risk-running snapshot in flight while polling
      // observes the joined synthesis phase, then deliver the older snapshot.
      const oldSnapshot=await holdExecutionRead(page,'snapshot');delayedReads.push(oldSnapshot);
      await releasePhase(request,analysisGate,'risk');
      await expect(node('synthesis')).toHaveAttribute('data-state','running');
      await expect(node('risk')).toHaveAttribute('data-state','succeeded');
      await oldSnapshot.release();
      await expect(node('synthesis')).toHaveAttribute('data-state','running');
      await expect(node('risk')).toHaveAttribute('data-state','succeeded');
      await releasePhase(request,analysisGate,'synthesis');
    });
    await expect(node('decision')).toHaveAttribute('data-state','waiting');
    await expect(node('synthesis')).toHaveAttribute('data-state','succeeded');
    await node('evidence').click();
    await expect(page.getByLabel('Selected execution step',{exact:true})).toContainText('read_mission_source');
    await expect(page.getByLabel('Selected execution step',{exact:true})).toContainText(/Product requirements/);
    const sourceCalls=page.getByLabel('Selected execution step',{exact:true}).getByLabel('Step activity',{exact:true}).locator('li').filter({hasText:'read_mission_source'});
    await expect(sourceCalls).toHaveCount(3);
    for(const row of await sourceCalls.all()){
      await expect(row).toHaveAttribute('data-outcome','succeeded');
      await expect(row).toContainText('read_mission_source · succeeded');
      await expect(row).not.toContainText('read_mission_source · started');
    }
    await node('decision').click();
    await graph.screenshot({path:testInfo.outputPath('execution-graph-human-waiting.png')});
    const waiting=(await snapshot(page)).execution;
    expect(waiting.adaptive?.budget.modelCalls).toBe(4);
    expect(waiting.adaptive?.budget.toolCalls).toBe(3);
    expect(waiting.tasks[2]?.status).toBe('queued');
    await page.reload();
    await expect(node('decision')).toHaveAttribute('data-state','waiting');
    expect((await snapshot(page)).execution.budget.agentRuns).toBe(1);

    const launchGate=await armPhases(request,'launch_pack',['launch_pack']);ownedGates.push(launchGate);
    await page.locator('.adaptive-option input[value="private_beta"]').check();
    await page.getByLabel('Additional constraints',{exact:true}).fill('Controlled graph review: retain manual entry and an unsent announcement.');
    await page.getByRole('button',{name:'Save decision and continue',exact:true}).click();
    await expect(node('launch_pack')).toHaveAttribute('data-state','running',{timeout:60_000});
    await expect(node('decision')).toHaveAttribute('data-state','succeeded');
    const producing=(await snapshot(page)).execution;
    expect(producing.adaptive?.decision?.optionId).toBe('private_beta');
    expect(producing.tasks[1]?.status).toBe('completed');
    expect(producing.artifacts.some(artifact=>artifact.kind==='review'&&artifact.verifiedAt)).toBe(true);
    await releasePhase(request,launchGate,'launch_pack');
    await expect(node('delivery')).toHaveAttribute('data-state','succeeded',{timeout:60_000});
    await expect(page.getByLabel('Graph outcome',{exact:true})).toContainText('Awaiting outcome verification');
    await node('delivery').click();
    await expect(page.getByLabel('Selected execution step',{exact:true})).toContainText('Reviewed launch pack v1');

    // A new revision reuses task identities but cannot inherit previous success.
    const revisionGate=await armPhases(request,'analysis',['readiness','risk']);ownedGates.push(revisionGate);
    const first=(await snapshot(page)).execution;
    await page.getByRole('button',{name:'Update sources',exact:true}).click();
    const engineering=first.adaptive!.sourceHistory[0]!.sources.find(source=>source.id==='engineering')!;
    await page.getByLabel('Source 2 material',{exact:true}).fill(`${engineering.content}\n\nFictional update: Calendar acceptance passed; request a fresh launch decision.`);
    await page.getByRole('button',{name:'Save sources and replan',exact:true}).click();
    await expect(graph).toContainText('Source revision 2');
    await expect(node('readiness')).toHaveAttribute('data-state','running');
    await expect(node('risk')).toHaveAttribute('data-state','running');
    await expect(node('decision')).not.toHaveAttribute('data-state','succeeded');
    await expect(node('launch_pack')).not.toHaveAttribute('data-state','succeeded');
    await expect(node('delivery')).not.toHaveAttribute('data-state','succeeded');
    await releasePhase(request,revisionGate,'all');
    await expect(page.getByRole('button',{name:'Save decision and continue',exact:true})).toBeVisible({timeout:60_000});
    await decide(page,'broader_rollout','Controlled graph revision 2: keep the announcement unsent.');
    await page.getByLabel('Outcome verification',{exact:true}).fill('I reviewed both controlled source revisions, saved decisions and launch documents. This graph test uses fixture storage.');
    await page.getByRole('button',{name:'Verify and complete mission',exact:true}).click();
    await expect(page.getByLabel('Graph outcome',{exact:true})).toContainText('Mission verified');
    await expect(node('delivery')).toHaveAttribute('data-state','succeeded');
    await graph.screenshot({path:testInfo.outputPath('execution-graph-verified-desktop.png')});
    await page.setViewportSize({width:390,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await graph.screenshot({path:testInfo.outputPath('execution-graph-verified-sidepanel-width.png')});
    await page.reload();
    await expect(page.getByLabel('Graph outcome',{exact:true})).toContainText('Mission verified');
    const completed=(await snapshot(page)).execution;
    expect(completed.tasks.map(task=>task.id)).toEqual(first.tasks.map(task=>task.id));
    expect(completed.budget.agentRuns).toBe(4);
    for(const artifact of first.artifacts)expect(completed.artifacts.find(item=>item.id===artifact.id)?.content).toBe(artifact.content);
    await writeFile(testInfo.outputPath('execution-graph-browser-result.json'),JSON.stringify({evidence:'Controlled runner and fixture workspace; no real Strands SDK, model, or Ambiguous calls.',missionId:completed.missionId,sourceRevision:completed.adaptive?.sourceRevision,parallelBranchesObserved:true,joinObserved:true,keyboardSelection:true,reducedMotion:true,staleRefreshObserved:true,supersededFailureIgnored:true,supersededSnapshotIgnored:true,correlatedToolOutcomes:true,sourceResetObserved:true,viewports:[1440,390],status:completed.status,agentRuns:completed.budget.agentRuns,modelCalls:completed.adaptive?.budget.modelCalls,toolCalls:completed.adaptive?.budget.toolCalls,artifactCount:completed.artifacts.length},null,2));
  }finally{for(const read of delayedReads)await read.release();for(const gate of ownedGates)await releasePhase(request,gate,'all');}
});

test('controlled adaptive browser workflow versions decisions and sources, imports accepted evidence, and reopens verified work',async({page,context,request},testInfo)=>{
  test.skip(testInfo.project.name!=='adaptive-chromium','Use playwright.adaptive.config.ts for the isolated controlled harness.');
  await forwardBackend(context,request);
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',entry=>{if(entry.type()==='error')errors.push(entry.text());});
  await page.goto('/');
  await pair(page);
  await startSample(page);
  const initial=(await snapshot(page)).execution;
  expect(initial).toMatchObject({engine:'strands',mode:'fixture',modelMode:'live',modelProvider:'controlled-browser-test'});
  expect(initial.tasks.map(task=>task.status)).toEqual(['completed','waiting_human','queued']);
  expect(initial.adaptive?.sourceHistory[0]?.sources.every(source=>source.documentId&&source.fingerprint)).toBe(true);
  expect(initial.adaptive?.decision).toBeUndefined();
  expect(initial.adaptive?.pack).toBeUndefined();
  await page.locator('.adaptive-finding .adaptive-citations > summary').first().click();
  await expect(page.locator('.adaptive-finding blockquote').first()).toContainText(initial.adaptive!.sourceHistory[0]!.sources[0]!.content.slice(0,120));
  await page.locator('.adaptive-activity > summary').click();
  await expect(page.locator('.adaptive-activity')).toContainText('no live model call was made');
  await screenshot(page,testInfo,'adaptive-decision-desktop.png',1440);
  await screenshot(page,testInfo,'adaptive-decision-sidepanel-width.png',390);
  await page.setViewportSize({width:1440,height:1000});
  const firstConstraints='Keep this a 20-customer private beta with manual date entry. Do not publish the draft.';
  await decide(page,'private_beta',firstConstraints);
  const first=(await snapshot(page)).execution;
  expect(first.adaptive?.decision).toMatchObject({optionId:'private_beta',constraints:firstConstraints,sourceRevision:1});
  expect(first.adaptive?.pack?.value.brief).toContain(firstConstraints);
  expect(first.budget.agentRuns).toBe(2);
  const firstArtifacts=first.artifacts.map(artifact=>({id:artifact.id,content:artifact.content}));

  // Accepted evidence is retained independently; it must not change active sources until imported.
  await page.getByRole('button',{name:'Add note',exact:true}).click();
  await page.getByLabel('Title',{exact:true}).fill(reviewedTitle);
  await page.getByLabel('Excerpt',{exact:true}).fill(reviewedExcerpt);
  await page.getByLabel('Source URL',{exact:true}).fill(reviewedUrl);
  await page.getByRole('button',{name:'Send to Mission Control',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review captured context',exact:true})).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Execute',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.locator('.copilot-panel')).toHaveCount(0);
  const captured=await snapshot(page);
  expect(captured.mission.proposals).toHaveLength(0);
  const accepted=captured.mission.evidence.find(item=>item.title===reviewedTitle)!;
  expect(accepted).toMatchObject({excerpt:reviewedExcerpt,sourceUrl:reviewedUrl,captureMethod:'manual'});
  expect(captured.execution.adaptive?.sourceRevision).toBe(1);
  expect(captured.execution.budget.agentRuns).toBe(2);
  expect(captured.execution.adaptive?.sourceHistory[0]?.sources).toHaveLength(3);

  await page.getByRole('button',{name:'Update sources',exact:true}).click();
  const engineering=captured.execution.adaptive!.sourceHistory[0]!.sources.find(source=>source.id==='engineering')!;
  const revisedEngineering=`${engineering.content}\n\nFictional update: Calendar integration has now passed acceptance. The launch owner must review the broader rollout before proceeding.`;
  await page.getByLabel('Source 2 material',{exact:true}).fill(revisedEngineering);
  await page.getByRole('button',{name:'Import a saved browser excerpt',exact:true}).click();
  await page.getByLabel('Saved browser excerpt',{exact:true}).selectOption(accepted.id);
  await expect(page.locator('.adaptive-browser-preview .adaptive-source-content')).toHaveText(reviewedExcerpt);
  await expect(page.locator('.adaptive-browser-preview')).toContainText(accepted.id);
  await expect(page.locator('.adaptive-browser-preview a')).toHaveAttribute('href',reviewedUrl);
  await page.getByRole('button',{name:'Add reviewed excerpt',exact:true}).click();
  await expect(page.getByLabel('Source 4 material',{exact:true})).toHaveValue(reviewedExcerpt);
  await expect(page.getByLabel('Source 4 material',{exact:true})).toHaveAttribute('readonly','');
  expect((await snapshot(page)).execution.adaptive?.sourceRevision).toBe(1);
  await screenshot(page,testInfo,'adaptive-reviewed-source-import.png',1440);
  await page.getByRole('button',{name:'Save sources and replan',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save decision and continue',exact:true})).toBeVisible({timeout:60_000});
  await expect(page.getByRole('heading',{name:'Calendar readiness changed',exact:true})).toBeVisible();
  const secondAnalysis=(await snapshot(page)).execution;
  expect(secondAnalysis.adaptive?.sourceRevision).toBe(2);
  expect(secondAnalysis.adaptive?.sourceHistory).toHaveLength(2);
  expect(secondAnalysis.adaptive?.decision).toBeUndefined();
  expect(secondAnalysis.adaptive?.pack).toBeUndefined();
  expect(secondAnalysis.adaptive?.analysis?.version).not.toBe(initial.adaptive?.analysis?.version);
  expect(secondAnalysis.tasks.map(task=>task.id)).toEqual(initial.tasks.map(task=>task.id));
  expect(secondAnalysis.adaptive?.sourceHistory[0]?.sources.find(source=>source.id==='engineering')?.content).toBe(engineering.content);
  expect(secondAnalysis.adaptive?.sourceHistory[1]?.sources.find(source=>source.id==='engineering')?.content).toBe(revisedEngineering);
  expect(secondAnalysis.adaptive?.sourceHistory[1]?.sources.find(source=>source.evidenceId===accepted.id)).toMatchObject({title:accepted.title,content:accepted.excerpt,sourceUrl:accepted.sourceUrl,capturedAt:accepted.capturedAt,provenance:'browser'});
  await expect(page.locator('.adaptive-history > summary')).toBeVisible();
  await page.getByLabel('View source revision',{exact:true}).selectOption('1');
  await expect(page.locator('.adaptive-source-section')).toContainText('Initial reviewed sources.');
  await page.getByLabel('View source revision',{exact:true}).selectOption('2');
  await decide(page,'broader_rollout','Use the accepted calendar integration. Keep all announcements unsent for the owner review.');
  const second=(await snapshot(page)).execution;
  expect(second.budget.agentRuns).toBe(4);
  expect(second.adaptive?.pack?.sourceRevision).toBe(2);
  expect(second.adaptive?.pack?.value.changeSummary).toContain('imported owner excerpt');
  expect(second.artifacts.filter(artifact=>artifact.kind==='review')).toHaveLength(2);
  for(const artifact of firstArtifacts)expect(second.artifacts.find(item=>item.id===artifact.id)?.content).toBe(artifact.content);
  await page.locator('.adaptive-history > summary').click();
  const history=page.getByLabel('Historical execution artifacts');
  await expect(history.locator('.execution-artifact')).toHaveCount(firstArtifacts.length);
  await history.locator('.execution-artifact > summary').first().click();
  await expect(history.locator('.execution-artifact-content').first()).toBeVisible();
  await screenshot(page,testInfo,'adaptive-replanned-history-desktop.png',1440);

  await page.reload();
  await expect(page.getByRole('heading',{name:'Review the mission outcome',exact:true})).toBeVisible();
  const restored=(await snapshot(page)).execution;
  expect(restored.budget.agentRuns).toBe(4);
  expect(restored.artifacts.map(artifact=>artifact.id)).toEqual(second.artifacts.map(artifact=>artifact.id));
  expect(restored.adaptive?.decision?.optionId).toBe('broader_rollout');
  await page.getByLabel('Outcome verification',{exact:true}).fill('I verified both controlled fixture launch packs, the exact imported excerpt, source revisions, and fresh human decisions. This is controlled browser verification, not live model or Ambiguous acceptance.');
  await page.getByRole('button',{name:'Verify and complete mission',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Completed',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Update sources',exact:true})).toHaveCount(0);
  await screenshot(page,testInfo,'adaptive-completed-sidepanel-width.png',390);
  await page.getByRole('button',{name:'Reopen mission for changes',exact:true}).click();
  await expect(page.getByRole('button',{name:'Update sources',exact:true})).toBeVisible();
  const reopened=await snapshot(page);
  expect(reopened.execution.status).toBe('needs_review');
  expect(reopened.execution.outcomeVerification).toBeUndefined();
  expect(reopened.mission.criteria.every(criterion=>criterion.verificationState==='needs_verification')).toBe(true);
  expect(reopened.execution.budget.agentRuns).toBe(4);
  expect(reopened.execution.operations.every(operation=>operation.state==='done')).toBe(true);
  expect(errors).toEqual([]);
  await writeFile(testInfo.outputPath('adaptive-browser-result.json'),JSON.stringify({evidence:'Controlled browser verification; no live model, Strands SDK, or Ambiguous calls.',missionId:reopened.execution.missionId,sourceRevisions:reopened.execution.adaptive?.sourceHistory.map(revision=>revision.revision),agentRuns:reopened.execution.budget.agentRuns,taskIds:reopened.execution.tasks.map(task=>task.id),artifactCount:reopened.execution.artifacts.length,acceptedEvidenceId:accepted.id,importedExactMatch:true,viewports:[1440,390],finalStatus:reopened.execution.status,errors},null,2));
});

test('unpacked adaptive MV3 runtime preserves execution and accepted-source navigation at side-panel width',async({request},testInfo)=>{
  test.skip(testInfo.project.name!=='adaptive-chromium','Use playwright.adaptive.config.ts for the isolated controlled harness.');
  await assertControlledBackend(request);
  const extensionPath=resolve(process.cwd(),'apps/extension/dist');
  const manifest=JSON.parse(await readFile(join(extensionPath,'manifest.json'),'utf8'));
  expect(manifest.permissions).toContain('sidePanel');
  expect(manifest.permissions).not.toContain('tabs');
  const profile=await mkdtemp(join(tmpdir(),'mission-adaptive-extension-'));
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,viewport:{width:390,height:1000},args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
  try{
    await forwardBackend(context,request);
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
    const extensionId=new URL(worker.url()).host;
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    const page=await context.newPage();
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await pair(page);
    await startSample(page);
    const initial=(await snapshot(page)).execution;
    expect(initial.mode).toBe('fixture');
    expect(initial.adaptive?.sourceRevision).toBe(1);
    expect(await page.evaluate(async()=>Boolean((await chrome.storage.session.get('mission-control.session'))['mission-control.session']))).toBe(true);
    await expect(page.getByRole('button',{name:'Evidence',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Evidence',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Accepted evidence',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Start Live Assist',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Execute',exact:true}).click();
    await page.reload();
    await expect(page.getByRole('button',{name:'Save decision and continue',exact:true})).toBeVisible();
    expect((await snapshot(page)).execution.missionId).toBe(initial.missionId);
    await screenshot(page,testInfo,'adaptive-unpacked-extension-390px.png',390);
    expect(errors).toEqual([]);
    await writeFile(testInfo.outputPath('adaptive-extension-result.json'),JSON.stringify({evidence:'Unpacked MV3 extension page with live service worker at 390px. Native toolbar-triggered side-panel opening remains manual.',extensionId,missionId:initial.missionId,workspace:'fixture',runner:'controlled-browser-test',sidePanelPermission:true,sessionRestored:true,errors},null,2));
  }finally{await context.close();await rm(profile,{recursive:true,force:true});}
});

function nestedTarget(session:CDPSession,sessionId:string){
  let nextId=0;
  const waiting=new Map<number,{resolve:(value:any)=>void;reject:(reason:Error)=>void}>();
  session.on('Target.receivedMessageFromTarget',event=>{
    if(event.sessionId!==sessionId)return;
    const reply=JSON.parse(event.message);const pending=waiting.get(reply.id);
    if(!pending)return;waiting.delete(reply.id);
    if(reply.error)pending.reject(new Error(reply.error.message));else pending.resolve(reply.result);
  });
  return async(method:string,params:Record<string,unknown>={})=>{
    const id=++nextId;
    return new Promise<any>((resolve,reject)=>{
      waiting.set(id,{resolve,reject});
      void session.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(error=>{waiting.delete(id);reject(error);});
    });
  };
}

test('native headful Chrome side panel renders the adaptive decision and completes its human handoff',async({request},testInfo)=>{
  test.skip(testInfo.project.name!=='adaptive-chromium','Use playwright.adaptive.config.ts for the isolated controlled harness.');
  await assertControlledBackend(request);
  const extensionPath=resolve(process.cwd(),'apps/extension/dist');
  const profile=await mkdtemp(join(tmpdir(),'mission-adaptive-native-panel-'));
  let recording:Awaited<ReturnType<typeof startWindowRecording>>|undefined;
  let nativePhaseGate:string|undefined;
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:false,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,viewport:null,deviceScaleFactor:undefined,isMobile:undefined,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`,'--window-size=1440,1000']});
  try{
    await forwardBackend(context,request);
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
    const extensionId=new URL(worker.url()).host;
    const opener=await context.newPage();
    await opener.goto(`chrome-extension://${extensionId}/index.html`);
    await pair(opener);
    if(recordingPath){recording=await startWindowRecording(resolve(recordingPath));await demoPause(1800);}
    await startSample(opener);
    const initial=(await snapshot(opener)).execution;
    await demoPause(2500);
    const session=await context.newCDPSession(opener);
    const before=new Set((await session.send('Target.getTargets')).targetInfos.map(target=>target.targetId));
    const windowId=await opener.evaluate(async()=>{const window=await chrome.windows.getCurrent();if(window.id===undefined)throw new Error('Chrome window ID is unavailable.');return window.id;});
    // This temporary test control supplies a real click/user gesture to the native
    // API. It never changes the packaged extension or the user's browser profile.
    await opener.evaluate(windowId=>{
      const button=document.createElement('button');button.id='native-sidepanel-test-open';button.textContent='Open native side panel for verification';button.style.cssText='position:fixed;top:8px;right:8px;z-index:10000;padding:12px;background:white;color:black;border:2px solid black';
      button.onclick=()=>{void chrome.sidePanel.open({windowId}).then(()=>button.dataset.opened='true').catch(error=>button.dataset.error=String(error));};
      document.body.append(button);
    },windowId);
    await opener.locator('#native-sidepanel-test-open').click();
    await expect(opener.locator('#native-sidepanel-test-open')).toHaveAttribute('data-opened','true');
    await expect.poll(async()=>(await session.send('Target.getTargets')).targetInfos.filter(target=>!before.has(target.targetId)&&target.url===`chrome-extension://${extensionId}/index.html`).length,{timeout:15_000}).toBeGreaterThan(0);
    const targets=(await session.send('Target.getTargets')).targetInfos;
    const panelTarget=targets.find(target=>!before.has(target.targetId)&&target.url===`chrome-extension://${extensionId}/index.html`)!;
    await writeFile(testInfo.outputPath('native-sidepanel-targets.json'),JSON.stringify({windowId,panelTarget,targets},null,2));
    const {sessionId}=await session.send('Target.attachToTarget',{targetId:panelTarget.targetId,flatten:false});
    const send=nestedTarget(session,sessionId);
    const evaluate=async(expression:string)=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
    // Native panels are separate targets that Playwright does not auto-attach.
    // Forward their requests with CDP as well; never use a local live workspace.
    const networkErrors:string[]=[];
    session.on('Target.receivedMessageFromTarget',event=>{
      if(event.sessionId!==sessionId)return;
      const message=JSON.parse(event.message);
      if(message.method!=='Fetch.requestPaused')return;
      const paused=message.params;
      void (async()=>{
        const source=new URL(paused.request.url);
        if(source.origin!==frontendBackend||!source.pathname.startsWith('/api/')){await send('Fetch.failRequest',{requestId:paused.requestId,errorReason:'BlockedByClient'});return;}
        const response=await request.fetch(new URL(source.pathname+source.search,isolatedBackend).href,{method:paused.request.method,headers:paused.request.headers,...(paused.request.postData?{data:paused.request.postData}:{}),maxRedirects:0});
        const responseHeaders=Object.entries(response.headers()).filter(([name])=>!['content-length','content-encoding','transfer-encoding'].includes(name.toLowerCase())).map(([name,value])=>({name,value}));
        await send('Fetch.fulfillRequest',{requestId:paused.requestId,responseCode:response.status(),responseHeaders,body:(await response.body()).toString('base64')});
      })().catch(error=>{networkErrors.push(error instanceof Error?error.message:String(error));void send('Fetch.failRequest',{requestId:paused.requestId,errorReason:'Failed'}).catch(()=>{});});
    });
    await send('Fetch.enable',{patterns:[{urlPattern:`${frontendBackend}/*`,requestStage:'Request'}]});
    await send('Page.reload');
    await expect.poll(()=>evaluate('document.body.innerText'),{timeout:30_000}).toContain('A launch decision needs your judgment');
    await expect.poll(()=>evaluate('document.querySelector("[data-graph-node=decision]")?.getAttribute("data-state")')).toBe('waiting');
    expect(await evaluate(`document.querySelector('[aria-label="Execution graph"]')?.textContent`)).toContain('Source revision 1');
    const visible=await evaluate('({visibility:document.visibilityState,width:innerWidth,height:innerHeight,title:document.title,overflow:document.documentElement.scrollWidth>innerWidth})');
    expect(visible.visibility).toBe('visible');expect(visible.width).toBeGreaterThan(200);expect(visible.width).toBeLessThan(800);expect(visible.overflow).toBe(false);expect(visible.title).toBe('Mission Control');
    await demoPause(3000);
    const capture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(testInfo.outputPath('adaptive-native-sidepanel-decision.png'),Buffer.from(capture.data,'base64'));
    const click=async(selector:string)=>{
      const point=await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw new Error('Native panel control is unavailable.');element.scrollIntoView({block:'center'});const rect=element.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`);
      await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    };
    await click('.adaptive-option input[value="private_beta"]');
    await click('.adaptive-decision-form textarea');
    await send('Input.insertText',{text:'Native side-panel verification: keep the private beta and leave the announcement unsent.'});
    await demoPause(1800);
    await click('.adaptive-decision-form button[type="submit"]');
    await expect.poll(()=>evaluate('document.body.innerText'),{timeout:60_000}).toContain('What changed in the launch pack');
    await demoPause(3000);
    const first=(await snapshot(opener)).execution;
    expect(first.missionId).toBe(initial.missionId);expect(first.status).toBe('needs_review');expect(first.adaptive?.decision?.constraints).toContain('Native side-panel verification');
    await click('.adaptive-edit-action button');
    const engineering=initial.adaptive!.sourceHistory[0]!.sources.find(source=>source.id==='engineering')!;
    await click('.adaptive-source-card:nth-of-type(2) textarea');
    await evaluate('document.querySelector(".adaptive-source-card:nth-of-type(2) textarea").select()');
    await send('Input.insertText',{text:`${engineering.content}\n\nFictional native-panel update: Calendar integration has passed acceptance. The launch owner must select the new rollout scope.`});
    await demoPause(1800);
    nativePhaseGate=await armPhases(request,'analysis',['readiness','risk']);
    await click('.adaptive-source-form .execution-actions button[type="submit"]');
    await expect.poll(()=>evaluate('Array.from(document.querySelectorAll("[data-graph-node=readiness], [data-graph-node=risk]")).map(node=>node.getAttribute("data-state"))'),{timeout:60_000}).toEqual(['running','running']);
    expect(await evaluate(`document.querySelector('[aria-label="Execution graph"]')?.textContent`)).toContain('Source revision 2');
    expect(await evaluate('document.querySelector("[data-graph-node=launch_pack]")?.getAttribute("data-state")')).not.toBe('succeeded');
    await evaluate('document.querySelector("[data-graph-node=readiness]").scrollIntoView({block:"center"})');
    const parallelCapture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(testInfo.outputPath('execution-graph-native-parallel.png'),Buffer.from(parallelCapture.data,'base64'));
    await releasePhase(request,nativePhaseGate,'readiness');
    await expect.poll(()=>evaluate('document.querySelector("[data-graph-node=readiness]")?.getAttribute("data-state")')).toBe('succeeded');
    expect(await evaluate('document.querySelector("[data-graph-node=synthesis]")?.getAttribute("data-state")')).not.toBe('running');
    await releasePhase(request,nativePhaseGate,'risk');
    await expect.poll(()=>evaluate('document.body.innerText'),{timeout:60_000}).toContain('Calendar readiness changed');
    await demoPause(3000);
    const secondAnalysis=(await snapshot(opener)).execution;
    expect(secondAnalysis.adaptive?.sourceRevision).toBe(2);expect(secondAnalysis.adaptive?.decision).toBeUndefined();expect(secondAnalysis.adaptive?.pack).toBeUndefined();
    await click('.adaptive-option input[value="broader_rollout"]');
    await click('.adaptive-decision-form textarea');
    await send('Input.insertText',{text:'Native source revision 2: approve the broader rollout, with an unsent announcement for final review.'});
    await demoPause(1800);
    await click('.adaptive-decision-form button[type="submit"]');
    await expect.poll(()=>evaluate('document.body.innerText'),{timeout:60_000}).toContain('Revised pack incorporates');
    await demoPause(3000);
    const second=(await snapshot(opener)).execution;
    expect(second.status).toBe('needs_review');expect(second.adaptive?.pack?.sourceRevision).toBe(2);expect(second.budget.agentRuns).toBe(4);
    expect(second.artifacts.filter(artifact=>artifact.kind==='review')).toHaveLength(2);
    for(const old of first.artifacts)expect(second.artifacts.find(artifact=>artifact.id===old.id)?.content).toBe(old.content);
    await send('Page.reload');
    await expect.poll(()=>evaluate('document.body.innerText'),{timeout:30_000}).toContain('Revised pack incorporates');
    await demoPause(2200);
    expect((await snapshot(opener)).execution.budget.agentRuns).toBe(4);
    const finalArtifact=second.artifacts.find(artifact=>artifact.sourceRevision===2&&artifact.title==='Reviewed launch pack v2')!;
    expect(finalArtifact.id).toBeTruthy();expect(finalArtifact.verifiedAt).toBeTruthy();expect(finalArtifact.mode).toBe('fixture');
    await evaluate(`(()=>{const artifact=Array.from(document.querySelectorAll('[aria-label="Execution artifacts"] .execution-artifact')).find(item=>item.querySelector('.execution-artifact-title')?.textContent.includes('Reviewed launch pack v2'));if(!artifact)throw new Error('Current launch artifact is missing.');artifact.dataset.nativeTestFinal='true';})()`);
    await click('[data-native-test-final="true"] > summary');
    expect(await evaluate('document.querySelector("[data-native-test-final] .execution-artifact-content").textContent')).toContain('Native source revision 2');
    expect(await evaluate('document.querySelector("[data-native-test-final] .execution-artifact-meta").textContent')).toContain(finalArtifact.id);
    const artifactCapture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(testInfo.outputPath('adaptive-native-sidepanel-final-artifact.png'),Buffer.from(artifactCapture.data,'base64'));
    await demoPause(3200);
    await click('textarea[minlength="10"]');
    await send('Input.insertText',{text:'I verified both controlled source revisions, the fresh owner decisions, and the saved launch pack from the native Chrome side panel. External live delivery remains separate.'});
    await click('.execution-overview form button[type="submit"]');
    await expect.poll(()=>evaluate('document.querySelector(".execution-overview h2")?.textContent'),{timeout:30_000}).toBe('Completed');
    await expect.poll(()=>evaluate(`document.querySelector('[aria-label="Graph outcome"]')?.textContent`)).toContain('Mission verified');
    await demoPause(2800);
    const completed=(await snapshot(opener)).execution;
    expect(completed.status).toBe('completed');expect(completed.adaptive?.sourceRevision).toBe(2);expect(completed.budget.agentRuns).toBe(4);expect(completed.outcomeVerification).toBeTruthy();
    expect(networkErrors).toEqual([]);
    await evaluate('scrollTo(0,0)');
    const finalCapture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(testInfo.outputPath('adaptive-native-sidepanel-reviewed.png'),Buffer.from(finalCapture.data,'base64'));
    await writeFile(testInfo.outputPath('adaptive-native-sidepanel-result.json'),JSON.stringify({evidence:'Native headful Chrome side panel opened through chrome.sidePanel.open after a real user gesture; controlled runner and fixture storage.',windowId,targetType:panelTarget.type,targetId:panelTarget.targetId,url:panelTarget.url,visible,missionId:completed.missionId,sourceRevisions:completed.adaptive?.sourceHistory.map(revision=>revision.revision),decisionsSaved:2,agentRuns:completed.budget.agentRuns,finalArtifactId:finalArtifact.id,reloadedWithoutDuplicateRuns:true,graphParallelBranchesObserved:true,graphJoinObserved:true,graphVerified:true,status:completed.status,liveModelCalls:false,liveAmbiguousCalls:false},null,2));
  }finally{if(nativePhaseGate)await releasePhase(request,nativePhaseGate,'all');if(recording)await recording.stop();await context.close();await rm(profile,{recursive:true,force:true});}
});
