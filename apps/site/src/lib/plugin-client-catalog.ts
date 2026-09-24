import type { PluginViewProps } from "@superboard/front-ui/context";
import type { ComponentType, ReactNode } from "react";

import pluginPackages from "../../../../scripts/config/superboard-plugin-packages.json";

interface PluginClientModule {
	pluginId: string;
	views: Record<string, () => Promise<{ default: ComponentType<PluginViewProps> }>>;
	Providers?: ComponentType<PluginViewProps & { children: ReactNode }>;
}

const legacyRouteSuffix = /_legacy$/u;
const componentPrefix = /^supbrd-(?:plug|plugmod)-/u;
const modules = import.meta.glob<PluginClientModule>([
	"../../../../packages/plugins/superboard-*/src/front/index.ts",
	"../../../../packages/plugins/superboard-*/src/front/*/index.ts",
]);
const byPlugin = new Map(
	pluginPackages.packages.flatMap((definition) =>
		definition.components.map((pluginId) => {
			const short = pluginId.replace(componentPrefix, "");
			const directory = definition.components.length > 1 ? `/${short}` : "";
			const path = `../../../../packages/plugins/${definition.directory}/src/front${directory}/index.ts`;
			return [pluginId, modules[path]] as const;
		}),
	),
);

export async function loadPluginClientView(pluginId: string, routeId: string) {
	const load = byPlugin.get(pluginId);
	if (!load) throw new Error(`Plugin client unavailable: ${pluginId}`);
	const plugin = await load();
	if (plugin.pluginId !== pluginId) throw new Error("Plugin client ownership mismatch");
	const loadView = plugin.views[routeId] ?? plugin.views[routeId.replace(legacyRouteSuffix, "")];
	if (!loadView) throw new Error(`View is not registered by ${pluginId}: ${routeId}`);
	const module = await loadView();
	if (!module?.default)
		throw new Error(`View component is not exported by ${pluginId}: ${routeId}`);
	return { Page: module.default, Providers: plugin.Providers };
}
