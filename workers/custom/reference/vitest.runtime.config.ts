import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { d1RuntimeBindings } from "../../../scripts/cloudflare-vitest-d1.mjs";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here("."),
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(here("./migrations"));
      return {
        wrangler: { configPath: here("./wrangler.jsonc") },
        miniflare: {
          bindings: {
            CUSTOM_WORKER_TOKEN: "custom-runtime-secret",
            ...d1RuntimeBindings(migrations),
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
