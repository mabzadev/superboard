import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import { d1RuntimeBindings } from "../../scripts/cloudflare-vitest-d1.mjs";
import { buildFreshInstancePlan } from "../../scripts/superboard-fresh-instance-proof.mjs";

const healthWorkers = [
	"identity",
	"app",
	"products",
	"api",
	"support",
	"flows",
	"analytics",
	"marketing",
	"email",
	"dynamic-links",
	"files",
	"paywalls",
	"onboardings",
];
const healthMigrations = Object.fromEntries(
	await Promise.all(
		healthWorkers.map(async (name) => [
			name,
			await readD1Migrations(
				fileURLToPath(new URL(`../../workers/${name}/migrations`, import.meta.url)),
			),
		]),
	),
);

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
					d1Databases: {
						DB: "site-runtime",
						...Object.fromEntries(
							healthWorkers.map((name) => [
								`HEALTH_${name.replaceAll("-", "_").toUpperCase()}_DB`,
								`health-${name}`,
							]),
						),
					},
					r2Buckets: ["HEALTH_FILES_R2"],
					serviceBindings: {
						SITE_SERVICE: { name: "superboard-site-runtime-test" },
						WORKFLOW_API_SERVICE: {
							name: "superboard-site-runtime-test",
							entrypoint: "WorkflowLifecycleApi",
						},
						API_SERVICE: { name: "superboard-site-runtime-test", entrypoint: "LifecycleApi" },
					},
					bindings: {
						SITE_OPERATOR_BRIDGE_TOKEN: "runtime-site-operator-health-secret",
						HEALTH_IDENTITY_KEYSET: JSON.stringify({
							active_kid: "autonomy-identity",
							keys: [{ ...privateJwk, kid: "autonomy-identity", alg: "ES256" }],
						}),
						HEALTH_MIGRATIONS_JSON: JSON.stringify(healthMigrations),
						FRESH_INSTANCE_PLAN_JSON: JSON.stringify(
							await buildFreshInstancePlan("mbza-development"),
						),
						PARITY_VERIFIED_PROOF_RECEIPTS:
							process.env.SUPERBOARD_VERIFIED_PROOF_RECEIPTS ??
							JSON.stringify({ complete: false, proofs: {} }),
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
		maxWorkers: 3,
		testTimeout: 30000,
		hookTimeout: 60000,
	},
});
