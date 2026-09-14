import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
dotenv({ path: resolve(repoRoot, '.env'), quiet: true });
process.env.COPILOTKIT_TELEMETRY_DISABLED ??= 'true';
const envSchema = z.object({
  DEPLOYMENT_MODE:z.enum(['local','hosted']).default('local'),
  WORKSPACE_UPGRADE_ENABLED:z.enum(['true','false']).default('true').transform(v=>v==='true'),
  PROVIDER_MODE: z.enum(['fixture', 'live']).default('fixture'), MODEL_MODE: z.enum(['fixture', 'live']).default('fixture'),
  DATABASE_MODE: z.enum(['pglite', 'postgres']).default('pglite'), DATA_DIR: z.string().default('.data'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(4318), DATABASE_URL: z.string().optional(),
  SERVER_HOST:z.preprocess(v=>v===''?undefined:v,z.string().trim().min(1).optional()),
  PUBLIC_DEMO_ENABLED:z.enum(['true','false']).default('false').transform(v=>v==='true'),
  PUBLIC_DEMO_MAX_MISSIONS:z.coerce.number().int().min(1).max(5).default(1),
  PUBLIC_DEMO_MAX_CONCURRENT:z.coerce.number().int().min(1).max(20).default(4),
  PUBLIC_DEMO_SESSION_LIMIT:z.coerce.number().int().min(1).max(20).default(3),
  PUBLIC_DEMO_MAX_SOURCE_REVISIONS:z.coerce.number().int().min(1).max(3).default(2),
  PUBLIC_DEMO_MAX_MODEL_CALLS:z.coerce.number().int().min(5).max(40).default(20),
  PUBLIC_DEMO_DAILY_MODEL_LIMIT:z.coerce.number().int().min(10).max(5000).default(200),
  MODEL_PROVIDER: z.enum(['bedrock', 'openrouter', 'openai']).default('bedrock'),
  AWS_REGION: z.preprocess(v=>v===''?undefined:v,z.string().trim().min(1).optional()), AWS_DEFAULT_REGION: z.preprocess(v=>v===''?undefined:v,z.string().trim().min(1).optional()),
  BEDROCK_MODEL_ID: z.string().trim().min(1).default('us.openai.gpt-5.6-luna'),
  OPENROUTER_API_KEY: z.string().optional(), OPENROUTER_MODEL: z.string().trim().min(1).default('openai/gpt-5.6-luna'),
  OPENAI_API_KEY: z.string().optional(), OPENAI_MODEL: z.string().default('gpt-5-mini'),
  AMBIGUOUS_API_KEY: z.string().optional(), AMBIGUOUS_EXPECTED_USER_ID: z.string().optional(), AMBIGUOUS_EXPECTED_WORKSPACE_ID: z.string().optional(),
  PAIRING_CODE: z.string().optional(), ALLOWED_ORIGINS: z.string().default('http://127.0.0.1:5173,http://localhost:5173'), DEMO_NOW: z.string().datetime().optional(),
});
const env = envSchema.parse(process.env);
export const config = {
  ...env,
  host:env.SERVER_HOST??(env.DEPLOYMENT_MODE==='hosted'?'0.0.0.0':'127.0.0.1'),
  dataDir: resolve(repoRoot, env.DATA_DIR),
  origins: env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
};

export function assertRuntimeConfig(runtime=config):void {
  if(runtime.DEPLOYMENT_MODE==='local'&&!['127.0.0.1','localhost','::1'].includes(runtime.host))
    throw new Error('Local mode must bind to a loopback host. Use DEPLOYMENT_MODE=hosted for a network listener.');
  if(runtime.DEPLOYMENT_MODE==='hosted'&&runtime.DATABASE_MODE!=='postgres')
    throw new Error('Hosted mode requires DATABASE_MODE=postgres; PGlite is only supported for durable local use and tests.');
  if(runtime.PUBLIC_DEMO_ENABLED&&runtime.DEPLOYMENT_MODE!=='hosted')
    throw new Error('PUBLIC_DEMO_ENABLED is available only in hosted mode.');
  if(runtime.PUBLIC_DEMO_ENABLED&&runtime.PROVIDER_MODE!=='fixture')
    throw new Error('The public demo must use PROVIDER_MODE=fixture so anonymous sessions cannot write to an external workspace.');
}
