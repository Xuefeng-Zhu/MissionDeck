import {describe,expect,it} from 'vitest';
import hostedConfig,{createHostedConfig} from '../vite.hosted.config';

describe('hosted browser bundle',()=>{
  it('retains the real CopilotKit client for private hosted deployments',()=>{
    expect(hostedConfig.resolve?.alias).toBeUndefined();
    expect(hostedConfig.define?.['import.meta.env.VITE_MISSIONDECK_BACKEND']).toBe(JSON.stringify('.'));
    expect(hostedConfig.build?.outDir).toBe('dist-hosted');
  });

  it('removes chat-only dependencies from the explicit public demo build',()=>{
    const aliases=createHostedConfig(true).resolve?.alias;
    expect(aliases).toHaveLength(2);
    expect(String(aliases?.[0]?.find)).toContain('@copilotkit\\/react-core\\/v2');
    expect(String(aliases?.[1]?.find)).toContain('components\\/Copilot');
    expect(aliases?.every(alias=>alias.replacement.endsWith('public-demo-copilot.tsx'))).toBe(true);
  });
});
