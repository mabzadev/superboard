import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import definitions from "../config/superboard-plugin-packages.json" with { type: "json" };

function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object")
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
function checksum(value) {
	return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}
function settingKey(component, key) {
	return `${component}__${key}`;
}

export function buildPluginPackages(topology) {
	if (
		definitions.packages.filter((item) => item.kind === "business").length !== 7 ||
		definitions.packages.filter((item) => item.kind === "core").length !== 1
	)
		throw new Error("PLUGIN_PACKAGE_BOUNDARIES_INVALID");
	const components = new Map(
		topology.plugins
			.filter(({ manifest }) => !manifest.plugin_id.includes("*"))
			.map((entry) => [entry.manifest.plugin_id, entry]),
	);
	const owners = new Map();
	const plugins = definitions.packages.map((definition) => {
		const entries = definition.components.map((id) => {
			if (owners.has(id)) throw new Error(`DUPLICATE_COMPONENT_OWNER:${id}`);
			owners.set(id, definition.id);
			const entry = components.get(id);
			if (!entry) throw new Error(`MISSING_COMPONENT:${id}`);
			return entry;
		});
		const manifests = entries.map((entry) => entry.manifest);
		const manifest = {
			schema_version: "1.0.0",
			plugin_id: definition.id,
			plugin_kind: "full",
			plugin_version: "2.0.0",
			artifact_id: `${definition.id}@2.0.0`,
			publisher: "superboard",
			resources: [...new Set(manifests.flatMap((item) => item.resources))].sort(),
			settings: {
				render_mode: "block_kit",
				storage: "plugin_kv",
				schema: {
					type: "object",
					additionalProperties: false,
					required: manifests.flatMap((item) =>
						item.settings.schema.required.map((key) => settingKey(item.plugin_id, key)),
					),
					properties: Object.fromEntries(
						manifests.flatMap((item) =>
							Object.entries(item.settings.schema.properties).map(([key, value]) => [
								settingKey(item.plugin_id, key),
								value,
							]),
						),
					),
				},
			},
			execution: {
				backend: "sandboxed",
				worker: entries.some((entry) => entry.worker_descriptor) ? "dedicated" : "none",
				renderer: "native_bundle",
			},
			capabilities: [...new Set(manifests.flatMap((item) => item.capabilities))].sort(),
			aliases: Object.assign(
				{},
				...manifests.map((item) => item.aliases),
				Object.fromEntries(definition.components.map((id) => [id, definition.id])),
			),
			stores: manifests.flatMap((item) =>
				item.stores.map((store) => {
					const { checksum: _, ...content } = store;
					content.authority = definition.id;
					return { ...content, checksum: checksum(content) };
				}),
			),
			schemas: manifests.flatMap((item) => item.schemas),
			renderers: manifests.flatMap((item) => item.renderers),
			commands: manifests.flatMap((item) => item.commands),
			data_sources: manifests.flatMap((item) => item.data_sources),
			failure_policies: { writes: "fail_closed", reads: "unavailable" },
		};
		return {
			kind: definition.kind,
			label: definition.label,
			label_fr: definition.label_fr,
			components: definition.components,
			required_components: definition.required_components,
			component_artifacts: manifests.map((item) => ({
				id: item.plugin_id,
				version: item.plugin_version,
				checksum: item.artifact_checksum,
			})),
			worker_descriptors: entries
				.filter((entry) => entry.worker_descriptor)
				.map((entry) => ({ component: entry.manifest.plugin_id, ...entry.worker_descriptor })),
			manifest:
				definition.components.length === 1 && definition.components[0] === definition.id
					? manifests[0]
					: { ...manifest, artifact_checksum: checksum(manifest) },
		};
	});
	for (const id of components.keys())
		if (!owners.has(id)) throw new Error(`UNASSIGNED_COMPONENT:${id}`);
	return { schema_version: 1, plugins };
}

export function lintPluginPackageProject(root) {
	try {
		const topology = JSON.parse(
			readFileSync(join(root, "scripts/config/emdash-plugin-topology.json"), "utf8"),
		);
		const expected = buildPluginPackages(topology);
		const actual = JSON.parse(
			readFileSync(join(root, "scripts/config/superboard-plugin-catalog.json"), "utf8"),
		);
		if (canonical(actual) !== canonical(expected)) throw new Error("PLUGIN_PACKAGE_CATALOG_STALE");
		const expectedEntries = expected.plugins.map(({ manifest }) => manifest.plugin_id).sort();
		const entries = readdirSync(join(root, "packages/plugins"))
			.filter((name) => name.startsWith("supbrd-"))
			.sort();
		if (canonical(entries) !== canonical(expectedEntries))
			throw new Error("PLUGIN_PACKAGE_ENTRYPOINTS_INVALID");
		for (const name of entries) readFileSync(join(root, "packages/plugins", name, "src/index.ts"));
		return [];
	} catch (error) {
		return [
			{
				code: "superboard/plugin-packages",
				severity: "error",
				filename: "scripts/config/superboard-plugin-catalog.json",
				message: error instanceof Error ? error.message : "PLUGIN_PACKAGE_CONFIGURATION_INVALID",
				labels: [],
			},
		];
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const source = JSON.parse(
		readFileSync(new URL("../config/emdash-plugin-topology.json", import.meta.url), "utf8"),
	);
	const catalog = buildPluginPackages(source);
	const destination = new URL("../config/superboard-plugin-catalog.json", import.meta.url);
	const text = `${JSON.stringify(catalog, null, 2)}\n`;
	if (process.argv.includes("--check")) {
		if (readFileSync(destination, "utf8") !== text) throw new Error("PLUGIN_PACKAGE_CATALOG_STALE");
	} else writeFileSync(destination, text);
	console.log(
		`${catalog.plugins.filter((plugin) => plugin.kind === "business").length} business plugins, ${catalog.plugins.filter((plugin) => plugin.kind === "application").length} application plugin, 1 core`,
	);
}
