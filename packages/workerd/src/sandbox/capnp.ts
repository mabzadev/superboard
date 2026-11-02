import type { PluginManifest } from "emdash";

const SAFE_NAME_RE = /[^a-z0-9_-]/gi;
const NON_ALNUM_RE = /[^a-z0-9]+/i;

function toCapnpId(pluginId: string): string {
	const parts = pluginId.split(NON_ALNUM_RE).filter(Boolean);
	return parts
		.map((p, i) =>
			i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
		)
		.join("");
}

interface LoadedPlugin {
	manifest: PluginManifest;
	code: string;
	port: number;
	token: string;
}

interface CapnpOptions {
	plugins: Map<string, LoadedPlugin>;
	backingServiceAddress: string;
	configDir: string;
	emdashShimFile: string;
}

export function generateCapnpConfig(options: CapnpOptions): string {
	const { plugins, backingServiceAddress, emdashShimFile } = options;

	const lines: string[] = [
		`# Auto-generated workerd configuration for EmDash plugin sandbox`,
		`# Generated at: ${new Date().toISOString()}`,
		`# Plugins: ${plugins.size}`,
		``,
		`using Workerd = import "/workerd/workerd.capnp";`,
		``,
		`const config :Workerd.Config = (`,
		`  services = [`,
		`    (name = "emdash-backing", external = (address = "${backingServiceAddress}")),`,
	];

	const socketEntries: string[] = [];

	for (const [pluginId, plugin] of plugins) {
		const constId = toCapnpId(pluginId);
		const safeName = pluginId.replace(SAFE_NAME_RE, "_");

		lines.push(`    (name = "plugin-${safeName}", worker = .plugin${constId}),`);
		socketEntries.push(
			`    (name = "socket-${safeName}", address = "127.0.0.1:${plugin.port}", service = "plugin-${safeName}"),`,
		);
	}

	lines.push(`  ],`);

	lines.push(`  sockets = [`);
	for (const socket of socketEntries) {
		lines.push(socket);
	}
	lines.push(`  ],`);
	lines.push(`);`);
	lines.push(``);

	for (const [pluginId] of plugins) {
		const constId = toCapnpId(pluginId);
		const safeName = pluginId.replace(SAFE_NAME_RE, "_");
		const wrapperFile = `${safeName}-wrapper.js`;
		const pluginFile = `${safeName}-plugin.js`;

		lines.push(`const plugin${constId} :Workerd.Worker = (`);
		lines.push(`  modules = [`);
		lines.push(`    (name = "worker.js", esModule = embed "${wrapperFile}"),`);
		lines.push(`    (name = "sandbox-plugin.js", esModule = embed "${pluginFile}"),`);
		lines.push(`    (name = "emdash", esModule = embed "${emdashShimFile}"),`);
		lines.push(`  ],`);
		lines.push(`  compatibilityDate = "2025-01-01",`);
		lines.push(`  compatibilityFlags = ["nodejs_compat"],`);
		lines.push(`  globalOutbound = "emdash-backing",`);
		lines.push(`);`);
		lines.push(``);
	}

	return lines.join("\n");
}
