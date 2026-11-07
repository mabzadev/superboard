import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import { d1RuntimeBindings } from "../../../../scripts/cloudflare/vitest-d1.mjs";
import { centralTests } from "../../../../tests/checks/project-config.mjs";

const JWKS_URL = "https://sdk.example.test/v1/auth/.well-known/application-jwks.json";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const signingKey = { ...privateKey.export({ format: "jwk" }), kid: "data-runtime", alg: "ES256" };
const verificationKey = {
	...publicKey.export({ format: "jwk" }),
	kid: "data-runtime",
	alg: "ES256",
	use: "sig",
};

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
							FILES_INTERNAL_TOKEN: "data-runtime-internal-token",
							FILES_DOWNLOAD_SIGNING_KEY: "data-runtime-signing-key-with-enough-entropy",
							DATA_ENCRYPTION_KEY: "data-runtime-encryption-key-with-32-characters",
							TEST_SIGNING_JWK: JSON.stringify(signingKey),
							...d1RuntimeBindings(migrations),
						},
						outboundService: (request: Request) =>
							request.url === JWKS_URL
								? Response.json({ keys: [verificationKey] })
								: new Response("Outbound requests are disabled in tests", { status: 503 }),
					},
				};
			}),
		],
		test: {
			include: ["../../../../tests/checks/plugins/superboard-data/worker/runtime/**/*.test.ts"],
			setupFiles: [
				"../../../../tests/checks/plugins/superboard-data/worker/runtime/apply-migrations.ts",
			],
		},
	}),
);
