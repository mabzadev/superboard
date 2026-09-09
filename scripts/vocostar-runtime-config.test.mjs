import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { test } from "node:test";

import { secretCoordinationPlan } from "./cloudflare-secret-inventory.mjs";
import { loadTarget } from "./cloudflare-target.mjs";
import { compileTarget, assertTargetServiceConfiguration } from "./target-compiler.mjs";

test("generated Vocostar configuration retains external namespaces and coordinates existing credentials", async () => {
	const path = "deploy/generated/vocostar-custom-production-bridge-test.jsonc";
	try {
		execFileSync(
			process.execPath,
			[
				"scripts/cloudflare-config.mjs",
				"--target",
				"vocostar",
				"--environment",
				"production",
				"--service",
				"custom",
				"--allow-unprovisioned",
				"--preflight",
				"--output-suffix",
				"bridge-test",
			],
			{ stdio: "pipe" },
		);
		const config = JSON.parse(await readFile(path, "utf8"));
		const { target } = await loadTarget("vocostar");
		const compiled = await compileTarget(target, "production");
		assertTargetServiceConfiguration(compiled, "custom", config, {
			routesEnabled: false,
			preflight: true,
		});
		assert.equal(config.migrations, undefined);
		assert.equal(
			config.secrets.required.includes("VOCOSTAR_INTERNAL_CALLBACK_TOKEN_PREVIOUS"),
			false,
		);
		assert.equal(config.secrets.required.includes("VOCOSTAR_LEGACY_JWT_SECRET_PREVIOUS"), false);
		assert.equal(config.durable_objects.bindings[0].script_name, "api-auth-gateway");
		const changedNamespace = structuredClone(config);
		changedNamespace.durable_objects.bindings[0].script_name = "fresh-empty-gateway";
		assert.throws(
			() =>
				assertTargetServiceConfiguration(compiled, "custom", changedNamespace, {
					routesEnabled: false,
					preflight: true,
				}),
			/must retain its external owner/u,
		);
		const coordination = secretCoordinationPlan(target, "production");
		const callbacks = coordination.contracts.find(
			({ id }) => id === "managed-worker-gateway-callback-token",
		);
		assert.ok(
			callbacks.members.some(
				({ service, name }) => service === "custom" && name === "VOCOSTAR_INTERNAL_CALLBACK_TOKEN",
			),
		);
		const jwt = coordination.contracts.find(({ id }) => id === "vocostar-legacy-identity-token");
		assert.deepEqual(jwt.externalPeers, ["api-auth-gateway/JWT_SECRET"]);
		target.customWorker.runtimeBridge.gatewayWorker = target.workers.api.production;
		const afterRoutingChange = secretCoordinationPlan(target, "production").contracts.find(
			({ id }) => id === "managed-worker-gateway-callback-token",
		);
		assert.deepEqual(afterRoutingChange.externalPeers, [
			"api-auth-gateway/INTERNAL_CALLBACK_TOKEN",
		]);
		assert.equal(target.customWorker.runtimeBridge.deploymentStatus, "blocked");
	} finally {
		await rm(path, { force: true });
	}
});
