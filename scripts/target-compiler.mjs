import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { desiredCloudflareResources } from "./cloudflare-bootstrap-core.mjs";
import { localMigrationFiles, targetD1Descriptors } from "./cloudflare-d1-registry.mjs";
import { deploymentOrder } from "./cloudflare-deploy-plan.mjs";
import { requiredSecretInventory, secretInventory } from "./cloudflare-secret-inventory.mjs";
import {
	DOMAIN_SERVICES,
	DOMAIN_SERVICE_BINDINGS,
	DOMAIN_SERVICE_REGISTRY,
	healthPathForService,
	managedWorkerDefinitions,
	managedWorkerOperationalBinding,
	workerNameForService,
} from "./cloudflare-services.mjs";
import { root } from "./cloudflare-target.mjs";

const ADAPTERS = new Set(["local", "cloudflare"]);
const LOCAL_PORT_BASE = 8787;
const LOCAL_INSPECTOR_PORT_BASE = 9229;
const PLUGIN_MIGRATION_ID_PATTERN = /^\d{4}_[a-z0-9_]+$/u;

export async function compileTarget(target, environment, options = {}) {
	const environmentResources = target.environments?.[environment];
	if (!environmentResources) {
		throw new Error(`${target.target} does not define ${environment}`);
	}
	const physicalResources = desiredCloudflareResources(target, environment);
	const migrations = await compileMigrations(target, environment);
	const pluginTopology =
		options.pluginTopology ?? (await loadPluginTopology(options.pluginTopologyPath));
	const services = compileServices(target);
	const graph = {
		services,
		resources: physicalResources
			.map(({ key, kind, configuration }) => ({
				key,
				kind,
				...(configuration ? { configuration } : {}),
			}))
			.toSorted(compareBy("kind", "key")),
		bindings: compileBindings(target, environment, physicalResources),
		secrets: secretInventory(target)
			.map(({ service, names }) => ({
				service,
				names: names.toSorted((left, right) => left.localeCompare(right)),
			}))
			.toSorted(compareBy("service")),
		migrations,
		plugins: compilePlugins(target, pluginTopology, migrations),
		routes: compileLogicalRoutes(target),
		healthChecks: compileLogicalHealthChecks(target),
		schedules: compileLogicalSchedules(target),
		queueConsumers: compileLogicalQueueConsumers(target),
	};
	const graphChecksum = canonicalChecksum(graph);
	const materialization = {
		workers: services.map(({ id }) => ({
			id,
			name: workerNameForService(target, id, environment),
		})),
		resources: physicalResources.map(({ key, kind, name, manifestId, configuration }) => ({
			key,
			kind,
			name,
			id: manifestId ?? null,
			...(configuration ? { configuration } : {}),
		})),
		requiredSecrets: requiredSecretInventory(target, environment),
		routes: compilePhysicalRoutes(target, environment),
		healthChecks: compilePhysicalHealthChecks(target),
		schedules: compilePhysicalSchedules(target, environment),
		queueConsumers: compilePhysicalQueueConsumers(target, environment, physicalResources),
		site: {
			workerLoaderBinding: target.siteRuntime.workerLoaderBinding,
			crons: [...target.siteRuntime.crons],
			observability: target.siteRuntime.observability,
			operatorEmail: target.operator.email,
			mailFromAddress: target.mail.fromAddress,
		},
	};
	const content = {
		schemaVersion: 1,
		kind: "superboard-target-artifact",
		target: target.target,
		environment,
		instance: {
			id: target.target,
			zone: target.zoneName,
		},
		release: {
			identityBinding: "SUPERBOARD_RELEASE",
			protocol: ["compile", "validate", "preview", "approve", "activate", "rollback"],
		},
		graph,
		graphChecksum,
		materialization,
	};
	return Object.freeze({ ...content, checksum: canonicalChecksum(content) });
}

export function targetWithAbsentResources(target) {
	const freshTarget = structuredClone(target);
	removeProvisionedResourceIds(freshTarget.environments);
	return freshTarget;
}

export function materializeTarget(compiledTarget, adapter) {
	if (!ADAPTERS.has(adapter)) {
		throw new Error(`Unknown target adapter ${adapter}`);
	}
	const local = adapter === "local";
	const workers = new Map(compiledTarget.materialization.workers.map(({ id, name }) => [id, name]));
	const services = compiledTarget.graph.services.map((service, index) => ({
		...service,
		workerName: workers.get(service.id),
		...(local
			? {
					localEndpoint: {
						host: "127.0.0.1",
						port: LOCAL_PORT_BASE + index,
						inspectorPort: LOCAL_INSPECTOR_PORT_BASE + index,
					},
				}
			: {}),
	}));
	const serviceEndpoints = new Map(services.map((service) => [service.id, service.localEndpoint]));
	return {
		schemaVersion: 1,
		kind: "superboard-target-materialization",
		adapter,
		target: compiledTarget.target,
		environment: compiledTarget.environment,
		artifactChecksum: compiledTarget.checksum,
		graphChecksum: compiledTarget.graphChecksum,
		services,
		resources: compiledTarget.materialization.resources.map((resource) => ({
			...resource,
			...(local ? { id: null, persistence: "local" } : {}),
		})),
		bindings: compiledTarget.graph.bindings.map((binding) => ({
			...binding,
			...(binding.targetService ? { targetWorker: workers.get(binding.targetService) } : {}),
		})),
		secrets: compiledTarget.materialization.requiredSecrets,
		migrations: compiledTarget.graph.migrations,
		routes: compiledTarget.materialization.routes,
		healthChecks: compiledTarget.materialization.healthChecks.map((healthCheck) => {
			const endpoint = serviceEndpoints.get(healthCheck.service);
			return local && healthCheck.kind === "worker" && endpoint
				? {
						...healthCheck,
						transport: "local_http",
						url: `http://${endpoint.host}:${endpoint.port}${healthCheck.path}`,
					}
				: healthCheck;
		}),
	};
}

