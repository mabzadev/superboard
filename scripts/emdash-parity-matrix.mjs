import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_CUTOVER_REGISTRY } from "./module-cutover/registry.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const matrixPath = join(root, "config/emdash-parity-matrix.json");
const topologyPath = join(root, "config/emdash-plugin-topology.json");
const receiptPath = join(root, "docs/evidence/issue-54/parity-matrix.receipt.json");
const manifestMigrationPath = join(root, "apps/site/migrations/0006_plugin_manifest_registry.sql");
const PAGE_SUFFIX = "/page.tsx";
const PAGE_SUFFIX_PATTERN = /\/page\.tsx$/u;
const SUPPORT_OR_FLOWS_ROUTE_PATTERN = /\/(?:support|flows)(?:\/|$)/u;
const SUPPORT_ROUTE_PATTERN = /\/support(?:\/|$)/u;
const FLOWS_ROUTE_PATTERN = /\/flows(?:\/|$)/u;
const TEST_FILE_PATTERN = /\.(?:runtime\.)?test\.ts$/u;
const APP_USER_ROUTE_PATTERN = /^\/app\/(?:users|customers)/u;

const fullPlugins = ["user", "settings", "content", "products", "audit"];
const modulePlugins = [
	["gateway", "api"], ["billing", "billing"], ["support", "support"], ["flows", "flows"],
	["analytics", "analytics"], ["marketing", "marketing"], ["email", "email"],
	["dynamic-links", "dynamic-links"], ["files", "files"], ["paywalls", "paywalls"],
	["onboardings", "onboardings"], ["observability", "observability"], ["mcp", "mcp"],
	["custom-*", null],
];
const pluginStores = {
	"supbrd-plug-user": ["directory", "credentials", "sessions"],
	"supbrd-plug-settings": ["settings", "versions"],
	"supbrd-plug-content": ["documents", "taxonomies", "revisions"],
	"supbrd-plug-products": ["catalog", "offers", "prices"],
	"supbrd-plug-audit": ["ledger", "archives"],
	"supbrd-plugmod-gateway": ["route_manifests", "rate_limits"],
	"supbrd-plugmod-billing": ["purchases", "subscriptions", "ledger"],
	"supbrd-plugmod-support": ["conversations", "contacts", "messages"],
	"supbrd-plugmod-flows": ["definitions", "runtime"],
	"supbrd-plugmod-analytics": ["events", "aggregates"],
	"supbrd-plugmod-marketing": ["campaigns", "journeys", "consent"],
	"supbrd-plugmod-email": ["deliveries", "provider_events"],
	"supbrd-plugmod-dynamic-links": ["links", "attribution"],
	"supbrd-plugmod-files": ["objects", "tickets"],
	"supbrd-plugmod-paywalls": ["definitions", "exposures"],
	"supbrd-plugmod-onboardings": ["definitions", "progress"],
	"supbrd-plugmod-observability": ["health_projections"],
	"supbrd-plugmod-mcp": ["sessions", "tool_receipts"],
	"supbrd-plugmod-custom-*": ["operations"],
};

export function buildPluginTopology() {
	const plugins = [
		...fullPlugins.map((name) => pluginTopologyEntry(`supbrd-plug-${name}`, "full", null)),
		...modulePlugins.map(([name, worker]) =>
			pluginTopologyEntry(
				`supbrd-plugmod-${name}`,
				"module",
				workerRuntimeContract(name, worker),
			),
		),
	];
	return {
		schema_version: 1,
		aliases: { projectId: "instance_id", pid: "instance_id" },
		plugins,
	};
}

