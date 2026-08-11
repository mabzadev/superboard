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
            INTERNAL_API_TOKEN: "marketing-runtime-secret",
            EMAIL_INTERNAL_TOKEN: "marketing-runtime-email-secret",
            SMTP_ENCRYPTION_KEY: "marketing-encryption-secret",
            TRACKING_SIGNING_KEY: "marketing-tracking-secret",
            ...d1RuntimeBindings(migrations),
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
