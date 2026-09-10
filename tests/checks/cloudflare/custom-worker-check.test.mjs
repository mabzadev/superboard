import "../../fixtures/cloudflare/targets.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import {
	customWorkerPackagePaths,
	runCustomWorkerChecks,
	selectedCustomWorkerPackages,
	selectedCustomWorkerTypeSelections,
	uniqueCustomWorkerTypeSelections,
	validatedPackagePath,
} from "../../../scripts/cloudflare/custom-worker-check.mjs";

test("custom Worker package discovery is target-driven and deduplicated", () => {
	assert.deepEqual(
		customWorkerPackagePaths([
			{ customWorker: { packagePath: "apps/reference/worker" } },
			{ customWorker: { packagePath: "apps/reference/worker" } },
			{ customWorker: { packagePath: "apps/reference/worker" } },
			{},
		]),
		["apps/reference/worker"],
	);
	assert.throws(() => validatedPackagePath("../outside"), /Invalid custom Worker/u);
});

test("all-target selection finds every declared extension without application constants", async () => {
	assert.deepEqual(await selectedCustomWorkerPackages({ all: true }, {}), [
		"apps/reference/worker",
	]);
});

test("target selection validates only that target custom Worker", async () => {
	assert.deepEqual(await selectedCustomWorkerPackages({ target: "mbza-development" }, {}), [
		"apps/reference/worker",
	]);
	assert.deepEqual(await selectedCustomWorkerPackages({ target: "reference-production" }, {}), [
		"apps/reference/worker",
		"apps/reference/worker/orchestrators/medias",
		"apps/reference/worker/orchestrators/vocals",
	]);
});

test("custom Worker type generation is target and environment driven", async () => {
	assert.deepEqual(
		await selectedCustomWorkerTypeSelections(
			{ target: "mbza-development", environment: "development" },
			{},
		),
		[
			{
				targetName: "mbza-development",
				environment: "development",
				packagePath: "apps/reference/worker",
				managedServices: [],
				managedPackages: {},
			},
		],
	);
	assert.deepEqual(
		await selectedCustomWorkerTypeSelections(
			{ target: "reference-production", environment: "production" },
			{},
		),
		[
			{
				targetName: "reference-production",
				environment: "production",
				packagePath: "apps/reference/worker",
				managedServices: ["managed-vocals-orchestrator", "managed-medias-orchestrator"],
				managedPackages: {
					"managed-vocals-orchestrator": "apps/reference/worker/orchestrators/vocals",
					"managed-medias-orchestrator": "apps/reference/worker/orchestrators/medias",
				},
			},
		],
	);
});

test("one app-specific custom package cannot have multiple target owners", () => {
	assert.throws(
		() =>
			uniqueCustomWorkerTypeSelections([
				{ targetName: "sample-dev", packagePath: "apps/sample/worker" },
				{ targetName: "sample-prod", packagePath: "apps/sample/worker" },
			]),
		/must have one target owner/u,
	);
});

test("custom Worker checks run typecheck and tests for each discovered package", () => {
	const calls = [];
	runCustomWorkerChecks(["apps/reference/worker"], (command, args) => {
		calls.push([command, args]);
	});
	assert.deepEqual(calls, [
		["npm", ["--prefix", "apps/reference/worker", "run", "typecheck"]],
		["npm", ["--prefix", "apps/reference/worker", "test"]],
	]);
});