export function assertTargetGraphParity(materializations) {
	if (!Array.isArray(materializations) || materializations.length < 2) {
		throw new Error("At least two target materializations are required");
	}
	const expected = materializations[0]?.graphChecksum;
	for (const materialization of materializations.slice(1)) {
		if (materialization.graphChecksum !== expected) {
			throw new Error(
				`Target graph drift: ${materializations[0].adapter}/${materializations[0].environment} has ${expected}, ${materialization.adapter}/${materialization.environment} has ${materialization.graphChecksum}`,
			);
		}
	}
	return true;
}

export async function assertTargetEnvironmentParity(target) {
	const environments = Object.keys(target.environments ?? {});
	if (environments.length < 2) return true;
	const materializations = [];
	for (const environment of environments) {
		materializations.push(
			materializeTarget(
				await compileTarget(target, environment),
				environment === "local" ? "local" : "cloudflare",
			),
		);
	}
	return assertTargetGraphParity(materializations);
}

export async function compiledTargetFromArgs(target, environment, args = {}) {
	await assertTargetEnvironmentParity(target);
	const artifactPath = args["target-artifact"];
	const expectedChecksum = args["target-artifact-checksum"];
	if (Boolean(artifactPath) !== Boolean(expectedChecksum)) {
		throw new Error("--target-artifact and --target-artifact-checksum are required together");
	}
	if (!artifactPath) return compileTarget(target, environment);
	if (typeof artifactPath !== "string" || typeof expectedChecksum !== "string") {
		throw new Error("Target artifact selection is invalid");
	}
	const generatedDirectory = resolve(root, "deploy/generated");
	const source = resolve(artifactPath);
	const relativePath = relative(generatedDirectory, source);
	if (relativePath.startsWith("..") || relativePath === "" || relativePath.startsWith("/")) {
		throw new Error("Target artifact must be inside deploy/generated");
	}
	const metadata = await stat(source);
	if (!metadata.isFile() || metadata.size === 0 || metadata.size > 32 * 1024 * 1024) {
		throw new Error("Target artifact file is invalid");
	}
	const artifact = JSON.parse(await readFile(source, "utf8"));
	const { checksum, ...content } = artifact;
	if (
		artifact.kind !== "superboard-target-artifact" ||
		artifact.target !== target.target ||
		artifact.environment !== environment ||
		checksum !== expectedChecksum ||
		canonicalChecksum(content) !== checksum
	) {
		throw new Error("Target artifact integrity validation failed");
	}
	const current = await compileTarget(target, environment);
	if (current.checksum !== checksum || current.graphChecksum !== artifact.graphChecksum) {
		throw new Error("Target artifact drift detected before operation");
	}
	return Object.freeze(artifact);
}

export function buildTargetOperationPlan(materialization) {
	if (!ADAPTERS.has(materialization?.adapter)) {
		throw new Error("A compiled target adapter is required");
	}
	const ids =
		materialization.adapter === "local"
			? ["provision", "configure", "migrate", "start"]
			: ["provision", "configure", "migrate", "deploy"];
	return {
		schemaVersion: 1,
		kind: "superboard-target-operation-plan",
		target: materialization.target,
		environment: materialization.environment,
		adapter: materialization.adapter,
		artifactChecksum: materialization.artifactChecksum,
		graphChecksum: materialization.graphChecksum,
		operations: ids.map((id) => ({
			id,
			target: materialization.target,
			environment: materialization.environment,
			graphChecksum: materialization.graphChecksum,
			services: materialization.services.map(({ id: service }) => service),
			migrationServices: materialization.migrations.map(({ service }) => service),
			resourceKeys: materialization.resources.map(({ key }) => key),
		})),
	};
}