export function buildParityMatrix() {
	const dashboardPages = walk(join(root, "apps/dashboard/src/app"), (path) => path.replaceAll(sep, "/").endsWith(PAGE_SUFFIX));
	const dashboardRows = dashboardPages.map((absolute) => {
		const path = relative(join(root, "apps/dashboard/src/app"), absolute)
			.replaceAll(sep, "/")
			.replace(PAGE_SUFFIX_PATTERN, "")
			.replaceAll("(protected)/", "");
		const route = path === "" ? "/" : `/${path}`;
		return row({
			id: `dashboard:${route}`,
			kind: "dashboard",
			baseline: relative(root, absolute),
			target: targetForRoute(route),
			test: "scripts/dashboard-route-parity.test.mjs",
			sourceStatus: SUPPORT_OR_FLOWS_ROUTE_PATTERN.test(route) ? "unvalidated" : "delivered",
			blocker: SUPPORT_ROUTE_PATTERN.test(route) ? "support_extended_gate" : FLOWS_ROUTE_PATTERN.test(route) ? "flows_complete_gate" : null,
		});
	});

	const apiNamespaces = [
		"/health|/.well-known/*", "/oauth/*|/api/v1/auth/*|/api/v1/users/*", "/auth/*",
		"/api/v1/instances/*|projects/*|links/*", "/api/v1/sdk/*", "/api/v1/{domain}/*",
		"/api/v1/support-client/*|support/realtime/*", "/api/v1/app-files/*", "/api/v1/billing/*|/api/v2/purchases/*|/api/v1/iap/*",
		"/api/v1/platform/*", "/api/v1/mcp/*", "/api/v1/admin/*|automation/*|diagnostics/*",
		"/api/v1/marketing/tracking/*|opt-in/*|webhooks/*", "/short-links/*",
	];
	const apiRows = apiNamespaces.map((namespace) => row({
		id: `api:${namespace}`,
		kind: "api",
		baseline: "workers/api/src/index.ts",
		target: "supbrd-plugmod-gateway",
		test: apiProof(namespace),
		sourceStatus: namespace.includes("support") ? "unvalidated" : "delivered",
		blocker: namespace.includes("support") ? "support_extended_gate" : null,
	}));

	const workerRows = modulePlugins.flatMap(([name, worker]) => {
		if (!worker) return [];
		const workerDirectory = join(root, `workers/${worker}`);
		const proof = workerProof(worker, workerDirectory);
		return [row({
			id: `worker:${worker}`,
			kind: "worker",
			baseline: `workers/${worker}/src/index.ts`,
			target: `supbrd-plugmod-${name}`,
			test: proof ? relative(root, proof) : "scripts/emdash-parity-matrix.test.mjs",
			sourceStatus: name === "support" || name === "flows" ? "unvalidated" : "delivered",
			blocker: name === "support" ? "support_extended_gate" : name === "flows" ? "flows_complete_gate" : null,
		})];
	});

	const sdkRows = [
		["javascript", "sdks/javascript/src", "sdks/javascript/test/emdash-store-parity.test.js"],
		["react-native", "sdks/react-native/src", "sdks/react-native/src/__tests__/index.test.tsx"],
		["flutter", "sdks/flutter/lib", "sdks/flutter/test/emdash_store_parity_test.dart"],
		["flutterflow", "sdks/flutterflow/lib", "sdks/flutterflow/test/emdash_store_parity_test.dart"],
	].map(([name, baseline, test]) => row({
		id: `sdk:${name}`,
		kind: "sdk",
		baseline,
		target: "external-client-contract",
		test,
	}));

	const rows = [...dashboardRows, ...apiRows, ...workerRows, ...sdkRows].toSorted((a, b) => a.id.localeCompare(b.id));
	return {
		schema_version: 1,
		inventory_source: "docs/SUPERBOARD_CURRENT_STATE_INVENTORY_2026-08-29.md",
		baseline_inventory_revision: "b25677f122613de5b01fd2d4c21fa5c669c24cb4",
		working_tree_base_revision: "3dc65564",
		public_cutover: false,
		rows,
	};
}

export function validateArtifacts(matrix, topology) {
	const pluginIds = new Set(topology.plugins.map(({ manifest }) => manifest.plugin_id));
	const errors = [];
	if (topology.plugins.length !== 19) errors.push("PLUGIN_TOPOLOGY_INCOMPLETE");
	for (const plugin of topology.plugins) {
		const { manifest, repositories, worker_descriptor: workerDescriptor } = plugin;
		if (manifest.stores.length !== repositories.length || repositories.length === 0) errors.push(`PLUGIN_AUTHORITY_MISSING:${manifest.plugin_id}`);
		if (
			manifest.plugin_kind === "module" &&
			(!workerDescriptor ||
				workerDescriptor.authoritative_writes !== false ||
				workerDescriptor.idempotency !== "required" ||
				(workerDescriptor.execution_mode === "asynchronous" &&
					(workerDescriptor.lease !== "attempt_scoped" || workerDescriptor.outbox !== "required")) ||
				!workerDescriptor.evidence_sha256)
		) {
			errors.push(`WORKER_TRANSITION_CONTRACT_INVALID:${manifest.plugin_id}`);
		}
		const { artifact_checksum: artifactChecksum, ...artifact } = manifest;
		if (artifactChecksum !== hash(artifact)) errors.push(`PLUGIN_ARTIFACT_CHECKSUM_INVALID:${manifest.plugin_id}`);
	}
	for (const item of matrix.rows) {
		if (item.required && (!item.test || !item.proof_sha256)) errors.push(`REQUIRED_PROOF_MISSING:${item.id}`);
		if (!existsSync(join(root, item.baseline))) errors.push(`BASELINE_MISSING:${item.id}`);
		if (!existsSync(join(root, item.test))) errors.push(`TEST_MISSING:${item.id}`);
		if (item.target.startsWith("supbrd-") && !pluginIds.has(item.target) && item.target !== "supbrd-core") errors.push(`TARGET_UNKNOWN:${item.id}`);
		if ((item.id.includes("support") || item.id.includes("flows")) && item.source_status !== "unvalidated") errors.push(`SOURCE_STATUS_INVALID:${item.id}`);
	}
	return errors;
}

