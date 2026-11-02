import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, handleError, unwrapResult } from "#api/error.js";
import { ErrorCode } from "#api/errors.js";
import {
	BACKUP_STORAGE_PREFIX,
	deleteBackupArchive,
	isValidArchiveName,
} from "#api/handlers/backup.js";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	const name = params.name ?? "";

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(user, "backups:manage");
	if (denied) return denied;

	if (!emdash.storage) {
		return apiError("STORAGE_NOT_CONFIGURED", "No storage backend is configured", 503);
	}

	if (!isValidArchiveName(name)) {
		return apiError("VALIDATION_ERROR", "Invalid archive name", 400);
	}

	try {
		const result = await emdash.storage.download(`${BACKUP_STORAGE_PREFIX}${name}`);
		return new Response(result.body, {
			status: 200,
			headers: {
				"Content-Type": "application/json",
				"Content-Disposition": `attachment; filename="${name}"`,
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch (error) {
		if (error instanceof Error && error.message.toLowerCase().includes("not found")) {
			return apiError("NOT_FOUND", "Archive not found", 404);
		}
		return handleError(error, "Failed to download archive", ErrorCode.BACKUP_DOWNLOAD_ERROR);
	}
};

export const DELETE: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	const name = params.name ?? "";

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(user, "backups:manage");
	if (denied) return denied;

	if (!emdash.storage) {
		return apiError("STORAGE_NOT_CONFIGURED", "No storage backend is configured", 503);
	}

	return unwrapResult(await deleteBackupArchive(emdash.storage, name));
};
