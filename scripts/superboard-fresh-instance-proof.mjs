#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildCloudflareBootstrapPlan } from "./cloudflare-bootstrap-core.mjs";
import { loadTarget, parseArgs, root, targetNameFromArgs } from "./cloudflare-target.mjs";
import {
	assertTargetGraphParity,
	compileTarget,
	materializeTarget,
	targetWithAbsentResources,
} from "./target-compiler.mjs";

const RECEIPT_PATH = resolve(root, "docs/evidence/issue-69/fresh-instance.receipt.json");
const EVIDENCE_STEPS = Object.freeze([
	{
		id: "target_adapters",
		command: process.execPath,
		args: [
			"--test",
			"scripts/superboard-fresh-instance-proof.test.mjs",
			"scripts/target-compiler.test.mjs",
		],
		sources: [
			"scripts/superboard-fresh-instance-proof.test.mjs",
			"scripts/target-compiler.test.mjs",
		],
	},
	{
		id: "store_schema",
		command: process.execPath,
		args: ["--test", "scripts/module-cutover/registry-schema.test.mjs"],
		sources: ["scripts/module-cutover/registry-schema.test.mjs"],
	},
	{
		id: "store_runtime",
		command: "pnpm",
		args: [
			"--dir",
			"apps/site",
			"exec",
			"vitest",
			"run",
			"--config",
			"vitest.runtime.config.ts",
			"runtime-tests/plugin-store-authority.runtime.test.ts",
		],
		sources: [
			"apps/site/vitest.runtime.config.ts",
			"apps/site/runtime-tests/plugin-store-authority.runtime.test.ts",
		],
	},
	{
		id: "store_convergence",
		command: process.execPath,
		args: [resolve(root, "scripts/emdash-migration-rehearsal-proof.mjs")],
		capture: true,
		sources: [
			"scripts/emdash-migration-rehearsal-proof.mjs",
			"scripts/emdash-migration-rehearsal-proof.test.mjs",
		],
	},
	{
		id: "local_workers",
		command: process.execPath,
		args: [],
		capture: true,
		sources: ["scripts/target-orchestrator.mjs"],
	},
	{
		id: "development_workers",
		command: process.execPath,
		args: [],
		capture: true,
		sources: ["scripts/target-orchestrator.mjs"],
	},
	{
		id: "runtime_lifecycle",
		command: "pnpm",
		capture: true,
		args: [
			"--dir",
			"apps/site",
			"exec",
			"vitest",
			"run",
			"--config",
			"vitest.runtime.config.ts",
			"--reporter=verbose",
			"runtime-tests/fresh-instance-proof.runtime.test.ts",
		],
		sources: [
			"apps/site/vitest.runtime.config.ts",
			"apps/site/runtime-tests/fresh-instance-proof.runtime.test.ts",
		],
	},
	{
		id: "route_states",
		command: "pnpm",
		args: [
			"--dir",
			"apps/site",
			"exec",
			"vitest",
			"run",
			"--config",
			"vitest.config.ts",
			"tests/front-surface-parity.test.ts",
			"tests/native-front-views-seed.test.ts",
		],
		sources: [
			"apps/site/tests/front-surface-parity.test.ts",
			"apps/site/tests/native-front-views-seed.test.ts",
		],
	},
]);