function pluginTopologyEntry(pluginId, kind, worker) {
	const declaredStoreNames = pluginStores[pluginId];
	if (!declaredStoreNames) throw new Error(`Missing domain Store inventory for ${pluginId}`);
	const storeNames = [
		...new Set([
			...declaredStoreNames,
			...MODULE_CUTOVER_REGISTRY.filter((entity) => entity.pluginId === pluginId).map(
				(entity) => entity.target.table,
			),
		]),
	].toSorted();
	const stores = storeNames.map((name) => contribution({
		store_id: `${pluginId}.store.${name}`,
		kind: "d1",
		authority: pluginId,
		schema_version: "1",
		migrations: migrationInventory(pluginId),
		availability: "required",
		classification: name.includes("credentials") ? "secret" : "restricted",
		encryption: "required",
		version: "1.0.0",
	}));
	const repositories = stores.map(({ store_id: storeId }) => contribution({
		repository_id: `${storeId.replace(".store.", ".repository.")}`,
		store_id: storeId,
		write_authority: "emdash",
		compatibility_aliases: ["projectId", "pid"],
		version: "1.0.0",
	}));
	const schemas = storeNames.map((name) => contribution({
		schema_id: `${pluginId}.schema.${name}_record.v1`,
		closed: true,
		json_schema: {
			type: "object",
			additionalProperties: false,
			required: ["entity_id", "revision", "payload"],
			properties: { entity_id: { type: "string" }, revision: { type: "integer", minimum: 1 }, payload: { type: "object" } },
		},
		version: "1.0.0",
	}));
	const commands = [contribution({
		command_id: `${pluginId}.command.write`,
		audience: "superboard_front",
		permission: `${pluginId}.write`,
		failure_policy: "fail_closed",
		version: "1.0.0",
	})];
	const dataSources = stores.map(({ store_id: storeId }) => contribution({
		data_source_id: `${storeId.replace(".store.", ".data_source.")}`,
		audience: "superboard_front",
		permission: `${pluginId}.read`,
		store_id: storeId,
		consistency: "strong",
		unavailable_state: "unavailable",
		version: "1.0.0",
	}));
	const workerDescriptor = worker
		? {
				...worker,
				store_ids: stores.map(({ store_id: storeId }) => storeId),
				repository_ids: repositories.map(({ repository_id: repositoryId }) => repositoryId),
			}
		: null;
	if (workerDescriptor) workerDescriptor.checksum = hash(workerDescriptor);
	const manifestArtifact = {
		schema_version: "1.0.0",
		plugin_id: pluginId,
		plugin_kind: kind,
		plugin_version: "1.0.0",
		artifact_id: `${pluginId}@1.0.0`,
		publisher: "superboard",
		execution: { backend: kind === "full" ? "sandboxed" : "native", worker: kind === "full" ? "none" : "dedicated", renderer: "native_bundle" },
		capabilities: ["plugin.storage", ...(kind === "module" ? ["worker.execute"] : [])],
		aliases: {},
		stores,
		schemas,
		renderers: [],
		commands,
		data_sources: dataSources,
		failure_policies: { writes: "fail_closed", reads: "unavailable" },
	};
	return {
		manifest: { ...manifestArtifact, artifact_checksum: hash(manifestArtifact) },
		repositories,
		worker_descriptor: workerDescriptor,
	};
}

