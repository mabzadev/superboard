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
          configPath: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
        },
        miniflare: {
          bindings: {
            INTERNAL_API_TOKEN: "flows-runtime-secret",
            FLOW_USER_ENCRYPTION_KEY: "flows-runtime-encryption-key",
            FLOW_USER_HASH_KEY: "flows-runtime-hash-key",
            ...d1RuntimeBindings(migrations),
          },
          serviceBindings: {
            PRODUCTS_MODULE: async () => Response.json({ data: null }),
          },
        },
      };
    }),
  ],
  test: {
    include: ["runtime-tests/**/*.test.ts"],
    setupFiles: ["./runtime-tests/apply-migrations.ts"],
    sequence: { concurrent: false },
  },
});
