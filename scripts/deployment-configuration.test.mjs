import "./test-targets.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import { expectedDomainOwners } from "./cloudflare-domain-plan-core.mjs";
import { loadTarget, publicMcpUrl } from "./cloudflare-target.mjs";
import { deploymentConfiguration } from "./deployment-configuration.mjs";

for (const targetName of ["mbza-development", "reference-production"])
	test(`${targetName} generates the requested endpoints and retains its aliases`, async () => {
		const { target } = await loadTarget(targetName);
		const environment = targetName === "reference-production" ? "production" : "development";
		const configuration = deploymentConfiguration(target, environment);
		assert.equal(
			new Set(configuration.endpoints.map((item) => new URL(item.url).hostname)).size,
			6,
		);
		assert.equal(
			publicMcpUrl(target),
			`https://board.${targetName === "reference-production" ? "reference.example" : "mbza.dev"}/mcp`,
		);
		assert.equal(configuration.workers.length, 11);
		if (targetName !== "reference-production")
			assert.equal(
				expectedDomainOwners(target, environment).filter(
					(item) => item.hostname === target.domains.site,
				).length,
				1,
			);
		const changed = structuredClone(target);
		changed.workers.api[environment] = "renamed-api-worker";
		changed.customWorker.vars.SECRET_TEST_VALUE = "do-not-expose";
		const updated = deploymentConfiguration(changed, environment);
		assert.equal(updated.workers.find((item) => item.id === "api").name, "renamed-api-worker");
		assert.notEqual(updated.checksum, configuration.checksum);
		assert.ok(!JSON.stringify(updated).includes("do-not-expose"));
	});
