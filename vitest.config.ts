import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@mission/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)) } },
  test: { include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/**/*.test.ts'], exclude: ['**/node_modules/**','**/dist/**','tests/browser/**'], testTimeout: 20000, hookTimeout: 30000 }
});
