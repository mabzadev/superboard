import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const matrixPath = join(root, "config/emdash-parity-matrix.json");
const topologyPath = join(root, "config/emdash-plugin-topology.json");
const receiptPath = join(root, "docs/evidence/issue-54/parity-matrix.receipt.json");
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

export function buildPluginTopology() {
	const plugins = [
		...fullPlugins.map((name) => pluginManifest(`supbrd-plug-${name}`, "full", null)),
		...modulePlugins.map(([name, worker]) => pluginManifest(`supbrd-plugmod-${name}`, "module", {
				path: worker ? `workers/${worker}` : "config/superboard-targets/*/customWorkers",
				authoritative_writes: false,
				lease: "attempt_scoped",
				idempotency: "required",
				outbox: "required",
				callback_verification: "signed_and_leased",
			})),
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
			test: "scripts/emdash-parity-matrix.test.mjs",
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
		test: "scripts/superboard-inventory.test.mjs",
		sourceStatus: namespace.includes("support") ? "unvalidated" : "delivered",
		blocker: namespace.includes("support") ? "support_extended_gate" : null,
	}));

	const workerRows = modulePlugins.flatMap(([name, worker]) => {
		if (!worker) return [];
		const workerDirectory = join(root, `workers/${worker}`);
		const proof = walk(workerDirectory, (path) => TEST_FILE_PATTERN.test(path))[0];
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
		["react-native", "sdks/react-native/src", "sdks/react-native/plugin/__tests__/emdash-store-parity.test.js"],
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
	const pluginIds = new Set(topology.plugins.map(({ plugin_id }) => plugin_id));
	const errors = [];
	if (topology.plugins.length !== 19) errors.push("PLUGIN_TOPOLOGY_INCOMPLETE");
	for (const plugin of topology.plugins) {
		if (plugin.stores.length !== 1 || plugin.repositories.length !== 1) errors.push(`PLUGIN_AUTHORITY_MISSING:${plugin.plugin_id}`);
		if (plugin.plugin_kind === "module" && (!plugin.worker_descriptor || plugin.worker_descriptor.authoritative_writes !== false || plugin.worker_descriptor.lease !== "attempt_scoped" || plugin.worker_descriptor.idempotency !== "required" || plugin.worker_descriptor.outbox !== "required" || plugin.worker_descriptor.callback_verification !== "signed_and_leased")) errors.push(`WORKER_TRANSITION_CONTRACT_INVALID:${plugin.plugin_id}`);
		const { artifact_checksum: artifactChecksum, ...artifact } = plugin;
		if (artifactChecksum !== hash(artifact)) errors.push(`PLUGIN_ARTIFACT_CHECKSUM_INVALID:${plugin.plugin_id}`);
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

function pluginManifest(pluginId, kind, worker) {
	const store = {
		store_id: `${pluginId}.store.authority`,
		schema_version: "1.0.0",
		classification: "restricted",
	};
	store.checksum = hash(store);
	const repository = {
		repository_id: `${pluginId}.repository.authority`,
		store_id: store.store_id,
		write_authority: "emdash",
		compatibility_aliases: ["projectId", "pid"],
	};
	repository.checksum = hash(repository);
	const workerDescriptor = worker ? { ...worker } : null;
	if (workerDescriptor) workerDescriptor.checksum = hash(workerDescriptor);
	const artifact = {
		schema_version: "1.0.0",
		plugin_id: pluginId,
		plugin_kind: kind,
		version: "1.0.0",
		stores: [store],
		repositories: [repository],
		worker_descriptor: workerDescriptor,
	};
	return { ...artifact, artifact_checksum: hash(artifact) };
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
	};
	if (process.argv.includes("--write")) {
		writeJson(matrixPath, matrix);
		writeJson(topologyPath, topology);
		writeJson(receiptPath, receipt);
	} else {
		for (const [path, value] of [[matrixPath, matrix], [topologyPath, topology], [receiptPath, receipt]]) {
			if (!existsSync(path) || readFileSync(path, "utf8") !== `${JSON.stringify(value, null, 2)}\n`) {
				console.error(`Generated artifact drift: ${relative(root, path)}`);
				process.exitCode = 1;
			}
		}
	}
	console.log(JSON.stringify(receipt));
}
