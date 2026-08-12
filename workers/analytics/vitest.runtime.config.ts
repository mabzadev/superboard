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
            INTERNAL_API_TOKEN: "analytics-runtime-secret",
            ANALYTICS_ID_HASH_KEY: "analytics-runtime-hash-key",
            ...d1RuntimeBindings(migrations),
          },
          serviceBindings: {
            MARKETING_MODULE: async () =>
              Response.json({ data: { duplicate: false, matched_journeys: 0 } }, { status: 202 }),
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
