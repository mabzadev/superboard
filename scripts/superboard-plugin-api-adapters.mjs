import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const compact = (text) => text.replace(/\s+/gu, "");
const httpMethod = (method) => (method === "DELETE_REQUEST" ? "DELETE" : method);
const equalSets = (left, right) =>
	left.length === right.length && left.every((value) => right.includes(value));

export function validatePluginApiAdapters(registry, baseline, root = repositoryRoot) {
	const errors = [];
	const unresolved = [];
	const issue = (code, id, detail) => errors.push({ code, id, detail });
	const expected = new Map(
		baseline.plugins.flatMap((plugin) =>
			plugin.api
				.filter(({ route_id }) => /\.(?:command|data_source)\./u.test(route_id))
				.map(({ route_id }) => [route_id.slice("gateway.".length), plugin.plugin_id]),
		),
	);
	const pluginIds = new Set(baseline.plugins.map(({ plugin_id }) => plugin_id));
	for (const contribution of registry.additional_contributions ?? []) {
		const { id, plugin_id: pluginId } = contribution;
		if (
			!pluginIds.has(pluginId) ||
			typeof id !== "string" ||
			!id.startsWith(`${pluginId}.`) ||
			!/^(?:command|data_source)\.[a-z][a-z0-9_]*$/u.test(id.slice(pluginId.length + 1)) ||
			expected.has(id)
		) {
			issue("ADDITIONAL_CONTRIBUTION_INVALID", id);
			continue;
		}
		expected.set(id, pluginId);
	}
	if (registry.schema_version !== 1) issue("SCHEMA_VERSION_INVALID");
	if (registry.baseline_source_release_sha256 !== baseline.source_release_sha256)
		issue("BASELINE_MISMATCH");
	const seen = new Set();
	for (const adapter of registry.adapters ?? []) {
		const id = adapter.id;
		if (seen.has(id)) issue("DUPLICATE_ADAPTER", id);
		seen.add(id);
		if (expected.get(id) !== adapter.plugin_id) issue("UNKNOWN_ADAPTER", id);
		const kind = id.includes(".command.") ? "command" : "data_source";
		if (adapter.kind !== kind) issue("ADAPTER_KIND_MISMATCH", id);
		if (adapter.status === "unresolved") {
			unresolved.push(id);
			if (adapter.operations?.length) issue("UNRESOLVED_ADAPTER_DISPATCHABLE", id);
			if (!adapter.reason?.trim() || (!adapter.sources?.length && !adapter.candidates?.length))
				issue("UNRESOLVED_REASON_MISSING", id);
		} else if (adapter.status !== "verified" || !adapter.operations?.length)
			issue("VERIFIED_OPERATION_MISSING", id);
		for (const operation of [...(adapter.operations ?? []), ...(adapter.candidates ?? [])]) {
			const candidate = !adapter.operations?.includes(operation);
			const path = operation.path ?? "";
			if (!methods.has(operation.method)) issue("METHOD_INVALID", id, operation.method);
			if (
				!candidate &&
				kind === "data_source" &&
				operation.method !== "GET" &&
				operation.read_only !== true
			)
				issue("DATASOURCE_MUTATION_UNREVIEWED", id, operation.method);
			if (
				!/^\/(?:api\/v[12]|_emdash\/api|internal\/v1)(?:\/|$)/u.test(path) ||
				/[?#*{}\\]/u.test(path) ||
				path.includes("..")
			)
				issue("PATH_INVALID", id, path);
			if (!candidate && path.startsWith("/internal/"))
				issue("INTERNAL_DISPATCH_REQUIRES_ADAPTER", id, path);
			const parameters = [...path.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/gu)].map((match) => match[1]);
			if (!equalSets([...new Set(parameters)], operation.parameters ?? []))
				issue("PARAMETERS_MISMATCH", id, path);
			if ((operation.server_bound_parameters ?? []).some((name) => !parameters.includes(name)))
				issue("SERVER_PARAMETER_MISMATCH", id, path);
			for (const [name, values] of Object.entries(operation.parameter_values ?? {})) {
				if (
					!parameters.includes(name) ||
					!Array.isArray(values) ||
					!values.length ||
					values.some((value) => typeof value !== "string" || /[/?#]/u.test(value))
				)
					issue("PARAMETER_VALUES_INVALID", id, name);
			}
			if (!operation.sources?.length) issue("OPERATION_SOURCE_MISSING", id, path);
			for (const source of operation.sources ?? []) {
				inspectSource(source, id, operation);
			}
		}
		for (const source of adapter.sources ?? []) inspectSource(source, id);
	}
	for (const id of expected.keys()) if (!seen.has(id)) issue("MISSING_ADAPTER", id);
	return {
		static_valid: errors.length === 0,
		dispatch_complete: errors.length === 0 && unresolved.length === 0,
		adapter_count: seen.size,
		verified_count: seen.size - unresolved.length,
		unresolved,
		errors,
	};

	function inspectSource(source, id, operation) {
		if (!source.file || isAbsolute(source.file) || source.file.split("/").includes("..")) {
			issue("SOURCE_PATH_INVALID", id, source.file);
			return;
		}
		const path = resolve(root, source.file);
		if (!existsSync(path)) {
			issue("SOURCE_MISSING", id, source.file);
			return;
		}
		const text = readFileSync(path, "utf8");
		if (!source.symbol || !text.includes(source.symbol))
			issue("SOURCE_SYMBOL_MISMATCH", id, source.file);
		if (!source.expression || !compact(text).includes(compact(source.expression)))
			issue("SOURCE_EXPRESSION_MISMATCH", id, source.file);
		if (
			source.transport_method &&
			operation &&
			httpMethod(source.transport_method) !== operation.method
		)
			issue("SOURCE_METHOD_MISMATCH", id, source.file);
		if (
			source.transport_method &&
			source.expression !== source.symbol &&
			!compact(text).includes(`${source.transport_method}(${compact(source.expression)}`)
		)
			issue("SOURCE_TRANSPORT_MISMATCH", id, source.file);
		if (
			source.path_fragment &&
			operation &&
			(!text.includes(source.path_fragment) || !operation.path.includes(source.path_fragment))
		)
			issue("SOURCE_PATH_FRAGMENT_MISMATCH", id, source.file);
	}
}

function main() {
	const registry = JSON.parse(
		readFileSync(resolve(repositoryRoot, "config/superboard-plugin-api-adapters.json"), "utf8"),
	);
	const baseline = JSON.parse(
		readFileSync(
			resolve(repositoryRoot, "config/superboard-plugin-independence-baseline.json"),
			"utf8",
		),
	);
	const report = validatePluginApiAdapters(registry, baseline);
	console.log(JSON.stringify(report, null, 2));
	if (!report.dispatch_complete) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
