import { normalizeFocalPoint } from "./focal-point.js";

export interface MediaProviderDescriptor<TConfig = Record<string, unknown>> {
	id: string;

	name: string;

	icon?: string;

	entrypoint: string;

	adminModule?: string;

	capabilities: MediaProviderCapabilities;

	config: TConfig;
}

export interface MediaProviderCapabilities {
	browse: boolean;
	search: boolean;
	upload: boolean;
	delete: boolean;
}

export interface MediaListOptions {
	cursor?: string;
	limit?: number;
	query?: string;
	mimeType?: string;
}

export interface MediaListResult {
	items: MediaProviderItem[];
	nextCursor?: string;
}

export interface MediaProviderItem {
	id: string;
	filename: string;
	mimeType: string;
	size?: number;
	width?: number;
	height?: number;
	focalX?: number;
	focalY?: number;
	blurhash?: string;
	dominantColor?: string;
	alt?: string;
	previewUrl?: string;
	meta?: Record<string, unknown>;
}

export interface MediaUploadInput {
	file: File;
	filename: string;
	alt?: string;
}

export interface EmbedOptions {
	width?: number;
	height?: number;
	format?: "webp" | "avif" | "jpeg" | "png" | "auto";
}

export type EmbedResult = ImageEmbed | VideoEmbed | AudioEmbed | ComponentEmbed;

export interface ImageEmbed {
	type: "image";
	src: string;
	srcset?: string;
	sizes?: string;
	width?: number;
	height?: number;
	blurhash?: string;
	dominantColor?: string;
	alt?: string;
	cdnBaseUrl?: string;
	getSrc?: (opts: { width?: number; height?: number; format?: string }) => string;
}

export interface VideoEmbed {
	type: "video";
	src?: string;
	sources?: Array<{ src: string; type: string }>;
	poster?: string;
	width?: number;
	height?: number;
	controls?: boolean;
	autoplay?: boolean;
	muted?: boolean;
	loop?: boolean;
	playsinline?: boolean;
	preload?: "none" | "metadata" | "auto";
	crossorigin?: "anonymous" | "use-credentials";
}

export interface AudioEmbed {
	type: "audio";
	src?: string;
	sources?: Array<{ src: string; type: string }>;
	controls?: boolean;
	autoplay?: boolean;
	muted?: boolean;
	loop?: boolean;
	preload?: "none" | "metadata" | "auto";
}

export interface ComponentEmbed {
	type: "component";
	package: string;
	export?: string;
	props: Record<string, unknown>;
}

export interface ThumbnailOptions {
	width?: number;
	height?: number;
}

export interface MediaProvider {
	list(options: MediaListOptions): Promise<MediaListResult>;

	get?(id: string): Promise<MediaProviderItem | null>;

	upload?(input: MediaUploadInput): Promise<MediaProviderItem>;

	delete?(id: string): Promise<void>;

	getEmbed(value: MediaValue, options?: EmbedOptions): Promise<EmbedResult> | EmbedResult;

	getThumbnailUrl?(id: string, mimeType?: string, options?: ThumbnailOptions): string;
}

export type CreateMediaProviderFn<TConfig = Record<string, unknown>> = (
	config: TConfig,
) => MediaProvider;

export interface MediaValue {
	provider?: string;

	id: string;

	src?: string;

	previewUrl?: string;

	filename?: string;
	mimeType?: string;
	width?: number;
	height?: number;
	focalX?: number;
	focalY?: number;
	blurhash?: string;
	dominantColor?: string;
	alt?: string;

	meta?: Record<string, unknown>;
}

export function mediaItemToValue(providerId: string, item: MediaProviderItem): MediaValue {
	const focalPoint = normalizeFocalPoint(item.focalX, item.focalY);
	return {
		provider: providerId,
		id: item.id,
		filename: item.filename,
		mimeType: item.mimeType,
		width: item.width,
		height: item.height,
		...focalPoint,
		blurhash: item.blurhash,
		dominantColor: item.dominantColor,
		alt: item.alt,
		meta: item.meta,
	};
}
