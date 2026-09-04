import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	buildFreshInstancePlan,
	runFreshInstanceProof,
	verifyFreshInstanceReceipt,
} from "./superboard-fresh-instance-proof.mjs";

const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u;

test("one target plans a blank local then development Instance with verifiable evidence", async () => {
	const plan = await buildFreshInstancePlan("mbza-development");

	assert.equal(plan.kind, "superboard-fresh-instance-proof-plan");
	assert.equal(plan.target, "mbza-development");
	assert.deepEqual(
		plan.adapters.map(({ environment, adapter }) => ({ environment, adapter })),
		[
			{ environment: "local", adapter: "local" },
			{ environment: "development", adapter: "cloudflare" },
		],
	);
	assert.equal(plan.adapters[0].graph_checksum, plan.adapters[1].graph_checksum);
	assert.ok(plan.adapters[0].resources.every(({ initial_state }) => initial_state === "absent"));
	assert.ok(plan.adapters[1].resources.every(({ initial_state }) => initial_state === "absent"));
	assert.ok(plan.adapters[1].resources.every(({ operation }) => operation === "create"));
	assert.equal(plan.plugins.catalog_count, plan.plugins.catalog_ids.length);
	assert.equal(plan.plugins.installed_count, plan.plugins.installed_ids.length);
	assert.deepEqual(plan.plugins.installed_ids, plan.plugins.catalog_ids);
	assert.equal(plan.plugins.target_count, plan.plugins.target_ids.length);
	assert.equal(
		plan.plugins.target_inactive_count,
		plan.plugins.installed_ids.filter((pluginId) => !plan.plugins.target_ids.includes(pluginId)).length,
	);
	assert.ok(plan.plugins.target_ids.every((pluginId) => plan.plugins.catalog_ids.includes(pluginId)));
	assert.match(plan.plan_checksum, CHECKSUM_PATTERN);
});

test("the executable proof rejects different runtime outcomes between adapters", async () => {
	const plan = await buildFreshInstancePlan("mbza-development");
	const runtime = plan.adapters.map(({ environment, adapter, artifact_checksum, graph_checksum }) => ({
		environment,
		adapter,
		artifact_checksum,
		graph_checksum,
		operator: { email: plan.operator.email, role: "admin" },
		plugins: {
			manifest_count: plan.plugins.catalog_count,
			installed_count: plan.plugins.installed_count,
			target_active_count: plan.plugins.target_count,
			target_inactive_count: plan.plugins.target_inactive_count,
			installation_step_receipt_count: plan.plugins.installed_count,
		},
		stores: { declared_count: plan.plugins.installed_count },
		workers: { plugin_health_receipt_count: plan.plugins.installed_count },
		release: {
			status: "active",
			validation_receipt_count: 1,
			active_route_count: 1,
			catalog_declared_route_count: 1,
			catalog_rendered_route_count: 1,
			catalog_mounted_renderer_count: 1,
		},
	}));
	runtime[1].release.active_route_count = 2;
	runtime[1].release.catalog_declared_route_count = 2;
	runtime[1].release.catalog_rendered_route_count = 2;
	runtime[1].release.catalog_mounted_renderer_count = 2;
	const storeConvergence = {
		store_count: plan.plugins.installed_count,
		converged_count: plan.plugins.installed_count,
		requires_schema_and_runtime_count: 0,
		source_to_store_count: plan.plugins.installed_count,
		new_empty_store_count: 0,
		plugin_ids: plan.plugins.installed_ids,
		stores: plan.plugins.installed_ids.map((pluginId) => ({
			plugin_id: pluginId,
			store_id: `${pluginId}.store.fixture`,
			descriptor_checksum: `sha256:${"1".repeat(64)}`,
			migration_kind: "source_to_store",
			status: "converged",
		})),
		receipt_checksum: `sha256:${"2".repeat(64)}`,
	};
	await assert.rejects(
		runFreshInstanceProof("mbza-development", {
			execute: (step) => {
				const workerIndex = step.id === "local_workers" ? 0 : step.id === "development_workers" ? 1 : -1;
				const adapter = plan.adapters[workerIndex];
				return {
					status: 0,
				evidence: adapter
						? {
								environment: adapter.environment,
								adapter: adapter.adapter,
								artifactChecksum: adapter.artifact_checksum,
								graphChecksum: adapter.graph_checksum,
								healthChecks: Array.from({ length: adapter.service_count }, (_, index) => ({
									service: `service-${index}`,
									status: 200,
								})),
							}
						: step.id === "store_convergence"
							? storeConvergence
							: step.id === "runtime_lifecycle"
							? runtime
							: null,
				};
			},
		}),
		/Fresh Instance runtime outcomes differ between adapters/u,
	);
});

