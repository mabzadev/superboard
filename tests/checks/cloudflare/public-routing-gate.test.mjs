import "../../fixtures/cloudflare/targets.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import { assertPublicRoutingReady } from "../../../scripts/cloudflare/public-routing-gate.mjs";
import { loadTarget } from "../../../scripts/cloudflare/target.mjs";

test("staged production deploys private Workers without public routes", async () => {
	const { target } = await loadTarget("reference-production");
	assert.deepEqual(assertPublicRoutingReady(target, "production"), {
		schemaVersion: 1,
		ready: true,
		routesEnabled: false,
		target: "reference-production",
		environment: "production",
		mode: "staged-private-workers",
		clientReceiptVerified: false,
	});
});

test("development public routing does not require a production receipt", async () => {
	const { target } = await loadTarget("mbza-development");
	assert.equal(assertPublicRoutingReady(target, "development").routesEnabled, true);
});

test("active production refuses routing without a reviewed client receipt", async () => {
	const { target: source } = await loadTarget("reference-production");
	const target = structuredClone(source);
	target.environments.production.publicRouting = "active";
	assert.throws(
		() => assertPublicRoutingReady(target, "production"),
		/requires a reviewed client cutover receipt/u,
	);
});

test("active production binds routing to the declared application receipt", async () => {
	const { target: source } = await loadTarget("reference-production");
	const target = structuredClone(source);
	target.environments.production.publicRouting = "active";
	target.productionCutover = {
		application: "reference-production",
		snapshot: "scripts/config/flutterflow-sources/reference-production.json",
		clientReceipt: "scripts/config/flutterflow-releases/reference-production.json",
	};
	const calls = [];
	const result = assertPublicRoutingReady(target, "production", {
		repositoryRoot: "/repository",
		verifyReceipt: (options) => {
			calls.push(options);
			return {
				ready: true,
				application: "reference-production",
				flutterflowCommitId: "accepted-commit",
			};
		},
	});
	assert.deepEqual(calls, [
		{
			manifestPath: "/repository/scripts/config/flutterflow-sources/reference-production.json",
			receiptPath: "/repository/scripts/config/flutterflow-releases/reference-production.json",
		},
	]);
	assert.equal(result.routesEnabled, true);
	assert.equal(result.clientReceiptVerified, true);
	assert.equal(result.flutterflowCommitId, "accepted-commit");
});
