import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
	buildCloudflareBootstrapPlan,
	desiredCloudflareResources,
} from "./cloudflare-bootstrap-core.mjs";
import { buildD1ConvergencePlan } from "./cloudflare-d1-converge.mjs";
import { buildDeploymentExecutionPlan } from "./cloudflare-deploy-plan.mjs";
import { loadTarget, root } from "./cloudflare-target.mjs";
import {
	assertTargetGraphParity,
	assertTargetServiceConfiguration,
	buildTargetOperationPlan,
	compileLocalSiteConfiguration,
	compileTarget,
	compiledTargetFromArgs,
	materializeTarget,
} from "./target-compiler.mjs";

const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const GRAPH_DRIFT_PATTERN = /Target graph drift/u;
const CONFIG_DRIFT_PATTERN = /configuration drift.*API_SERVICE/u;
const UNEXPECTED_CONFIG_DRIFT_PATTERN = /configuration drift.*unexpected MANUAL_SERVICE/u;
const ARTIFACT_DRIFT_PATTERN = /Target artifact drift/u;
const UNKNOWN_STORE_MIGRATION_PATTERN = /Store .* references unknown migration/u;
const RESOURCE_DRIFT_PATTERN = /configuration drift.*DB must use/u;
const SCHEDULE_DRIFT_PATTERN = /configuration drift.*scheduled activation/u;
const ROUTE_DRIFT_PATTERN = /configuration drift.*route activation changed/u;
const QUEUE_DRIFT_PATTERN = /configuration drift.*queue consumers/u;

test("one target compiles to the same closed graph for local and Cloudflare", async () => {
	const { target } = await loadTarget("mbza-development");
	const local = await compileTarget(target, "local");
	const development = await compileTarget(target, "development");

	assert.equal(local.graphChecksum, development.graphChecksum);
	assert.ok(local.graph.services.some(({ id, role }) => id === "site" && role === "site"));
	assert.ok(local.graph.services.some(({ id, role }) => id === "api" && role === "gateway"));
	assert.ok(
		local.graph.bindings.some(
			({ service, binding, targetService }) =>
				service === "site" && binding === "API_SERVICE" && targetService === "api",
		),
	);
	assert.ok(local.graph.plugins.some(({ pluginId }) => pluginId === "supbrd-plugmod-gateway"));
	assert.ok(local.graph.resources.some(({ key }) => key === "siteD1"));
	assert.ok(local.graph.migrations.every(({ checksum }) => CHECKSUM_PATTERN.test(checksum)));
	assert.ok(
		local.graph.secrets.some(
			({ service, names }) => service === "site" && names.includes("EMDASH_ENCRYPTION_KEY"),
		),
	);
	assert.ok(
		local.graph.healthChecks.some(
			({ service, path }) => service === "site" && path === "/superboard-system/health",
		),
	);

	const localMaterialization = materializeTarget(local, "local");
	const cloudflareMaterialization = materializeTarget(development, "cloudflare");
	assert.equal(localMaterialization.graphChecksum, local.graphChecksum);
	assert.equal(cloudflareMaterialization.graphChecksum, development.graphChecksum);
	assert.deepEqual(
		localMaterialization.services.map(({ id }) => id),
		cloudflareMaterialization.services.map(({ id }) => id),
	);
	assertTargetGraphParity([localMaterialization, cloudflareMaterialization]);
});

test("target graph drift is rejected before an adapter can run", async () => {
	const { target } = await loadTarget("mbza-development");
	const compiled = await compileTarget(target, "development");
	const cloudflare = materializeTarget(compiled, "cloudflare");
	const drifted = structuredClone(materializeTarget(compiled, "local"));
	drifted.graphChecksum = `sha256:${"0".repeat(64)}`;

	assert.throws(() => assertTargetGraphParity([cloudflare, drifted]), GRAPH_DRIFT_PATTERN);
});

