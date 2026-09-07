import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "oxfmt";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(
	await readFile(resolve(root, "config/superboard-plugin-api-adapters.json"), "utf8"),
);
const directory = resolve(root, "packages/supbrd-runtime-plugins/src/front/client/plugins");
const check = process.argv.includes("--check");
const failures = [];
for (const pluginId of await readdir(directory)) {
	const adapters = registry.adapters
		.filter(
			(adapter) =>
				adapter.plugin_id === pluginId &&
				adapter.status === "verified" &&
				adapter.audience !== "application_client",
		)
		.map((adapter) => ({
			id: adapter.id,
			kind: adapter.kind,
			operations: adapter.operations.map((operation) => ({
				method: operation.method,
				path: operation.path,
				query: operation.query,
				body: operation.body,
				...(Object.keys(operation.parameter_values ?? {}).length
					? { parameter_values: operation.parameter_values }
					: {}),
				...(operation.read_only ? { read_only: true } : {}),
			})),
		}));
	const path = resolve(directory, pluginId, "adapters.ts");
	const formatted = await format(
		path,
		`import type { PluginApiAdapter } from "@superboard/front-ui/api";\n\nexport const adapters = ${JSON.stringify(adapters, null, "\t")} satisfies readonly PluginApiAdapter[];\n`,
		{ useTabs: true, sortImports: {} },
	);
	if (formatted.errors.length) throw new Error(`Invalid client adapter source for ${pluginId}`);
	const contents = formatted.code;
	if (check) {
		if ((await readFile(path, "utf8").catch(() => "")) !== contents) failures.push(pluginId);
	} else await writeFile(path, contents);
}
process.stdout.write(
	`${JSON.stringify({ status: failures.length ? "stale" : "ok", plugins: failures })}\n`,
);
if (failures.length) process.exitCode = 1;
