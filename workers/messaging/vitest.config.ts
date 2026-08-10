import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: {
    'cloudflare:workers': fileURLToPath(new URL('./src/test-cloudflare-workers.ts', import.meta.url)),
  } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
  },
});
