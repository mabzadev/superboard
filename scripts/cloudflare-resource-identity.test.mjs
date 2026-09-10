import "./test-targets.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import { assertTargetPhysicalResourceNames } from "./cloudflare-resource-identity.mjs";
import { loadTarget } from "./cloudflare-target.mjs";

const siteResources = ["siteD1", "siteSessionKv", "siteReleaseKv", "siteMedia"];

test("Site resources retain physical names while exposing their logical migration identity", async () => {
	for (const [name, environment] of [
		["mbza-development", "development"],
		["reference-production", "production"],
	]) {
		const { target } = await loadTarget(name);
		const contracts = assertTargetPhysicalResourceNames(target, environment);
		for (const key of siteResources) {
			const contract = contracts.find((entry) => entry.key === key);
			assert.ok(contract, `${name}:${key}`);
			const physicalName = target.environments[environment][key].name;
			assert.equal(contract.physicalName, physicalName);
			assert.equal(
				contract.logicalName,
				`${target.resourceIdentity.logicalName}${physicalName.slice(target.resourceIdentity.physicalName.length)}`,
			);
			assert.equal(contract.migrationStrategy, target.resourceIdentity.migrationStrategy);
			assert.deepEqual(
				contract.previousNames,
				target.resourceIdentity.migrationStrategy === "retain-physical-name" ? [physicalName] : [],
			);
		}
	}
});

test("Site resources outside the declared physical namespace fail validation", async () => {
	const { target: source } = await loadTarget("mbza-development");
	for (const key of siteResources) {
		const target = structuredClone(source);
		target.environments.development[key].name = "foreign-site-resource";
		assert.throws(
			() => assertTargetPhysicalResourceNames(target, "development"),
			/outside the declared superboard namespace/u,
			key,
		);
	}
});
