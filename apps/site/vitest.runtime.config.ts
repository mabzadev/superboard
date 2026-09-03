import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import { d1RuntimeBindings } from "../../scripts/cloudflare-vitest-d1.mjs";

const parityRelease = JSON.parse(
	readFileSync(new URL("../../config/superboard-parity-release.json", import.meta.url), "utf8"),
);

export default defineConfig({
	plugins: [
		cloudflareTest(async () => {
			const releaseKeys = await crypto.subtle.generateKey(
				{ name: "ECDSA", namedCurve: "P-256" },
				true,
				["sign", "verify"],
			);
			const privateJwk = await crypto.subtle.exportKey("jwk", releaseKeys.privateKey);
			return {
				wrangler: {
					configPath: fileURLToPath(new URL("./wrangler.test.jsonc", import.meta.url)),
				},
				miniflare: {
					compatibilityDate: "2026-08-08",
					bindings: {
						SUPERBOARD_INSTANCE_ID: "vocostar",
						SUPERBOARD_ENVIRONMENT: "local",
						SUPERBOARD_PLUGIN_IDS: JSON.stringify(parityRelease.active_plugin_ids),
						SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
						SUPERBOARD_RELEASE_OPERATIONS: "enabled",
						SUPERBOARD_RELEASE_PRIVATE_JWK: JSON.stringify({
							...privateJwk,
							kid: "site-runtime-parity",
							alg: "ES256",
							key_ops: ["sign"],
							ext: true,
						}),
						TARGET_ARTIFACT_CHECKSUM: parityRelease.target_artifact_checksum,
						...d1RuntimeBindings(
							await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url))),
						),
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