export async function buildFreshInstancePlan(targetName) {
	const { target } = await loadTarget(targetName);
	if (!target.environments.local || !target.environments.development) {
		throw new Error(`${targetName} must define local and development environments`);
	}
	const freshDevelopmentTarget = targetWithAbsentResources(target);
	const localArtifact = await compileTarget(target, "local");
	const developmentArtifact = await compileTarget(freshDevelopmentTarget, "development");
	const local = materializeTarget(localArtifact, "local");
	const development = materializeTarget(developmentArtifact, "cloudflare");
	assertTargetGraphParity([local, development]);
	const bootstrap = buildCloudflareBootstrapPlan({
		target: freshDevelopmentTarget,
		environment: "development",
		accountId: "0".repeat(32),
		inventories: { d1: [], kv: [], r2: [], queue: [], vectorize: [] },
		compiledTarget: developmentArtifact,
	});
	if (!bootstrap.applicable || bootstrap.blockers.length > 0) {
		throw new Error("The development adapter cannot provision a blank Instance");
	}
	const topology = JSON.parse(
		await readFile(resolve(root, "config/emdash-plugin-topology.json"), "utf8"),
	);
	const catalogIds = topology.plugins
		.map(({ manifest }) => manifest.plugin_id)
		.filter((pluginId) => !pluginId.includes("*"))
		.toSorted();
	const installedIds = localArtifact.graph.plugins.map(({ pluginId }) => pluginId).toSorted();
	const targetIds = localArtifact.graph.plugins
		.filter(({ targetState }) => targetState === "active")
		.map(({ pluginId }) => pluginId)
		.toSorted();
	if (canonical(catalogIds) !== canonical(installedIds)) {
		throw new Error("The target artifact does not cover the complete installable plugin catalog");
	}
	const content = {
		schema_version: 1,
		kind: "superboard-fresh-instance-proof-plan",
		target: targetName,
		operator: { email: target.operator.email },
		adapters: [
			{
				environment: "local",
				adapter: "local",
				artifact_checksum: localArtifact.checksum,
				graph_checksum: localArtifact.graphChecksum,
				service_count: local.services.length,
				health_check_count: local.healthChecks.length,
				resources: local.resources.map(({ key, kind }) => ({
					key,
					kind,
					initial_state: "absent",
					operation: "create",
				})),
			},
			{
				environment: "development",
				adapter: "cloudflare",
				artifact_checksum: developmentArtifact.checksum,
				graph_checksum: developmentArtifact.graphChecksum,
				service_count: development.services.length,
				health_check_count: development.healthChecks.length,
				resources: bootstrap.operations.map(({ key, kind, type }) => ({
					key,
					kind,
					initial_state: "absent",
					operation: type,
				})),
			},
		],
		plugins: {
			catalog_count: catalogIds.length,
			installed_count: installedIds.length,
			target_count: targetIds.length,
			target_inactive_count: installedIds.filter((pluginId) => !targetIds.includes(pluginId)).length,
			catalog_ids: catalogIds,
			installed_ids: installedIds,
			target_ids: targetIds,
		},
		constraints: {
			direct_sql_writes: false,
			hardcoded_tokens: false,
			wrangler_patches: false,
			manual_worker_start: false,
		},
	};
	return { ...content, plan_checksum: checksum(content) };
}

export async function runFreshInstanceProof(targetName, { execute = executeEvidenceStep } = {}) {
	const plan = await buildFreshInstancePlan(targetName);
	const localStateDirectories = {
		local: await mkdtemp(join(tmpdir(), "superboard-fresh-instance-local-")),
		development: await mkdtemp(join(tmpdir(), "superboard-fresh-instance-development-")),
	};
	const evidenceResults = new Map();
	const workerSteps = {
		local_workers: {
			environment: "local",
			adapter: "local",
			localState: localStateDirectories.local,
			fresh: false,
		},
		development_workers: {
			environment: "development",
			adapter: "cloudflare",
			localState: localStateDirectories.development,
			fresh: true,
		},
	};
	const evidenceSteps = EVIDENCE_STEPS.map((step) => {
		const worker = workerSteps[step.id];
		if (step.id === "store_convergence") {
			return {
				...step,
				args: [...step.args, "--plugin-ids", JSON.stringify(plan.plugins.installed_ids)],
			};
		}
		return worker
			? {
					...step,
					args: [
						resolve(root, "scripts/target-orchestrator.mjs"),
						"exercise",
						"--target",
						targetName,
						"--environment",
						worker.environment,
						"--adapter",
						worker.adapter,
						"--local-state",
						worker.localState,
						...(worker.fresh ? ["--fresh"] : []),
					],
				}
			: step;
	});
	try {
		for (const step of evidenceSteps) {
			const result = execute(step);
			if (result.status !== 0) {
				throw new Error(`Fresh Instance evidence failed: ${step.id}`);
			}
			evidenceResults.set(step.id, result.evidence ?? { exit_status: result.status });
		}
	} finally {
		await Promise.all(
			Object.values(localStateDirectories).map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
	}
	const { target } = await loadTarget(targetName);
	const localWorkers = evidenceResults.get("local_workers");
	const developmentWorkers = evidenceResults.get("development_workers");
	const storeSchema = evidenceResults.get("store_schema");
	const storeRuntime = evidenceResults.get("store_runtime");
	const storeConvergence = evidenceResults.get("store_convergence");
	const runtime = evidenceResults.get("runtime_lifecycle");
	assertRuntimeEvidence(
		plan,
		target,
		{ localWorkers, developmentWorkers, storeSchema, storeRuntime, storeConvergence },
		runtime,
	);
	const runtimeReceipt = runtime[0];
	const content = {
		schema_version: 1,
		kind: "superboard-fresh-instance-proof-receipt",
		status: "passed",
		target: targetName,
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
			email: runtimeReceipt.operator.email,
			declared_by: "target_manifest",
			provisioned_by: "emdash_auth_adapter",
			role: runtimeReceipt.operator.role,
		},
		plugins: runtimeReceipt.plugins,
		stores: {
			converged_count: storeConvergence.store_count,
			source_to_store_count: storeConvergence.source_to_store_count,
			new_empty_store_count: storeConvergence.new_empty_store_count,
			authority: "plugin_repositories",
			receipt_checksum: storeConvergence.receipt_checksum,
		},
		workers: {
			health_status: "ready",
			local_health_receipt_count: localWorkers.healthChecks.length,
			development_health_receipt_count: developmentWorkers.healthChecks.length,
			plugin_health_receipt_count: runtimeReceipt.workers.plugin_health_receipt_count,
		},
		release: runtimeReceipt.release,
		constraints: plan.constraints,
		evidence: await Promise.all(
			evidenceSteps.map(async ({ id, sources }) => ({
				id,
				sources: await Promise.all(
					sources.map(async (source) => ({
						path: source,
						checksum: await fileChecksum(source),
					})),
				),
				result_checksum: checksum(evidenceResults.get(id)),
				status: "passed",
			})),
		),
	};
	return { ...content, receipt_checksum: checksum(content) };
}

