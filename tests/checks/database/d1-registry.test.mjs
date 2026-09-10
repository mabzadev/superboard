import "../../fixtures/cloudflare/targets.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import { loadTarget } from "../../../scripts/cloudflare/target.mjs";
import { d1RuntimeBindings } from "../../../scripts/cloudflare/vitest-d1.mjs";
import {
	d1Descriptor,
	localMigrationFiles,
	targetD1Descriptors,
} from "../../../scripts/database/d1-registry.mjs";
import { targetWithoutResourceIds } from "../../fixtures/cloudflare/factories.mjs";

test("the D1 registry assigns one migration owner per enabled database", async () => {
	const { target } = await loadTarget("reference-production");
	const descriptors = targetD1Descriptors(target, "reference-production", "production");
	assert.deepEqual(
		descriptors.map(({ service }) => service),
		[
			"api",
			"site",
			"email",
			"identity",
			"files",
			"custom",
			"app",
			"products",
			"paywalls",
			"dynamic-links",
			"support",
			"marketing",
			"onboardings",
		],
	);
	assert.equal(
		descriptors.some(({ service }) => service === "billing"),
		false,
	);
	assert.equal(
		descriptors.some(({ service }) => service === "messaging"),
		false,
	);
	assert.equal(d1Descriptor(target, "reference-production", "production", "messaging"), null);
	assert.equal(
		d1Descriptor(target, "reference-production", "production", "messaging", {
			includeDisabled: true,
		})?.migrationsDirectory,
		"scripts/database/legacy-messaging-migrations",
	);
	assert.equal(
		d1Descriptor(target, "reference-production", "production", "custom")?.binding,
		"REFERENCE_DB",
	);
	assert.equal(
		d1Descriptor(target, "reference-production", "production", "support")?.databaseName,
		"superboard-support-v2-db",
	);
	for (const descriptor of descriptors) {
		assert.ok((await localMigrationFiles(descriptor)).length > 0, descriptor.service);
	}
});

test("a target can select one or several schema owners without hardcoded resources", async () => {
	const { target: source } = await loadTarget("mbza-development");
	const target = targetWithoutResourceIds(source, "development");
	const selected = targetD1Descriptors(
		target,
		"mbza-development",
		"development",
		"identity,support,identity",
	);
	assert.deepEqual(
		selected.map(({ service }) => service),
		["identity", "support"],
	);
	assert.equal(selected[0].databaseId, null);
	assert.equal(selected[0].databaseName, "superboard-dev-identity-db");
});

test("runtime D1 bindings derive the expected schema from the migration chain", () => {
	const migrations = [
		{ name: "0001_initial.sql", queries: ["SELECT 1"] },
		{ name: "0002_current.sql", queries: ["SELECT 2"] },
	];
	assert.deepEqual(d1RuntimeBindings(migrations), {
		D1_EXPECTED_MIGRATION: "0002_current.sql",
		TEST_MIGRATIONS: migrations,
	});
	assert.throws(() => d1RuntimeBindings([]), /empty/u);
	assert.throws(
		() => d1RuntimeBindings([{ name: "0001_valid.sql" }, { name: "../invalid.sql" }]),
		/invalid or duplicate/u,
	);
});
