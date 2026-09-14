import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

export function createHostedConfig(publicDemoBuild=process.env.VITE_PUBLIC_DEMO_BUILD==='true'){
  const publicDemoCopilot=fileURLToPath(new URL('./src/public-demo-copilot.tsx',import.meta.url));
  return {
    plugins:[react()],
    base:'./',
    // Hosted HTML is served by the API process. Pin calls to that same origin so
    // a developer's local VITE_MISSIONDECK_BACKEND cannot leak into this bundle.
    define:{'import.meta.env.VITE_MISSIONDECK_BACKEND':JSON.stringify('.')},
    // Anonymous sessions cannot reach chat. Only the explicitly public build
    // swaps those imports; private-hosted and extension builds keep CopilotKit.
    ...(publicDemoBuild?{resolve:{alias:[
      {find:/^@copilotkit\/react-core\/v2$/,replacement:publicDemoCopilot},
      {find:/^\.\/components\/Copilot$/,replacement:publicDemoCopilot},
    ]}}:{}),
    // Keep the browser-only bundle separate from the unpacked MV3 extension.
    // Vite empties its output directory before building, so sharing `dist`
    // silently removed background.js and made extension verification hang.
    build:{target:'es2022',sourcemap:false,outDir:'dist-hosted'},
  };
}

export default defineConfig(createHostedConfig());
