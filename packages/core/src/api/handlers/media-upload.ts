import * as path from "node:path";

import type { Kysely } from "kysely";
import { ulid } from "ulidx";

import { MediaRepository, type MediaItem } from "../../database/repositories/media.js";
import type { Database } from "../../database/types.js";
import { enrichImageMetadata } from "../../media/enrich.js";
import { matchesMimeAllowlist, normalizeMime } from "../../media/mime.js";
import { SsrfError, ssrfSafeFetch } from "../../security/ssrf.js";
import type { Storage } from "../../storage/types.js";
import { decodeBase64Bytes } from "../../utils/base64.js";
import { computeContentHash } from "../../utils/hash.js";
import { CONTENT_TYPE_RE, DEFAULT_MAX_UPLOAD_SIZE, formatFileSize } from "../schemas/media.js";
import type { ApiResult } from "../types.js";
import { GLOBAL_UPLOAD_ALLOWLIST } from "./media-allowlist.js";

export interface MediaUploadInput {
	filename: string;
	base64?: string;
	url?: string;
	contentType?: string;
	alt?: string;
	authorId?: string;
	maxUploadSize?: number;
}

export type MediaUploadResult = ApiResult<{
	item: MediaItem & { url: string };
	deduplicated?: boolean;
}>;

function fail(code: string, message: string): MediaUploadResult {
	return { success: false, error: { code, message } };
}

function withUrl(item: MediaItem): MediaItem & { url: string } {
	return { ...item, url: `/_emdash/api/media/file/${item.storageKey}` };
}

function bareMime(headerValue: string): string {
	return (headerValue.split(";")[0] ?? "").trim();
}

async function acquireBytes(
	input: MediaUploadInput,
	maxUploadSize: number,
): Promise<{ bytes: Uint8Array; mimeType: string } | MediaUploadResult> {
	if (input.base64) {
		if (!input.contentType) {
			return fail("VALIDATION_ERROR", "contentType is required when uploading base64 data");
		}
		if ((input.base64.length * 3) / 4 > maxUploadSize) {
			return fail(
				"PAYLOAD_TOO_LARGE",
				`File exceeds maximum size of ${formatFileSize(maxUploadSize)}`,
			);
		}
		try {
			return { bytes: decodeBase64Bytes(input.base64), mimeType: input.contentType };
		} catch {
			return fail("VALIDATION_ERROR", "Invalid base64 data");
		}
	}

	const url = input.url;
	if (!url) {
		return fail("VALIDATION_ERROR", "Provide exactly one of 'base64' or 'url'");
	}
	let response: Response;
	try {
		response = await ssrfSafeFetch(url, { headers: { accept: "*/*" } });
	} catch (error) {
		if (error instanceof SsrfError) {
			return fail("VALIDATION_ERROR", `URL not allowed: ${error.message}`);
		}
		return fail("FETCH_ERROR", "Failed to fetch file from URL");
	}
	if (!response.ok) {
		return fail("FETCH_ERROR", `Failed to fetch file from URL (HTTP ${response.status})`);
	}

	const contentLength = response.headers.get("Content-Length");
	if (contentLength && parseInt(contentLength, 10) > maxUploadSize) {
		return fail(
			"PAYLOAD_TOO_LARGE",
			`File exceeds maximum size of ${formatFileSize(maxUploadSize)}`,
		);
	}

	const mimeType = input.contentType ?? bareMime(response.headers.get("Content-Type") ?? "");
	if (!mimeType) {
		return fail("VALIDATION_ERROR", "Could not determine MIME type — pass contentType explicitly");
	}

	const bytes = new Uint8Array(await response.arrayBuffer());
	return { bytes, mimeType };
}

export async function handleMediaUpload(
	db: Kysely<Database>,
	storage: Storage,
	input: MediaUploadInput,
): Promise<MediaUploadResult> {
	if (!input.base64 === !input.url) {
		return fail("VALIDATION_ERROR", "Provide exactly one of 'base64' or 'url'");
	}

	const rawMax = input.maxUploadSize ?? DEFAULT_MAX_UPLOAD_SIZE;
	if (!Number.isFinite(rawMax) || rawMax <= 0) {
		return fail("CONFIGURATION_ERROR", "Invalid maxUploadSize configuration");
	}

	const acquired = await acquireBytes(input, rawMax);
	if ("success" in acquired) return acquired;
	const { bytes } = acquired;

	if (!CONTENT_TYPE_RE.test(acquired.mimeType)) {
		return fail("VALIDATION_ERROR", "Invalid content type");
	}
	const mimeType = normalizeMime(acquired.mimeType);

	if (!matchesMimeAllowlist(mimeType, GLOBAL_UPLOAD_ALLOWLIST)) {
		return fail("INVALID_TYPE", "File type not allowed");
	}
	if (bytes.byteLength > rawMax) {
		return fail("PAYLOAD_TOO_LARGE", `File exceeds maximum size of ${formatFileSize(rawMax)}`);
	}

	try {
		const contentHash = await computeContentHash(bytes);
		const repo = new MediaRepository(db);

		const existing = await repo.findByContentHash(contentHash);
		if (existing) {
			return { success: true, data: { item: withUrl(existing), deduplicated: true } };
		}

		const storageKey = `${ulid()}${path.extname(input.filename)}`;
		await storage.upload({ key: storageKey, body: bytes, contentType: mimeType });

		try {
			const enriched = await enrichImageMetadata(bytes, mimeType);
			const item = await repo.create({
				filename: input.filename,
				mimeType,
				size: bytes.byteLength,
				width: enriched.width,
				height: enriched.height,
				alt: input.alt,
				storageKey,
				contentHash,
				blurhash: enriched.blurhash,
				dominantColor: enriched.dominantColor,
				authorId: input.authorId,
			});
			return { success: true, data: { item: withUrl(item) } };
		} catch (error) {
			try {
				await storage.delete(storageKey);
			} catch {}
			throw error;
		}
	} catch {
		return fail("UPLOAD_ERROR", "Upload failed");
	}
}
