import type { MediaProviderDescriptor } from "./types.js";

export interface LocalMediaConfig {
	enabled?: boolean;
}

export function localMedia(config: LocalMediaConfig = {}): MediaProviderDescriptor {
	return {
		id: "local",
		name: "Library",
		icon: "📁",
		entrypoint: "emdash/media/local-runtime",
		capabilities: {
			browse: true,
			search: false,
			upload: true,
			delete: true,
		},
		config: {
			enabled: config.enabled ?? true,
		},
	};
}
