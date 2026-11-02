import type { Storage } from "../storage/types.js";
import { INTERNAL_MEDIA_PREFIX } from "./normalize.js";

const SAFE_STORAGE_KEY = /^[A-Za-z0-9._-]+$/;

export function resolvePublicMediaUrl(
	storage: Storage | null | undefined,
	storageKey: string,
): string {
	if (!storageKey) return "";
	if (storage) return storage.getPublicUrl(storageKey);
	return `/_emdash/api/media/file/${storageKey}`;
}

export function createPublicMediaUrlResolver(
	storage: Storage | null | undefined,
): (key: string) => string {
	return (key) => resolvePublicMediaUrl(storage, key);
}

export interface RenderMediaRef {
	storageKey?: string;
	url?: string;
	id?: string;
}

export function buildRenderMediaUrl(
	resolve: ((key: string) => string) | undefined,
	ref: RenderMediaRef,
): string {
	const { storageKey, url, id } = ref;
	if (storageKey) {
		return resolve ? resolve(storageKey) : `${INTERNAL_MEDIA_PREFIX}${storageKey}`;
	}
	if (url) {
		if (resolve && url.startsWith(INTERNAL_MEDIA_PREFIX)) {
			const key = url.slice(INTERNAL_MEDIA_PREFIX.length);
			if (SAFE_STORAGE_KEY.test(key)) return resolve(key);
		}
		return url;
	}
	if (id) return `${INTERNAL_MEDIA_PREFIX}${id}`;
	return "";
}
