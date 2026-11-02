import { normalizeFocalPoint } from "./focal-point.js";
import type { MediaProvider, MediaProviderItem, MediaValue } from "./types.js";

export const INTERNAL_MEDIA_PREFIX = "/_emdash/api/media/file/";
const URL_PATTERN = /^https?:\/\//;

export async function normalizeMediaValue(
	value: unknown,
	getProvider: (id: string) => MediaProvider | undefined,
): Promise<MediaValue | null> {
	if (value == null) return null;

	if (typeof value === "string") {
		return normalizeStringUrl(value, getProvider);
	}

	if (!isRecord(value)) return null;

	if (!("id" in value) && !("src" in value)) return null;

	const provider = (typeof value.provider === "string" ? value.provider : undefined) || "local";
	const id = typeof value.id === "string" ? value.id : "";

	if (provider === "external") {
		return recordToMediaValue(value);
	}

	const result: MediaValue = { ...recordToMediaValue(value), provider };

	if (provider === "local") {
		delete result.src;
	}

	const needsDimensions = result.width == null || result.height == null;
	const needsStorageKey = provider === "local" && !result.meta?.storageKey;
	const needsFileInfo = !result.mimeType || !result.filename;
	const needsLqip =
		(result.mimeType ?? "").startsWith("image/") &&
		(result.blurhash == null || result.dominantColor == null);
	const needsLookup = needsDimensions || needsStorageKey || needsFileInfo || needsLqip;

	if (!needsLookup || !id) return result;

	const mediaProvider = getProvider(provider);
	if (!mediaProvider?.get) return result;

	let providerItem: MediaProviderItem | null;
	try {
		providerItem = await mediaProvider.get(id);
	} catch {
		return result;
	}

	if (!providerItem) return result;

	return mergeProviderData(result, providerItem);
}

async function normalizeStringUrl(
	url: string,
	getProvider: (id: string) => MediaProvider | undefined,
): Promise<MediaValue | null> {
	if (url.startsWith(INTERNAL_MEDIA_PREFIX)) {
		return resolveInternalUrl(url, getProvider);
	}

	if (URL_PATTERN.test(url)) {
		return Promise.resolve({
			provider: "external",
			id: "",
			src: url,
		});
	}

	const localMedia = await resolveLocalId(url, getProvider);
	if (localMedia) return localMedia;

	return {
		provider: "external",
		id: "",
		src: url,
	};
}

async function resolveInternalUrl(
	url: string,
	getProvider: (id: string) => MediaProvider | undefined,
): Promise<MediaValue> {
	const storageKey = url.slice(INTERNAL_MEDIA_PREFIX.length);
	const localProvider = getProvider("local");

	if (!localProvider?.get) {
		return { provider: "external", id: "", src: url };
	}

	let item: MediaProviderItem | null;
	try {
		item = await localProvider.get(storageKey);
	} catch {
		return { provider: "external", id: "", src: url };
	}

	if (!item) {
		return { provider: "external", id: "", src: url };
	}

	const focalPoint = normalizeFocalPoint(item.focalX, item.focalY);
	return {
		provider: "local",
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

async function resolveLocalId(
	id: string,
	getProvider: (id: string) => MediaProvider | undefined,
): Promise<MediaValue | null> {
	const localProvider = getProvider("local");

	if (!localProvider?.get) return null;

	let item: MediaProviderItem | null;
	try {
		item = await localProvider.get(id);
	} catch {
		return null;
	}

	if (!item) return null;

	const focalPoint = normalizeFocalPoint(item.focalX, item.focalY);
	return {
		provider: "local",
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

function mergeProviderData(existing: MediaValue, item: MediaProviderItem): MediaValue {
	const result = { ...existing };

	if (result.width == null && item.width != null) result.width = item.width;
	if (result.height == null && item.height != null) result.height = item.height;

	if (result.blurhash == null && item.blurhash != null) result.blurhash = item.blurhash;
	if (result.dominantColor == null && item.dominantColor != null) {
		result.dominantColor = item.dominantColor;
	}

	if (!result.filename && item.filename) result.filename = item.filename;
	if (!result.mimeType && item.mimeType) result.mimeType = item.mimeType;

	if (!result.alt && item.alt) result.alt = item.alt;

	if (item.meta) {
		result.meta = { ...item.meta, ...result.meta };
	}

	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordToMediaValue(obj: Record<string, unknown>): MediaValue {
	const result: MediaValue = {
		id: typeof obj.id === "string" ? obj.id : "",
	};
	if (typeof obj.provider === "string") result.provider = obj.provider;
	if (typeof obj.src === "string") result.src = obj.src;
	if (typeof obj.previewUrl === "string") result.previewUrl = obj.previewUrl;
	if (typeof obj.filename === "string") result.filename = obj.filename;
	if (typeof obj.mimeType === "string") result.mimeType = obj.mimeType;
	if (typeof obj.width === "number") result.width = obj.width;
	if (typeof obj.height === "number") result.height = obj.height;
	const focalPoint = normalizeFocalPoint(obj.focalX, obj.focalY);
	if (focalPoint) {
		result.focalX = focalPoint.focalX;
		result.focalY = focalPoint.focalY;
	}
	if (typeof obj.blurhash === "string") result.blurhash = obj.blurhash;
	if (typeof obj.dominantColor === "string") result.dominantColor = obj.dominantColor;
	if (typeof obj.alt === "string") result.alt = obj.alt;
	if (isRecord(obj.meta)) result.meta = obj.meta;
	return result;
}
