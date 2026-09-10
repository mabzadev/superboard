import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import { d1RuntimeBindings } from "../../../../scripts/cloudflare/vitest-d1.mjs";
import { centralTests } from "../../../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		root: import.meta.dirname,
		plugins: [
			cloudflareTest(async () => {
				const migrations = await readD1Migrations(
					fileURLToPath(new URL("./migrations", import.meta.url)),
				);
				return {
					wrangler: {
						configPath: fileURLToPath(new URL("./wrangler.test.jsonc", import.meta.url)),
					},
					miniflare: {
						bindings: {
							INTERNAL_API_TOKEN: "marketing-runtime-secret",
							EMAIL_INTERNAL_TOKEN: "marketing-runtime-email-secret",
							SMTP_ENCRYPTION_KEY: "marketing-encryption-secret",
							TRACKING_SIGNING_KEY: "marketing-tracking-secret",
							ANALYTICS_ID_HASH_KEY: "marketing-runtime-hash-key",
							...d1RuntimeBindings(migrations),
						},
					},
				};
			}),
		],
		test: {
			include: [
				"../../../../tests/checks/plugins/supbrd-plug-communication/marketing/runtime/**/*.test.ts",
			],
			setupFiles: [
				"../../../../tests/checks/plugins/supbrd-plug-communication/marketing/runtime/apply-migrations.ts",
			],
		},
	}),
);