export async function verifyFreshInstanceReceipt(receipt) {
	if (!receipt || typeof receipt !== "object") return false;
	const { receipt_checksum: receiptChecksum, ...content } = receipt;
	if (receiptChecksum !== checksum(content)) return false;
	if (
		receipt.schema_version !== 1 ||
		receipt.kind !== "superboard-fresh-instance-proof-receipt" ||
		receipt.status !== "passed" ||
		typeof receipt.target !== "string" ||
		!Array.isArray(receipt.adapters) ||
		receipt.adapters.length !== 2 ||
		!receipt.operator ||
		!receipt.plugins ||
		!receipt.stores ||
		!receipt.workers ||
		receipt.release?.status !== "active" ||
		!receipt.constraints ||
		!Array.isArray(receipt.evidence) ||
		receipt.evidence.length !== EVIDENCE_STEPS.length
	) {
		return false;
	}
	let plan;
	try {
		plan = await buildFreshInstancePlan(receipt.target);
	} catch {
		return false;
	}
	if (!receiptMatchesPlan(receipt, plan)) return false;
	const expectedEvidence = new Map(EVIDENCE_STEPS.map(({ id, sources }) => [id, sources]));
	for (const evidence of receipt.evidence) {
		const expectedSources = expectedEvidence.get(evidence.id);
		if (
			!expectedSources ||
			!Array.isArray(evidence.sources) ||
			canonical(evidence.sources.map(({ path }) => path)) !== canonical(expectedSources) ||
			evidence.status !== "passed" ||
			!/^sha256:[a-f0-9]{64}$/u.test(evidence.result_checksum)
		) {
			return false;
		}
		for (const source of evidence.sources) {
			if (source.checksum !== (await fileChecksum(source.path))) return false;
		}
		expectedEvidence.delete(evidence.id);
	}
	return expectedEvidence.size === 0;
}

