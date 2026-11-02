import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, handleError } from "#api/error.js";
import { ErrorCode } from "#api/errors.js";
import { archiveNameForDate, generateBackupJson } from "#api/handlers/backup.js";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(user, "backups:manage");
	if (denied) return denied;

	try {
		const json = await generateBackupJson(emdash.db);
		return new Response(json, {
			status: 200,
			headers: {
				"Content-Type": "application/json",
				"Content-Disposition": `attachment; filename="${archiveNameForDate(new Date())}"`,
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch (error) {
		return handleError(error, "Failed to generate backup", ErrorCode.BACKUP_EXPORT_ERROR);
	}
};
