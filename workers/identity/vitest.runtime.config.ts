import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { exportJWK, generateKeyPair } from "jose";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { d1RuntimeBindings } from "../../scripts/cloudflare-vitest-d1.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [
    cloudflareTest(async () => {
      const pair = await generateKeyPair("ES256", { extractable: true });
      const key = await exportJWK(pair.privateKey);
      key.kid = "runtime-identity-key";
      const migrations = await readD1Migrations(
        fileURLToPath(new URL("./migrations", import.meta.url)),
      );
      return {
        wrangler: {
          configPath: fileURLToPath(
            new URL("./wrangler.jsonc", import.meta.url),
          ),
        },
        miniflare: {
          bindings: {
            IDENTITY_KEYSET: JSON.stringify({
              active_kid: key.kid,
              keys: [key],
            }),
            INTERNAL_API_TOKEN: "identity-runtime-internal-token",
            EMAIL_INTERNAL_TOKEN: "email-runtime-token",
            FILES_INTERNAL_TOKEN: "files-runtime-token",
            ...d1RuntimeBindings(migrations),
          },
          serviceBindings: {
            FILES_SERVICE: () =>
              Response.json({ data: { erased: true, files_deleted: 0 } }),
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