test("the local Site configuration is generated and guarded by the target artifact", async () => {
	const { target } = await loadTarget("mbza-development");
	const compiled = await compileTarget(target, "local");
	const config = compileLocalSiteConfiguration(compiled);

	assert.equal(config.name, "superboard-site-local");
	assert.deepEqual(config.services, [{ binding: "API_SERVICE", service: "superboard-api-local" }]);
	assert.equal(config.d1_databases[0].database_name, "superboard-local-site-db");
	assert.deepEqual(
		config.kv_namespaces.map(({ binding }) => binding),
		["SESSION", "RELEASE_CACHE"],
	);
	assert.equal(config.vars.SUPERBOARD_INSTANCE_ID, "mbza-development");
	assert.equal(config.vars.SUPERBOARD_ENVIRONMENT, "local");
	assert.equal(JSON.parse(config.vars.SUPERBOARD_PLUGIN_IDS).length, 16);
	assert.match(config.vars.TARGET_ARTIFACT_CHECKSUM, CHECKSUM_PATTERN);
	assertTargetServiceConfiguration(compiled, "site", config);

	const drifted = structuredClone(config);
	drifted.services = [];
	assert.throws(
		() => assertTargetServiceConfiguration(compiled, "site", drifted),
		CONFIG_DRIFT_PATTERN,
	);

	const expanded = structuredClone(config);
	expanded.services.push({ binding: "MANUAL_SERVICE", service: "manual-worker" });
	assert.throws(
		() => assertTargetServiceConfiguration(compiled, "site", expanded),
		UNEXPECTED_CONFIG_DRIFT_PATTERN,
	);

	const wrongDatabase = structuredClone(config);
	wrongDatabase.d1_databases[0].database_name = "manual-site-db";
	assert.throws(
		() => assertTargetServiceConfiguration(compiled, "site", wrongDatabase),
		RESOURCE_DRIFT_PATTERN,
	);

	const wrongSchedule = structuredClone(config);
	wrongSchedule.triggers.crons = ["0 0 * * *"];
	assert.throws(
		() => assertTargetServiceConfiguration(compiled, "site", wrongSchedule),
		SCHEDULE_DRIFT_PATTERN,
	);

	const manualRoute = structuredClone(config);
	manualRoute.routes = [{ pattern: "manual.example.com", custom_domain: true }];
	assert.throws(
		() =>
			assertTargetServiceConfiguration(compiled, "site", manualRoute, {
				routesEnabled: false,
			}),
		ROUTE_DRIFT_PATTERN,
	);

	const manualConsumer = structuredClone(config);
	manualConsumer.queues = { consumers: [{ queue: "manual-queue" }] };
	assert.throws(
		() => assertTargetServiceConfiguration(compiled, "site", manualConsumer),
		QUEUE_DRIFT_PATTERN,
	);
});

test("one orchestrator plans local and Cloudflare lifecycle operations from the graph", async () => {
	const { target } = await loadTarget("mbza-development");
	const local = materializeTarget(await compileTarget(target, "local"), "local");
	const cloudflare = materializeTarget(await compileTarget(target, "development"), "cloudflare");

	const localPlan = buildTargetOperationPlan(local);
	const cloudflarePlan = buildTargetOperationPlan(cloudflare);
	assert.deepEqual(
		localPlan.operations.map(({ id }) => id),
		["provision", "configure", "migrate", "start"],
	);
	assert.deepEqual(
		cloudflarePlan.operations.map(({ id }) => id),
		["provision", "configure", "migrate", "deploy"],
	);
	assert.equal(
		new Set(local.services.map(({ localEndpoint }) => localEndpoint.port)).size,
		local.services.length,
	);
	assert.ok(cloudflare.services.every((service) => !service.localEndpoint));
	assert.ok(
		[...localPlan.operations, ...cloudflarePlan.operations].every(
			({ target: selectedTarget, environment, graphChecksum }) =>
				selectedTarget === "mbza-development" &&
				["local", "development"].includes(environment) &&
				graphChecksum === local.graphChecksum,
		),
	);
	assert.ok(
		[...localPlan.operations, ...cloudflarePlan.operations].every(
			(operation) => !Object.hasOwn(operation, "token") && !Object.hasOwn(operation, "port"),
		),
		"operation plans never introduce an out-of-manifest token or port",
	);
});

test("provision, migration and deployment plans bind the compiled target", async () => {
	const { target } = await loadTarget("mbza-development");
	const compiledTarget = await compileTarget(target, "development");
	const desired = desiredCloudflareResources(target, "development");
	const inventories = { d1: [], kv: [], r2: [], queue: [], vectorize: [] };
	for (const resource of desired) {
		inventories[resource.kind].push(remoteResource(resource));
	}
	const bootstrap = buildCloudflareBootstrapPlan({
		target,
		environment: "development",
		accountId: "a".repeat(32),
		inventories,
		compiledTarget,
	});
	const migrations = await buildD1ConvergencePlan({
		target,
		targetName: target.target,
		environment: "development",
		compiledTarget,
	});
	const deployment = buildDeploymentExecutionPlan({
		target,
		environment: "development",
		compiledTarget,
	});

	assert.equal(bootstrap.targetArtifactChecksum, compiledTarget.checksum);
	assert.equal(migrations.target_artifact_checksum, compiledTarget.checksum);
	assert.equal(deployment.targetArtifactChecksum, compiledTarget.checksum);
	assert.equal(bootstrap.graphChecksum, compiledTarget.graphChecksum);
	assert.equal(migrations.graph_checksum, compiledTarget.graphChecksum);
	assert.equal(deployment.graphChecksum, compiledTarget.graphChecksum);
});

test("operations consume the written artifact and reject later target drift", async () => {
	const { target } = await loadTarget("mbza-development");
	const compiled = await compileTarget(target, "development");
	const artifactPath = resolve(root, "deploy/generated/issue-68-test-target.json");
	await mkdir(resolve(root, "deploy/generated"), { recursive: true });
	await writeFile(artifactPath, `${JSON.stringify(compiled)}\n`);
	const args = {
		"target-artifact": artifactPath,
		"target-artifact-checksum": compiled.checksum,
	};
	try {
		const loaded = await compiledTargetFromArgs(target, "development", args);
		assert.equal(loaded.checksum, compiled.checksum);

		const drifted = structuredClone(target);
		drifted.features.paywalls = true;
		await assert.rejects(
			compiledTargetFromArgs(drifted, "development", args),
			ARTIFACT_DRIFT_PATTERN,
		);
	} finally {
		await rm(artifactPath, { force: true });
	}
});

