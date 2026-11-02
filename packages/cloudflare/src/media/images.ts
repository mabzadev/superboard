import type { MediaProviderDescriptor } from "emdash/media";

export interface CloudflareImagesConfig {
	accountId?: string;

	accountIdEnvVar?: string;

	accountHash?: string;

	accountHashEnvVar?: string;

	apiToken?: string;

	apiTokenEnvVar?: string;

	deliveryDomain?: string;

	defaultVariant?: string;
}

const IMAGES_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="none" viewBox="0 0 64 64"><path fill="#F63" d="M56 11.92H8l-2 2v39.87l2 2h48l2-2V13.92l-2-2Zm-2 4v18.69l-8-6.55-2.62.08-5.08 4.68-5.43-4-2.47.08-14 11.7-6.4-4.4V15.92h44ZM10 51.79V41.08l5.3 3.7 2.42-.11L31.75 33l5.5 4 2.54-.14 5-4.63L54 39.77v12l-44 .02Z"/><path fill="#F63" d="M19.08 32.16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>')}`;

export function cloudflareImages(
	config: CloudflareImagesConfig,
): MediaProviderDescriptor<CloudflareImagesConfig> {
	return {
		id: "cloudflare-images",
		name: "Cloudflare Images",
		icon: IMAGES_ICON,
		entrypoint: "@emdash-cms/cloudflare/media/images-runtime",
		capabilities: {
			browse: true,
			search: false,
			upload: true,
			delete: true,
		},
		config,
	};
}
