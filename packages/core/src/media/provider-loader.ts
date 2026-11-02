import type { MediaProvider, MediaProviderCapabilities } from "./types.js";

interface MediaProviderEntry {
	id: string;
	name: string;
	icon?: string;
	capabilities: MediaProviderCapabilities;
	createProvider: (ctx: Record<string, unknown>) => MediaProvider;
}

let virtualMediaProviders: MediaProviderEntry[] | undefined;

const mediaProviderInstances = new Map<string, MediaProvider>();

async function loadMediaProviders(): Promise<void> {
	if (virtualMediaProviders === undefined) {
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore - virtual module
		const providersModule = await import("virtual:emdash/media-providers");
		virtualMediaProviders = providersModule.mediaProviders || [];
	}
}

export async function getMediaProvider(providerId: string): Promise<MediaProvider | undefined> {
	const cached = mediaProviderInstances.get(providerId);
	if (cached) {
		return cached;
	}

	await loadMediaProviders();

	const entry = virtualMediaProviders?.find((p) => p.id === providerId);
	if (!entry) {
		return undefined;
	}

	const provider = entry.createProvider({});
	mediaProviderInstances.set(providerId, provider);
	return provider;
}
