import { INTERNAL_MEDIA_PREFIX } from "./normalize.js";

export const ALLOWED_TRANSFORM_FORMATS = ["webp", "avif", "jpeg", "png"] as const;

export const DEFAULT_TRANSFORM_FORMAT: ImageTransformFormat = "webp";

export const DEFAULT_TRANSFORM_QUALITY = 85;

export const MAX_TRANSFORM_DIMENSION = 4000;

export type ImageTransformFormat = (typeof ALLOWED_TRANSFORM_FORMATS)[number];

export interface ImageTransformOptions {
	width?: number;
	height?: number;
	format: ImageTransformFormat;
	quality?: number;
}

export const IMMUTABLE_IMAGE_CACHE = "public, max-age=31536000, immutable";

const SAFE_INLINE_IMAGE_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
	"image/avif",
	"image/x-icon",
]);

export function originalMediaHeaders(contentType: string): Record<string, string> {
	return {
		"Content-Type": contentType,
		"Cache-Control": IMMUTABLE_IMAGE_CACHE,
		"X-Content-Type-Options": "nosniff",
		"Content-Security-Policy":
			"sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
		"Content-Disposition": SAFE_INLINE_IMAGE_TYPES.has(contentType) ? "inline" : "attachment",
	};
}

const SAFE_STORAGE_KEY = /^[A-Za-z0-9._-]+$/;

const DECIMAL_DIGITS = /^\d+$/;

export function isSafeTransformKey(key: string): boolean {
	return SAFE_STORAGE_KEY.test(key);
}

export function matchInternalMediaKey(href: string | null | undefined): string | null {
	if (!href) return null;
	let pathname: string;
	try {
		pathname = new URL(href, "http://localhost").pathname;
	} catch {
		return null;
	}
	if (!pathname.startsWith(INTERNAL_MEDIA_PREFIX)) return null;
	const key = pathname.slice(INTERNAL_MEDIA_PREFIX.length);
	if (!key || !isSafeTransformKey(key)) return null;
	return key;
}

export function isTransformFormat(value: string): value is ImageTransformFormat {
	return (ALLOWED_TRANSFORM_FORMATS as readonly string[]).includes(value);
}

export type ParsedTransformParams =
	| { ok: true; options: ImageTransformOptions }
	| { ok: false; message: string };

export function resolveTransformQuality(
	format: ImageTransformFormat,
	requested: number | undefined,
): number | undefined {
	if (requested !== undefined) return requested;
	return format === "png" ? undefined : DEFAULT_TRANSFORM_QUALITY;
}

export function parseTransformParams(params: URLSearchParams): ParsedTransformParams {
	const width = parseDimension(params.get("w"));
	if (width === null) return { ok: false, message: "Invalid 'w' (width)" };
	if (width === undefined) return { ok: false, message: "Missing 'w' (width)" };

	const height = parseDimension(params.get("h"));
	if (height === null) return { ok: false, message: "Invalid 'h' (height)" };

	const formatRaw = params.get("f");
	let format: ImageTransformFormat = DEFAULT_TRANSFORM_FORMAT;
	if (formatRaw !== null) {
		if (!isTransformFormat(formatRaw)) {
			return { ok: false, message: `Unsupported 'f' (format): ${formatRaw}` };
		}
		format = formatRaw;
	}

	let quality: number | undefined;
	const qualityRaw = params.get("q");
	if (qualityRaw !== null) {
		const q = Number(qualityRaw);
		if (!Number.isInteger(q) || q < 1 || q > 100) {
			return { ok: false, message: "Invalid 'q' (quality), expected 1-100" };
		}
		quality = q;
	}

	return { ok: true, options: { width, height, format, quality } };
}

function parseDimension(raw: string | null): number | undefined | null {
	if (raw === null) return undefined;
	if (!DECIMAL_DIGITS.test(raw)) return null;
	const n = Number(raw);
	if (n < 1 || n > MAX_TRANSFORM_DIMENSION) return null;
	return n;
}