export function compileLocalSiteConfiguration(compiledTarget) {
	if (compiledTarget.environment !== "local") {
		throw new Error("Local Site configuration requires the local environment");
	}
	const resources = new Map(
		compiledTarget.materialization.resources.map((resource) => [resource.key, resource]),
	);
	const workers = new Map(compiledTarget.materialization.workers.map(({ id, name }) => [id, name]));
	const siteMigration = compiledTarget.graph.migrations.find(({ service }) => service === "site");
	const siteSecrets = compiledTarget.materialization.requiredSecrets.find(
		({ service }) => service === "site",
	);
	return {
		$schema: "../../node_modules/wrangler/config-schema.json",
		name: workers.get("site"),
		main: "./src/worker.ts",
		compatibility_date: "2026-08-08",
		compatibility_flags: ["nodejs_compat"],
		d1_databases: [
			{
				binding: "DB",
				database_name: requiredResource(resources, "siteD1").name,
				migrations_dir: "migrations",
				migrations_table: "d1_migrations",
			},
		],
		r2_buckets: [
			{
				binding: "MEDIA",
				bucket_name: requiredResource(resources, "siteMedia").name,
			},
		],
		kv_namespaces: [{ binding: "SESSION" }, { binding: "RELEASE_CACHE" }],
		worker_loaders: [{ binding: compiledTarget.materialization.site.workerLoaderBinding }],
		services: [{ binding: "API_SERVICE", service: workers.get("api") }],
		tail_consumers: [{ service: workers.get("observability") }],
		images: { binding: "IMAGES" },
		assets: { binding: "ASSETS", directory: "./dist/client" },
		send_email: [
			{
				name: "EMAIL",
				allowed_destination_addresses: [compiledTarget.materialization.site.operatorEmail],
				allowed_sender_addresses: [compiledTarget.materialization.site.mailFromAddress],
			},
		],
		secrets: { required: (siteSecrets?.names ?? []).toSorted() },
		vars: {
			SUPERBOARD_INSTANCE_ID: compiledTarget.target,
			SUPERBOARD_ENVIRONMENT: compiledTarget.environment,
			SUPERBOARD_PLUGIN_IDS: JSON.stringify(
				compiledTarget.graph.plugins
					.filter(({ targetState }) => targetState === "active")
					.map(({ pluginId }) => pluginId),
			),
			SUPERBOARD_RELEASE_OPERATIONS: "disabled",
			D1_EXPECTED_MIGRATION: siteMigration?.files.at(-1)?.file,
			TARGET_ARTIFACT_CHECKSUM: compiledTarget.checksum,
		},
		triggers: { crons: [...compiledTarget.materialization.site.crons] },
		observability: compiledTarget.materialization.site.observability,
	};
}

export function assertTargetServiceConfiguration(
	compiledTarget,
	service,
	configuration,
	{ routesEnabled, sitePreviewRoute = false, preflight = false } = {},
) {
	const worker = compiledTarget.materialization.workers.find(({ id }) => id === service);
	if (!worker || configuration.name !== worker.name) {
		throw new Error(
			`Target configuration drift for ${service}: Worker name must be ${worker?.name ?? "declared"}`,
		);
	}
	const actualBindings = configuredBindings(configuration);
	const expectedBindings = compiledTarget.graph.bindings.filter(
		(binding) => binding.service === service,
	);
	for (const expected of expectedBindings) {
		const actual = actualBindings.get(expected.binding);
		if (!actual) {
			throw new Error(`Target configuration drift for ${service}: missing ${expected.binding}`);
		}
		if (expected.resourceKey) {
			const resource = compiledTarget.materialization.resources.find(
				({ key }) => key === expected.resourceKey,
			);
			assertConfiguredResource(service, expected.binding, actual, resource);
		}
		if (expected.targetService) {
			const targetWorker = compiledTarget.materialization.workers.find(
				({ id }) => id === expected.targetService,
			)?.name;
			if (actual.service !== targetWorker) {
				throw new Error(
					`Target configuration drift for ${service}: ${expected.binding} must target ${targetWorker}`,
				);
			}
		}
	}
	const expectedNames = new Set(expectedBindings.map(({ binding }) => binding));
	for (const binding of actualBindings.keys()) {
		if (!expectedNames.has(binding)) {
			throw new Error(`Target configuration drift for ${service}: unexpected ${binding}`);
		}
	}
	const expectedSecrets = compiledTarget.materialization.requiredSecrets.find(
		(entry) => entry.service === service,
	);
	const configuredSecrets = new Set(configuration.secrets?.required ?? []);
	for (const secret of expectedSecrets?.names ?? []) {
		if (!configuredSecrets.has(secret)) {
			throw new Error(
				`Target configuration drift for ${service}: missing secret contract ${secret}`,
			);
		}
	}
	for (const alternative of expectedSecrets?.alternatives ?? []) {
		if (!alternative.oneOf.some((secret) => configuredSecrets.has(secret))) {
			throw new Error(
				`Target configuration drift for ${service}: missing secret alternative ${alternative.oneOf.join(" or ")}`,
			);
		}
	}
	const allowedSecrets = new Set([
		...(compiledTarget.graph.secrets.find((entry) => entry.service === service)?.names ?? []),
		...(expectedSecrets?.names ?? []),
		...(expectedSecrets?.alternatives ?? []).flatMap(({ oneOf }) => oneOf),
	]);
	for (const secret of configuredSecrets) {
		if (!allowedSecrets.has(secret)) {
			throw new Error(
				`Target configuration drift for ${service}: unexpected secret contract ${secret}`,
			);
		}
	}
	const expectedCrons = preflight
		? []
		: (compiledTarget.materialization.schedules.find(
				({ service: scheduledService }) => scheduledService === service,
			)?.crons ?? []);
	const configuredCrons = configuration.triggers?.crons ?? [];
	if (!sameStrings(expectedCrons, configuredCrons)) {
		throw new Error(`Target configuration drift for ${service}: scheduled activation changed`);
	}
	const expectedConsumers = preflight
		? []
		: compiledTarget.materialization.queueConsumers
				.filter(({ service: consumerService }) => consumerService === service)
				.map(normalizeCompiledConsumer)
				.toSorted(compareBy("queue"));
	const configuredConsumers = (configuration.queues?.consumers ?? [])
		.map(normalizeConfiguredConsumer)
		.toSorted(compareBy("queue"));
	if (canonicalJson(expectedConsumers) !== canonicalJson(configuredConsumers)) {
		throw new Error(`Target configuration drift for ${service}: queue consumers changed`);
	}
	assertConfiguredRoutes(compiledTarget, service, configuration, {
		routesEnabled,
		sitePreviewRoute,
	});
	assertTailConsumer(compiledTarget, service, configuration);
	if (service === "api") assertHealthChecks(compiledTarget, configuration);
	return true;
}

