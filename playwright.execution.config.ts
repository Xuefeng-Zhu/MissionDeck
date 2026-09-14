import {defineConfig,devices} from '@playwright/test';
import {existsSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const temporaryRoot=existsSync('/private/tmp')?'/private/tmp':tmpdir();
const runDirectory=mkdtempSync(join(temporaryRoot,'missiondeck-execution-browser-'));
const frontendPort=process.env.MISSIONDECK_EXECUTION_TEST_PORT??'5173';
if(!/^\d{4,5}$/.test(frontendPort)||Number(frontendPort)>65535)throw new Error('Choose a valid local execution-test port.');
const frontendUrl=`http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir:'./tests/browser',
  testMatch:'execution.spec.ts',
  fullyParallel:false,
  workers:1,
  timeout:180_000,
  expect:{timeout:15_000},
  outputDir:join(runDirectory,'test-results'),
  reporter:[['list']],
  use:{
    baseURL:frontendUrl,
    trace:'off',
    screenshot:'only-on-failure',
    launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE},
  },
  projects:[{name:'execution-chromium',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}}],
  webServer:[
    {
      command:'node --import tsx apps/server/src/index.ts',
      url:'http://127.0.0.1:4321/health',
      reuseExistingServer:!process.env.CI,
      timeout:120_000,
      env:{
        PORT:'4321',
        PROVIDER_MODE:'fixture',
        MODEL_MODE:'fixture',
        DATABASE_MODE:'pglite',
        DATA_DIR:join(runDirectory,'data'),
        PAIRING_CODE:'execution-demo-fixture-code',
        ALLOWED_ORIGINS:`${frontendUrl},http://localhost:${frontendPort}`,
        WORKSPACE_UPGRADE_ENABLED:'true',
      },
    },
    {
      command:`../../node_modules/.bin/vite --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      cwd:resolve(process.cwd(),'apps/extension'),
      url:frontendUrl,
      reuseExistingServer:!process.env.CI,
      timeout:120_000,
    },
  ],
});
