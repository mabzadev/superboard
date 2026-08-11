import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const workerRoot = fileURLToPath(new URL('.', import.meta.url));
const runtimeConfigPath = process.env.OPENGROW_LEGACY_MESSAGING_CONFIG;
if (!runtimeConfigPath) {
  throw new Error(
    'OPENGROW_LEGACY_MESSAGING_CONFIG must select a generated target config',
  );
}

export default defineConfig({
  root: workerRoot,
  plugins: [
    cloudflareTest(async () => ({
      wrangler: {
        configPath: runtimeConfigPath,
      },
      miniflare: {
        bindings: {
          INTERNAL_API_TOKEN: 'runtime-test-internal-token',
          TEST_MIGRATIONS: await readD1Migrations(
            fileURLToPath(new URL('./migrations', import.meta.url)),
          ),
        },
      },
    })),
  ],
  test: {
    include: ['runtime-tests/**/*.test.ts'],
    setupFiles: ['./runtime-tests/apply-migrations.ts'],
  },
});