function assertRuntimeEvidence(plan, target, evidence, runtime) {
	const { localWorkers, developmentWorkers, storeSchema, storeRuntime, storeConvergence } = evidence;
	if (
		!Array.isArray(runtime) ||
		runtime.length !== plan.adapters.length
	) {
		throw new Error("Fresh Instance runtime evidence is incomplete");
	}
	assertWorkerEvidence(plan.adapters[0], localWorkers);
	assertWorkerEvidence(plan.adapters[1], developmentWorkers);
	assertStoreEvidence(plan, storeConvergence, { storeSchema, storeRuntime }, runtime);
	for (const [index, evidence] of runtime.entries()) {
		const adapter = plan.adapters[index];
		if (
			!adapter ||
			evidence.environment !== adapter.environment ||
			evidence.adapter !== adapter.adapter ||
			evidence.artifact_checksum !== adapter.artifact_checksum ||
			evidence.graph_checksum !== adapter.graph_checksum ||
			evidence.operator?.email !== target.operator.email ||
			evidence.operator?.role !== "admin" ||
			evidence.plugins?.manifest_count !== plan.plugins.catalog_count ||
			evidence.plugins?.installed_count !== plan.plugins.installed_count ||
			evidence.plugins?.target_active_count !== plan.plugins.target_count ||
			evidence.plugins?.target_inactive_count !== plan.plugins.target_inactive_count ||
			evidence.plugins?.installation_step_receipt_count < plan.plugins.installed_count ||
			evidence.stores?.declared_count !== storeConvergence.store_count ||
			evidence.workers?.plugin_health_receipt_count !== plan.plugins.installed_count ||
			evidence.release?.status !== "active" ||
			evidence.release?.validation_receipt_count < 1 ||
			evidence.release?.active_route_count < 1 ||
			evidence.release?.catalog_declared_route_count < evidence.release?.active_route_count ||
			evidence.release?.catalog_rendered_route_count !==
				evidence.release?.catalog_declared_route_count ||
			evidence.release?.catalog_mounted_renderer_count <
				evidence.release?.catalog_rendered_route_count
		) {
			throw new Error(`Fresh Instance runtime evidence is invalid for ${adapter?.environment}`);
		}
	}
	const comparable = runtime.map(({ environment, adapter, artifact_checksum, ...evidence }) => evidence);
	if (canonical(comparable[0]) !== canonical(comparable[1])) {
		throw new Error("Fresh Instance runtime outcomes differ between adapters");
	}
}

function assertStoreEvidence(plan, evidence, externalProofs, runtime) {
	const { storeSchema, storeRuntime } = externalProofs;
	if (
		!evidence ||
		!Array.isArray(evidence.stores) ||
		evidence.store_count !== evidence.stores.length ||
		evidence.converged_count + evidence.requires_schema_and_runtime_count !==
			evidence.store_count ||
		evidence.source_to_store_count + evidence.new_empty_store_count !== evidence.store_count ||
		evidence.requires_schema_and_runtime_count !== evidence.new_empty_store_count ||
		storeSchema?.exit_status !== 0 ||
		storeRuntime?.exit_status !== 0 ||
		canonical(evidence.plugin_ids) !== canonical(plan.plugins.installed_ids) ||
		!/^sha256:[a-f0-9]{64}$/u.test(evidence.receipt_checksum) ||
		evidence.stores.some(
			(store) =>
				(store.migration_kind === "source_to_store"
					? store.status !== "converged"
					: store.status !== "requires_schema_and_runtime") ||
				!plan.plugins.installed_ids.includes(store.plugin_id) ||
				!/^sha256:[a-f0-9]{64}$/u.test(store.descriptor_checksum),
		) ||
		new Set(evidence.stores.map(({ store_id: storeId }) => storeId)).size !== evidence.store_count ||
		runtime.some(({ stores }) => stores?.declared_count !== evidence.store_count)
	) {
		throw new Error("Fresh Instance Store convergence evidence is invalid");
	}
}

function assertWorkerEvidence(adapter, evidence) {
	if (
		!adapter ||
		!evidence ||
		evidence.environment !== adapter.environment ||
		evidence.adapter !== adapter.adapter ||
		evidence.artifactChecksum !== adapter.artifact_checksum ||
		evidence.graphChecksum !== adapter.graph_checksum ||
		!Array.isArray(evidence.healthChecks) ||
		evidence.healthChecks.length !== adapter.service_count ||
		evidence.healthChecks.some(({ status }) => status !== 200)
	) {
		throw new Error(`Fresh Instance Worker evidence is invalid for ${adapter?.environment}`);
	}
}

