import assert from "node:assert/strict";
import test from "node:test";

import { desiredCloudflareResources } from "./cloudflare-bootstrap-core.mjs";
import { deploymentOrder } from "./cloudflare-deploy-plan.mjs";
import { loadTarget, validateTarget } from "./cloudflare-target.mjs";
import { compileTarget, materializeTarget } from "./target-compiler.mjs";

test("an existing instance deploys the Site without provisioning or starting its retired Dashboard", async () => {
	const { target } = await loadTarget("mbza-development");
	const before = JSON.stringify(target);
	const compiled = await compileTarget(target, "local");
	for (const adapter of ["local", "cloudflare"]) {
		const runtime = materializeTarget(compiled, adapter);
		assert.ok(runtime.services.some((service) => service.id === "site"));
		assert.ok(runtime.services.every((service) => service.id !== "dashboard"));
		assert.ok(
			runtime.bindings.every(
				(binding) => binding.service !== "dashboard" && binding.targetService !== "dashboard",
			),
		);
		assert.ok(runtime.resources.every((resource) => resource.key !== "dashboardCache"));
		assert.ok(runtime.secrets.every((secret) => secret.service !== "dashboard"));
	}
	assert.equal(JSON.stringify(target), before);
	assert.ok(!deploymentOrder(target).includes("dashboard"));
	assert.ok(
		desiredCloudflareResources(target, "local").some((resource) => resource.key === "siteD1"),
	);
});

test("new instances need no Dashboard worker, cache, hostname or OAuth client", async () => {
	const { target } = await loadTarget("mbza-development");
	delete target.workers.dashboard;
	delete target.domains.dashboard;
	delete target.oauth;
	for (const resources of Object.values(target.environments)) delete resources.dashboardCache;
	await validateTarget(target);
	const compiled = await compileTarget(target, "local");
	assert.ok(
		compiled.materialization.routes.some(
			(route) => route.service === "site" && route.hostname === target.domains.site,
		),
	);
	assert.ok(
		compiled.materialization.healthChecks.every((check) => !check.url?.includes("undefined")),
	);
});

test("the former Dashboard hostname is served and monitored by the Site", async () => {
	const { target } = await loadTarget("mbza-development");
	const compiled = await compileTarget(target, "development");
	const frontAlias = compiled.materialization.routes.find(
		(route) => route.hostname === target.domains.dashboard,
	);
	assert.equal(frontAlias?.service, "site");
	const health = compiled.materialization.healthChecks.find(
		(check) =>
			check.url?.includes(target.domains.dashboard) && check.path === "/superboard-system/health",
	);
	assert.equal(health?.service, "site");
	assert.equal(health?.path, "/superboard-system/health");
	assert.ok(
		compiled.materialization.healthChecks.some(
			(check) => check.url?.includes(target.domains.dashboard) && check.path === "/mcp/health",
		),
	);
});
