import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

const migrationsPath = fileURLToPath(new URL("./migrations", import.meta.url));
const migrations = await readD1Migrations(migrationsPath);

export default centralTests(
	import.meta.url,
	defineConfig({
		plugins: [
			cloudflareTest({
				wrangler: { configPath: "./wrangler.jsonc" },
				miniflare: {
					bindings: {
						TEST_MIGRATIONS: migrations,
						ADMIN_TOKEN: "test-admin-token",
						LISTING_POLICY_MODE: "open",
						LISTING_ALLOWLIST: "[]",
						LISTING_MODERATION_POLICY: "",
					},
				},
			}),
		],
	}),
);
