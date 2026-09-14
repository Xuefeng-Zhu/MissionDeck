import {defineConfig,devices} from '@playwright/test';
import {existsSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const temporaryRoot=existsSync('/private/tmp')?'/private/tmp':tmpdir();
const runDirectory=mkdtempSync(join(temporaryRoot,'missiondeck-adaptive-browser-'));
export default defineConfig({
  testDir:'./tests/browser',testMatch:'adaptive.spec.ts',fullyParallel:false,workers:1,timeout:180_000,expect:{timeout:15_000},
  outputDir:join(runDirectory,'test-results'),reporter:[['list']],
  use:{baseURL:'http://127.0.0.1:5176',trace:'off',screenshot:'only-on-failure',launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}},
  projects:[{name:'adaptive-chromium',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}}],
  webServer:[
    {command:'node --import tsx tests/browser/adaptive-server.mts',url:'http://127.0.0.1:4333/__adaptive_test__',reuseExistingServer:false,timeout:120_000,env:{PORT:'4333',PROVIDER_MODE:'fixture',MODEL_MODE:'fixture',DATABASE_MODE:'pglite',DATA_DIR:join(runDirectory,'data'),ALLOWED_ORIGINS:'http://127.0.0.1:5176',WORKSPACE_UPGRADE_ENABLED:'true'}},
    {command:'../../node_modules/.bin/vite --host 127.0.0.1 --port 5176 --strictPort',cwd:resolve(process.cwd(),'apps/extension'),url:'http://127.0.0.1:5176',reuseExistingServer:false,timeout:120_000},
  ],
});
