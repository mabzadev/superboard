import * as path from "node:path";

import type { APIRoute } from "astro";
import { ulid } from "ulidx";

import { canReadMediaUsageCount, requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess, handleError, unwrapResult } from "#api/error.js";
import { GLOBAL_UPLOAD_ALLOWLIST, resolveFieldAllowlist } from "#api/handlers/media-allowlist.js";
import { handleMediaUsageSummaries } from "#api/handlers/media-usage.js";
import { isParseError, parseQuery } from "#api/parse.js";
import { DEFAULT_MAX_UPLOAD_SIZE, formatFileSize, mediaListQuery } from "#api/schemas.js";
import { MediaRepository } from "#db/repositories/media.js";
import { enrichImageMetadata } from "#media/enrich.js";
import { matchesMimeAllowlist, normalizeMime } from "#media/mime.js";
import { computeContentHash } from "#utils/hash.js";

import type { MediaItem } from "../../types.js";

export const prerender = false;

function addUrlToMedia(item: MediaItem): MediaItem & { url: string } {
	return {
		...item,
		url: `/_emdash/api/media/file/${item.storageKey}`,
	};
}

export const GET: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;

	const denied = requirePerm(user, "media:read");
	if (denied) return denied;

	if (!emdash?.handleMediaList) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const url = new URL(request.url);
	const query = parseQuery(url, mediaListQuery);
	if (isParseError(query)) return query;

	const result = await emdash.handleMediaList({
		cursor: query.cursor,
		page: query.page,
		limit: query.limit,
		mimeType: query.mimeType,
		q: query.q,
		folderId: query.folderId === "unfiled" ? null : query.folderId,
	});

	if (!result.success) {
		return unwrapResult(result);
	}

	const itemsWithUrl = result.data.items.map((item) => addUrlToMedia(item));
	if (query.includeUsage !== "1") {
		return apiSuccess({
			items: itemsWithUrl,
			nextCursor: result.data.nextCursor,
			totalCount: result.data.totalCount,
		});
	}

	const includeCount = canReadMediaUsageCount(user, locals.tokenScopes);
	const usageResult = await handleMediaUsageSummaries(
		emdash.db,
		itemsWithUrl.map((item) => item.id),
		{ includeCount },
	);
	if (!usageResult.success) return unwrapResult(usageResult);

	const itemsWithUsage = [];
	for (const item of itemsWithUrl) {
		const usage = usageResult.data[item.id];
		if (!usage) return apiError("MEDIA_USAGE_READ_ERROR", "Failed to read media usage", 500);
		itemsWithUsage.push({ ...item, usage });
	}

	return apiSuccess({
		items: itemsWithUsage,
		nextCursor: result.data.nextCursor,
		totalCount: result.data.totalCount,
	});
};

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;

	const denied = requirePerm(user, "media:upload");
	if (denied) return denied;

	if (!emdash?.handleMediaCreate) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	if (!emdash?.storage) {
		return apiError("NO_STORAGE", "Storage not configured", 500);
	}

	try {
		const rawMax = emdash.config.maxUploadSize ?? DEFAULT_MAX_UPLOAD_SIZE;
		if (!Number.isFinite(rawMax) || rawMax <= 0) {
			return apiError("CONFIGURATION_ERROR", "Invalid maxUploadSize configuration", 500);
		}
		const maxUploadSize = rawMax;

		const contentLength = request.headers.get("Content-Length");
		if (contentLength && parseInt(contentLength, 10) > maxUploadSize) {
			return apiError("PAYLOAD_TOO_LARGE", "Upload too large", 413);
		}

		const formData = await request.formData();
		const fileEntry = formData.get("file");
		const file = fileEntry instanceof File ? fileEntry : null;

		if (!file) {
			return apiError("NO_FILE", "No file provided", 400);
		}

		const fieldIdEntry = formData.get("fieldId");
		const fieldId =
			typeof fieldIdEntry === "string" && fieldIdEntry.length > 0 ? fieldIdEntry : null;

		const fieldAllowlist = fieldId ? await resolveFieldAllowlist(emdash.db, fieldId) : null;
		const allowlist = fieldAllowlist ?? [...GLOBAL_UPLOAD_ALLOWLIST];

		if (!matchesMimeAllowlist(file.type, allowlist)) {
			return apiError("INVALID_TYPE", "File type not allowed", 400);
		}

		if (file.size > maxUploadSize) {
			return apiError(
				"PAYLOAD_TOO_LARGE",
				`File exceeds maximum size of ${formatFileSize(maxUploadSize)}`,
				413,
			);
		}

		const buffer = new Uint8Array(await file.arrayBuffer());
		const contentHash = await computeContentHash(buffer);

		const repo = new MediaRepository(emdash.db);
		const existing = await repo.findByContentHash(contentHash);
		if (existing) {
			const itemWithUrl = addUrlToMedia(existing);
			return apiSuccess({ item: itemWithUrl, deduplicated: true });
		}

		const id = ulid();
		const ext = path.extname(file.name) || "";
		const storageKey = `${id}${ext}`;

		await emdash.storage.upload({
			key: storageKey,
			body: buffer,
			contentType: file.type,
		});

		const widthEntry = formData.get("width");
		const widthStr = typeof widthEntry === "string" ? widthEntry : null;
		const heightEntry = formData.get("height");
		const heightStr = typeof heightEntry === "string" ? heightEntry : null;
		const width = widthStr ? parseInt(widthStr, 10) : undefined;
		const height = heightStr ? parseInt(heightStr, 10) : undefined;

		const thumbnailEntry = formData.get("thumbnail");
		const thumbnail = thumbnailEntry instanceof File ? thumbnailEntry : null;
		const enriched = await enrichImageMetadata(buffer, file.type, {
			knownDimensions: width != null && height != null ? { width, height } : undefined,
			placeholder: thumbnail
				? { bytes: new Uint8Array(await thumbnail.arrayBuffer()), contentType: thumbnail.type }
				: undefined,
		});

		const result = await emdash.handleMediaCreate({
			filename: file.name,
			mimeType: normalizeMime(file.type),
			size: file.size,
			width: width ?? enriched.width,
			height: height ?? enriched.height,
			storageKey,
			contentHash,
			blurhash: enriched.blurhash,
			dominantColor: enriched.dominantColor,
			authorId: user?.id,
		});

		if (!result.success) {
			try {
				await emdash.storage.delete(storageKey);
			} catch {}
			return unwrapResult(result);
		}

		const itemWithUrl = addUrlToMedia(result.data.item);

		return apiSuccess({ item: itemWithUrl }, 201);
	} catch (error) {
		return handleError(error, "Upload failed", "UPLOAD_ERROR");
	}
};
