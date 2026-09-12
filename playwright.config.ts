import {defineConfig,devices} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({
  testDir:'./tests/browser',fullyParallel:false,workers:1,timeout:120_000,expect:{timeout:15_000},
  use:{baseURL:'http://127.0.0.1:5173',trace:'off',screenshot:'only-on-failure',viewport:{width:1440,height:1000},launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}},
  reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report'}]],
  projects:[{name:'chromium',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}}],
  webServer:[
    {command:'./node_modules/.bin/tsx apps/server/src/index.ts',url:'http://127.0.0.1:4318/health',reuseExistingServer:!process.env.CI,timeout:120_000,env:{PROVIDER_MODE:'fixture',MODEL_MODE:'fixture'}},
    {command:'../../node_modules/.bin/vite --host 127.0.0.1 --port 5173',cwd:resolve(process.cwd(),'apps/extension'),url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI,timeout:120_000},
  ],
});
