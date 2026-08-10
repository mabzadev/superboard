import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { exportJWK, generateKeyPair } from "jose";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const workerRoot = fileURLToPath(new URL(".", import.meta.url));
const referenceProject = JSON.parse(
  readFileSync(new URL("../../superboard.project.json", import.meta.url), "utf8"),
);
const referenceTarget = String(referenceProject.development.target);

export default defineConfig({
  root: workerRoot,
  plugins: [
    cloudflareTest(async () => ({
      wrangler: {
        configPath: fileURLToPath(
          new URL(
            `../../deploy/generated/${referenceTarget}-billing-development.jsonc`,
            import.meta.url,
          ),
        ),
      },
      miniflare: {
        bindings: {
          APPLE_ROOT_CERTIFICATES_B64: "runtime-test-roots",
          INTERNAL_API_TOKEN: "billing-runtime-internal-token",
          OPENGROW_ENTITLEMENT_WEBHOOK_SECRET: "runtime-test-webhook-secret",
          PURCHASES_SIGNING_KEYSET: await runtimeSigningKeySet(),
          STORE_CREDENTIALS_ACTIVE_KEY_VERSION: "billing-runtime-v1",
          STORE_CREDENTIALS_ENCRYPTION_KEYS: JSON.stringify({
            "billing-runtime-v1": "runtime-test-key-material",
          }),
          TEST_MIGRATIONS: await readD1Migrations(
            fileURLToPath(new URL("../api/migrations", import.meta.url)),
          ),
        },
      },
    })),
  ],
  test: {
    include: ["runtime-tests/**/*.test.ts"],
    setupFiles: ["./runtime-tests/apply-migrations.ts"],
  },
});

async function runtimeSigningKeySet(): Promise<string> {
  const kid = "billing-runtime-es256";
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const key = await exportJWK(privateKey);
  return JSON.stringify({
    active_kid: kid,
    keys: [{ ...key, alg: "ES256", kid, key_ops: ["sign"], use: "sig" }],
  });
}
