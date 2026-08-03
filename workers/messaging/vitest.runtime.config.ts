import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const workerRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: workerRoot,
  plugins: [
    cloudflareTest(async () => ({
      wrangler: {
        configPath: fileURLToPath(new URL('../../deploy/generated/vocostar-messaging-production.jsonc', import.meta.url)),
      },
      miniflare: {
        bindings: {
          INTERNAL_API_TOKEN: 'runtime-test-internal-token',
          TEST_MIGRATIONS: await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url))),
        },
      },
    })),
  ],
  test: {
    include: ['runtime-tests/**/*.test.ts'],
    setupFiles: ['./runtime-tests/apply-migrations.ts'],
  },
});
