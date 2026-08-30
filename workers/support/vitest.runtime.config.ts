import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { d1RuntimeBindings } from "../../scripts/cloudflare-vitest-d1.mjs";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        fileURLToPath(new URL("./migrations", import.meta.url)),
      );
      return {
        wrangler: {
          configPath: fileURLToPath(
            new URL("./wrangler.test.jsonc", import.meta.url),
          ),
        },
        miniflare: {
          bindings: {
            INTERNAL_API_TOKEN: "support-runtime-secret",
            ALLOWED_PROJECT_IDS: "12",
            SUPPORT_WEBHOOK_ENCRYPTION_KEY:
              "support-runtime-webhook-encryption-key",
            SUPPORT_CREDENTIAL_ENCRYPTION_KEY:
              "support-runtime-credential-encryption-key",
            ...d1RuntimeBindings(migrations),
          },
          queueProducers: {
            SUPPORT_AI_QUEUE: { queueName: "support-test-ai" },
            SUPPORT_BULK_QUEUE: { queueName: "support-test-bulk" },
          },
        },
      };
    }),
  ],
  test: {
    include: ["runtime-tests/**/*.test.ts"],
    setupFiles: ["./runtime-tests/apply-migrations.ts"],
  },
});
