import type { MediaItem, MediaProviderItem } from "./api/media.js";

export interface MediaFocalPoint {
	focalX: number;
	focalY: number;
}

function isFocalCoordinate(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function normalizeMediaFocalPoint(value: {
	focalX?: number | null;
	focalY?: number | null;
}): MediaFocalPoint | null {
	const { focalX, focalY } = value;
	if (!isFocalCoordinate(focalX) || !isFocalCoordinate(focalY)) return null;
	return { focalX, focalY };
}

export function getMediaObjectPosition(value: {
	focalX?: number | null;
	focalY?: number | null;
}): string | undefined {
	const point = normalizeMediaFocalPoint(value);
	if (!point) return undefined;
	return `${Math.round(point.focalX * 10_000) / 100}% ${Math.round(point.focalY * 10_000) / 100}%`;
}

export function metaString(
	meta: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = meta?.[key];
	return typeof value === "string" ? value : undefined;
}

export function metaNumber(
	meta: Record<string, unknown> | undefined,
	key: string,
): number | undefined {
	const value = meta?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export interface MediaPlayback {
	hls?: string;
	dash?: string;
}

export function metaPlayback(meta: Record<string, unknown> | undefined): MediaPlayback | undefined {
	const raw = meta?.playback;
	if (!isRecord(raw)) return undefined;
	const hls = typeof raw.hls === "string" ? raw.hls : undefined;
	const dash = typeof raw.dash === "string" ? raw.dash : undefined;
	return hls || dash ? { hls, dash } : undefined;
}

export function providerItemToMediaItem(
	providerId: string,
	item: MediaProviderItem,
): MediaItem & { provider: string; meta?: Record<string, unknown> } {
	return {
		id: item.id,
		filename: item.filename,
		mimeType: item.mimeType,
		url: item.previewUrl || "",
		size: item.size ?? metaNumber(item.meta, "size") ?? 0,
		width: item.width,
		height: item.height,
		blurhash: item.blurhash ?? metaString(item.meta, "blurhash"),
		dominantColor: item.dominantColor ?? metaString(item.meta, "dominantColor"),
		alt: item.alt,
		createdAt: new Date().toISOString(),
		provider: providerId,
		meta: item.meta,
	};
}

const INTERNAL_MEDIA_PREFIX = "/_emdash/api/media/file/";

export const MEDIA_THUMBNAIL_WIDTH = 400;

export function getMediaThumbnailUrl(
	originalUrl: string,
	mimeType: string,
	width: number = MEDIA_THUMBNAIL_WIDTH,
): string {
	if (!mimeType.startsWith("image/") || mimeType === "image/svg+xml") return originalUrl;
	if (!originalUrl.startsWith(INTERNAL_MEDIA_PREFIX)) return originalUrl;

	const origin = typeof window === "undefined" ? "" : window.location.origin;
	if (!origin) return originalUrl;

	const params = new URLSearchParams({
		href: `${origin}${originalUrl}`,
		w: String(width),
		f: "webp",
	});
	return `/_image?${params.toString()}`;
}

export function fallbackToOriginalThumbnail(
	img: { dataset: DOMStringMap; src: string },
	originalUrl: string,
): void {
	if (img.dataset.thumbFallback) return;
	img.dataset.thumbFallback = "1";
	img.src = originalUrl;
}

export function getFileIcon(mimeType: string): string {
	if (mimeType.startsWith("video/")) return "🎬";
	if (mimeType.startsWith("audio/")) return "🎵";
	if (mimeType.includes("pdf")) return "📄";
	if (mimeType.includes("document") || mimeType.includes("word")) return "📝";
	if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "📊";
	return "📁";
}

export function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
