import "./test-targets.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import {
	customWorkerPackagePaths,
	runCustomWorkerChecks,
	selectedCustomWorkerPackages,
	selectedCustomWorkerTypeSelections,
	uniqueCustomWorkerTypeSelections,
	validatedPackagePath,
} from "./custom-worker-check.mjs";

test("custom Worker package discovery is target-driven and deduplicated", () => {
	assert.deepEqual(
		customWorkerPackagePaths([
			{ customWorker: { packagePath: "workers/custom/reference" } },
			{ customWorker: { packagePath: "workers/custom/reference" } },
			{ customWorker: { packagePath: "workers/custom/reference" } },
			{},
		]),
		["workers/custom/reference"],
	);
	assert.throws(() => validatedPackagePath("../outside"), /Invalid custom Worker/u);
});

test("all-target selection finds every declared extension without application constants", async () => {
	assert.deepEqual(await selectedCustomWorkerPackages({ all: true }, {}), [
		"workers/custom/reference",
	]);
});

test("target selection validates only that target custom Worker", async () => {
	assert.deepEqual(await selectedCustomWorkerPackages({ target: "mbza-development" }, {}), [
		"workers/custom/reference",
	]);
	assert.deepEqual(await selectedCustomWorkerPackages({ target: "reference-production" }, {}), [
		"workers/custom/reference",
		"workers/custom/reference/orchestrators/medias",
		"workers/custom/reference/orchestrators/vocals",
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
				packagePath: "workers/custom/reference",
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
				packagePath: "workers/custom/reference",
				managedServices: ["managed-vocals-orchestrator", "managed-medias-orchestrator"],
				managedPackages: {
					"managed-vocals-orchestrator": "workers/custom/reference/orchestrators/vocals",
					"managed-medias-orchestrator": "workers/custom/reference/orchestrators/medias",
				},
			},
		],
	);
});

test("one app-specific custom package cannot have multiple target owners", () => {
	assert.throws(
		() =>
			uniqueCustomWorkerTypeSelections([
				{ targetName: "sample-dev", packagePath: "workers/custom/sample" },
				{ targetName: "sample-prod", packagePath: "workers/custom/sample" },
			]),
		/must have one target owner/u,
	);
});

test("custom Worker checks run typecheck and tests for each discovered package", () => {
	const calls = [];
	runCustomWorkerChecks(["workers/custom/reference"], (command, args) => {
		calls.push([command, args]);
	});
	assert.deepEqual(calls, [
		["npm", ["--prefix", "workers/custom/reference", "run", "typecheck"]],
		["npm", ["--prefix", "workers/custom/reference", "test"]],
	]);
});