function receiptMatchesPlan(receipt, plan) {
	const constraints = receipt.constraints;
	return (
		receipt.plan_checksum === plan.plan_checksum &&
		canonical(receipt.adapters) ===
			canonical(
				plan.adapters.map(
					({ environment, adapter, artifact_checksum, graph_checksum, service_count }) => ({
						environment,
						adapter,
						artifact_checksum,
						graph_checksum,
						service_count,
					}),
				),
			) &&
		receipt.plugins.manifest_count === plan.plugins.catalog_count &&
		receipt.plugins.installed_count === plan.plugins.installed_count &&
		receipt.plugins.target_active_count === plan.plugins.target_count &&
		receipt.plugins.target_inactive_count === plan.plugins.target_inactive_count &&
		receipt.plugins.installation_step_receipt_count >= plan.plugins.installed_count &&
		receipt.stores.converged_count > 0 &&
		receipt.stores.source_to_store_count + receipt.stores.new_empty_store_count ===
			receipt.stores.converged_count &&
		receipt.stores.authority === "plugin_repositories" &&
		/^sha256:[a-f0-9]{64}$/u.test(receipt.stores.receipt_checksum) &&
		receipt.workers.health_status === "ready" &&
		receipt.workers.local_health_receipt_count === plan.adapters[0].service_count &&
		receipt.workers.development_health_receipt_count === plan.adapters[1].service_count &&
		receipt.workers.plugin_health_receipt_count === plan.plugins.installed_count &&
		receipt.release.status === "active" &&
		receipt.release.validation_receipt_count > 0 &&
		receipt.release.active_route_count > 0 &&
		receipt.release.catalog_declared_route_count >= receipt.release.active_route_count &&
		receipt.release.catalog_rendered_route_count === receipt.release.catalog_declared_route_count &&
		receipt.release.catalog_mounted_renderer_count >=
			receipt.release.catalog_rendered_route_count &&
		receipt.operator.email === plan.operator.email &&
		receipt.operator.declared_by === "target_manifest" &&
		receipt.operator.provisioned_by === "emdash_auth_adapter" &&
		receipt.operator.role === "admin" &&
		constraints.direct_sql_writes === false &&
		constraints.hardcoded_tokens === false &&
		constraints.wrangler_patches === false &&
		constraints.manual_worker_start === false
	);
}

function checksum(value) {
	return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

async function fileChecksum(path) {
	return `sha256:${createHash("sha256")
		.update(await readFile(resolve(root, path)))
		.digest("hex")}`;
}

function executeEvidenceStep({ command, args, capture = false }) {
	const result = spawnSync(command, args, {
		cwd: root,
		env: process.env,
		...(capture
			? { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }
			: { stdio: "inherit" }),
		shell: false,
	});
	if (capture && result.status !== 0) {
		const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
		process.stderr.write(output.slice(-20_000));
	}
	return {
		...result,
		...(capture && result.status === 0
			? { evidence: capturedEvidence(commandEvidencePrefix(args), result.stdout ?? "") }
			: {}),
	};
}

function commandEvidencePrefix(args) {
	const command = args.join(" ");
	if (command.includes("target-orchestrator.mjs") && command.includes(" exercise ")) {
		return "SUPERBOARD_FRESH_INSTANCE_WORKERS";
	}
	if (command.includes("fresh-instance-proof.runtime.test.ts")) {
		return "SUPERBOARD_FRESH_INSTANCE_RUNTIME";
	}
	if (command.includes("emdash-migration-rehearsal-proof.mjs")) {
		return "SUPERBOARD_FRESH_INSTANCE_STORES";
	}
	throw new Error("Fresh Instance evidence command has no output contract");
}

function capturedEvidence(prefix, output) {
	const marker = `${prefix}=`;
	const line = output.split("\n").find((candidate) => candidate.includes(marker));
	if (!line) throw new Error(`Fresh Instance evidence output is missing ${prefix}`);
	const serialized = line.slice(line.indexOf(marker) + marker.length);
	return JSON.parse(serialized);
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

async function main() {
	const args = parseArgs();
	const receipt = await runFreshInstanceProof(targetNameFromArgs(args));
	if (args.write) {
		await mkdir(dirname(RECEIPT_PATH), { recursive: true });
		await writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, "\t")}\n`, { mode: 0o600 });
	}
	if (args.check) {
		const expected = JSON.parse(await readFile(RECEIPT_PATH, "utf8"));
		if (canonical(expected) !== canonical(receipt)) {
			throw new Error("Fresh Instance receipt is stale; run the proof with --write");
		}
	}
	process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	await main();
}