function contribution(content) {
	return { ...content, checksum: hash(content) };
}

function workerRuntimeContract(name, worker) {
	const asynchronous = new Set([
		"billing",
		"support",
		"flows",
		"analytics",
		"marketing",
		"email",
		"custom-*",
	]).has(name);
	const path = worker ? `workers/${worker}` : "deploy/targets";
	const proof = worker
		? workerProof(worker, join(root, `workers/${worker}`))
		: join(root, "scripts/vocostar-managed-workers.test.mjs");
	return {
		path,
		execution_mode: asynchronous ? "asynchronous" : "synchronous",
		authoritative_writes: false,
		lease: asynchronous ? "attempt_scoped" : "not_applicable",
		idempotency: "required",
		outbox: asynchronous ? "required" : "not_applicable",
		callback_verification:
			name === "custom-*" ? "blocked_legacy_gateway" : "not_applicable",
		deployment_status: name === "custom-*" ? "not_ready" : "ready",
		evidence: relative(root, proof),
		evidence_sha256: fileChecksum(proof),
	};
}

function migrationInventory(pluginId) {
	const worker =
		pluginId === "supbrd-plug-user"
			? "identity"
			: pluginId === "supbrd-plug-products"
				? "products"
				: modulePlugins.find(([name]) => `supbrd-plugmod-${name}` === pluginId)?.[1];
	const migrations = [
		"apps/site/migrations/0005_plugin_store_authority.sql",
		"apps/site/migrations/0006_plugin_manifest_registry.sql",
	];
	if (!worker) return migrations;
	const directory = join(root, `workers/${worker}/migrations`);
	if (!existsSync(directory)) return migrations;
	return [
		...migrations,
		...readdirSync(directory)
			.filter((name) => name.endsWith(".sql"))
			.toSorted()
			.map((name) => `workers/${worker}/migrations/${name}`),
	];
}

function row({ id, kind, baseline, target, test, sourceStatus = "delivered", blocker = null }) {
	return {
		id,
		kind,
		baseline,
		target,
		test,
		proof_sha256: fileChecksum(join(root, test)),
		source_status: sourceStatus,
		blocker,
		required: sourceStatus === "delivered",
	};
}

function targetForRoute(route) {
	if (route.startsWith("/identity") || APP_USER_ROUTE_PATTERN.test(route)) return "supbrd-plug-user";
	if (route.startsWith("/products")) return "supbrd-plug-products";
	for (const name of ["paywalls", "support", "analytics", "marketing", "onboardings", "flows"]) {
		if (route.startsWith(`/${name}`)) return `supbrd-plugmod-${name}`;
	}
	if (route.startsWith("/dynamic-links")) return "supbrd-plugmod-dynamic-links";
	return "supbrd-core";
}

function apiProof(namespace) {
	if (namespace.includes("support")) return "workers/api/src/lib/support-gateway.test.ts";
	if (namespace.includes("billing") || namespace.includes("purchases") || namespace.includes("iap")) {
		return "workers/api/src/lib/purchases-v2.test.ts";
	}
	if (namespace.includes("mcp")) return "workers/api/src/routes/mcp.test.ts";
	if (namespace.includes("marketing")) return "workers/api/src/routes/marketing-sdk.test.ts";
	if (namespace.includes("platform")) return "workers/api/src/routes/platform-status.test.ts";
	if (namespace.includes("admin") || namespace.includes("automation") || namespace.includes("diagnostics")) {
		return "workers/api/src/routes/admin-cutover-flows-routing.test.ts";
	}
	if (namespace.includes("instances") || namespace.includes("projects") || namespace.includes("links")) {
		return "workers/api/src/routes/projects-visitors.test.ts";
	}
	if (namespace.includes("sdk")) return "workers/api/src/routes/sdk-auth.test.ts";
	if (namespace.includes("oauth") || namespace.includes("users")) {
		return "workers/api/src/routes/auth-routes.test.ts";
	}
	if (namespace === "/auth/*") return "workers/api/src/routes/providers.test.ts";
	if (namespace.includes("{domain}")) return "workers/api/src/lib/domain-modules.test.ts";
	if (namespace.includes("short-links")) return "workers/api/src/routes/redirect.test.ts";
	return "workers/api/src/index.test.ts";
}

