import type { PluginDescriptor } from "emdash";
import { definePlugin } from "emdash";

export function createPlugin() {
	return definePlugin({
		id: "color",
		version: "0.0.1",

		admin: {
			entry: "@emdash-cms/plugin-color/admin",
			fieldWidgets: [
				{
					name: "picker",
					label: "Color Picker",
					fieldTypes: ["string"],
				},
			],
		},
	});
}

export default createPlugin;

export function colorPlugin(): PluginDescriptor {
	return {
		id: "color",
		version: "0.0.1",
		entrypoint: "@emdash-cms/plugin-color",
		options: {},
		adminEntry: "@emdash-cms/plugin-color/admin",
	};
}
