import { definePlugin } from "emdash";

interface SuperBoardManifestPluginOptions {
	id: string;
	version: string;
}

export function createPlugin(options: SuperBoardManifestPluginOptions) {
	return definePlugin({ id: options.id, version: options.version });
}