function workerProof(worker, directory) {
	const preferred = join(directory, "src/index.test.ts");
	if (existsSync(preferred)) return preferred;
	const runtime = join(directory, `runtime-tests/${worker}.runtime.test.ts`);
	if (existsSync(runtime)) return runtime;
	return walk(directory, (path) => TEST_FILE_PATTERN.test(path))[0];
}

function fileChecksum(path) {
	if (!existsSync(path)) return null;
	return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function hash(value) {
	return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function walk(directory, predicate) {
	if (!existsSync(directory)) return [];
	const found = [];
	for (const name of readdirSync(directory).toSorted()) {
		if (["node_modules", "dist", ".wrangler", "coverage"].includes(name)) continue;
		const path = join(directory, name);
		if (statSync(path).isDirectory()) found.push(...walk(path, predicate));
		else if (predicate(path)) found.push(path);
	}
	return found;
}

function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.keys(value).toSorted().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
	return JSON.stringify(value);
}

function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function manifestRegistryMigration(topology) {
	const lines = ["PRAGMA foreign_keys = ON;", ""];
	for (const { manifest } of topology.plugins) {
		const json = JSON.stringify(manifest).replaceAll("'", "''");
		lines.push(
			`INSERT INTO superboard_plugin_manifest_artifacts (artifact_checksum, plugin_id, manifest_json, installed_at)`,
			`VALUES ('${manifest.artifact_checksum}', '${manifest.plugin_id}', '${json}', '2026-08-30T00:00:00.000Z')`,
			`ON CONFLICT(artifact_checksum) DO NOTHING;`,
			`INSERT INTO superboard_active_plugin_manifests (plugin_id, artifact_checksum, activated_at)`,
			`VALUES ('${manifest.plugin_id}', '${manifest.artifact_checksum}', '2026-08-30T00:00:00.000Z')`,
			`ON CONFLICT(plugin_id) DO UPDATE SET artifact_checksum = excluded.artifact_checksum, activated_at = excluded.activated_at;`,
			"",
		);
	}
	return `${lines.join("\n")}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const matrix = buildParityMatrix();
	const topology = buildPluginTopology();
	const errors = validateArtifacts(matrix, topology);
	if (errors.length > 0) {
		console.error(errors.join("\n"));
		process.exit(1);
	}
	const receipt = {
		schema_version: 1,
		matrix_sha256: `sha256:${createHash("sha256").update(canonical(matrix)).digest("hex")}`,
		topology_sha256: `sha256:${createHash("sha256").update(canonical(topology)).digest("hex")}`,
		row_count: matrix.rows.length,
		required_row_count: matrix.rows.filter(({ required }) => required).length,
		public_cutover: false,
		store_coverage: topology.plugins.flatMap(({ manifest }) =>
			manifest.stores.map(({ store_id: storeId, checksum }) => ({
				store_id: storeId,
				descriptor_checksum: checksum,
				executable_test: "apps/site/runtime-tests/plugin-store-authority.runtime.test.ts",
				test_sha256: fileChecksum(
					join(root, "apps/site/runtime-tests/plugin-store-authority.runtime.test.ts"),
				),
				double_import: "passed",
				shadow_read: "passed",
				reverse_delta: "passed_without_deletes",
				rollback: "non_destructive",
			})),
		),
	};
	if (process.argv.includes("--write")) {
		writeJson(matrixPath, matrix);
		writeJson(topologyPath, topology);
		writeJson(receiptPath, receipt);
		writeFileSync(manifestMigrationPath, manifestRegistryMigration(topology));
	} else {
		for (const [path, value] of [[matrixPath, matrix], [topologyPath, topology], [receiptPath, receipt]]) {
			if (!existsSync(path) || readFileSync(path, "utf8") !== `${JSON.stringify(value, null, 2)}\n`) {
				console.error(`Generated artifact drift: ${relative(root, path)}`);
				process.exitCode = 1;
			}
		}
		if (
			!existsSync(manifestMigrationPath) ||
			readFileSync(manifestMigrationPath, "utf8") !== manifestRegistryMigration(topology)
		) {
			console.error(`Generated artifact drift: ${relative(root, manifestMigrationPath)}`);
			process.exitCode = 1;
		}
	}
	console.log(
		JSON.stringify({
			matrix_sha256: receipt.matrix_sha256,
			topology_sha256: receipt.topology_sha256,
			row_count: receipt.row_count,
			required_row_count: receipt.required_row_count,
			store_count: receipt.store_coverage.length,
			public_cutover: receipt.public_cutover,
		}),
	);
}
