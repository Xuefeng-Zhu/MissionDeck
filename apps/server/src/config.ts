import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
dotenv({ path: resolve(repoRoot, '.env'), quiet: true });
process.env.COPILOTKIT_TELEMETRY_DISABLED ??= 'true';
const envSchema = z.object({
  PROVIDER_MODE: z.enum(['fixture', 'live']).default('fixture'), MODEL_MODE: z.enum(['fixture', 'live']).default('fixture'),
  DATABASE_MODE: z.enum(['pglite', 'postgres']).default('pglite'), DATA_DIR: z.string().default('.data'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(4318), DATABASE_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(), OPENAI_MODEL: z.string().default('gpt-5-mini'),
  AMBIGUOUS_API_KEY: z.string().optional(), AMBIGUOUS_EXPECTED_USER_ID: z.string().optional(), AMBIGUOUS_EXPECTED_WORKSPACE_ID: z.string().optional(),
  PAIRING_CODE: z.string().optional(), ALLOWED_ORIGINS: z.string().default('http://127.0.0.1:5173,http://localhost:5173'), DEMO_NOW: z.string().datetime().optional(),
});
const env = envSchema.parse(process.env);
export const config = { ...env, dataDir: resolve(repoRoot, env.DATA_DIR), origins: env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) };
