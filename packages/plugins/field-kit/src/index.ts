import type { PluginDescriptor } from "emdash";
import { definePlugin } from "emdash";

const PLUGIN_ID = "field-kit";
const PLUGIN_VERSION = "0.0.0";

export function createPlugin() {
	return definePlugin({
		id: PLUGIN_ID,
		version: PLUGIN_VERSION,
		admin: {
			entry: "@emdash-cms/plugin-field-kit/admin",
			fieldWidgets: [
				{ name: "object-form", label: "Object form", fieldTypes: ["json"] },
				{ name: "list", label: "List", fieldTypes: ["json"] },
				{ name: "grid", label: "Grid", fieldTypes: ["json"] },
				{ name: "tags", label: "Tags input", fieldTypes: ["json"] },
			],
		},
	});
}

export default createPlugin;

export function fieldKitPlugin(): PluginDescriptor {
	return {
		id: PLUGIN_ID,
		version: PLUGIN_VERSION,
		entrypoint: "@emdash-cms/plugin-field-kit",
		options: {},
		adminEntry: "@emdash-cms/plugin-field-kit/admin",
	};
}