test("the same target executes local and Cloudflare configuration adapters", async () => {
	const { target } = await loadTarget("mbza-development");
	const local = await compileTarget(target, "local");
	const development = await compileTarget(target, "development");
	const localArtifact = resolve(root, "deploy/generated/issue-68-local-target.json");
	const developmentArtifact = resolve(root, "deploy/generated/issue-68-development-target.json");
	await mkdir(resolve(root, "deploy/generated"), { recursive: true });
	await writeFile(localArtifact, `${JSON.stringify(local)}\n`);
	await writeFile(developmentArtifact, `${JSON.stringify(development)}\n`);
	try {
		const localRun = runConfigurationAdapter("local", localArtifact, local.checksum, [
			"--allow-unprovisioned",
		]);
		const cloudflareRun = runConfigurationAdapter(
			"development",
			developmentArtifact,
			development.checksum,
		);
		const routedRun = runConfigurationAdapter(
			"development",
			developmentArtifact,
			development.checksum,
			[],
			{ noRoutes: false, outputSuffix: "routes" },
		);
		assert.equal(localRun.status, 0, localRun.stderr);
		assert.equal(cloudflareRun.status, 0, cloudflareRun.stderr);
		assert.equal(routedRun.status, 0, routedRun.stderr);
		const localConfig = JSON.parse(
			await readFile(resolve(root, "deploy/generated/mbza-development-api-local.jsonc"), "utf8"),
		);
		const developmentConfig = JSON.parse(
			await readFile(
				resolve(root, "deploy/generated/mbza-development-api-development.jsonc"),
				"utf8",
			),
		);
		const routedConfig = JSON.parse(
			await readFile(
				resolve(root, "deploy/generated/mbza-development-api-development-routes.jsonc"),
				"utf8",
			),
		);
		assert.equal(local.graphChecksum, development.graphChecksum);
		assert.equal(localConfig.name, "superboard-api-local");
		assert.equal(developmentConfig.name, "superboard-api-dev");
		assert.equal(routedConfig.routes.length, 5);

		const missingRoutes = structuredClone(routedConfig);
		missingRoutes.routes = [];
		assert.throws(
			() =>
				assertTargetServiceConfiguration(development, "api", missingRoutes, {
					routesEnabled: true,
				}),
			ROUTE_DRIFT_PATTERN,
		);

		const changedQueuePolicy = structuredClone(routedConfig);
		changedQueuePolicy.queues.consumers[0].max_retries += 1;
		assert.throws(
			() =>
				assertTargetServiceConfiguration(development, "api", changedQueuePolicy, {
					routesEnabled: true,
				}),
			QUEUE_DRIFT_PATTERN,
		);
	} finally {
		await Promise.all([
			rm(localArtifact, { force: true }),
			rm(developmentArtifact, { force: true }),
		]);
	}
});

test("plugin Stores cannot escape the compiled migration graph", async () => {
	const { target } = await loadTarget("mbza-development");
	const topology = JSON.parse(
		await readFile(resolve(root, "config/emdash-plugin-topology.json"), "utf8"),
	);
	const gateway = topology.plugins.find(
		({ manifest }) => manifest.plugin_id === "supbrd-plugmod-gateway",
	);
	gateway.manifest.stores[0].migrations.push("workers/api/migrations/9999_unknown.sql");
	await assert.rejects(
		compileTarget(target, "development", { pluginTopology: topology }),
		UNKNOWN_STORE_MIGRATION_PATTERN,
	);
});

function runConfigurationAdapter(
	environment,
	artifactPath,
	checksum,
	extraArgs = [],
	{ noRoutes = true, outputSuffix } = {},
) {
	return spawnSync(
		process.execPath,
		[
			resolve(root, "scripts/cloudflare-config.mjs"),
			"--target",
			"mbza-development",
			"--environment",
			environment,
			"--service",
			"api",
			...(noRoutes ? ["--no-routes"] : []),
			...(outputSuffix ? ["--output-suffix", outputSuffix] : []),
			"--target-artifact",
			artifactPath,
			"--target-artifact-checksum",
			checksum,
			...extraArgs,
		],
		{ cwd: root, encoding: "utf8", env: process.env, shell: false },
	);
}

function remoteResource(resource) {
	if (resource.kind === "d1") {
		return { name: resource.name, uuid: resource.manifestId };
	}
	if (resource.kind === "kv") {
		return { title: resource.name, id: resource.manifestId };
	}
	if (resource.kind === "queue") {
		return { queue_name: resource.name, queue_id: `queue-${resource.key}` };
	}
	if (resource.kind === "vectorize") {
		return { name: resource.name, config: resource.configuration };
	}
	return { name: resource.name };
}
