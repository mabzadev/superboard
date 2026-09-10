import "../../fixtures/cloudflare/targets.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
	assertService,
	assertServiceForTarget,
	isServiceEnabled,
} from "../../../scripts/cloudflare/services.mjs";
import { newTargetManifest } from "../../../scripts/cloudflare/target-template.mjs";
import { loadTarget, validateTarget } from "../../../scripts/cloudflare/target.mjs";
import { d1Descriptor, localMigrationFiles } from "../../../scripts/database/d1-registry.mjs";

test("retired Messaging cannot be selected even with a legacy target and allow-disabled", async () => {
	const { target } = await loadTarget("reference-production");
	assert.throws(() => assertService("messaging"), /Messaging.*retired.*support/u);
	assert.throws(() => assertServiceForTarget(target, "messaging"), /Messaging.*retired.*support/u);
	assert.equal(isServiceEnabled({ features: { messaging: true } }, "messaging"), false);
	const result = spawnSync(
		process.execPath,
		[
			"scripts/cloudflare/config.mjs",
			"--service",
			"messaging",
			"--target",
			"reference-production",
			"--environment",
			"production",
			"--allow-disabled",
		],
		{ encoding: "utf8" },
	);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Messaging.*retired.*support/u);
});

test("target registration rejects reactivation of Messaging", async () => {
	assert.throws(
		() =>
			newTargetManifest({
				args: { "enable-legacy-messaging": true },
				target: "example",
				selectedEnvironment: "production",
			}),
		/Messaging.*retired.*support/u,
	);
	const { target } = await loadTarget("reference-production");
	target.features.messaging = true;
	await assert.rejects(validateTarget(target), /Messaging.*retired.*support/u);
});

test("legacy Messaging databases remain readable for migration without an executable worker", async () => {
	const { target } = await loadTarget("reference-production");
	assert.equal(d1Descriptor(target, target.target, "production", "messaging"), null);
	const descriptor = d1Descriptor(target, target.target, "production", "messaging", {
		includeDisabled: true,
	});
	const files = await localMigrationFiles(descriptor);
	assert.equal(files.length, 4);
	assert.ok(files.includes("0001_messaging.sql"));
});