export function canonicalChecksum(value) {
	return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

async function compileMigrations(target, environment) {
	const descriptors = targetD1Descriptors(target, target.target, environment, "all");
	const migrations = [];
	for (const descriptor of descriptors) {
		const files = await localMigrationFiles(descriptor);
		const entries = [];
		for (const file of files) {
			const path = resolve(descriptor.migrationsPath, file);
			const contents = await readFile(path);
			entries.push({
				file,
				checksum: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
			});
		}
		const content = {
			service: descriptor.service,
			binding: descriptor.binding,
			directory: descriptor.migrationsDirectory,
			files: entries,
		};
		migrations.push({ ...content, checksum: canonicalChecksum(content) });
	}
	return migrations.toSorted(compareBy("service"));
}

function compileServices(target) {
	return deploymentOrder(target).map((id) => ({
		id,
		role: id === "site" ? "site" : id === "api" ? "gateway" : "worker",
	}));
}

function compileBindings(target, environment, physicalResources) {
	const bindings = [];
	const addService = (service, binding, targetService) => {
		bindings.push({ service, binding, kind: "service", targetService });
	};
	const addResource = (service, binding, resourceKey) => {
		bindings.push({ service, binding, kind: "resource", resourceKey });
	};
	const addRuntime = (service, binding) => {
		bindings.push({ service, binding, kind: "runtime" });
	};

	addService("site", "API_SERVICE", "api");
	addService("mcp", "API_SERVICE", "api");
	addService("identity", "EMAIL_SERVICE", "email");
	addService("identity", "FILES_SERVICE", "files");
	addService("api", "EMAIL_SERVICE", "email");
	addService("api", "IDENTITY_SERVICE", "identity");
	addService("api", "FILES_SERVICE", "files");
	addService("api", "OBSERVABILITY", "observability");
	addService("dashboard", "WORKER_SELF_REFERENCE", "dashboard");
	if (target.features.billing) addService("api", "BILLING", "billing");
	if (target.features.messaging) addService("api", "MESSAGING", "messaging");
	if (target.customWorker) addService("api", "CUSTOM_WORKER", "custom");
	if (target.features.analytics && target.features.billing) {
		addService("billing", "ANALYTICS_MODULE", "analytics");
	}
	for (const service of DOMAIN_SERVICES.filter((candidate) => target.features[candidate])) {
		addService("api", DOMAIN_SERVICE_BINDINGS[service], service);
		const definition = DOMAIN_SERVICE_REGISTRY[service];
		for (const dependency of definition.services) {
			addService(service, dependency.binding, dependency.service);
		}
		for (const resource of definition.r2) {
			addResource(service, resource.binding, `moduleR2.${resource.resourceKey}`);
		}
		for (const queue of definition.queues) {
			addResource(service, queue.binding, `moduleQueues.${queue.resourceKey}.name`);
		}
		for (const vectorize of definition.vectorize) {
			addResource(service, vectorize.binding, `moduleVectorize.${vectorize.resourceKey}`);
		}
		if (definition.ai) addRuntime(service, definition.ai.binding);
		for (const workflow of definition.workflows) {
			addRuntime(service, workflow.binding);
		}
		for (const durableObject of definition.durableObjects) {
			addRuntime(service, durableObject.name);
		}
	}
	for (const component of managedWorkerDefinitions(target)) {
		const managedService = `managed-${component.id}`;
		addService("api", managedWorkerOperationalBinding(component), managedService);
		addResource(managedService, component.d1Binding, "customD1");
		addRuntime(managedService, component.workflow.binding);
		for (const container of component.containers) {
			addRuntime(managedService, container.binding);
		}
		for (const durableObject of component.durableObjects) {
			addRuntime(managedService, durableObject.binding);
		}
	}
	for (const customBinding of target.customWorker?.serviceBindings ?? []) {
		const targetService = serviceForWorkerName(
			target,
			environment,
			customBinding.workers[environment],
		);
		if (targetService) addService("custom", customBinding.binding, targetService);
	}

	for (const descriptor of targetD1Descriptors(target, target.target, environment, "all")) {
		const resource = physicalResources.find(
			({ kind, name }) => kind === "d1" && name === descriptor.databaseName,
		);
		if (!resource) {
			throw new Error(`No target resource owns ${descriptor.service} D1`);
		}
		addResource(descriptor.service, descriptor.binding, resource.key);
	}
	for (const [service, binding, resourceKey] of [
		["site", "MEDIA", "siteMedia"],
		["site", "SESSION", "siteSessionKv"],
		["site", "RELEASE_CACHE", "siteReleaseKv"],
		["api", "KV", "kv"],
		["api", "R2", "r2"],
		["api", "EVENT_QUEUE", "queues.events"],
		["api", "PUSH_QUEUE", "queues.push"],
		["api", "MAINTENANCE_QUEUE", "queues.maintenance"],
		...(target.features.billing ? [["api", "BILLING_QUEUE", "queues.billing"]] : []),
		...(target.features.billing
			? [
					["billing", "DB", "d1"],
					["billing", "KV", "kv"],
					["billing", "R2", "r2"],
					["billing", "BILLING_QUEUE", "queues.billing"],
				]
			: []),
		...(target.features.messaging
			? [
					["messaging", "ATTACHMENTS", "messagingR2"],
					["messaging", "MESSAGING_QUEUE", "queues.messaging"],
				]
			: []),
		["email", "EMAIL_QUEUE", "queues.email"],
		["files", "FILES", "r2"],
		["dashboard", "NEXT_INC_CACHE_R2_BUCKET", "dashboardCache"],
	]) {
		addResource(service, binding, resourceKey);
	}
	for (const binding of ["LOADER", "IMAGES", "EMAIL", "ASSETS"]) {
		addRuntime("site", binding);
	}
	addRuntime("identity", "ASSETS");
	addRuntime("observability", "ANALYTICS");
	addRuntime("dashboard", "ASSETS");
	addRuntime("dashboard", "IMAGES");
	if (target.features.messaging) addRuntime("messaging", "CONVERSATIONS");
	return bindings.toSorted(compareBy("service", "kind", "binding"));
}

function compilePlugins(target, topology, migrations) {
	if (!Array.isArray(topology?.plugins)) {
		throw new Error("Plugin topology does not define plugins");
	}
	const migrationPaths = new Set(
		migrations.flatMap((migration) =>
			migration.files.map(({ file }) => `${migration.directory}/${file}`),
		),
	);
	return topology.plugins
		.filter(({ manifest }) => !manifest?.plugin_id.includes("*"))
		.map(({ manifest, worker_descriptor: workerDescriptor }) => {
			const targetState = pluginEnabled(target, manifest.plugin_id) ? "active" : "installed";
			const storeIds = new Set((manifest.stores ?? []).map(({ store_id: storeId }) => storeId));
			for (const storeId of workerDescriptor?.store_ids ?? []) {
				if (!storeIds.has(storeId)) {
					throw new Error(
						`Plugin ${manifest.plugin_id} Worker references undeclared Store ${storeId}`,
					);
				}
			}
			const stores = (manifest.stores ?? []).map(
				({ store_id: storeId, checksum, migrations: storeMigrations = [] }) => {
					for (const migration of storeMigrations) {
						if (
							targetState === "active" &&
							!PLUGIN_MIGRATION_ID_PATTERN.test(migration) &&
							!migrationPaths.has(migration)
						) {
							throw new Error(
								`Plugin ${manifest.plugin_id} Store ${storeId} references unknown migration ${migration}`,
							);
						}
					}
					return { storeId, checksum, migrations: [...storeMigrations] };
				},
			);
			return {
				pluginId: manifest.plugin_id,
				targetState,
				kind: manifest.plugin_kind,
				version: manifest.plugin_version,
				artifactChecksum: manifest.artifact_checksum,
				worker: manifest.execution.worker,
				workerDescriptorChecksum: workerDescriptor?.checksum ?? null,
				stores,
			};
		})
		.toSorted(compareBy("pluginId"));
}

function pluginEnabled(target, pluginId) {
	const featureByPlugin = {
		"supbrd-plug-products": "products",
		"supbrd-plugmod-billing": "billing",
		"supbrd-plugmod-support": "support",
		"supbrd-plugmod-flows": "flows",
		"supbrd-plugmod-analytics": "analytics",
		"supbrd-plugmod-marketing": "marketing",
		"supbrd-plugmod-dynamic-links": "dynamic-links",
		"supbrd-plugmod-paywalls": "paywalls",
		"supbrd-plugmod-onboardings": "onboardings",
	};
	if (pluginId === "supbrd-plugmod-custom-*") return Boolean(target.customWorker);
	const feature = featureByPlugin[pluginId];
	return feature ? target.features[feature] === true : true;
}

function compileLogicalRoutes(target) {
	return [
		{ id: "api", service: "api", surface: "gateway" },
		{ id: "auth", service: "api", surface: "identity-gateway" },
		{ id: "shortlinks", service: "api", surface: "shortlinks" },
		{ id: "sdk", service: "api", surface: "sdk" },
		{ id: "files", service: "api", surface: "files" },
		{ id: "site", service: "site", surface: "front" },
		{ id: "dashboard", service: "dashboard", surface: "legacy-dashboard" },
		{ id: "mcp", service: "mcp", surface: "mcp" },
		...(target.mail.transport === "capture" && target.domains.mailPreview
			? [{ id: "mail-preview", service: "email", surface: "mail-preview" }]
			: []),
		...(target.features.messaging
			? [{ id: "messaging", service: "messaging", surface: "messaging" }]
			: []),
		...(target.features.support
			? [{ id: "support", service: "api", surface: "gateway-module" }]
			: []),
	];
}

function compileLogicalHealthChecks(target) {
	return [
		...compileServices(target).map(({ id: service }) => ({
			id: `worker:${service}`,
			kind: "worker",
			service,
			path: healthPathForService(service),
			...(service === "observability"
				? {
						authentication: {
							type: "secret",
							binding: "OBSERVABILITY_INTERNAL_TOKEN",
							header: "x-observability-token",
						},
					}
				: {}),
		})),
		{ id: "site", kind: "public_surface", service: "site", path: "/superboard-system/health" },
		{ id: "api", kind: "public_surface", service: "api", path: "/health" },
		{ id: "sdk", kind: "public_surface", service: "api", path: "/health" },
		{ id: "shortlinks", kind: "public_surface", service: "api", path: "/health" },
		{ id: "files", kind: "public_surface", service: "api", path: "/health" },
		{ id: "mcp", kind: "public_surface", service: "mcp", path: "/health" },
		{ id: "dashboard", kind: "public_surface", service: "dashboard", path: "/" },
		...(target.domains.mailPreview
			? [{ id: "mail-preview", kind: "public_surface", service: "email", path: "/" }]
			: []),
		...(target.publicSurfaceMonitors ?? []).map((monitor) => ({
			id: monitor.id,
			kind: "public_surface",
			service: "external",
			path: new URL(monitor.healthUrl ?? monitor.url).pathname,
		})),
	].toSorted(compareBy("id"));
}

function compilePhysicalRoutes(target, environment) {
	return compileLogicalRoutes(target).map((route) => ({
		...route,
		hostname:
			route.id === "support"
				? target.domains.api
				: route.id === "mail-preview"
					? target.domains.mailPreview
					: target.domains[route.id],
		pattern:
			route.id === "support"
				? target.environments[environment].supportRouting.pattern
				: route.id === "mail-preview"
					? target.domains.mailPreview
					: target.domains[route.id],
		mode:
			route.id === "support"
				? target.environments[environment].supportRouting.mode
				: target.environments[environment].publicRouting,
	}));
}

function compilePhysicalHealthChecks(target) {
	const publicHostnames = {
		site: target.domains.site,
		api: target.domains.api,
		sdk: target.domains.sdk,
		shortlinks: target.domains.shortlinks,
		files: target.domains.files,
		mcp: target.domains.mcp,
		dashboard: target.domains.dashboard,
		"mail-preview": target.domains.mailPreview,
	};
	const declared = new Map(
		(target.publicSurfaceMonitors ?? []).map((monitor) => [monitor.id, monitor]),
	);
	return compileLogicalHealthChecks(target).map((healthCheck) => {
		const declaredUrl = declared.get(healthCheck.id)?.healthUrl;
		const hostname = healthCheck.kind === "public_surface" ? publicHostnames[healthCheck.id] : null;
		return {
			...healthCheck,
			transport: declaredUrl || hostname ? "https" : "service_binding",
			url: declaredUrl ?? (hostname ? `https://${hostname}${healthCheck.path}` : null),
		};
	});
}

function compileLogicalSchedules(target) {
	return [
		{ service: "api", crons: ["*/10 * * * *"], policy: "active" },
		{ service: "site", crons: [...target.siteRuntime.crons], policy: "active" },
		...(target.features.billing
			? [
					{
						service: "billing",
						crons: ["*/10 * * * *"],
						policy: "billing-service-mode",
					},
				]
			: []),
		...(target.customWorker?.crons?.length
			? [{ service: "custom", crons: [...target.customWorker.crons], policy: "active" }]
			: []),
		...DOMAIN_SERVICES.filter((service) => target.features[service]).flatMap((service) => {
			const crons = DOMAIN_SERVICE_REGISTRY[service].crons;
			return crons.length ? [{ service, crons: [...crons], policy: "active" }] : [];
		}),
	].toSorted(compareBy("service"));
}

function compilePhysicalSchedules(target, environment) {
	return compileLogicalSchedules(target)
		.filter(
			(schedule) =>
				schedule.policy === "active" ||
				target.environments[environment].billingExecutionMode === "service",
		)
		.map(({ service, crons }) => ({ service, crons }));
}

function compileLogicalQueueConsumers(target) {
	return [
		logicalQueueConsumer("api", "queues.events", "queues.eventsDlq", 25, 10, 5),
		logicalQueueConsumer("api", "queues.push", "queues.pushDlq", 10, 5, 5),
		logicalQueueConsumer("api", "queues.maintenance", "queues.maintenanceDlq", 5, 10, 3),
		logicalQueueConsumer("api", "queues.eventsDlq", null, 10, 5, 100),
		logicalQueueConsumer("api", "queues.pushDlq", null, 10, 5, 100),
		logicalQueueConsumer("api", "queues.maintenanceDlq", null, 10, 5, 100),
		...(target.features.billing
			? [
					logicalQueueConsumer(
						"api",
						"queues.billing",
						"queues.billingDlq",
						10,
						5,
						8,
						"billing-local-mode",
					),
					logicalQueueConsumer(
						"billing",
						"queues.billing",
						"queues.billingDlq",
						10,
						5,
						8,
						"billing-service-mode",
					),
					logicalQueueConsumer("billing", "queues.billingDlq", null, 10, 5, 8),
				]
			: []),
		logicalQueueConsumer("email", "queues.email", "queues.emailDlq", 10, 5, 8),
		logicalQueueConsumer("email", "queues.emailDlq", null, 10, 5, 100),
		...(target.features.messaging
			? [
					logicalQueueConsumer("messaging", "queues.messaging", "queues.messagingDlq", 10, 5, 8),
					logicalQueueConsumer("messaging", "queues.messagingDlq", null, 10, 5, 100),
				]
			: []),
		...DOMAIN_SERVICES.filter((service) => target.features[service]).flatMap((service) =>
			DOMAIN_SERVICE_REGISTRY[service].queues.flatMap((queue) => [
				logicalQueueConsumer(
					service,
					`moduleQueues.${queue.resourceKey}.name`,
					`moduleQueues.${queue.resourceKey}.dlq`,
					queue.maxBatchSize,
					queue.maxBatchTimeout,
					queue.maxRetries,
				),
				logicalQueueConsumer(service, `moduleQueues.${queue.resourceKey}.dlq`, null, 10, 5, 100),
			]),
		),
	].toSorted(compareBy("service", "resourceKey"));
}

function compilePhysicalQueueConsumers(target, environment, physicalResources) {
	const billingMode = target.environments[environment].billingExecutionMode;
	const resources = new Map(physicalResources.map((resource) => [resource.key, resource]));
	return compileLogicalQueueConsumers(target)
		.filter(
			({ policy }) =>
				policy === "active" ||
				(policy === "billing-local-mode" && billingMode === "local") ||
				(policy === "billing-service-mode" && billingMode === "service"),
		)
		.map((consumer) => ({
			service: consumer.service,
			resourceKey: consumer.resourceKey,
			queue: resources.get(consumer.resourceKey)?.name,
			deadLetterQueue: consumer.deadLetterResourceKey
				? resources.get(consumer.deadLetterResourceKey)?.name
				: null,
			maxBatchSize: consumer.maxBatchSize,
			maxBatchTimeout: consumer.maxBatchTimeout,
			maxRetries: consumer.maxRetries,
			retryDelay: consumer.retryDelay,
		}));
}

function logicalQueueConsumer(
	service,
	resourceKey,
	deadLetterResourceKey,
	maxBatchSize,
	maxBatchTimeout,
	maxRetries,
	policy = "active",
) {
	return {
		service,
		resourceKey,
		deadLetterResourceKey,
		maxBatchSize,
		maxBatchTimeout,
		maxRetries,
		retryDelay: null,
		policy,
	};
}

function serviceForWorkerName(target, environment, workerName) {
	for (const service of deploymentOrder(target)) {
		if (workerNameForService(target, service, environment) === workerName) {
			return service;
		}
	}
	return null;
}

function configuredBindings(configuration) {
	const bindings = new Map();
	const add = (binding, value = {}) => {
		if (binding) bindings.set(binding, value);
	};
	for (const entry of configuration.d1_databases ?? []) add(entry.binding, entry);
	for (const entry of configuration.r2_buckets ?? []) add(entry.binding, entry);
	for (const entry of configuration.kv_namespaces ?? []) add(entry.binding, entry);
	for (const entry of configuration.services ?? []) add(entry.binding, entry);
	for (const entry of configuration.worker_loaders ?? []) add(entry.binding, entry);
	for (const entry of configuration.send_email ?? []) add(entry.name, entry);
	for (const entry of configuration.queues?.producers ?? []) add(entry.binding, entry);
	for (const entry of configuration.analytics_engine_datasets ?? []) {
		add(entry.binding, entry);
	}
	for (const entry of configuration.vectorize ?? []) add(entry.binding, entry);
	for (const entry of configuration.workflows ?? []) add(entry.binding, entry);
	for (const entry of configuration.durable_objects?.bindings ?? []) {
		add(entry.name, entry);
	}
	add(configuration.assets?.binding, configuration.assets);
	add(configuration.images?.binding, configuration.images);
	add(configuration.ai?.binding, configuration.ai);
	return bindings;
}

function assertConfiguredResource(service, binding, actual, resource) {
	if (!resource) {
		throw new Error(`Target configuration drift for ${service}: ${binding} has no resource`);
	}
	const nameField = {
		d1: "database_name",
		r2: "bucket_name",
		queue: "queue",
		vectorize: "index_name",
	}[resource.kind];
	if (nameField && actual[nameField] !== resource.name) {
		throw new Error(
			`Target configuration drift for ${service}: ${binding} must use ${resource.name}`,
		);
	}
	const idField = resource.kind === "d1" ? "database_id" : resource.kind === "kv" ? "id" : null;
	if (idField && resource.id && actual[idField] !== resource.id) {
		throw new Error(
			`Target configuration drift for ${service}: ${binding} must use ${resource.id}`,
		);
	}
}

function assertConfiguredRoutes(
	compiledTarget,
	service,
	configuration,
	{ routesEnabled, sitePreviewRoute },
) {
	if (routesEnabled === undefined) return;
	const configuredPatterns = (configuration.routes ?? []).map(({ pattern }) => pattern).toSorted();
	const expectedPatterns = expectedRoutePatterns(compiledTarget, service, {
		routesEnabled,
		sitePreviewRoute,
	}).toSorted();
	if (!sameStrings(expectedPatterns, configuredPatterns)) {
		throw new Error(`Target configuration drift for ${service}: route activation changed`);
	}
}

function expectedRoutePatterns(compiledTarget, service, { routesEnabled, sitePreviewRoute }) {
	if (!routesEnabled) return [];
	const routes = compiledTarget.materialization.routes;
	if (service === "api") {
		const support = routes.find(({ id }) => id === "support");
		if (compiledTarget.environment === "production" && support) {
			return support.mode === "active" ? [support.pattern] : [];
		}
		return routes
			.filter(({ id }) => ["api", "auth", "shortlinks", "sdk", "files"].includes(id))
			.map(({ pattern }) => pattern);
	}
	if (service === "site") {
		return sitePreviewRoute
			? routes.filter(({ id }) => id === "site").map(({ pattern }) => pattern)
			: [];
	}
	const routeIds = {
		dashboard: "dashboard",
		email: "mail-preview",
		mcp: "mcp",
		messaging: "messaging",
	};
	const routeId = routeIds[service];
	return routeId ? routes.filter(({ id }) => id === routeId).map(({ pattern }) => pattern) : [];
}

function assertTailConsumer(compiledTarget, service, configuration) {
	const configured = (configuration.tail_consumers ?? []).map(({ service: worker }) => worker);
	const expected =
		service === "observability"
			? []
			: [compiledTarget.materialization.workers.find(({ id }) => id === "observability")?.name];
	if (!sameStrings(expected, configured)) {
		throw new Error(`Target configuration drift for ${service}: tail consumer changed`);
	}
}

function assertHealthChecks(compiledTarget, configuration) {
	let configured;
	try {
		configured = JSON.parse(configuration.vars?.PUBLIC_SURFACES_JSON ?? "[]");
	} catch {
		throw new Error("Target configuration drift for api: health checks are invalid");
	}
	const actual = configured.map(({ id, healthUrl }) => `${id}:${healthUrl}`).toSorted();
	const expected = compiledTarget.materialization.healthChecks
		.filter(({ id, kind }) => kind === "public_surface" && id !== "site")
		.map(({ id, url }) => `${id}:${url}`)
		.toSorted();
	if (!sameStrings(expected, actual)) {
		throw new Error("Target configuration drift for api: health checks changed");
	}
}

function sameStrings(left, right) {
	if (left.length !== right.length) return false;
	const sortedRight = right.toSorted();
	return left.toSorted().every((value, index) => value === sortedRight[index]);
}

function removeProvisionedResourceIds(value) {
	if (!value || typeof value !== "object") return;
	if (!Array.isArray(value) && typeof value.name === "string") delete value.id;
	for (const child of Object.values(value)) removeProvisionedResourceIds(child);
}

function normalizeCompiledConsumer(consumer) {
	return {
		queue: consumer.queue,
		deadLetterQueue: consumer.deadLetterQueue,
		maxBatchSize: consumer.maxBatchSize,
		maxBatchTimeout: consumer.maxBatchTimeout,
		maxRetries: consumer.maxRetries,
		retryDelay: consumer.retryDelay,
	};
}

function normalizeConfiguredConsumer(consumer) {
	return {
		queue: consumer.queue,
		deadLetterQueue: consumer.dead_letter_queue ?? null,
		maxBatchSize: consumer.max_batch_size,
		maxBatchTimeout: consumer.max_batch_timeout,
		maxRetries: consumer.max_retries,
		retryDelay: consumer.retry_delay ?? null,
	};
}

function requiredResource(resources, key) {
	const resource = resources.get(key);
	if (!resource) throw new Error(`Compiled target does not define ${key}`);
	return resource;
}

async function loadPluginTopology(path = resolve(root, "config/emdash-plugin-topology.json")) {
	return JSON.parse(await readFile(path, "utf8"));
}

function canonicalJson(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.keys(value)
		.toSorted()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
		.join(",")}}`;
}

function compareBy(...keys) {
	return (left, right) => {
		for (const key of keys) {
			const comparison = String(left[key]).localeCompare(String(right[key]), "en");
			if (comparison !== 0) return comparison;
		}
		return 0;
	};
}