test("receipt verification rejects a signed summary without executable evidence", async () => {
	const content = {
		kind: "superboard-fresh-instance-proof-receipt",
		status: "passed",
		plugins: { installed_count: 18 },
		stores: { converged_count: 41 },
		release: { status: "active" },
	};
	const receipt = { ...content, receipt_checksum: checksum(content) };

	assert.equal(await verifyFreshInstanceReceipt(receipt), false);
});

test("receipt verification accepts independently sealed complete evidence", async () => {
	const plan = await buildFreshInstancePlan("mbza-development");
	const evidenceSources = [
		{
			id: "target_adapters",
			paths: [
				"scripts/superboard-fresh-instance-proof.test.mjs",
				"scripts/target-compiler.test.mjs",
			],
		},
		{ id: "local_workers", paths: ["scripts/target-orchestrator.mjs"] },
		{ id: "development_workers", paths: ["scripts/target-orchestrator.mjs"] },
		{ id: "store_schema", paths: ["scripts/module-cutover/registry-schema.test.mjs"] },
		{
			id: "store_runtime",
			paths: [
				"apps/site/vitest.runtime.config.ts",
				"apps/site/runtime-tests/plugin-store-authority.runtime.test.ts",
			],
		},
		{
			id: "store_convergence",
			paths: [
				"scripts/emdash-migration-rehearsal-proof.mjs",
				"scripts/emdash-migration-rehearsal-proof.test.mjs",
			],
		},
		{
			id: "runtime_lifecycle",
			paths: [
				"apps/site/vitest.runtime.config.ts",
				"apps/site/runtime-tests/fresh-instance-proof.runtime.test.ts",
			],
		},
		{
			id: "route_states",
			paths: [
				"apps/site/tests/front-surface-parity.test.ts",
				"apps/site/tests/native-front-views-seed.test.ts",
			],
		},
	];
	const content = {
		schema_version: 1,
		kind: "superboard-fresh-instance-proof-receipt",
		status: "passed",
		target: plan.target,
		plan_checksum: plan.plan_checksum,
		adapters: plan.adapters.map(
			({ environment, adapter, artifact_checksum, graph_checksum, service_count }) => ({
				environment,
				adapter,
				artifact_checksum,
				graph_checksum,
				service_count,
			}),
		),
		operator: {
			email: plan.operator.email,
			declared_by: "target_manifest",
			provisioned_by: "emdash_auth_adapter",
			role: "admin",
		},
		plugins: {
			manifest_count: plan.plugins.catalog_count,
			installed_count: plan.plugins.installed_count,
			target_active_count: plan.plugins.target_count,
			target_inactive_count: plan.plugins.target_inactive_count,
			installation_step_receipt_count: plan.plugins.installed_count,
		},
		stores: {
			converged_count: 1,
			source_to_store_count: 1,
			new_empty_store_count: 0,
			authority: "plugin_repositories",
			receipt_checksum: `sha256:${"3".repeat(64)}`,
		},
		workers: {
			health_status: "ready",
			local_health_receipt_count: plan.adapters[0].service_count,
			development_health_receipt_count: plan.adapters[1].service_count,
			plugin_health_receipt_count: plan.plugins.installed_count,
		},
		release: {
			status: "active",
			validation_receipt_count: 1,
			active_route_count: 1,
			catalog_declared_route_count: 1,
			catalog_rendered_route_count: 1,
			catalog_mounted_renderer_count: 1,
		},
		constraints: {
			direct_sql_writes: false,
			hardcoded_tokens: false,
			wrangler_patches: false,
			manual_worker_start: false,
		},
		evidence: await Promise.all(
			evidenceSources.map(async ({ id, paths }) => ({
				id,
				sources: await Promise.all(
					paths.map(async (path) => ({ path, checksum: await fileChecksum(path) })),
				),
				result_checksum: checksum({ status: "passed" }),
				status: "passed",
			})),
		),
	};

	assert.equal(
		await verifyFreshInstanceReceipt({ ...content, receipt_checksum: checksum(content) }),
		true,
	);
});

function checksum(value) {
	return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

async function fileChecksum(path) {
	return `sha256:${createHash("sha256")
		.update(await readFile(new URL(`../${path}`, import.meta.url)))
		.digest("hex")}`;
}

function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.toSorted()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}
