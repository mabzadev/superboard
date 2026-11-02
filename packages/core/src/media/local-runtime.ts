import type { Kysely } from "kysely";

import { MediaRepository } from "../database/repositories/media.js";
import type { Database } from "../database/types.js";
import type { Storage } from "../index.js";
import { invalidateSiteSettingsCache } from "../settings/index.js";
import type {
	CreateMediaProviderFn,
	MediaProvider,
	MediaListOptions,
	MediaProviderItem,
	MediaValue,
	EmbedResult,
	EmbedOptions,
} from "./types.js";

export interface LocalMediaRuntimeConfig {
	enabled?: boolean;
	db?: Kysely<Database>;
	getDb?: () => Kysely<Database>;
	storage?: Storage;
}

export const createMediaProvider: CreateMediaProviderFn<LocalMediaRuntimeConfig> = (config) => {
	const { db, storage } = config;

	if (!db) {
		throw new Error("Local media provider requires database connection");
	}

	const resolveDb = config.getDb ?? (() => db);
	const repo = () => new MediaRepository(resolveDb());

	const provider: MediaProvider = {
		async list(options: MediaListOptions) {
			const result = await repo().findMany({
				cursor: options.cursor,
				limit: options.limit,
				mimeType: options.mimeType,
			});

			return {
				items: result.items.map((item) => ({
					id: item.id,
					filename: item.filename,
					mimeType: item.mimeType,
					size: item.size ?? undefined,
					width: item.width ?? undefined,
					height: item.height ?? undefined,
					focalX: item.focalX ?? undefined,
					focalY: item.focalY ?? undefined,
					blurhash: item.blurhash ?? undefined,
					dominantColor: item.dominantColor ?? undefined,
					alt: item.alt ?? undefined,
					previewUrl: `/_emdash/api/media/file/${item.storageKey}`,
					meta: {
						storageKey: item.storageKey,
						caption: item.caption,
						blurhash: item.blurhash,
						dominantColor: item.dominantColor,
					},
				})),
				nextCursor: result.nextCursor,
			};
		},

		async get(id: string) {
			const item = await repo().findById(id);
			if (!item) return null;

			return {
				id: item.id,
				filename: item.filename,
				mimeType: item.mimeType,
				size: item.size ?? undefined,
				width: item.width ?? undefined,
				height: item.height ?? undefined,
				focalX: item.focalX ?? undefined,
				focalY: item.focalY ?? undefined,
				blurhash: item.blurhash ?? undefined,
				dominantColor: item.dominantColor ?? undefined,
				alt: item.alt ?? undefined,
				previewUrl: `/_emdash/api/media/file/${item.storageKey}`,
				meta: {
					storageKey: item.storageKey,
					caption: item.caption,
					blurhash: item.blurhash,
					dominantColor: item.dominantColor,
				},
			};
		},

		async upload(_input) {
			if (!storage) {
				throw new Error("Storage not configured for local media provider");
			}

			throw new Error("Local upload should use /_emdash/api/media endpoint");
		},

		async delete(id: string) {
			const repoInstance = repo();
			const item = await repoInstance.findById(id);
			if (!item) return;

			if (storage) {
				try {
					await storage.delete(item.storageKey);
				} catch {}
			}

			await repoInstance.delete(id);

			invalidateSiteSettingsCache();
		},

		getEmbed(value: MediaValue, _options?: EmbedOptions): EmbedResult {
			const storageKey =
				typeof value.meta?.storageKey === "string" ? value.meta.storageKey : value.id;
			const src = `/_emdash/api/media/file/${storageKey}`;
			const mimeType = value.mimeType || "";

			const blurhash =
				value.blurhash ??
				(typeof value.meta?.blurhash === "string" ? value.meta.blurhash : undefined);
			const dominantColor =
				value.dominantColor ??
				(typeof value.meta?.dominantColor === "string" ? value.meta.dominantColor : undefined);

			if (mimeType.startsWith("image/")) {
				return {
					type: "image",
					src,
					width: value.width,
					height: value.height,
					blurhash,
					dominantColor,
					alt: value.alt,
				};
			}

			if (mimeType.startsWith("video/")) {
				return {
					type: "video",
					src,
					width: value.width,
					height: value.height,
					controls: true,
					preload: "metadata",
				};
			}

			if (mimeType.startsWith("audio/")) {
				return {
					type: "audio",
					src,
					controls: true,
					preload: "metadata",
				};
			}

			return {
				type: "image",
				src,
				width: value.width,
				height: value.height,
				blurhash,
				dominantColor,
				alt: value.alt,
			};
		},

		getThumbnailUrl(id: string, _mimeType?: string) {
			return `/_emdash/api/media/file/${id}`;
		},
	};

	return provider;
};

export function repoItemToProviderItem(item: {
	id: string;
	filename: string;
	mimeType: string;
	size: number | null;
	width: number | null;
	height: number | null;
	focalX?: number | null;
	focalY?: number | null;
	alt: string | null;
	caption: string | null;
	storageKey: string;
	blurhash: string | null;
	dominantColor: string | null;
}): MediaProviderItem {
	return {
		id: item.id,
		filename: item.filename,
		mimeType: item.mimeType,
		size: item.size ?? undefined,
		width: item.width ?? undefined,
		height: item.height ?? undefined,
		focalX: item.focalX ?? undefined,
		focalY: item.focalY ?? undefined,
		blurhash: item.blurhash ?? undefined,
		dominantColor: item.dominantColor ?? undefined,
		alt: item.alt ?? undefined,
		previewUrl: `/_emdash/api/media/file/${item.storageKey}`,
		meta: {
			storageKey: item.storageKey,
			caption: item.caption,
			blurhash: item.blurhash,
			dominantColor: item.dominantColor,
		},
	};
}
